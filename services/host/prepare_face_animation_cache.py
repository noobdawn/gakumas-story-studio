"""Generate editable face clips and projector curves from one local catalog."""
import argparse,hashlib,json,math,re,sys,warnings,zlib
from pathlib import Path
from face_curve_sampling import decode_stream,sample_curve,sample_dense,simplify_keys
HERE=Path(__file__).resolve().parent;pass # dependencies installed in the Python environment
import UnityPy
warnings.filterwarnings('ignore',category=UnityPy.exceptions.UnityVersionFallbackWarning)
UnityPy.config.FALLBACK_UNITY_VERSION='6000.0.77f1'
PATTERN=re.compile(r'b_(?:brow|eye|iris|mouth)\.[a-z]+_\d{3}')
ID=re.compile(r'[A-Za-z0-9_-]{1,170}_f')
PREFIX='Root_Body/Reference/Hips/Spine/Spine1/Spine2/Neck/Head/Head_Face/FacialDecal/'
DECALS=['Shadow','Pale','CheekWhole','LeftCheek','RightCheek','LeftCheekLine','RightCheekLine','CheekLineWhole']
DECAL_PATHS={zlib.crc32((PREFIX+n).encode())&0xffffffff:n for n in DECALS};FADE=zlib.crc32(b'm_FadeFactor')&0xffffffff
LEGACY={'mot_all_chr_ttmr_tereru-002_in_f','mot_all_chr_ttmr_idle-001_in_f','mot_all_chr_ttmr_angry-001_in_f','mot_all_chr_cmmn_yes-003_in_f'}

