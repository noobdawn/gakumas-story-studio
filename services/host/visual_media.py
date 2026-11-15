"""Prepare user-owned visual media. Never reads or writes game resources."""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import uuid
from contextlib import contextmanager

VERSION = 1
IMAGES = {'.png', '.jpg', '.jpeg', '.webp', '.gif'}
VIDEOS = {'.mp4', '.mov', '.webm', '.mkv'}
ID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', re.I)


@contextmanager
def cache_stage(parent: Path, prefix: str):
    # This directory becomes a persistent cache. Windows TemporaryDirectory uses
    # an owner-only DACL which survives rename and blocks the desktop user's Player.
    parent = parent.resolve(strict=True)
    stage = parent / (prefix + uuid.uuid4().hex)
    stage.mkdir()  # Inherit the asset library's ordinary access rules.
    try:
        yield stage
    finally:
        if stage.exists():
            if stage.is_symlink() or stage.resolve().parent != parent:
                raise ValueError('准备目录路径发生变化，保留文件等待检查')
            shutil.rmtree(stage)

def binary(name):
    found = shutil.which(name)
    fallback = Path(__file__).resolve().parents[2] / 'runtime/tools' / (name + '.exe')
    if found: return found
    if fallback.is_file(): return str(fallback)
    raise ValueError('需要安装 FFmpeg / FFprobe 后才能导入图片和视频')

def run(args, timeout=1800):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode: raise ValueError(result.stderr.decode('utf-8', 'replace')[-1800:])
    return result.stdout

def digest(file):
    with file.open('rb') as stream: return hashlib.file_digest(stream, 'sha256').hexdigest()

def metadata(directory):
    info = json.loads((directory / 'info.json').read_text('utf-8'))
    if info.get('version') != VERSION or info.get('kind') not in ('image', 'video'): raise ValueError('画面缓存版本无效，请重新准备素材')
    for k in ('width', 'height'):
        if not isinstance(info.get(k), int) or not 1 <= info[k] <= 4096: raise ValueError('画面尺寸无效')
    if info['kind'] == 'video':
        for k in ('duration', 'fps'):
            if not isinstance(info.get(k), (int, float)) or not math.isfinite(info[k]) or info[k] <= 0: raise ValueError('视频元数据无效')
        if info['duration'] > 3600 or info['fps'] > 60: raise ValueError('视频超出支持范围')
    for filename in (['image.png'] if info['kind'] == 'image' else ['video.mp4', 'poster.png'] + (['audio.wav'] if info.get('hasAudio') else [])):
        if not (directory / filename).is_file(): raise ValueError('画面缓存缺失，请重新准备素材')
    return info

