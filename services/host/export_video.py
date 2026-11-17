"""Experimental offline MP4 encoder; frame images are supplied by the Unity Player."""
import math
import time
from export_diagnostics import sample_range, validate_profile, validate_gpu_video, validate_gpu_reply, validate_gpu_frames, validate_merged_frame
import hashlib
import json
import os
import re
import secrets
import shutil
import subprocess
import struct
import tempfile
import zlib
import wave
from pathlib import Path

UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', re.I)
MAX_AUDIO_CLIPS = 10000
AUDIO_BATCH_INPUTS = 32

def number(x, minimum, maximum):
    if isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) or not minimum <= x <= maximum:
        raise ValueError('Invalid export setting')
    return float(x)

def assert_video_destination(parent, library_root):
    """Keep the configured installation read-only even when it is temporarily invalid."""
    roots = []
    missing = False
    try:
        data = json.loads((Path(library_root) / 'game-directory.json').read_text(encoding='utf-8'))
    except FileNotFoundError:
        data = None; missing = True
    except (OSError, ValueError) as error:
        raise ValueError('游戏目录设置无法读取，请重新选择后再导出') from error
    if not missing:
        if not isinstance(data, dict) or not isinstance(data.get('game'), str) or not Path(data['game']).is_absolute():
            raise ValueError('游戏目录设置无效，请重新选择后再导出')
        roots.append(Path(data['game']).resolve())
    actual=Path(parent).resolve()
    if any(actual==root or root in actual.parents for root in roots):
        raise ValueError('不能向只读游戏目录导出视频')

def ass_time(value):
    cs=round(value*100); h,cs=divmod(cs,360000); m,cs=divmod(cs,6000); s,cs=divmod(cs,100)
    return f'{h}:{m:02}:{s:02}.{cs:02}'

def ass_text(value):
    if not isinstance(value,str) or len(value)>500: raise ValueError('Invalid subtitle text')
    return value.replace('\\','/').replace('{','（').replace('}','）').replace('\r','').replace('\n',r'\N')

def audio_file(root, asset):
    if isinstance(asset,dict) and asset.get('extension') in ('.mp4','.mov','.webm','.mkv'):
        from visual_media import resolve
        return resolve(root,asset,audio=True)[0]
    if not isinstance(asset,dict) or not UUID.fullmatch(str(asset.get('id',''))) or asset.get('extension') not in ('.wav','.mp3','.ogg','.m4a'):
        raise ValueError('Invalid audio asset')
    scope=asset.get('scope')
    if scope=='shared': base=root/'shared'
    elif scope=='project' and UUID.fullmatch(str(asset.get('projectId',''))): base=root/'projects'/asset['projectId']
    else: raise ValueError('Invalid audio scope')
    target=(base/(asset['id']+asset['extension'])).resolve()
    if root not in target.parents or not target.is_file(): raise ValueError('音频素材缺失：'+str(asset.get('source','音频')))
    return target

def audio_input_args(file, loop):
    if not isinstance(loop,bool): raise ValueError('Invalid audio loop setting')
    return ['-i',str(file)]

