"""Clip-local deterministic FFmpeg effects. Shared by preview and export."""
import hashlib
import json
import math
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import threading
import wave

_lock=threading.Lock()
VERSION=2

def num(value,low,high):
    if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or not low<=value<=high:raise ValueError('声音效果参数无效')
    return float(value)

def validate(effects):
    if not isinstance(effects,list) or len(effects)>16:raise ValueError('声音效果数量无效')
    ids=set()
    for e in effects:
        if not isinstance(e,dict) or e.get('version')!=1 or e.get('type') not in ('telephone','echo') or not isinstance(e.get('enabled'),bool) or not isinstance(e.get('id'),str) or not 0<len(e['id'])<=100 or e['id'] in ids:raise ValueError('不支持的声音效果版本或类型')
        ids.add(e['id']);p=e.get('parameters')
        if not isinstance(p,dict):raise ValueError('声音效果参数缺失')
        if e['type']=='telephone':num(p.get('strength'),0,1);num(p.get('output'),-12,12)
        else:num(p.get('delay'),.02,1);num(p.get('feedback'),0,.85);num(p.get('mix'),0,1)
    return effects

def filters(effects):
    """Each effect preserves unit gain at zero strength. Echo tail is bounded."""
    parts=[]
    for e in validate(effects):
        if not e['enabled']:continue
        p=e['parameters']
        if e['type']=='telephone':
            s=p['strength']
            if s:
                # Strength smoothly narrows the pass band and adds soft clipping.
                parts+= [f'highpass=f={20+280*s:.6f}',f'lowpass=f={20000-16600*s:.6f}',f'asoftclip=type=tanh:threshold={1-.65*s:.6f}:output=1']
            if p['output']:parts.append(f"volume={p['output']:.6f}dB")
        elif p['mix']:
            # Finite feedback taps avoid unbounded tails and runaway feedback.
            taps=[(i,p['mix']*p['feedback']**(i-1)) for i in range(1,9) if p['mix']*p['feedback']**(i-1)>=1e-8]
            if not taps:continue
            delays='|'.join(f"{p['delay']*1000*i:.6f}" for i,_ in taps)
            decays='|'.join(f"{decay:.12g}" for _,decay in taps)
            parts.append(f"aecho=in_gain={1-p['mix']:.8f}:out_gain=1:delays={delays}:decays={decays}")
    return parts

def active(effects):
    return bool(filters(effects))

def prepare(root,item):
    from export_video import audio_file,audio_filter,validate_original_loop,audio_loop_cost,audio_loop_budget
    root=Path(root).resolve();effects=validate(item.get('effects',[]));source=audio_file(root,item.get('asset'))
    length=num(item.get('length'),.001,3600);offset=num(item.get('offset',0),0,3600);rate=num(item.get('rate',1),.25,4)
    loop=item.get('loop',False)
    if not isinstance(loop,bool):raise ValueError('循环参数无效')
    original=item.get('originalLoop');original_range=None
    if original is not None:
        if not loop:raise ValueError('原始循环点需要启用循环')
        original_range=validate_original_loop(source,original)
    ffmpeg=shutil.which('ffmpeg')
    if not ffmpeg:raise ValueError('声音效果需要 FFmpeg')
    if loop:audio_loop_budget(audio_loop_cost(shutil.which('ffprobe'),source),0)
    digest=hashlib.sha256()
    with source.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):digest.update(block)
    config={'version':VERSION,'source':digest.hexdigest(),'length':length,'offset':offset,'rate':rate,'loop':loop,'original':original_range,'effects':effects}
    key=hashlib.sha256(json.dumps(config,sort_keys=True,allow_nan=False).encode()).hexdigest()
    cache=root/'effect-cache';cache.mkdir(exist_ok=True);destination=cache/(key+'.wav')
    # Serialize producers; clients never observe half-written PCM.
    with _lock:
        if destination.is_file():
            try:
                with wave.open(str(destination),'rb') as wav:
                    if wav.getframerate()==48000 and wav.getnchannels()==2 and wav.getsampwidth()==2 and abs(wav.getnframes()-round(length*48000))<=1 and destination.stat().st_size>=wav.getnframes()*4+44:return key,destination
            except (wave.Error,EOFError,OSError):pass
        temp=cache/(key+'-'+secrets.token_hex(8)+'.wav')
        try:
            base=audio_filter(0,0,length,offset,length,1,0,0,loop,original_range,rate).replace('[0:a]','').split(',adelay=')[0]
            chain=','.join([base,f'apad=whole_dur={length:.9f}',*filters(effects),f'atrim=duration={length:.9f}','alimiter=limit=0.98:level=false:latency=true'])
            subprocess.run([ffmpeg,'-hide_banner','-v','error','-nostdin','-i',str(source),'-af',chain,'-t',str(length),'-ar','48000','-ac','2','-c:a','pcm_s16le','-y',str(temp)],capture_output=True,check=True,timeout=max(60,min(600,length*2)),creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            os.replace(temp,destination)
        except subprocess.CalledProcessError as error:raise ValueError('声音效果处理失败：'+error.stderr.decode('utf-8',errors='replace')[-1200:]) from error
        finally:
            if temp.exists():temp.unlink()
    return key,destination

def cached(root,key):
    if not re.fullmatch('[0-9a-f]{64}',key):raise ValueError('声音缓存标识无效')
    path=Path(root)/'effect-cache'/(key+'.wav')
    if not path.is_file():raise ValueError('声音效果缓存不存在')
    return path
