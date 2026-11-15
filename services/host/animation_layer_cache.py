"""Prepare original motion metadata and built-in additive clips inside a catalog.

Game files are read only. Existing catalog files and asset identifiers are untouched.
"""
import argparse,hashlib,json,os,shutil,sys,uuid,warnings
from pathlib import Path
HERE=Path(__file__).resolve().parent
VERSION=1
BUILTINS=('mot_all_chr_cmn_idle-001-add_lp_b','mot_all_chr_cmn_idle-002-add_lp_b')

def prepare(root,game=None):
 root=Path(root).resolve(strict=True)
 inventory=root.parent/'inventory.json'
 if game is None:
  if not inventory.is_file():raise ValueError('缺少本批次游戏目录记录，无法准备原生叠加动作')
  game=json.loads(inventory.read_text(encoding='utf8'))['game']
 game=Path(game).resolve(strict=True)
 if root==game or game in root.parents:raise ValueError('叠加缓存不能位于游戏安装目录')
 installed=game/'gakumas_Data/data.unity3d'
 stat=installed.stat();index=root/'bundles.jsonl'
 fingerprint=hashlib.sha256(index.read_bytes()).hexdigest()+':'+str(stat.st_size)+':'+str(stat.st_mtime_ns)
 output=root/'player-view/animation-layers-v1';manifest=output/'catalog.json'
 if manifest.is_file():
  saved=json.loads(manifest.read_text(encoding='utf8'))
  if saved.get('version')==VERSION and saved.get('fingerprint')==fingerprint and all((output/x['file']).is_file() for x in saved['builtinMotions']):return saved
  raise ValueError('原生叠加缓存与游戏版本不一致，请在资产设置重新解包')
 pass # dependencies installed in the Python environment
 import UnityPy
 UnityPy.config.FALLBACK_UNITY_VERSION='6000.0.77f1'
 warnings.filterwarnings('ignore',category=UnityPy.exceptions.UnityVersionFallbackWarning)
 rows=[json.loads(line) for line in index.read_text(encoding='utf8').splitlines() if line.strip()]
 selected=[r for r in rows if r.get('exposed') and any(c.get('role')=='body' and '_chr_' in c.get('name','') for c in r.get('clips',[]))]
 traits={};errors=[]
 for r in selected:
  try:
   source=(root/r['file']).resolve(strict=True)
   if source.parent!=(root/'bundles').resolve():raise ValueError('动作包路径不在缓存内')
   env=UnityPy.load(str(source));definition=None
   for ob in env.objects:
    if ob.type.name=='MonoBehaviour':
     t=ob.read_typetree()
     if 'isAdditive' in t and 'baseAnimation' in t:definition=t;break
   for ob in env.objects:
    if ob.type.name!='AnimationClip':continue
    clip=ob.read_typetree();name=clip['m_Name']
    if not name.endswith('_b'):continue
    muscle=clip['m_MuscleClip'];length=muscle['m_StopTime']-muscle['m_StartTime'];fps=clip['m_SampleRate']
    additive=bool(definition and definition.get('isAdditive'))
    override=bool(definition and '-override_' in definition.get('m_Name',''))
    traits[name]={'isPose':length<=1.01/max(fps,1),'isAdditive':additive,'isLoop':bool(muscle.get('m_LoopTime')),'overlayReady':additive or override,'defaultScope':'head' if additive else 'full','defaultBlend':'additive' if additive else 'override'}
  except Exception as exc:errors.append({'name':r['name'],'error':str(exc)[:300]})
 if errors:raise ValueError('动作类型检查失败：'+json.dumps(errors[:3],ensure_ascii=False))
 output.parent.mkdir(parents=True,exist_ok=True)
 # Inherit the catalog directory's access rules. Windows mkdtemp uses a private
 # ACL, which would prevent a workbench running as the normal user from reading it.
 staging=output.parent/('.animation-layers-'+uuid.uuid4().hex);staging.mkdir()
 try:
  game_env=UnityPy.load(str(installed));originals={o.peek_name():o for o in game_env.objects if o.type.name=='AnimationClip'}
  template=root/'exposed/mot_all_chr_cmmn_yes-002-add_in.bundle'
  builtin=[]
  for name in BUILTINS:
   if name not in originals:raise ValueError('游戏安装包缺少基础叠加动作：'+name)
   source=originals[name];tree=source.read_typetree();env=UnityPy.load(str(template))
   dest=next(o for o in env.objects if o.type.name=='AnimationClip');container=next(o for o in env.objects if o.type.name=='AssetBundle')
   dest.save_typetree(tree)
   sf=dest.assets_file;sf.objects={k:v for k,v in sf.objects.items() if v in (dest,container)}
   ptr={'m_FileID':0,'m_PathID':dest.path_id};bt=container.read_typetree()
   bt.update(m_Name=name,m_AssetBundleName=name,m_PreloadTable=[ptr],m_Container=[(name,{'preloadIndex':0,'preloadSize':1,'asset':ptr})],m_Dependencies=[])
   container.save_typetree(bt)
   bundle=next(iter(env.files.values()));cab='CAB-'+hashlib.md5(name.encode()).hexdigest();sf.name=cab;bundle.files={cab:sf}
   file=name+'.bundle';(staging/file).write_bytes(bundle.save(packer='none'))
   # Verify serialized data survives the standalone bundle round trip.
   check=UnityPy.load((staging/file).read_bytes());copy=next(o.read_typetree() for o in check.objects if o.type.name=='AnimationClip')
   if copy!=tree:raise ValueError('内置动作重新封装的数据校验失败：'+name)
   ident='film-'+hashlib.sha256(('builtin-v1\0'+name).encode()).hexdigest()[:24]
   builtin.append({'id':ident,'name':name,'clip':name,'length':tree['m_MuscleClip']['m_StopTime']-tree['m_MuscleClip']['m_StartTime'],'file':file,'isPose':False,'isAdditive':True,'isLoop':True,'overlayReady':True,'defaultScope':'full','defaultBlend':'additive','builtin':True})
  result={'version':VERSION,'fingerprint':fingerprint,'traits':traits,'builtinMotions':builtin,'errors':errors}
  (staging/'catalog.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
  try:os.rename(staging,output)
  except FileExistsError:
   existing=json.loads(manifest.read_text(encoding='utf8'))
   if existing.get('fingerprint')!=fingerprint:raise
  return result
 finally:
  if staging.exists() and staging.parent==output.parent and staging.name.startswith('.animation-layers-'):shutil.rmtree(staging)

def load(root):
 root=Path(root).resolve();folder=root/'player-view/animation-layers-v1'
 data=json.loads((folder/'catalog.json').read_text(encoding='utf8'))
 if data.get('version')!=VERSION:raise ValueError('叠加动作缓存版本不可用')
 motions=[]
 for item in data['builtinMotions']:
  p=(folder/item['file']).resolve(strict=True)
  if p.parent!=folder.resolve() or p.suffix!='.bundle':raise ValueError('无效的叠加动作路径')
  motions.append(dict(item,file=str(p)))
 return data['traits'],motions

if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--root',required=True,type=Path);ap.add_argument('--game',type=Path);args=ap.parse_args()
 r=prepare(args.root,args.game);print(json.dumps({'traits':len(r['traits']),'builtins':len(r['builtinMotions']),'errors':r['errors']}))
