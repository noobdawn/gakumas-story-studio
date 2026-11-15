"""Convert the seven local Titan transition prefabs into a portable UI graph.

Only local manifest-verified game files are inputs. The graph retains original
sprites, transforms, bindings, masks and track values; it does not select scenes.
"""
import hashlib,io,json,math,sys,uuid
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'importer'))
from prepare_film_assets import UnityPy,select_source,transform

NAMES={
 'change_l':'条带与循环图形 · 横版', 'change_p':'条带与循环图形 · 竖版',
 'event_change':'事件条带 · 暖色', 'time_l':'时钟与圆形遮罩 · 横版',
 'time_p':'时钟与圆形遮罩 · 竖版', 'event_time':'事件时钟 · 暖色',
 'channel_reversi_kllj':'Reversi 频道 · 标志与圆形遮罩'}
PROPS={'LocalPositionTrack':'position','AnchorPositionTrack':'anchor','SizeDeltaTrack':'size','ScaleTrack':'scale','LocalRotateTrack':'rotation','CanvasGroupAlphaTrack':'alpha','CampusCanvasGroupAlphaTrack':'alpha','GraphicColorTrack':'color'}
def pid(ref):return ref.get('m_PathID',0)
def vec(v,keys='xy'):return [v[k] for k in keys]
def param(t):
 v=t['_value'];return dict(value=vec(v,'rgba' if 'r' in v else 'xyz' if 'z' in v else 'xy') if isinstance(v,dict) else [v],relative=bool(t.get('_isRelative')),ignore=t.get('_ignoreAxis',0))
