"""Install pinned official VOICEVOX components into the user's data directory."""
import argparse, hashlib, json, os, shutil, tarfile, urllib.request, zipfile
from pathlib import Path
from runtime_paths import ROOT, VOICE

def emit(message,**values):
    print(json.dumps(dict(message=message,**values),ensure_ascii=False),flush=True)

def download(item,cache,**context):
    emit("检查文件 "+item["name"],phase="verify",**context)
    target=cache/item['sha256']
    if target.is_file() and hashlib.file_digest(target.open('rb'),'sha256').hexdigest()==item['sha256']:return target
    part=target.with_suffix('.part')
    request=urllib.request.Request(item['url'],headers={'User-Agent':'Gakumas-Story-Studio/0.1'})
    with urllib.request.urlopen(request,timeout=45) as response,part.open('wb') as output:
        count=0;limit=item.get('bytes',1024**3)
        while block:=response.read(1024*1024):
            count+=len(block)
            if count>limit:raise ValueError('下载超出清单大小')
            output.write(block);emit('正在下载 '+item['name'],phase='download',received=count,total=item.get('bytes'),**context)
    emit('正在校验 '+item['name'],phase='verify',**context)
    if hashlib.file_digest(part.open('rb'),'sha256').hexdigest()!=item['sha256']:raise ValueError('下载校验失败：'+item['name'])
    part.replace(target);return target

def unpack(source,dest,kind):
    dest.mkdir(parents=True,exist_ok=True)
    def allowed(name):
        p=dest/name
        if dest.resolve() not in p.resolve().parents:raise ValueError('归档路径超出目标目录')
        return p
    if kind=='zip':
        with zipfile.ZipFile(source) as z:
            for info in z.infolist():
                if info.is_dir():continue
                if info.file_size>512*1024**2 or (info.external_attr>>16)&0o170000==0o120000:raise ValueError('非法归档成员')
                p=allowed(info.filename);p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(z.read(info))
    else:
        with tarfile.open(source,'r:gz') as z:
            for info in z:
                if info.isdir():continue
                if not info.isfile() or info.size>512*1024**2:raise ValueError('非法归档成员')
                p=allowed(info.name);p.parent.mkdir(parents=True,exist_ok=True)
                with z.extractfile(info) as data,p.open('wb') as out:shutil.copyfileobj(data,out)

def install(models,staging):
    base=VOICE/'voicevox';base.mkdir(parents=True,exist_ok=True)
    if staging.parent.resolve()!=VOICE.resolve() or not staging.name.startswith('.install-'):raise ValueError('临时路径无效')
    staging.mkdir(exist_ok=False);cache=base/'downloads';cache.mkdir(exist_ok=True)
    catalog=json.loads((ROOT/'resources/voicevox/models.json').read_text('utf-8'))
    wanted=[x for x in catalog['models'] if x['id'] in models]
    if not wanted or len(wanted)!=len(set(models)):raise ValueError('请选择有效声库')
    components=json.loads((ROOT/'resources/voicevox/components.json').read_text('utf-8'))
    try:
        engine=base/'engine'
        item_total=(len(components) if not engine.exists() else 0)+len(wanted)
        item_index=0
        if not engine.exists():
            prepared=staging/'engine';prepared.mkdir()
            for item in components:
                item_index+=1
                context=dict(itemIndex=item_index,itemTotal=item_total)
                file=download(item,cache,**context);folder=staging/item['name']
                emit('正在解压 '+item['name'],phase='unpack',**context)
                unpack(file,folder,item['kind'])
                emit('正在安装 '+item['name'],phase='install',**context)
                if item['name']=='core':shutil.copytree(folder,prepared/'python')
                elif item['name']=='onnxruntime':shutil.copytree(next(folder.iterdir())/'lib',prepared/'onnxruntime');shutil.copytree(next(folder.iterdir()),prepared/'notices/onnxruntime',ignore=shutil.ignore_patterns('lib','include'))
                elif item['name']=='dictionary':shutil.copytree(next(folder.iterdir()),prepared/'dictionary')
            (prepared/'manifest.json').write_text(json.dumps(components,indent=2),'utf-8');prepared.rename(engine)
        elif json.loads((engine/'manifest.json').read_text('utf-8'))!=components:raise ValueError('现有引擎版本不同，请选择新的数据目录或先备份旧引擎')
        folder=base/'models';folder.mkdir(exist_ok=True)
        for item in wanted:
            item_index+=1
            context=dict(itemIndex=item_index,itemTotal=item_total)
            emit('检查声库 '+item['id'],phase='verify',**context)
            target=folder/item['id']
            if target.exists():
                if hashlib.file_digest(target.open('rb'),'sha256').hexdigest()!=item['sha256']:raise ValueError('已有声库校验不符：'+item['id'])
                continue
            file=download({**item,'name':item['id']},cache,**context)
            emit('正在安装声库 '+item['id'],phase='install',**context)
            temp=staging/item['id'];shutil.copyfile(file,temp);temp.rename(target)
        emit('安装完成',done=True,models=[x['id'] for x in wanted])
    finally:
        if staging.exists():shutil.rmtree(staging)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--models',required=True);p.add_argument('--staging',required=True,type=Path);a=p.parse_args();install(a.models.split(','),a.staging)