def prepare(file: Path):
    file = file.resolve(strict=True)
    if not ID.fullmatch(file.stem) or file.suffix not in IMAGES | VIDEOS: raise ValueError('只接受已导入素材库的画面文件')
    target = file.with_suffix('.media')
    if target.is_symlink() or target.exists() and target.resolve() != target: raise ValueError('画面缓存目录不可重定向')
    stat = file.stat()
    source_stat = {'size': stat.st_size, 'mtimeNs': stat.st_mtime_ns}
    if target.is_dir():
        info = metadata(target)
        if info.get('sourceStat') == source_stat: return info
        raise ValueError('源素材已改变；请重新导入为新素材，以保留原工程内容')
    signature = digest(file)
    probe = json.loads(run([binary('ffprobe'), '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(file)], 60))
    video = next((s for s in probe['streams'] if s['codec_type'] == 'video'), None)
    if not video or not 0 < video.get('width', 0) <= 32768 or not 0 < video.get('height', 0) <= 32768: raise ValueError('文件没有可解码的画面')
    kind = 'image' if file.suffix in IMAGES else 'video'
    info = {'version': VERSION, 'kind': kind, 'sha256': signature, 'sourceStat': source_stat, 'sourceWidth': video['width'], 'sourceHeight': video['height'], 'hasAudio': False}
    with cache_stage(file.parent, file.stem + '.preparing-') as stage:
        base = [binary('ffmpeg'), '-hide_banner', '-loglevel', 'error', '-nostdin', '-copyts', '-i', str(file), '-map', '0:v:0']
        if kind == 'image':
            run(base + ['-frames:v', '1', '-vf', "scale=w='min(4096,iw)':h='min(4096,ih)':force_original_aspect_ratio=decrease,setsar=1", str(stage / 'image.png')])
        else:
            duration = float(video.get('duration') or probe.get('format', {}).get('duration') or 0)
            if not 0 < duration <= 3600: raise ValueError('视频时长须在 0–3600 秒之间')
            from fractions import Fraction
            rate=30.
            for key in ('avg_frame_rate','r_frame_rate'):
                try:
                    candidate=float(Fraction(video.get(key) or '0'))
                    if candidate>0: rate=candidate;break
                except (ValueError,ZeroDivisionError): pass
            rate=min(60.,max(1.,rate))
            run(base + ['-an', '-vf', "setpts=PTS-STARTPTS,scale=w='max(2,trunc(iw*sar*min(1,min(4096/(iw*sar),4096/ih))/2)*2)':h='max(2,trunc(ih*min(1,min(4096/(iw*sar),4096/ih))/2)*2)',setsar=1,fps="+str(rate), '-c:v', 'libx264', '-crf', '18', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(stage / 'video.mp4')])
            run([binary('ffmpeg'), '-v', 'error', '-nostdin', '-i', str(stage / 'video.mp4'), '-frames:v', '1', str(stage / 'poster.png')])
            converted = json.loads(run([binary('ffprobe'), '-v', 'error', '-show_streams', '-of', 'json', str(stage / 'video.mp4')]))['streams'][0]
            info.update(duration=float(converted['duration']), fps=float(Fraction(converted['avg_frame_rate'])), frameCount=int(converted['nb_frames']))
            info['hasAudio'] = any(s['codec_type'] == 'audio' for s in probe['streams'])
            video_start=float(video.get('start_time') or probe.get('format',{}).get('start_time') or 0)
            if not math.isfinite(video_start): raise ValueError('视频时间戳无效')
            if info['hasAudio']: run([binary('ffmpeg'), '-v', 'error', '-nostdin', '-copyts', '-i', str(file), '-map', '0:a:0', '-vn', '-af', f'asetpts=PTS-({video_start})/TB,aresample=async=1:first_pts=0,apad', '-t', str(info['duration']), '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', str(stage / 'audio.wav')])
        from PIL import Image
        with Image.open(stage / ('image.png' if kind == 'image' else 'poster.png')) as picture:
            info.update(width=picture.width, height=picture.height)
            preview=picture.copy();preview.thumbnail((512,512),Image.Resampling.LANCZOS);preview.save(stage/'preview.png')
        (stage / 'info.json').write_text(json.dumps(info, ensure_ascii=False), 'utf-8')
        # Publish only a complete cache; keep the source unchanged.
        metadata(stage)
        final_stat = file.stat()
        if final_stat.st_size != stat.st_size or final_stat.st_mtime_ns != stat.st_mtime_ns: raise ValueError('素材在准备期间发生变化，请重新导入')
        stage.rename(target)
    return info

def resolve(root: Path, asset: dict, audio=False):
    if not isinstance(asset, dict) or not ID.fullmatch(str(asset.get('id', ''))) or asset.get('extension') not in IMAGES | VIDEOS: raise ValueError('画面素材标识无效')
    if asset.get('scope') == 'shared': base = root / 'shared'
    elif asset.get('scope') == 'project' and ID.fullmatch(str(asset.get('projectId', ''))): base = root / 'projects' / asset['projectId']
    else: raise ValueError('画面素材范围无效')
    source = (base / (asset['id'] + asset['extension'])).resolve(strict=True)
    source.relative_to(root.resolve())
    folder = source.with_suffix('.media').resolve(strict=True)
    folder.relative_to(root.resolve())
    info = metadata(folder)
    stat=source.stat()
    if info.get('sourceStat') != {'size':stat.st_size,'mtimeNs':stat.st_mtime_ns}: raise ValueError('源素材已变化，请重新导入')
    if audio and not info.get('hasAudio'): raise ValueError('视频没有音轨')
    file = (folder / ('audio.wav' if audio else 'image.png' if info['kind'] == 'image' else 'video.mp4')).resolve(strict=True)
    file.relative_to(folder)
    return file, info

def resolve_draws(root, draws):
    if not isinstance(draws, list) or len(draws) > 32: raise ValueError('同时显示的画面层不能超过 32 层')
    result = []
    for draw in draws:
        file, info = resolve(root, draw.get('asset'))
        time = draw.get('time', 0)
        if not isinstance(time, (float, int)) or not math.isfinite(time) or not 0 <= time <= 3600: raise ValueError('视频时间无效')
        result.append({k: draw[k] for k in ('id', 'points', 'uv', 'color', 'pivot')} | {'file': str(file), 'kind': info['kind'], 'time': time, 'fps': info.get('fps', 0), 'frameCount': info.get('frameCount', 1), 'width': info['width'], 'height': info['height']})
    return result

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('file', type=Path); args = parser.parse_args()
    print(json.dumps(prepare(args.file), ensure_ascii=True))
