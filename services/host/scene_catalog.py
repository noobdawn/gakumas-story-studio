"""Index streamed 3D scenes and their validated dependency closure."""
import json,re
import UnityPy
def build(root):
 rows=[json.loads(x) for x in (root/'bundles.jsonl').read_text(encoding='utf8').splitlines() if x.strip()];byid={};entries=[];issues=[]
 for row in rows:
  if row['id'] in byid:raise ValueError('ambiguous bundle id '+str(row['id']))
  byid[row['id']]=row
 legacy=json.loads((root/'player-view/manifest.json').read_text(encoding='utf8'))['scenes'];reverse={v:k for k,v in legacy.items()}
 def closure(r,seen):
  if r['name'] in seen:return []
  seen.add(r['name'])
  if r.get('error') or r.get('inspectionError') or not re.fullmatch(r'[A-Za-z0-9_-]+',r['name']):raise ValueError('invalid dependency '+r['name'])
  if r.get('file')!='bundles/'+r['name']+'.bundle' or not (root/r['file']).is_file():raise ValueError('missing dependency '+r['name'])
  result=[]
  for i in r.get('dependencies',[]):result+=closure(byid[i],seen)
  return result+[r['name']]
 for row in rows:
  if not row['name'].startswith('env_3d_'):continue
  try:
   files=closure(row,set());env=UnityPy.load(str(root/row['file']));data=next(o.read_typetree() for o in env.objects if o.type.name=='AssetBundle')
   if not data['m_IsStreamedSceneAssetBundle']:raise ValueError('not a streamed Unity scene')
   ident=reverse.get(row['name'],'3d-'+row['name']);entries.append(dict(id='scene-'+ident,sceneId=ident,source=row['name'],files=files))
  except Exception as e:issues.append(dict(source=row['name'],error=str(e)))
 report=dict(version=1,entries=entries,issues=issues)
 (root/'player-view/scenes-catalog.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8');return report
