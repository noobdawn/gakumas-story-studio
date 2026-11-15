"""Deterministic six-strip drawing, composited above captions by libass."""
import math

def number(value, low, high):
    if isinstance(value,bool) or not isinstance(value,(float,int)) or not math.isfinite(value) or not low<=value<=high:
        raise ValueError('转场数值无效')
    return value

def validate(plan):
    if not isinstance(plan,list) or len(plan)>1000: raise ValueError('转场片段过多')
    for c in plan:
        number(c['start'],0,3600);number(c['len'],.001,3600);number(c['order'],0,10000)
        d=c['asset']
        if d['renderer']!='six-strips-v1':raise ValueError('转场类型尚未支持')
        number(d['inDuration'],.01,10);number(d['outDuration'],.01,10);number(d['hold'],0,10);number(d['referenceWidth'],1,10000)
        if len(d['strips'])!=6 or len(d['color'])!=4:raise ValueError('转场条带数据无效')
        for n in d['color']:number(n,0,1)
        for s in d['strips']:
            number(s['anchorMin'],0,1);number(s['anchorMax'],s['anchorMin'],1);number(s['width'],1,10000)
            for phase in ('inTrack','outTrack'):
                t=s[phase];number(t['start'],0,10);number(t['duration'],.001,10);number(t['initial'],-10000,10000);number(t['delta'],-10000,10000)
                if t['ease'] not in ('OutCubic','InOutCubic'):raise ValueError('转场缓动尚未支持')
    return plan

def ease(t,mode):
    t=max(0,min(1,t))
    return 1-(1-t)**3 if mode=='OutCubic' else 4*t*t*t if t<.5 else 1-(-2*t+2)**3/2

def rectangles(c,time):
    if time<c['start'] or time>=c['start']+c['len']:return []
    d=c['asset'];t=(time-c['start'])/c['len']*(d['inDuration']+d['hold']+d['outDuration']);out=t>=d['inDuration']+d['hold'];result=[]
    for s in d['strips']:
        track=s['outTrack'] if out else s['inTrack'];clock=t-d['inDuration']-d['hold'] if out else t
        x=0 if t>=d['inDuration'] and not out else track['initial']+track['delta']*ease((clock-track['start'])/track['duration'],track['ease'])
        left=max(0,.5+(x-s['width']/2)/d['referenceWidth']);right=min(1,.5+(x+s['width']/2)/d['referenceWidth'])
        if right>left:result.append(dict(x=left,y=1-s['anchorMax'],w=right-left,h=s['anchorMax']-s['anchorMin'],color=d['color']))
    return result

def stamp(frame,fps):
    # ASS is centisecond based. Floor each boundary so sampled frame i belongs to i.
    cs=math.floor(frame*100/fps+1e-8)
    return f'{cs//360000}:{cs//6000%60:02}:{cs//100%60:02}.{cs%100:02}'

def ass_events(plan,width,height,fps,frames):
    validate(plan);events=[]
    for c in plan:
        d=c['asset'];rgb=[round(x*255) for x in d['color'][:3]];alpha=round((1-d['color'][3])*255)
        style=r'{\an7\pos(0,0)\p1\bord0\shad0\fscx100\fscy100\1c&H%02X%02X%02X&\1a&H%02X&}'%(rgb[2],rgb[1],rgb[0],alpha)
        for i in range(max(0,math.ceil(c['start']*fps-1e-8)),min(frames,math.ceil((c['start']+c['len'])*fps-1e-8))):
            paths=[]
            for r in rectangles(c,i/fps):
                l=math.floor(r['x']*width);t=math.floor(r['y']*height);right=math.ceil((r['x']+r['w'])*width);bottom=math.ceil((r['y']+r['h'])*height)
                paths.append(f'm {l} {t} l {right} {t} {right} {bottom} {l} {bottom}')
            if paths:events.append(f"Dialogue: {10+c['order']},{stamp(i,fps)},{stamp(i+1,fps)},Game,,0,0,0,,{style}{' '.join(paths)}\n")
            if len(events)>250000:raise ValueError('转场绘制帧过多，请分段导出')
    return ''.join(events)