def convert(name,raw,atlas,out):
 env=UnityPy.load(raw,atlas)
 # The main bundle owns the prefab; imported atlas objects are only texture inputs.
 allobj=list(env.objects);primary=UnityPy.load(raw);main_ids={o.path_id for o in primary.objects}
 obj={o.path_id:o for o in allobj if o.path_id in main_ids}
 data={};scripts={}
 for key,o in obj.items():
  if o.type.name in ('GameObject','Transform','RectTransform','CanvasGroup','PlayableDirector','MonoBehaviour'):
   data[key]=o.read_typetree()
   if o.type.name=='MonoBehaviour':scripts[key]=o.read().m_Script.read().m_ClassName
 rects={k:t for k,t in data.items() if obj[k].type.name in ('Transform','RectTransform')}
 roots=[k for k,t in rects.items() if not pid(t['m_Father'])]
 if len(roots)!=1:raise ValueError('Expected one prefab root')
 ordered=[]
 def visit(k):
  ordered.append(k)
  for c in rects[k]['m_Children']:visit(pid(c))
 visit(roots[0]);index={k:i for i,k in enumerate(ordered)}
 go_to_rect={pid(t['m_GameObject']):k for k,t in rects.items()}
 def target(k):return index.get(k,index.get(go_to_rect.get(pid(data.get(k,{}).get('m_GameObject',{})),-1),-1))
 warnings=[];textures={}
 def image_ref(o,field):
  ref=getattr(o.read(),field,None)
  if not ref or not ref.path_id:return None
  image=ref.read();buf=io.BytesIO();image.image.save(buf,format='PNG');raw_png=buf.getvalue();key=hashlib.sha256(raw_png).hexdigest()
  dest=out/(key+'.png')
  if not dest.exists():dest.write_bytes(raw_png)
  tree=ref.deref().read_typetree();border=vec(tree['m_Border'],'xyzw') if 'm_Border' in tree else [0,0,0,0]
  meta=dict(id=key,name=image.m_Name,width=image.image.width,height=image.image.height,border=border)
  textures[key]=meta;return meta
 nodes=[]
 for k in ordered:
  t=rects[k];go=data[pid(t['m_GameObject'])];is_rect=obj[k].type.name=='RectTransform';q=t['m_LocalRotation'];angle=math.degrees(math.atan2(2*(q['w']*q['z']+q['x']*q['y']),1-2*(q['y']**2+q['z']**2)))
  n=dict(name=go['m_Name'],parent=index.get(pid(t['m_Father']),-1),active=bool(go['m_IsActive']),rect=is_rect,anchorMin=vec(t.get('m_AnchorMin',dict(x=.5,y=.5))),anchorMax=vec(t.get('m_AnchorMax',dict(x=.5,y=.5))),pivot=vec(t.get('m_Pivot',dict(x=.5,y=.5))),position=vec(t['m_AnchoredPosition'] if is_rect else t['m_LocalPosition']),size=vec(t.get('m_SizeDelta',dict(x=0,y=0))),scale=vec(t['m_LocalScale']),rotation=angle,alpha=1,color=[1,1,1,1])
  for c in go['m_Component']:
   ck=pid(c['component']);ct=data.get(ck,{});sc=scripts.get(ck)
   if obj.get(ck) and obj[ck].type.name=='CanvasGroup':n['alpha']=ct['m_Alpha']
   elif sc in ('Image','RawImage'):
    meta=image_ref(obj[ck],'m_Sprite' if sc=='Image' else 'm_Texture');n.update(draw=True,color=vec(ct['m_Color'],'rgba'),texture=meta['id'] if meta else '',border=meta['border'] if meta else [0,0,0,0],textureSize=[meta['width'],meta['height']] if meta else [1,1],imageType=ct.get('m_Type',0))
   elif sc in ('GraphicMask','MultipleGraphicMask'):
    refs=ct.get('_targets',[ct.get('_target',{})]);n['mask']=dict(invert=bool(ct['_isInvert']),targets=[target(pid(x)) for x in refs])
    if any(x<0 for x in n['mask']['targets']):raise ValueError('Unresolved graphic mask binding')
  nodes.append(n)
 directors=[(k,t) for k,t in data.items() if obj[k].type.name=='PlayableDirector' and pid(t['m_PlayableAsset'])]
 main=next((k,t) for k,t in directors if target(k)==0);main_timeline=pid(main[1]['m_PlayableAsset'])
 bindings={pid(b['key']):pid(b['value']) for _,t in directors for b in t['m_SceneBindings']}
 timeline_owner={pid(t['m_PlayableAsset']):target(k) for k,t in directors}
 def lineage(k):
  chain=[]
  while k and k in data:
   chain.append(k);k=pid(data[k].get('m_Parent',{}))
  return chain
 nested={}
 for k,sc in scripts.items():
  if sc=='NestTrack':
   for clip in data[k].get('m_Clips',[]):nested[target(bindings.get(k))]=dict(start=clip['m_Start'],duration=clip['m_Duration'])
 tracks=[];sounds=[]
 for k,sc in scripts.items():
  if not sc.endswith('Track') or sc in ('GroupTrack','GroupParameterTrack','MarkerTrack','NestTrack'):continue
  t=data[k];chain=lineage(k);tl=next((x for x in chain if scripts.get(x)=='TimelineAsset'),None)
  phase=next((data[x]['m_Name'].lower() for x in chain if scripts.get(x)=='GroupTrack' and data[x]['m_Name'] in ('In','Out','Idle')),'constant')
  nest=nested.get(timeline_owner.get(tl)) if tl!=main_timeline else None
  if tl!=main_timeline:
   if not nest:raise ValueError('Unresolved nested timeline')
   phase='nested'
  if sc=='SoundEffectTrack':
   for c in t.get('m_Clips',[]):sounds.append(dict(phase=phase,start=c['m_Start'],duration=c['m_Duration'],source=data[pid(c['m_Asset'])].get('_assetName')))
   continue
  if sc not in PROPS:raise ValueError('Unsupported Titan track: '+sc)
  dest=target(bindings.get(k))
  if dest<0:
   warnings.append('原资源轨道未绑定对象，未作用于画面：'+sc+'/'+t['m_Name']);continue
  group=next((x for x in chain if scripts.get(x)=='GroupTrack'),None)
  gp=next((data[x] for x,s in scripts.items() if s=='GroupParameterTrack' and pid(data[x]['m_Parent'])==group),{})
  group_clips=[c for x in scripts if group in lineage(x) and scripts[x] in PROPS for c in data[x].get('m_Clips',[])] if gp else []
  track=dict(node=dest,property=PROPS[sc],phase=phase,initialEnabled=bool(t.get('_enableInitialValue',1)),initial=param(t['_initialParameter']),clips=[],loop=gp.get('_loopCount')==-1,loopType=gp.get('_loopType',0),loopStart=min((c['m_Start'] for c in group_clips),default=0),loopEnd=max((c['m_Start']+c['m_Duration'] for c in group_clips),default=0),nestStart=nest['start'] if nest else 0)
  for c in t.get('m_Clips',[]):
   ct=data[pid(c['m_Asset'])];end=param(ct['_endParameter']);ease=ct['_easeInfo']['_easeId'] or 'Linear'
   if ease not in ('Linear','OutCubic','InCubic','InOutCubic','OutQuint'):raise ValueError('Unknown easing '+ease)
   for expr in ct.get('_expressions',[]):
    if expr['_name']=='Z' and expr['_expression']=='-360':end['value'][2]=-360
    else:raise ValueError('Unresolved clip expression '+str(expr))
   track['clips'].append(dict(start=c['m_Start'],duration=c['m_Duration'],end=end,ease=ease))
  if t.get('_expressions'):warnings.append('运行时配色变量使用资源中保存的默认颜色：'+t['m_Name'])
  track['clips'].sort(key=lambda c:c['start']);tracks.append(track)
 def phase_end(p):return max((c['start']+c['duration'] for t in tracks if t['phase']==p for c in t['clips']),default=0)
 in_end=phase_end('in');out_end=phase_end('out');mask_tracks=[t for t in tracks if nodes[t['node']]['name']=='MaskImage' and t['property']=='size']
 cover_start=max((c['start']+c['duration'] for t in mask_tracks if t['phase']=='in' for c in t['clips']),default=in_end)
 cover_out=min((c['start'] for t in mask_tracks if t['phase']=='out' for c in t['clips']),default=0)
 short=name.removeprefix('ttn_adv_transition_');portrait=short in ('change_p','time_p','event_change')
 return dict(id='ui-transition-'+short.replace('_','-')+'-v1',type='UI',source=name,alias=NAMES[short],kind='transition',renderer='titan-ui-graph-v2',referenceWidth=1080 if portrait else 1920,referenceHeight=1920 if portrait else 1080,nodes=nodes,tracks=tracks,textures=list(textures.values()),inDuration=in_end,outDuration=out_end,hold=.8,coverStart=cover_start,coverOut=cover_out,sounds=sounds,reconstruction=True,warnings=warnings)

