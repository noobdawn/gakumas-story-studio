"""Build a read-only Player-compatible view of a single prepared catalog.
The view consists of hard links inside that catalog; game files are never linked.
"""
import argparse,json,os,re,shutil
from pathlib import Path
CODES='ttmr hski fktn amao kllj kcna ssmk shro hrnm hume jsna hmsz atbm nasr krnh'.split()
SCENES='trainingroom classroom courtyard dormitory rooftop'.split()
SAFE=re.compile(r'^[A-Za-z0-9_.-]+$')
def build(root):
 root=Path(root).resolve(strict=True)
 import base_motions
 base_motions.resolve(root)
 report=root/'bundles.jsonl';rows=[json.loads(s) for s in report.read_text(encoding='utf-8').splitlines() if s.strip()]
 byname={};byid={}
 for r in rows:
  n=r.get('name');i=r.get('id')
  if not isinstance(n,str) or not SAFE.fullmatch(n) or n in byname:raise ValueError('duplicate or unsafe bundle name')
  byname[n]=r;byid.setdefault(i,[]).append(r)
 def file_for(row,key='file'):
  if row.get('error') or row.get('inspectionError'):raise ValueError('failed bundle '+row['name'])
  v=row.get(key)
  if not isinstance(v,str):raise ValueError('missing '+key+' for '+row['name'])
  base={'file':'bundles','exposed':'exposed','faceData':'face'}[key]
  raw=root/v
  if raw.is_symlink():raise ValueError('linked catalog file')
  p=raw.resolve(strict=True)
  if p.parent!=(root/base).resolve() or not p.is_file():raise ValueError('invalid catalog path')
  return p
 def closure(row):
  result={};active=set()
  def visit(r):
   n=r['name']
   if n in result:return
   if n in active:raise ValueError('dependency cycle '+n)
   active.add(n);file_for(r)
   for dep in r.get('dependencies',[]):
    matches=byid.get(dep,[])
    if len(matches)!=1:raise ValueError('missing or ambiguous dependency for '+n)
    visit(matches[0])
   active.remove(n);result[n]=r
  visit(row);return result
 def required(n):
  if n not in byname:raise ValueError('missing '+n)
  return byname[n]
 # Validate before creating output. Retain only whole supported characters/scenes.
 base={};actors=[];issues={}
 for n in ('shader','actor-shader','m_fdc'):
  row=required(n);base[n]=file_for(row)
 for code in CODES:
  outfit='0000' if code in ('nasr','krnh') else '0002'
  try:
   body=required(f'mdl_chr_{code}-casl-{outfit}_body');hair=required(f'mdl_chr_{code}-base-0000_hair');face=required(f'mdl_chr_{code}-base-0000_face')
   dependencies={}
   for r in (body,hair,face):dependencies.update(closure(r))
   # This Player's character root does not preload arbitrary dependency bundles.
   allowed={body['name'],hair['name'],face['name'],'shader','actor-shader','m_fdc'}
   if set(dependencies)-allowed:raise ValueError('unsupported character dependencies: '+','.join(sorted(set(dependencies)-allowed)))
   data=json.loads(file_for(face,'faceData').read_text(encoding='utf-8'))
   if data.get('source')!=face['name'] or not isinstance(data.get('vertexCount'),int) or not any(x.get('name')=='b_mouth.mouth_001' for x in data.get('shapes',[])):raise ValueError('missing face data')
   for r in (body,hair,face):base[r['name']]=file_for(r)
   base[code+'-face-exposed']=file_for(face,'exposed');actors.append(code)
  except (ValueError,OSError,KeyError,TypeError) as e:issues[code]=str(e)
 if 'ttmr' not in actors:raise ValueError('baseline character unavailable: '+issues.get('ttmr','unknown'))
 scenes={};scene_files={}
 for name in SCENES:
  try:
   r=required('env_3d_adv_'+name+'-00-00-noon');deps=closure(r)
   for n,row in deps.items():
    if n not in ('shader','actor-shader','m_fdc'):scene_files[n]=file_for(row)
   scenes[name]=r['name']
  except (ValueError,OSError,KeyError,TypeError) as e:issues['scene:'+name]=str(e)
 if 'trainingroom' not in scenes:raise ValueError('baseline scene unavailable: '+issues.get('scene:trainingroom','unknown'))
 # Reuse the established extraction logic without changing physics behavior.
 import prepare_costume_swing
 cloth=prepare_costume_swing.extract(base['mdl_chr_ttmr-casl-0002_body'],'mdl_chr_ttmr-casl-0002_body')
 if cloth.get('source')!='mdl_chr_ttmr-casl-0002_body' or not isinstance(cloth.get('dynamic'),list) or not isinstance(cloth.get('static'),list):raise ValueError('invalid baseline cloth metadata')
 target=root/'player-view';target.mkdir(exist_ok=False)
 for sub,files in [('characters',base),('scenes',scene_files)]:
  folder=target/sub;folder.mkdir()
  for name,source in files.items():
   dest=folder/(name+'.bundle')
   try:os.link(source,dest)
   except OSError:
    if shutil.disk_usage(target).free-source.stat().st_size<40*1024**3:raise ValueError('insufficient free space after reserve for Player view')
    try:
     with source.open('rb') as src,dest.open('xb') as out:shutil.copyfileobj(src,out,1024*1024)
    except Exception:
     dest.unlink(missing_ok=True);raise
 (target/'baseline-cloth.json').write_text(json.dumps(cloth,ensure_ascii=False,allow_nan=False,separators=(',',':')),encoding='utf8')
 result={'version':1,'actors':actors,'scenes':scenes,'issues':issues,'characterBundles':len(base),'sceneBundles':len(scene_files)}
 if (root.parent/'inventory.json').is_file():
  from animation_layer_cache import prepare as prepare_layers
  layer_data=prepare_layers(root);result['animationLayers']={'traits':len(layer_data['traits']),'builtins':len(layer_data['builtinMotions'])}
 (target/'manifest.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');return result
if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--root',type=Path,required=True);a=ap.parse_args();print(json.dumps(build(a.root),ensure_ascii=False),flush=True)