def audio_loop_cost(ffprobe, file):
    """Conservatively bound decoded samples buffered by FFmpeg's audio loop filter."""
    if not ffprobe: raise ValueError('循环音频导出需要 FFprobe；请安装并加入 PATH')
    try:
        result=subprocess.run([ffprobe,'-v','error','-select_streams','a:0','-show_entries','stream=sample_rate,channels,duration:format=duration','-of','json',str(file)],capture_output=True,check=True,timeout=15,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        if len(result.stdout)>256*1024: raise ValueError('音频信息过大')
        data=json.loads(result.stdout);stream=data['streams'][0]
        rate=int(stream['sample_rate']);channels=int(stream['channels']);duration=None
        for value in (stream.get('duration'),data.get('format',{}).get('duration')):
            try: candidate=float(value)
            except (TypeError,ValueError): continue
            if math.isfinite(candidate) and candidate>0:duration=candidate;break
        if duration is None:raise ValueError('音频时长无效')
        if not math.isfinite(duration) or duration<=0 or duration>86400 or not 8000<=rate<=192000 or not 1<=channels<=8: raise ValueError('音频信息无效')
        samples=math.ceil((duration*1.1+1)*rate)
        if samples>2147483647: raise ValueError('循环音频过长')
        return samples*channels*8
    except (OSError,subprocess.SubprocessError,KeyError,IndexError,TypeError,ValueError,OverflowError) as error:
        raise ValueError('无法读取循环音频信息，请检查素材及 FFprobe') from error

def audio_loop_budget(cost, total):
    if cost>256*1024*1024 or total+cost>512*1024*1024:
        raise ValueError('循环音频过长或同时循环的音频过多，请缩短源文件或减少循环轨道')
    return total+cost

def validate_original_loop(file, info):
    if not isinstance(info,dict):raise ValueError('原始循环点无效')
    start,end,rate,frames=(info.get(k) for k in ('start','end','sampleRate','frames'))
    if not all(isinstance(x,int) and not isinstance(x,bool) for x in (start,end,rate,frames)) or not 8000<=rate<=192000 or not 0<=start<end<=frames or end-start>2147483647:raise ValueError('原始循环点无效')
    digest=info.get('sha256')
    if not isinstance(digest,str) or not re.fullmatch(r'[0-9a-f]{64}',digest):raise ValueError('原始循环音频校验信息无效')
    channels=info.get('channels')
    if channels is not None and (isinstance(channels,bool) or not isinstance(channels,int) or not 1<=channels<=8):raise ValueError('原始循环音频声道无效')
    try:
        with wave.open(str(file),'rb') as wav:
            if wav.getframerate()!=rate or wav.getnframes()!=frames or wav.getcomptype()!='NONE' or (channels is not None and wav.getnchannels()!=channels):raise ValueError('原始循环点与音频文件不匹配')
        h=hashlib.sha256()
        with file.open('rb') as source:
            for block in iter(lambda:source.read(1024*1024),b''):h.update(block)
        if h.hexdigest()!=digest:raise ValueError('原始循环音频文件已变化，请重新导入')
    except (wave.Error,OSError,EOFError) as error:raise ValueError('无法读取原始循环音频') from error
    return start,end

def audio_filter(index, start, length, offset, original_length, volume, fade_in, fade_out, loop=False, original_loop=None, rate=1):
    rate=number(rate,.25,4)
    tempo=[];remaining=rate
    while remaining<.5:tempo.append('atempo=0.5');remaining/=.5
    while remaining>2:tempo.append('atempo=2');remaining/=2
    if rate!=1:tempo.append(f'atempo={remaining:.9f}')
    # Rebase tempo output to its samples before mixing. Otherwise EOF timing
    # depends on the surrounding mix graph and differs between batch levels.
    loop_filter=(f'aloop=loop=-1:start={original_loop[0]}:size={original_loop[1]-original_loop[0]},' if original_loop else 'aloop=loop=-1:size=2147483647,' if loop else '')
    chain=f'[{index}:a]asetpts=PTS-STARTPTS,'+loop_filter+('asettb=1/sr,asetpts=N,' if loop else '')+f'atrim=start={offset:.9f}:duration={length*rate:.9f},asetpts=PTS-STARTPTS,'+(','.join(tempo)+',asetpts=N/SR/TB,' if tempo else '')+f'volume={volume:.9f}'
    if fade_in: chain+=f',afade=t=in:st=0:d={fade_in:.9f}'
    if fade_out: chain+=f',afade=t=out:st={max(0,original_length-fade_out):.9f}:d={fade_out:.9f}'
    return chain+f',adelay={round(start*1000)}:all=1[a{index}]'

def audio_graph(entries, first=1, origin=0):
    args=[];filters=[];labels=[];memory=0
    for index, entry in enumerate(entries,first):
        memory=audio_loop_budget(entry['loop_cost'],memory)
        args+=audio_input_args(entry['file'],entry['loop'])
        filters.append(audio_filter(index,entry['start']-origin,entry['length'],entry['offset'],
                                    entry['original_length'],entry['volume'],entry['fade_in'],entry['fade_out'],
                                    entry['loop'],entry['original_loop'],entry['rate']))
        labels.append(f'[a{index}]')
    return args,filters,labels


def reduce_audio_inputs(entries, ffmpeg, directory):
    """Bound decoder/command size; float PCM preserves gain across mixing levels."""
    entries=sorted(entries,key=lambda entry:entry['start'])
    level=0
    while len(entries)>AUDIO_BATCH_INPUTS:
        reduced=[]
        for group in range(0,len(entries),AUDIO_BATCH_INPUTS):
            batch=entries[group:group+AUDIO_BATCH_INPUTS]
            # Match audio_filter's millisecond placement before removing leading silence.
            origin=min(round(entry['start']*1000) for entry in batch)/1000
            length=max(round(entry['start']*1000)/1000+entry['length'] for entry in batch)-origin
            args,filters,labels=audio_graph(batch,first=0,origin=origin)
            filters.append(''.join(labels)+f'amix=inputs={len(labels)}:normalize=0:duration=longest,apad,atrim=duration={length:.9f}[mix]')
            stem=directory/f'mix-{level}-{group//AUDIO_BATCH_INPUTS}.wav'
            graph=stem.with_suffix('.txt');graph.write_text(';'.join(filters),encoding='utf-8')
            command=[ffmpeg,'-hide_banner','-loglevel','error','-nostdin','-y',*args,
                     '-filter_complex_script',str(graph),'-map','[mix]','-ar','48000','-ac','2',
                     '-c:a','pcm_f32le','-rf64','auto',str(stem)]
            result=subprocess.run(command,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,
                                  timeout=max(60,min(600,length*2)),creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            if result.returncode:
                raise ValueError('导出音频混音失败：'+result.stderr.decode('utf-8',errors='replace')[-1500:])
            reduced.append(dict(file=stem,start=origin,length=length,offset=0,original_length=length,
                                volume=1,fade_in=0,fade_out=0,loop=False,original_loop=None,rate=1,loop_cost=0))
        if level:
            for entry in entries:
                entry['file'].unlink()
                entry['file'].with_suffix('.txt').unlink()
        entries=reduced;level+=1
    return entries


def sliced_png(ffmpeg, source, destination, width, height, borders, scale, gradient=None, uniform_to_height=False):
    raw=source.read_bytes()
    if len(raw)<24 or raw[:8]!=b'\x89PNG\r\n\x1a\n':raise ValueError('游戏对白素材不是 PNG')
    sw,sh=struct.unpack('>II',raw[16:24])
    if not (1<=sw<=2048 and 1<=sh<=2048 and 1<=width<=1920 and 1<=height<=1920):raise ValueError('游戏对白素材尺寸无效')
    data=subprocess.run([ffmpeg,'-v','error','-i',str(source),'-f','rawvideo','-pix_fmt','rgba','-frames:v','1','pipe:1'],capture_output=True,check=True).stdout
    if len(data)!=sw*sh*4:raise ValueError('游戏对白素材解码失败')
    left,right,top,bottom=borders
    if uniform_to_height: scale=height/sh
    def mapping(dst,src,first,last):
        a=min(round(first*scale),dst//2);b=min(round(last*scale),dst//2);middle=src-first-last
        return [min(src-1, int(i*first/a) if i<a and a else (src-last+int((i-(dst-b))*last/b) if i>=dst-b and b else first+int((i-a)*middle/max(1,dst-a-b)))) for i in range(dst)]
    xs=mapping(width,sw,left,right);ys=mapping(height,sh,top,bottom)
    rows=[]
    for y in ys:
        line=bytearray(1+width*4);base=y*sw*4
        for x,source_x in enumerate(xs):
            pixel=data[base+source_x*4:base+source_x*4+4]
            if gradient:
                t=x/max(1,width-1);a,b=gradient
                pixel=bytes([round(pixel[i]*(a[i]*(1-t)+b[i]*t)/255) for i in range(3)]+[pixel[3]])
            line[1+x*4:5+x*4]=pixel
        rows.append(line)
    def chunk(kind,payload):return struct.pack('>I',len(payload))+kind+payload+struct.pack('>I',zlib.crc32(kind+payload)&0xffffffff)
    destination.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(rows)))+chunk(b'IEND',b''))

