"""Session-scoped preview frames, produced by a separate, on-demand off-screen Player."""
from collections import OrderedDict
import json
from pathlib import Path
import secrets
import socket
import subprocess
import threading
import time
import uuid


class ShotCache:
    def __init__(self, command, directory):
        self.command = command
        self.root = Path(directory)
        self.frames = OrderedDict()
        self.bytes = 0
        self.lock = threading.Lock()
        self.frames_lock = threading.Lock()
        self.closed = threading.Event()
        self.session = None
        self.child = self.conn = self.stream = None

    def start(self, session):
        self.stop_worker()
        directory = self.root / 'worker'
        directory.mkdir(exist_ok=True)
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            listener.listen(1)
            listener.settimeout(.2)
            cmd = list(self.command)
            if '-parentHWND' in cmd:
                i = cmd.index('-parentHWND')
                del cmd[i:i+3]
            if '-creator-connect' not in cmd:
                cmd.append('-creator-connect')
            token = secrets.token_urlsafe(32)
            for arg, value in [('-creator-output', directory), ('-creator-port', listener.getsockname()[1]),
                               ('-creator-token', token), ('-logFile', directory/'worker.log')]:
                cmd[cmd.index(arg)+1] = str(value)
            cmd += ['-batchmode', '-creator-shot-worker']
            self.child = subprocess.Popen(cmd, cwd=Path(cmd[0]).parent,
                                          creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
                                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            deadline = time.monotonic()+90
            while not self.closed.is_set() and self.child.poll() is None and time.monotonic()<deadline:
                try:
                    self.conn, _ = listener.accept()
                except socket.timeout:
                    continue
                self.conn.settimeout(65)
                self.stream = self.conn.makefile('rb')
                if self.stream.readline(256).rstrip() != ('creator-session '+token).encode():
                    self.stream.close()
                    self.conn.close()
                    continue
                self.session, self.token = session, token
                return
        raise RuntimeError('拍摄缓存 Player 启动失败')

    def stop_worker(self):
        if self.child is not None and self.child.poll() is None:
            self.child.terminate()
            try:
                self.child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.child.kill()
                self.child.wait()
        if self.stream is not None:
            self.stream.close()
        if self.conn is not None:
            self.conn.close()
        self.child = self.stream = self.conn = self.session = None

    def close(self):
        self.closed.set()
        with self.lock:
            self.stop_worker()

    def lookup(self, key):
        with self.frames_lock:
            if isinstance(key, str) and key in self.frames:
                self.frames.move_to_end(key)
                return key
        return None

    def sample(self, message):
        session = message.get('session')
        if not isinstance(session, str) or len(session)>64 or not session:
            raise ValueError('拍摄缓存会话无效')
        width, height = message.get('width'), message.get('height')
        if type(width)!=int or type(height)!=int or not 16<=min(width,height)<=max(width,height)<=1280 or width*height>921600:
            raise ValueError('拍摄缓存尺寸无效')
        states = message.get('states')
        if not isinstance(states, list) or not 1<=len(states)<=4:
            raise ValueError('拍摄缓存取样数量无效')
        capture = message.get('capture') is True
        result, evicted = [], []
        with self.lock:
            try:
                if self.closed.is_set():
                    raise RuntimeError('拍摄缓存已关闭')
                if self.session != session:
                    self.start(session)
                for state in states:
                    if self.closed.is_set():
                        raise RuntimeError('拍摄缓存已关闭')
                    key = uuid.uuid4().hex if capture else ''
                    request = dict(state, kind='state', id=1, token=self.token, mediaDraws=[], uiDraws=[],
                                   readShot='', writeShot=key, frameWidth=width, frameHeight=height)
                    request['composition'] = dict(version=1, time=state['composition']['time'], nodes=[dict(id='world', kind='world')])
                    self.conn.sendall((json.dumps(request, separators=(',', ':'), allow_nan=False)+'\n').encode())
                    reply = json.loads(self.stream.readline(8192))
                    if not reply.get('ok'):
                        raise RuntimeError(reply.get('error') or '拍摄缓存取样失败')
                    if not capture:
                        continue
                    path = self.root/(key+'.rgba')
                    size = path.stat().st_size
                    if size!=8+width*height*8:
                        raise RuntimeError('拍摄缓存帧不完整')
                    with self.frames_lock:
                        self.frames[key] = size
                        self.bytes += size
                        while self.bytes>640*1024**2:
                            old, old_size = self.frames.popitem(last=False)
                            (self.root/(old+'.rgba')).unlink(missing_ok=True)
                            self.bytes -= old_size
                            evicted.append(old)
                    result.append(key)
                return dict(ok=True, keys=result, evicted=evicted)
            except Exception:
                self.stop_worker()
                raise
