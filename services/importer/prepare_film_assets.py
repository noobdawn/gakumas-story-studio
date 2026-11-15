"""Prepare a versioned local film asset inventory from a read-only game scan.
The output is a fresh research directory; no files are placed in the game or Player build.
"""
import argparse, collections, hashlib, json, os, re, shutil, sys, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
pass # dependencies installed in the Python environment
import UnityPy
UnityPy.config.FALLBACK_UNITY_VERSION='6000.0.77f1'

SAFE=re.compile(r'^[A-Za-z0-9_.-]+$')
def mask(name):
    raw=name.encode('ascii');key=bytearray(len(raw)*2)
    for i,b in enumerate(raw):key[2*i]=b;key[-1-2*i]=(~b)&255
    v=0x9b
    for b in key:v=((v&1)<<7|v>>1)^b
    return bytes(b^v for b in key)
def transform(data,name):
    out=bytearray(data);key=mask(name)
    for i in range(min(256,len(out))):out[i]^=key[i%len(key)]
    return out

class SourceSelectionError(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def select_source(row):
    expected=row.get('md5','').lower()
    candidates=row.get('local_candidates',[])
    if not candidates:
        raise SourceSelectionError('local_source_missing', '本地未找到该资源文件；清单有记录不代表本机已下载')
    readable=missing=0
    for file in candidates:
        try:
            data=Path(file).read_bytes()
            readable+=1
            if hashlib.md5(data).hexdigest()==expected:return data,file
        except FileNotFoundError:missing+=1
        except OSError:continue
    if readable:
        raise SourceSelectionError('local_source_md5_mismatch', '已找到本地文件，但 MD5 与当前清单不符；可能为旧版本或内容不完整')
    if missing==len(candidates):
        raise SourceSelectionError('local_source_missing', '扫描记录中的本地文件已不存在，请重新检查游戏资源')
    raise SourceSelectionError('local_source_unreadable', '本地候选文件无法读取，请检查访问权限或文件占用')


def record_error(info, exc):
    info['error'] = str(exc) if isinstance(exc, SourceSelectionError) else type(exc).__name__+': '+str(exc)[:400]
    if isinstance(exc, SourceSelectionError):info['errorCode']=exc.code

def write_new(path,data):
    with path.open('xb') as f:f.write(data)

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--index',type=Path,required=True);ap.add_argument('--out',type=Path,required=True);mode=ap.add_mutually_exclusive_group();mode.add_argument('--audio-only',action='store_true');mode.add_argument('--visual-only',action='store_true');ap.add_argument('--include-scenes',action='store_true');ap.add_argument('--reserve-gib',type=int,default=40);args=ap.parse_args()
    scan=json.loads(args.index.read_text(encoding='utf-8'));game=Path(scan['game']).resolve();out=args.out.resolve()
    if out==game or game in out.parents:ap.error('output must not be in game directory')
    out.mkdir(parents=True,exist_ok=False)
    for name in ('bundles','exposed','face','audio-banks'): (out/name).mkdir()
    def require_space(data):
        if shutil.disk_usage(out).free-len(data)<args.reserve_gib*1024**3:raise ValueError('insufficient free space after reserve')
    rows=scan['records'];asset=[r for r in rows if r['kind']=='asset'];by_id=collections.defaultdict(list)
    for row in asset:by_id[row.get('id')].append(row)
    if args.audio_only:requested=[r for r in asset if r.get('name','').startswith(('sud_se_','sud_bgm_','sud_music_'))]
    else:
        prefixes=('mdl_chr_','mot_') if args.visual_only else ('mdl_chr_','mot_','sud_se_','sud_bgm_','sud_music_')
        def facial_effect(name):
            return name.startswith('mef_pfb_chr_') and any(tag in name for tag in ('_eye-shiromaru-001_','_head-gaan-001','_head-yodare-001')) or name.startswith('mef_mat_chr_') and any(tag in name for tag in ('_eye-nohighlight-001','_eye-kirakira-001','_eye-kirakirasmall-001','_eye-kiran-001','_eye-move-001','_eye-heart-001'))
        requested=[r for r in asset if r.get('name','').startswith(prefixes) or (args.include_scenes and r.get('name','').startswith('env_')) or r.get('name') in ('shader','actor-shader','m_fdc') or facial_effect(r.get('name',''))]
    selected={};missing_deps=[]
    def visit(row):
        name=row.get('name','')
        if name in selected:return
        selected[name]=row
        for dep in row.get('dependencies',[]):
            candidates=by_id[dep]
            if len(candidates)==1:visit(candidates[0])
            else:missing_deps.append({'asset':name,'id':dep,'matches':len(candidates)})
    for row in requested:visit(row)
    audio=[] if args.visual_only else [r for r in rows if r['kind']=='resource' and r.get('name','').startswith(('sud_se_','sud_bgm_','sud_music_')) and r.get('name','').endswith(('.acb','.awb','.mp3'))]
    summary={'format':'creator-local-film-assets','version':1,'manifest_sha256':scan['manifest_sha256'],'requested':len(requested),'bundles':len(selected),'audio_resources':len(audio),'missing_dependencies':missing_deps,'bundle_errors':0,'audio_errors':0,'motion_clips':0,'face_shapes':0,'face_mouth_shapes':0}
    def log(file,obj):file.write(json.dumps(obj,ensure_ascii=False,separators=(',',':'))+'\n');file.flush()
    start=time.time()
    with (out/'bundles.jsonl').open('x',encoding='utf-8') as report:
        for i,(name,row) in enumerate(sorted(selected.items()),1):
            info={'name':name,'id':row.get('id'),'md5':row.get('md5'),'dependencies':row.get('dependencies',[]),'requested':row in requested}
            try:
                if not SAFE.fullmatch(name):raise ValueError('unsafe asset name')
                data,source=select_source(row);converted=not data.startswith(b'UnityFS\0')
                if converted:data=transform(data,name)
                if not data.startswith(b'UnityFS\0'):raise ValueError('not UnityFS after transformation')
                require_space(data)
                path=out/'bundles'/(name+'.bundle');write_new(path,data);info.update(file='bundles/'+path.name,bytes=len(data),transformed=converted)
                if name.startswith('mot_') or name.endswith('_face'):
                    try:
                        env=UnityPy.load(str(path));clips=[]
                        for obj in env.objects:
                            if obj.type.name!='AnimationClip':continue
                            clip=obj.read();muscle=getattr(clip,'m_MuscleClip',None);cname=clip.m_Name
                            clips.append({'name':cname,'pathId':str(obj.path_id),'start':getattr(muscle,'m_StartTime',None),'stop':getattr(muscle,'m_StopTime',None),'fps':getattr(clip,'m_SampleRate',None),'role':'face' if cname.endswith('_f') else 'body' if cname.endswith('_b') else 'other'})
                        info['clips']=clips;summary['motion_clips']+=len(clips)
                        expose=[]
                        if name.startswith('mot_'):expose=[(clip['name'],int(clip['pathId'])) for clip in clips if clip['name']]
                        if name.startswith('mdl_chr_') and name.endswith('_face'):
                            meshes=[o for o in env.objects if o.type.name=='Mesh' and o.read().m_Name=='_CombinedFaceMesh']
                            if len(meshes)==1:expose=[('_CombinedFaceMesh',meshes[0].path_id)]
                            components=[]
                            for obj in env.objects:
                                if obj.type.name!='MonoBehaviour':continue
                                try:
                                    data=obj.read();script=data.m_Script.read() if data.m_Script else None
                                    if script and script.m_ClassName=='VLActorFaceModel':components.append(obj)
                                except Exception:continue
                            if len(meshes)==1 and len(components)==1:
                                vertex_count=meshes[0].read().m_VertexData.m_VertexCount;shapes=[]
                                for shape in components[0].read_typetree()['blendShapes']:
                                    if not shape['blendShapeVertices']:continue
                                    indices=[];offsets=[]
                                    for v in shape['blendShapeVertices']:
                                        if not 0<=v['vertIndex']<vertex_count:raise ValueError('face vertex out of bounds')
                                        indices.append(v['vertIndex']);p=v['position'];offsets.extend((p['x'],p['y'],p['z']))
                                    shapes.append({'name':shape['blendShapeName'],'indices':indices,'offsets':offsets})
                                dest=out/'face'/(name+'.json');face_data=json.dumps({'source':name,'vertexCount':vertex_count,'shapes':shapes},ensure_ascii=False,separators=(',',':')).encode('utf-8');require_space(face_data);write_new(dest,face_data)
                                info['faceData']='face/'+dest.name;info['shapeCount']=len(shapes);info['mouthShapeNames']=[s['name'] for s in shapes if 'mouth' in s['name'].lower()];summary['face_shapes']+=len(shapes);summary['face_mouth_shapes']+=len(info['mouthShapeNames'])
                            else:info['faceNote']=f'meshes={len(meshes)}, faceComponents={len(components)}'
                        if expose:
                            container=next(o for o in env.objects if o.type.name=='AssetBundle');tree=container.read_typetree();existing={v[0] for v in tree['m_Container']}
                            for entry,pid in expose:
                                if entry not in existing:tree['m_Container'].append((entry,{'preloadIndex':0,'preloadSize':len(tree['m_PreloadTable']),'asset':{'m_FileID':0,'m_PathID':pid}}));existing.add(entry)
                            container.save_typetree(tree);dest=out/'exposed'/(name+'.bundle');exposed_data=next(iter(env.files.values())).save(packer='none');require_space(exposed_data);write_new(dest,exposed_data);info['exposed']='exposed/'+dest.name
                    except Exception as exc:info['inspectionError']=type(exc).__name__+': '+str(exc)[:400]
            except Exception as exc:record_error(info,exc);summary['bundle_errors']+=1
            log(report,info)
            if i%50==0 or i==len(selected):print('bundles',i,'/',len(selected),'errors',summary['bundle_errors'],'clips',summary['motion_clips'],'seconds',round(time.time()-start),flush=True)
    with (out/'audio-banks.jsonl').open('x',encoding='utf-8') as report:
        for i,row in enumerate(sorted(audio,key=lambda x:x['name']),1):
            name=row['name'];info={'name':name,'id':row.get('id'),'md5':row.get('md5')}
            try:
                if not name or name in ('.','..') or any(c in name for c in '\\/:*?"<>|') or any(ord(c)<32 for c in name):raise ValueError('unsafe audio name')
                data,source=select_source(row)
                require_space(data)
                dest=out/'audio-banks'/name;write_new(dest,data);info.update(file='audio-banks/'+name,bytes=len(data))
            except Exception as exc:record_error(info,exc);summary['audio_errors']+=1
            log(report,info)
            if i%100==0 or i==len(audio):print('audio banks',i,'/',len(audio),'errors',summary['audio_errors'],flush=True)
    write_new(out/'summary.json',json.dumps(summary,ensure_ascii=False,indent=2).encode('utf-8'))
    print(json.dumps(summary,ensure_ascii=False),flush=True)
if __name__=='__main__':main()
