"""Build a local searchable catalog from the completed film-asset reports."""
import argparse,json,re
from pathlib import Path

def read(path):return [json.loads(x) for x in path.read_text(encoding='utf-8').splitlines()]
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--root',type=Path,required=True);args=ap.parse_args();root=args.root.resolve()
    if (root/'catalog-data.js').exists():raise FileExistsError(root/'catalog-data.js')
    bundles=read(root/'bundles.jsonl');audio=read(root/'audio-wav.jsonl');unity=read(root/'audio-unity.jsonl');items=[]
    people={'hski':'花海咲季','ttmr':'月村手毬','fktn':'藤田琴音','amao':'有村麻央','kllj':'葛城莉莉娅','kcna':'仓本千奈','ssmk':'紫云清夏','shro':'筱泽广','hrnm':'姬崎莉波','hume':'花海佑芽','jsna':'十王星南','hmsz':'秦谷美铃','atbm':'雨夜燕','nasr':'根绪亚纱里','krnh':'贺阳燐羽'}
    for row in bundles:
        name=row['name']
        if not row.get('file'):continue
        if name.startswith('mdl_chr_'):
            part=name.rsplit('_',1)[-1];code=name[8:12];items.append({'category':'角色','name':name,'detail':f'{people.get(code,code)} · {code} · 部件 {part}','file':row['file']})
        for clip in row.get('clips',[]):
            role=clip.get('role');category='动作' if role=='body' else '面部动画' if role=='face' else '其他动画'
            start=clip.get('start');stop=clip.get('stop');length=round(stop-start,3) if isinstance(start,(int,float)) and isinstance(stop,(int,float)) else None
            actor=next((people[c] for c in people if '_'+c+'_' in name),'');items.append({'category':category,'name':clip['name'],'detail':(actor+' · ' if actor else '')+name+(' · '+str(length)+' 秒' if length is not None else ''),'file':row.get('exposed',row['file'])})
        if row.get('faceData'):
            face=json.loads((root/row['faceData']).read_text(encoding='utf-8'))
            for shape in face['shapes']:
                is_mouth='mouth' in shape['name'].lower();code=name[8:12];items.append({'category':'口型' if is_mouth else '表情','name':shape['name'],'detail':people.get(code,code)+' · '+name+' · '+str(len(shape['indices']))+' 个顶点','file':row['faceData']})
    for row in audio:
        if not row.get('file'):continue
        meta=row.get('metadata',{});info=meta.get('streamInfo',{});rate=meta.get('sampleRate') or 0;count=meta.get('numberOfSamples') or 0
        duration=round(count/rate,2) if rate else None
        items.append({'category':row['category'],'name':info.get('name') or row['bank']+' #'+str(row['index']),'detail':row['bank']+(' · '+str(duration)+' 秒' if duration is not None else ''),'file':row['file'],'audio':True})
    for row in unity:
        if row.get('file'):items.append({'category':row['category'],'name':row['bundle'],'detail':'Unity 音频 · '+str(row.get('sampleRate','?'))+' Hz','file':row['file'],'audio':True})
    items.sort(key=lambda x:(x['category'],x['name'].casefold(),x['detail']))
    with (root/'catalog-data.js').open('x',encoding='utf-8') as f:f.write('window.FILM_ASSETS = '+json.dumps(items,ensure_ascii=False,separators=(',',':'))+';\n')
    print('catalog items',len(items))
if __name__=='__main__':main()
