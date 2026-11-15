"""Decode the extracted local ACB/AWB banks to individually indexed WAV files."""
import argparse,json,os,shutil,subprocess,time,wave
from pathlib import Path
HERE=Path(__file__).resolve().parent
VGM=Path(os.environ.get('CREATOR_VGMSTREAM') or shutil.which('vgmstream-cli') or HERE.parents[1]/'runtime/tools/vgmstream-cli.exe')
NO_WINDOW=getattr(subprocess,'CREATE_NO_WINDOW',0)
CANCEL_FILE=None
def run(args,timeout):
    p=subprocess.Popen([str(VGM),*map(str,args)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=NO_WINDOW)
    started=time.monotonic()
    try:
        while True:
            if CANCEL_FILE is not None and CANCEL_FILE.exists():raise KeyboardInterrupt('audio preparation cancelled')
            if time.monotonic()-started>timeout:raise subprocess.TimeoutExpired(p.args,timeout)
            try:stdout,stderr=p.communicate(timeout=.25);break
            except subprocess.TimeoutExpired:continue
        if p.returncode:raise RuntimeError((stderr+stdout).decode('utf-8','replace')[-500:])
        return stdout
    finally:
        if p.poll() is None:p.kill();p.communicate()

def main():
    global CANCEL_FILE
    ap=argparse.ArgumentParser();ap.add_argument('--root',type=Path,required=True);ap.add_argument('--reserve-gib',type=int,default=40);ap.add_argument('--cancel-file',type=Path);args=ap.parse_args();root=args.root.resolve();CANCEL_FILE=args.cancel_file
    if not (root/'summary.json').is_file():raise ValueError('asset preparation must finish first')
    out=root/'audio-wav';out.mkdir(exist_ok=False);(out/'音效').mkdir();(out/'音乐').mkdir()
    sources=[json.loads(s) for s in (root/'audio-banks.jsonl').read_text(encoding='utf-8').splitlines()];sources=[x for x in sources if x.get('file') and x['name'].endswith(('.acb','.awb','.mp3'))]
    summary={'banks':len(sources),'files':0,'errors':0,'bytes':0,'skippedForSpace':0};started=time.time()
    with (root/'audio-wav.jsonl').open('x',encoding='utf-8') as report:
        def log(row):report.write(json.dumps(row,ensure_ascii=False,separators=(',',':'))+'\n');report.flush()
        for pos,source in enumerate(sources,1):
            name=source['name'];path=root/source['file'];kind='音效' if name.startswith('sud_se_') else '音乐';folder=out/kind/name;folder.mkdir()
            try:
                if name.endswith('.mp3'):
                    ffmpeg=shutil.which('ffmpeg');probe=shutil.which('ffprobe')
                    if not ffmpeg or not probe:raise ValueError('MP3 解码需要 FFmpeg 和 FFprobe')
                    meta=json.loads(subprocess.check_output([probe,'-v','error','-show_format','-of','json',str(path)],timeout=30,creationflags=NO_WINDOW))
                    duration=float(meta['format']['duration'])
                    if not 0<duration<=3600:raise ValueError('invalid MP3 duration')
                    if shutil.disk_usage(root).free-duration*48000*4-65536<args.reserve_gib*1024**3:raise ValueError('insufficient free space after reserve')
                    target=folder/'0001.wav'
                    subprocess.run([ffmpeg,'-nostdin','-v','error','-n','-i',str(path),'-vn','-ac','2','-ar','48000','-c:a','pcm_s16le',str(target)],check=True,timeout=300,creationflags=NO_WINDOW,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
                    with wave.open(str(target),'rb') as wav:
                        frames=wav.getnframes();rate=wav.getframerate()
                        if not frames:raise ValueError('empty decoded MP3')
                    size=target.stat().st_size;summary['files']+=1;summary['bytes']+=size
                    log(dict(bank=name,index=1,category=kind,file=str(target.relative_to(root)).replace('\\','/'),bytes=size,metadata=dict(sampleRate=rate,numberOfSamples=frames)))
                    continue
                first=json.loads(run(['-I','-m','-s','1',path],45));count=first['streamInfo']['total']
                if not isinstance(count,int) or not 1<=count<=10000:raise ValueError('invalid subsong count')
                for number in range(1,count+1):
                    item={'bank':name,'index':number,'category':kind}
                    temp=None
                    try:
                        meta=first if number==1 else json.loads(run(['-I','-m','-s',number,path],45));item['metadata']=meta
                        estimated=int(meta['numberOfSamples'])*int(meta['mixingInfo']['outputChannels'])*2+65536
                        if shutil.disk_usage(root).free-estimated<args.reserve_gib*1024**3:
                            item['error']='insufficient free space after reserve';summary['skippedForSpace']+=1;log(item);continue
                        target=folder/(f'{number:04d}.wav');temp=folder/(f'.{number:04d}.tmp.wav')
                        if temp.exists() or target.exists():raise FileExistsError(target)
                        run(['-i','-s',number,'-o',temp,path],300)
                        with temp.open('rb') as f:
                            header=f.read(12)
                            if header[:4]!=b'RIFF' or header[8:]!=b'WAVE':raise ValueError('not a RIFF WAV')
                        if temp.stat().st_size<=44:raise ValueError('empty WAV')
                        temp.rename(target);temp=None;item['file']=str(target.relative_to(root)).replace('\\','/');item['bytes']=target.stat().st_size;summary['files']+=1;summary['bytes']+=item['bytes']
                    except Exception as exc:
                        item['error']=type(exc).__name__+': '+str(exc)[:400];summary['errors']+=1
                        if temp is not None:temp.unlink(missing_ok=True)
                    log(item)
            except Exception as exc:summary['errors']+=1;log({'bank':name,'category':kind,'error':type(exc).__name__+': '+str(exc)[:400]})
            if pos%25==0 or pos==len(sources):print('decoded banks',pos,'/',len(sources),'wav',summary['files'],'errors',summary['errors'],'GiB',round(summary['bytes']/2**30,2),'seconds',round(time.time()-started),flush=True)
    with (root/'audio-summary.json').open('x',encoding='utf-8') as f:json.dump(summary,f,ensure_ascii=False,indent=2)
    print(json.dumps(summary,ensure_ascii=False),flush=True)
if __name__=='__main__':main()
