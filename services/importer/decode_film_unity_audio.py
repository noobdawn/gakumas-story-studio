"""Extract Unity AudioClip samples from already-prepared local sound bundles."""
import argparse,json,re,shutil,sys,time
from pathlib import Path
pass # dependencies installed in the Python environment
import UnityPy
UnityPy.config.FALLBACK_UNITY_VERSION='6000.0.77f1'

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--root',type=Path,required=True);ap.add_argument('--reserve-gib',type=int,default=40);args=ap.parse_args();root=args.root.resolve()
    sources=[json.loads(s) for s in (root/'bundles.jsonl').read_text(encoding='utf-8').splitlines()];sources=[x for x in sources if x['name'].startswith('sud_') and x.get('file')]
    out=root/'audio-unity';out.mkdir(exist_ok=False);(out/'音乐').mkdir();(out/'音效').mkdir();summary={'bundles':len(sources),'files':0,'errors':0,'bytes':0,'skippedForSpace':0};start=time.time()
    with (root/'audio-unity.jsonl').open('x',encoding='utf-8') as log:
        for i,row in enumerate(sources,1):
            name=row['name'];item={'bundle':name};temp=None
            try:
                env=UnityPy.load(str(root/row['file']));clips=[o.read() for o in env.objects if o.type.name=='AudioClip']
                if len(clips)!=1:raise ValueError('expected one AudioClip, found '+str(len(clips)))
                clip=clips[0];samples=clip.samples
                if len(samples)!=1:raise ValueError('expected one decoded audio stream')
                data=next(iter(samples.values()))
                if len(data)<44 or data[:4]!=b'RIFF' or data[8:12]!=b'WAVE':raise ValueError('not WAV')
                if shutil.disk_usage(root).free-len(data)<args.reserve_gib*1024**3:summary['skippedForSpace']+=1;raise ValueError('insufficient free space after reserve')
                kind='音效' if name.startswith('sud_se_') else '音乐';path=out/kind/(name+'.wav')
                with path.open('xb') as f:f.write(data)
                item.update(file=str(path.relative_to(root)).replace('\\','/'),category=kind,bytes=len(data),sampleRate=clip.m_Frequency,channels=clip.m_Channels);summary['files']+=1;summary['bytes']+=len(data)
            except Exception as exc:item['error']=type(exc).__name__+': '+str(exc)[:400];summary['errors']+=1
            log.write(json.dumps(item,ensure_ascii=False,separators=(',',':'))+'\n');log.flush()
            if i%25==0 or i==len(sources):print('Unity AudioClip',i,'/',len(sources),'decoded',summary['files'],'errors',summary['errors'],'GiB',round(summary['bytes']/2**30,2),'seconds',round(time.time()-start),flush=True)
    with (root/'audio-unity-summary.json').open('x',encoding='utf-8') as f:json.dump(summary,f,ensure_ascii=False,indent=2)
    print(json.dumps(summary,ensure_ascii=False),flush=True)
if __name__=='__main__':main()