class VideoExport:
    def __init__(self, config, root, directory, dialogue_assets=None, *, gpu_input=None):
        self.directory=Path(directory); self.root=Path(root).resolve(); self.proc=None; self.log=None; self.output=None; self.temp=None; self.audio_directory=None
        self.gpu_input=None;self.gpu_sidecar=None;self.gpu_completed=0
        self.native_post=config.get('nativePostEffects',False) is True
        self.native_ui=config.get('nativeUI',False) is True;self.ui_frames=[];self.ui_files={}
        self.fps=config.get('fps'); self.width=config.get('width'); self.height=config.get('height')
        self.supersampling=config.get('exportSupersampling',1)
        if type(self.supersampling) is not int or self.supersampling not in (1,2):raise ValueError('导出超采样只能为 1 或 2')
        if self.fps not in (24,25,30,60) or type(self.width) is not int or type(self.height) is not int or not (16<=self.width<=1920 and 16<=self.height<=1920 and self.width%2==0 and self.height%2==0): raise ValueError('Invalid output dimensions or frame rate')
        self.duration=number(config.get('duration'),1,3600); self.frames=math.ceil(self.duration*self.fps); self.count=0
        self.profile=validate_profile(config.get("profileExport",False));self.last_write_ms=0
        run_id=config.get('runId','')
        if not isinstance(run_id,str) or len(run_id)>80 or (run_id and not re.fullmatch(r'[0-9A-Za-z_-]+',run_id)): raise ValueError('诊断运行标识无效')
        self.run_id=run_id
        self.start_frame,self.end_frame=sample_range(config,self.frames,self.native_post)
        self.frames=self.end_frame-self.start_frame
        self.gpu_video=validate_gpu_video(config,self.native_post,self.native_ui,self.frames)
        self.merged_frame=validate_merged_frame(config,self.gpu_video)
        from export_queue import capacity
        self.queue_capacity=capacity(config,self.merged_frame)
        self.queue_session=secrets.token_hex(16) if self.queue_capacity else ''
        self.queue_enqueued=0
        if self.gpu_video:
            if gpu_input is None or Path(gpu_input).name!='export-gpu.h264':raise ValueError('GPU 导出输入路径无效')
            gpu_input=Path(gpu_input).resolve();sidecar=gpu_input.with_suffix('.frames.jsonl')
            if not gpu_input.parent.is_dir() or gpu_input.exists() or sidecar.exists():raise ValueError('GPU 导出临时文件已存在或目录无效')
        output=Path(config.get('output',''))
        if not output.is_absolute() or output.suffix.lower()!='.mp4' or not output.parent.is_dir(): raise ValueError('视频保存位置无效')
        parent=output.parent.resolve(); assert_video_destination(parent,self.root)
        self.output=parent/output.name
        self.original=self.output_stat()
        self.new_only=config.get('newOnly',False)
        if not isinstance(self.new_only,bool): raise ValueError('Invalid export setting')
        if self.new_only and self.original is not None: raise ValueError('目标已存在')
        self.temp=parent/('.'+output.stem+'-'+secrets.token_hex(12)+'.tmp.mp4')
        fd=os.open(self.temp,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600);os.close(fd)
        try:
            if self.gpu_video:self.gpu_input=gpu_input;self.gpu_sidecar=sidecar
            ffmpeg=shutil.which('ffmpeg')
            if not ffmpeg: raise ValueError('未找到 FFmpeg；请安装并加入 PATH')
            audio=config.get('audio',[]); captions=[] if self.native_post else config.get('captions',[])
            if not isinstance(audio,list) or len(audio)>MAX_AUDIO_CLIPS: raise ValueError(f'导出音频片段数量无效（最多 {MAX_AUDIO_CLIPS} 个）')
            if not isinstance(captions,list) or len(captions)>10000: raise ValueError('导出字幕片段数量无效（最多 10000 个）')
            args=[ffmpeg,'-hide_banner','-loglevel','error','-y']
            args+=(['-fflags','+genpts','-r',str(self.fps),'-f','h264','-i',str(self.gpu_input)] if self.gpu_video else ['-f','image2pipe','-vcodec','png','-framerate',str(self.fps),'-i','pipe:0'])
            entries=[];loop_costs={}
            for i,item in enumerate(audio):
                start=number(item.get('start'),0,self.duration); original_length=number(item.get('length'),0,3600); offset=number(item.get('offset',0),0,3600)
                vol=number(item.get('volume',1),0,1); fade_in=number(item.get('fadeIn',0),0,3600); fade_out=number(item.get('fadeOut',0),0,3600);loop=item.get('loop',False)
                if not isinstance(loop,bool): raise ValueError('Invalid audio loop setting')
                if original_length<=0 or start>=self.duration: continue
                length=min(original_length,self.duration-start); file=audio_file(self.root,item.get('asset'))
                original_loop=item.get('originalLoop');original_range=None
                if original_loop is not None:
                    if not loop:raise ValueError('原始循环点需要启用音频循环')
                    original_range=validate_original_loop(file,original_loop)
                loop_cost=0
                if loop:
                    if file not in loop_costs:loop_costs[file]=audio_loop_cost(shutil.which('ffprobe'),file)
                    loop_cost=audio_loop_budget(loop_costs[file],0)
                import audio_effects
                effects=audio_effects.validate(item.get('effects',[]))
                playback_rate=item.get('rate',1)
                if audio_effects.active(effects):
                    _,file=audio_effects.prepare(self.root,item)
                    loop=False;original_range=None;offset=0;playback_rate=1;loop_cost=0
                entries.append(dict(file=file,start=start,length=length,offset=offset,original_length=original_length,
                                    volume=vol,fade_in=fade_in,fade_out=fade_out,loop=loop,
                                    original_loop=original_range,rate=playback_rate,loop_cost=loop_cost))
            if len(entries)>AUDIO_BATCH_INPUTS:
                self.audio_directory=tempfile.TemporaryDirectory(prefix='audio-',dir=self.directory)
                entries=reduce_audio_inputs(entries,ffmpeg,Path(self.audio_directory.name))
            audio_args,filters,audio_labels=audio_graph(entries)
            args+=audio_args
            game_cues=[x for x in captions if x.get('uiStyle')=='game']
            video_label='0:v'
            if game_cues:
                if not dialogue_assets:raise ValueError('游戏对白素材缺失')
                if len(game_cues)>256:raise ValueError('游戏对白片段过多')
                asset_dir=Path(dialogue_assets).resolve();scale=min(self.width/960,self.height/540)
                box_w=round(self.width*.84);box_h=round(self.height*.25);name_w=round(box_w*.44);name_h=round(self.height*.07)
                def color(value):
                    if not isinstance(value,str) or not re.fullmatch(r'#[0-9a-fA-F]{6}',value):raise ValueError('对白姓名条颜色无效')
                    return tuple(int(value[i:i+2],16) for i in (1,3,5))
                def cue_colors(c):
                    speaker=c.get('speaker','')
                    default=('#20a9e5','#78e3d6') if any(x in speaker for x in ('手毬','手鞠','てまり')) else ('#54566c','#54566c') if any(x in speaker for x in ('燐羽','りんは')) else ('#57576d','#57576d')
                    return color(c.get('nameColor',default[0])),color(c.get('nameColorEnd',default[1]))
                def enabled(cues):return '+'.join('(gte(t,%.6f)*lt(t,%.6f))'%(number(c.get('start'),0,self.duration),min(number(c.get('end'),0,3600),self.duration)) for c in cues)
                image_index=1+len(audio_labels)
                for n,(source,target) in enumerate((('message_bg.png','game-bg.png'),('frame_message_bg.png','game-frame.png'))):
                    sliced_png(ffmpeg,asset_dir/source,self.directory/target,box_w,box_h,(40,40,40,40),scale)
                    args+=['-loop','1','-framerate',str(self.fps),'-t',str(self.frames/self.fps),'-i',str(self.directory/target)]
                    out=f'game{n}';filters.append(f"[{video_label}][{image_index}:v]overlay={round(self.width*.08)}:{round(self.height*.70)}:enable='{enabled(game_cues)}'[{out}]");video_label=out;image_index+=1
                palettes={}
                for cue in game_cues:palettes.setdefault(cue_colors(cue),[]).append(cue)
                for n,(palette,cues) in enumerate(palettes.items()):
                    target=f'game-name-{n}.png'
                    sliced_png(ffmpeg,asset_dir/'name_bg.png',self.directory/target,name_w,name_h,(33,33,0,0),scale,palette,uniform_to_height=config.get('dialogueNameRoundCaps',False))
                    args+=['-loop','1','-framerate',str(self.fps),'-t',str(self.frames/self.fps),'-i',str(self.directory/target)]
                    out=f'gamename{n}';filters.append(f"[{video_label}][{image_index}:v]overlay={round(self.width*.08)}:{round(self.height*.635)}:enable='{enabled(cues)}'[{out}]");video_label=out;image_index+=1
            ui_transitions=[] if self.native_ui or self.native_post else config.get('uiTransitions',[])
            from ui_transition_export import ass_events
            ui_events=ass_events(ui_transitions,self.width,self.height,self.fps,self.frames)
            if captions or ui_events:
                style=f'Style: Default,Microsoft YaHei,{max(16,round(self.height*.033))},&H00FFFFFF,&H000000FF,&HAA000000,&H99000000,0,0,0,0,100,100,0,0,3,8,0,2,{round(self.width*.09)},{round(self.width*.09)},{round(self.height*.06)},1'
                subtitle=f'Style: Subtitle,Microsoft YaHei,{max(16,round(self.height*.033))},&H00FFFFFF,&H000000FF,&H00000000,&H99000000,0,0,0,0,100,100,0,0,1,2,0,2,{round(self.width*.09)},{round(self.width*.09)},{round(self.height*.06)},1'
                game_style=f'Style: Game,Microsoft YaHei,{max(14,round(self.height*.045))},&H00333333,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1'
                ass='[Script Info]\nScriptType: v4.00+\nPlayResX: '+str(self.width)+'\nPlayResY: '+str(self.height)+'\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\n'+style+'\n'+subtitle+'\n'+game_style+'\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n'
                events=0
                for cue in captions:
                    start=number(cue.get('start'),0,self.duration); end=number(cue.get('end'),0,3600)
                    if end<=start: continue
                    speaker=ass_text(cue.get('speaker',''));text=cue.get('text','');ass_text(text)
                    mode=cue.get('uiStyle','box');typing=cue.get('typewriter',False)
                    if mode not in ('box','subtitle','game') or not isinstance(typing,bool):raise ValueError('Invalid dialogue style')
                    rate=number(cue.get('revealRate',12),1,60);origin=number(cue.get('origin',start),0,self.duration)
                    if origin>start:raise ValueError('Invalid dialogue timing')
                    style_name='Default' if mode=='box' else 'Subtitle' if mode=='subtitle' else 'Game';end=min(end,self.duration)
                    points=[start]
                    if typing:points.extend(origin+i/rate for i in range(1,len(text)) if start<origin+i/rate<end)
                    points.append(end)
                    for a,b in zip(points,points[1:]):
                        events+=1
                        if events>10000:raise ValueError('逐字字幕过多，请减少对白或关闭逐字显示')
                        visible=text[:min(len(text),max(0,math.floor((a-origin)*rate+1e-8)+1))] if typing else text
                        if mode=='game':
                            content='{\\an7\\pos(%d,%d)\\b1\\c&HFFFFFF&}'%(round(self.width*.105),round(self.height*.635))+speaker+'\n'+f'Dialogue: 0,{ass_time(a)},{ass_time(b)},Game,,0,0,0,,'+'{\\an7\\pos(%d,%d)}'%(round(self.width*.12),round(self.height*.725))+ass_text(visible)
                        else:content=speaker+r'\N'+ass_text(visible)
                        ass+=f'Dialogue: 0,{ass_time(a)},{ass_time(b)},{style_name},,0,0,0,,{content}\n'
                ass+=ui_events
                (self.directory/'captions.ass').write_text(ass,encoding='utf-8-sig')
                filters.append(f'[{video_label}]ass=captions.ass[v]');args+=['-map','[v]']
            else: args+=['-map','0:v:0']
            if audio_labels:
                trim=(f'atrim=start={self.start_frame/self.fps:.9f}:end={self.end_frame/self.fps:.9f},asetpts=N/SR/TB' if config.get('diagnosticRange') is not None else f'atrim=duration={self.frames/self.fps:.9f}')
                filters.append(''.join(audio_labels)+f'amix=inputs={len(audio_labels)}:normalize=0:duration=longest,apad,{trim}[a]');args+=['-map','[a]','-c:a','aac','-b:a','192k']
            if filters:
                (self.directory/'filter.txt').write_text(';'.join(filters),encoding='utf-8');args+=['-filter_complex_script','filter.txt']
            if self.gpu_video:
                # Input already contains exactly the validated frame count.
                # A video packet limit can stop fast streamcopy before the audio
                # trim/mix has produced its first packet. Let both inputs drain.
                args+=['-c:v','copy','-movflags','+faststart',str(self.temp)]
            elif self.native_ui:
                self.base_video=self.directory/'captioned-base.mkv'
                args+=['-c:v','ffv1','-level','3','-pix_fmt','yuv444p','-frames:v',str(self.frames),str(self.base_video)]
            else:
                args+=['-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart','-frames:v',str(self.frames),str(self.temp)]
            self.encode_args=args
            if not self.gpu_video:self.start_encoder()
        except Exception:
            self.cancel();raise
    def write(self, image, ui_image=None):
        if self.gpu_video:raise ValueError('GPU 导出不接受 PNG 帧')
        if self.count>=self.frames or not image.startswith(b'\x89PNG\r\n\x1a\n'): raise ValueError('Invalid export frame')
        if self.native_ui:
            if not isinstance(ui_image,bytes) or not ui_image.startswith(b'\x89PNG\r\n\x1a\n') or len(ui_image)<24 or struct.unpack('>II',ui_image[16:24])!=(self.width,self.height):raise ValueError('UI 导出帧缺失或尺寸错误')
            digest=hashlib.sha256(ui_image).hexdigest()
            if digest not in self.ui_files:
                if shutil.disk_usage(self.directory).free-len(ui_image)<64*1024*1024:raise ValueError('UI 导出临时空间不足')
                file=self.directory/('ui-'+digest+'.png');file.write_bytes(ui_image);self.ui_files[digest]=file
            self.ui_frames.append(digest)
        if self.proc.poll() is not None: raise RuntimeError('FFmpeg 编码失败：'+self.error())
        try:
            start=time.perf_counter();self.proc.stdin.write(image);self.count+=1
            if self.profile:self.last_write_ms=(time.perf_counter()-start)*1000
        except (BrokenPipeError,OSError) as e: raise RuntimeError('FFmpeg 编码失败：'+self.error()) from e
    def start_encoder(self):
        self.log=(self.directory/'ffmpeg.log').open('wb')
        self.proc=subprocess.Popen(self.encode_args,cwd=self.directory,stdin=subprocess.DEVNULL if self.gpu_video else subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=self.log,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    def write_gpu(self, reply):
        if not self.gpu_video or self.count>=self.frames:raise ValueError('GPU 导出帧顺序无效')
        completed=validate_gpu_reply(reply,self.count+1,self.gpu_completed)
        self.count+=1;self.gpu_completed=completed
    def complete_gpu(self, reply):
        if not self.gpu_video or self.count!=self.frames:raise ValueError('GPU 导出帧不完整')
        self.gpu_completed=validate_gpu_reply(reply,self.frames,self.gpu_completed,final=True)
    def error(self):
        if self.log:self.log.flush()
        file=self.directory/'ffmpeg.log'
        return file.read_text(encoding='utf-8',errors='replace')[-1500:] if file.exists() else ''
    def output_stat(self):
        try:
            stat=self.output.stat()
            return (stat.st_dev,stat.st_ino,stat.st_size,stat.st_mtime_ns)
        except FileNotFoundError: return None
    def finish(self):
        if self.count!=self.frames: raise ValueError('视频帧不完整')
        if getattr(self,'gpu_video',False):
            if self.gpu_completed!=self.frames:raise ValueError('GPU 编码尚未完成')
            validate_gpu_frames(self.gpu_sidecar,self.frames,self.fps)
            if not self.gpu_input.is_file() or not self.gpu_input.stat().st_size:raise ValueError('GPU 编码文件缺失或为空')
            self.start_encoder()
        if self.proc.stdin:self.proc.stdin.close()
        code=self.proc.wait()
        if code: raise RuntimeError('FFmpeg 编码失败：'+self.error())
        self.log.close();self.log=None
        if self.native_ui:self.finish_ui()
        assert_video_destination(self.output.parent,self.root)
        if self.output_stat()!=self.original: raise RuntimeError('目标文件在导出期间发生变化，请重新选择保存位置')
        if self.new_only:
            os.link(self.temp,self.output)
            self.temp.unlink();self.temp=None
        else:
            os.replace(self.temp,self.output);self.temp=None
        if self.audio_directory:self.audio_directory.cleanup();self.audio_directory=None
        self.clean_gpu_files()
    def finish_ui(self):
        if len(self.ui_frames)!=self.frames:raise ValueError('UI 导出帧不完整')
        args=[shutil.which('ffmpeg'),'-hide_banner','-loglevel','error','-y','-i',str(self.base_video),'-f','image2pipe','-vcodec','png','-framerate',str(self.fps),'-i','pipe:0','-filter_complex','[0:v][1:v]overlay=0:0:format=auto:shortest=1[v]','-map','[v]','-map','0:a?','-c:a','copy','-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart','-frames:v',str(self.frames),str(self.temp)]
        self.log=(self.directory/'ffmpeg.log').open('ab')
        self.proc=subprocess.Popen(args,cwd=self.directory,stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=self.log,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        try:
            last=None;data=None
            for digest in self.ui_frames:
                if digest!=last:data=self.ui_files[digest].read_bytes();last=digest
                self.proc.stdin.write(data)
            self.proc.stdin.close();code=self.proc.wait()
            if code:raise RuntimeError('UI 视频合成失败：'+self.error())
        except (BrokenPipeError,OSError) as e:raise RuntimeError('UI 视频合成失败：'+self.error()) from e
        finally:
            if self.proc.poll() is None:self.proc.kill();self.proc.wait()
            if self.proc.stdin and not self.proc.stdin.closed:self.proc.stdin.close()
            self.log.close();self.log=None
    def cancel(self):
        if self.proc and self.proc.poll() is None:
            self.proc.kill();self.proc.wait()
        if self.proc and self.proc.stdin and not self.proc.stdin.closed:
            try:self.proc.stdin.close()
            except OSError:pass
        if self.log:self.log.close();self.log=None
        if self.temp:
            try:self.temp.unlink(missing_ok=True)
            except OSError:pass
        if self.audio_directory:self.audio_directory.cleanup();self.audio_directory=None
        self.clean_gpu_files()
    def clean_gpu_files(self):
        for path in (self.gpu_input,self.gpu_sidecar):
            if path is not None:path.unlink(missing_ok=True)