def prepare(root):
 root=Path(root).resolve(strict=True);scan=json.loads((root.parent/'inventory.json').read_text(encoding='utf8'));game=Path(scan['game']).resolve()
 if root==game or game in root.parents:raise ValueError('Game directory is read-only')
 dest=root/'player-view/ui-transitions-v2'
 if (dest/'catalog.json').is_file():
  old=json.loads((dest/'catalog.json').read_text(encoding='utf8'))
  if old.get('revision')==2 and old.get('manifest')==scan['manifest_sha256']:return old
  raise ValueError('Transition cache metadata mismatch; prepare a new batch')
 rows={r['name']:r for r in scan['records'] if r['kind']=='asset' and r['name'].startswith('ttn_adv_transition_')}
 def read(name):
  raw,_=select_source(rows[name]);raw=raw if raw.startswith(b'UnityFS\0') else transform(raw,name)
  if not raw.startswith(b'UnityFS\0'):raise ValueError('Not UnityFS: '+name)
  return bytes(raw)
 temp=dest.with_name(dest.name+'.preparing-'+uuid.uuid4().hex);temp.mkdir(parents=True);tex=temp/'textures';tex.mkdir()
 report=dict(revision=2,manifest=scan['manifest_sha256'],entries=[],packages=[],issues=[])
 try:
  atlas=read('ttn_adv_transition_time_atlas')
  for short in NAMES:
   name='ttn_adv_transition_'+short;item=dict(source=name,supported=False)
   try:
    entry=convert(name,read(name),atlas,tex);report['entries'].append(entry);item.update(supported=True,md5=rows[name]['md5'],warnings=entry['warnings'])
   except Exception as e:item['error']=str(e);report['issues'].append(dict(source=name,error=str(e)))
   report['packages'].append(item)
  report['packages'].append(dict(source='ttn_adv_transition_time_atlas',role='shared atlas',md5=rows['ttn_adv_transition_time_atlas']['md5']))
  (temp/'catalog.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8');temp.rename(dest)
  return report
 except Exception:
  # Keep incomplete outputs as evidence; never publish them as the cache catalog.
  raise