def build(root,out):
 root=Path(root).resolve(strict=True);out=Path(out).resolve();allowed=(root/'player-view').resolve(strict=True)
 if not out.is_relative_to(allowed):raise ValueError('output must be inside player view')
 face=UnityPy.load(str(root/'bundles/mdl_chr_ttmr-base-0000_face.bundle'));names=None
 for obj in face.objects:
  if obj.type.name!='MonoBehaviour':continue
  try:
   if obj.read().m_Script.read().m_ClassName=='VLActorFaceModel':names=[x['blendShapeName'] for x in obj.read_typetree()['blendShapes']];break
  except (AttributeError,ValueError):continue
 if not names or len(names)>128:raise ValueError('face shape order unavailable')
 attrs={zlib.crc32(f'blendShapeWeights.w{i//16}.w{i%16}'.encode())&0xffffffff:n for i,n in enumerate(names)}
 candidates={};duplicates=[];exposed=(root/'exposed').resolve(strict=True)
 for line in (root/'bundles.jsonl').read_text(encoding='utf8').splitlines():
  row=json.loads(line);rel=row.get('exposed')
  if not isinstance(rel,str) or row.get('error') or row.get('inspectionError'):continue
  f=(root/rel).resolve()
  if f.parent!=exposed or f.suffix.lower()!='.bundle' or not f.is_file():continue
  for clip in row.get('clips',[]):
   name,start,stop=clip.get('name'),clip.get('start'),clip.get('stop')
   if clip.get('role')!='face' or not isinstance(name,str) or not ID.fullmatch(name):continue
   if isinstance(start,bool) or isinstance(stop,bool) or not isinstance(start,(float,int)) or not isinstance(stop,(float,int)) or not math.isfinite(start) or not math.isfinite(stop) or not 0<stop-start<=3600:continue
   if name in candidates:duplicates.append(name);continue
   candidates[name]=f
 out.mkdir(exist_ok=False);(out/'clips').mkdir();(out/'decal-curves').mkdir();results=[];errors=[]
 for index,(name,file) in enumerate(sorted(candidates.items())):
  try:
   env=UnityPy.load(str(file));clip=next(o.read() for o in env.objects if o.type.name=='AnimationClip' and o.read().m_Name==name)
   raw=clip.m_MuscleClip.m_Clip.data;stream=decode_stream(raw.m_StreamedClip.data,raw.m_StreamedClip.curveCount);dense=raw.m_DenseClip;constants=raw.m_ConstantClip.data if raw.m_ConstantClip else [];bindings=clip.m_ClipBindingConstant.genericBindings
   if len(bindings)!=len(stream)+dense.m_CurveCount+len(constants):raise ValueError('unsupported binding layout')
   source_start=float(clip.m_MuscleClip.m_StartTime);length=float(clip.m_MuscleClip.m_StopTime-source_start)
   if not math.isfinite(length) or not 0<length<=3600:raise ValueError('invalid duration')
   mapping=[];projectors=[]
   for i,b in enumerate(bindings):
    try:script=b.script.read().m_ClassName
    except (AttributeError,ValueError):continue
    if script=='VLActorFaceModel':
     shape=attrs.get(b.attribute)
     if not shape:raise ValueError('unknown facial attribute '+str(b.attribute))
     if PATTERN.fullmatch(shape):mapping.append((i,shape))
    elif script=='DecalProjector':
     if b.attribute!=FADE or b.path not in DECAL_PATHS:raise ValueError('unknown decal binding')
     projectors.append((i,'decal.'+DECAL_PATHS[b.path]))
   if len({n for _,n in mapping})!=len(mapping) or len({n for _,n in projectors})!=len(projectors):raise ValueError('duplicate binding')
   def channel(i,shape,offset,segment_length,scaled):
    keys=[];frames=math.ceil(segment_length*30-1e-5)
    for frame in range(frames+1):
     t=min(frame/30,segment_length);at=source_start+offset+t
     value=sample_curve(stream[i],at) if i<len(stream) else sample_dense(dense.m_SampleArray,dense.m_CurveCount,dense.m_FrameCount,dense.m_SampleRate,dense.m_BeginTime,i-len(stream),at) if i<len(stream)+dense.m_CurveCount else constants[i-len(stream)-dense.m_CurveCount]
     if not math.isfinite(value):raise ValueError('invalid weight')
     key={'time':round(t,6),'value':round(max(0,min(1,value))*100 if scaled else max(0,min(100,value)),3)}
     if keys and key['time']==keys[-1]['time']:
      if key['value']!=keys[-1]['value']:raise ValueError('rounded key collision')
     else:keys.append(key)
    return {'shape':shape,'keys':keys if name in LEGACY and not scaled else simplify_keys(keys)} if any(k['value']>.001 for k in keys) else None
   pending=[]
   for seg in range(math.ceil(length/60-1e-7)):
    offset=seg*60;seglen=min(60.,length-offset);segname=name if length<=60 else name[:-2]+'-part-'+str(seg+1).zfill(3)+'_f';ident='asset-face-motion-'+segname
    channels=[x for i,shape in mapping if (x:=channel(i,shape,offset,seglen,False))];decal=[x for i,shape in projectors if (x:=channel(i,shape,offset,seglen,True))]
    if not channels:raise ValueError('no usable facial channels')
    row={'id':ident,'name':segname,'length':seglen,'channels':channels}
    if length>60:row.update(originalName=name,sourceOffset=offset,sourceLength=length)
    encoded=json.dumps(row,ensure_ascii=False,separators=(',',':')).encode('utf8');overlay=json.dumps({'id':ident,'channels':decal},separators=(',',':')).encode('utf8')
    if len(encoded)>4*1024*1024 or len(overlay)>512*1024:raise ValueError('clip exceeds size limit')
    filename=hashlib.sha256(segname.encode('utf8')).hexdigest()+'.json';entry={k:v for k,v in row.items() if k!='channels'};entry['file']=filename;pending.append((entry,encoded,overlay))
   if len(results)+len(pending)>5000:raise ValueError('catalog exceeds Player limit')
   for entry,data,overlay in pending:
    (out/'clips'/entry['file']).write_bytes(data);(out/'decal-curves'/entry['file']).write_bytes(overlay);results.append(entry)
  except Exception as e:errors.append({'name':name,'error':str(e)[:300]})
  if (index+1)%100==0 or index+1==len(candidates):print('face clips',index+1,'/',len(candidates),'prepared',len(results),'errors',len(errors),flush=True)
 (out/'catalog.json').write_text(json.dumps({'version':2,'fps':30,'motions':results},ensure_ascii=False,separators=(',',':')),encoding='utf8')
 report={'sources':len(candidates),'prepared':len(results),'duplicates':duplicates,'errors':errors}
 (out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8');return report
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--catalog-root',type=Path,required=True);p.add_argument('--output-dir',type=Path,required=True);a=p.parse_args();print(json.dumps(build(a.catalog_root,a.output_dir),ensure_ascii=False),flush=True)
