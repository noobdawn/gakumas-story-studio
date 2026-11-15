"""Sample a motion in a disposable local Player; frames are PNGs, not video."""
import argparse,base64,json,os,re,secrets,socket,subprocess,sys,tempfile,time
from pathlib import Path
import film_motions
ROOT=Path(__file__).resolve().parent

def generate(asset_id,bundles,player,catalog_root=None):
 from resource_catalog import require_catalog,require_characters
 film=require_catalog(catalog_root)
 require_characters(film,bundles)
 player=Path(player).resolve();bundles=Path(bundles).resolve()
 if not player.is_file() or not (player.parent/'creator-performance-v1').is_file():raise ValueError('当前 Player 不支持动作预览')
 import base_motions
 base=base_motions.resolve(film)
 legacy={'asset-local-shy':('shy','ttmr-shy-exposed.bundle',3.5333),'asset-local-idle':('idle','ttmr-idle-exposed.bundle',1),'asset-local-angry':('angry','ttmr-angry-exposed.bundle',1.9333),'asset-local-yes':('yes','shared-yes-exposed.bundle',1.5667)}
 face=None;entry=None;extra=[]
 if asset_id.startswith('asset-film-'):
  entry=next((x for x in film_motions.load(film) if 'asset-'+x['id']==asset_id),None)
  if not entry or not (player.parent/'creator-film-motions-v1').is_file():raise ValueError('动作资源或 Player 能力不可用')
  motion=entry['id'];length=entry['length']
 elif asset_id in legacy:
  motion,filename,length=legacy[asset_id];f=base[motion]
  if not f.is_file():raise ValueError('本地动作文件缺失')
  if motion!='shy':extra+=['-creator-motion-'+motion,str(f)]
 elif re.fullmatch(r'asset-face-motion-[A-Za-z0-9_-]+_f',asset_id):
  face_root=film/'player-view/face-effects/face-animation'
  data=json.loads((face_root/'catalog.json').read_text(encoding='utf8'));row=next((x for x in data.get('motions',[]) if x.get('id')==asset_id),None)
  if not row or not re.fullmatch(r'[0-9a-f]{64}\.json',row.get('file','')):raise ValueError('面部动画不可用')
  file=(face_root/'clips'/row['file']).resolve()
  if (face_root/'clips').resolve() not in file.parents or not file.is_file() or file.stat().st_size>4*1024*1024:raise ValueError('面部动画文件无效')
  face=json.loads(file.read_text(encoding='utf8'));length=float(row['length']);motion='shy'
  shape=film/'face/mdl_chr_ttmr-base-0000_face.json'
  if not shape.is_file() or not (player.parent/'creator-face-v2').is_file():raise ValueError('面部动画预览不可用')
  extra+=['-creator-face-shapes',str(shape)]
 else:raise ValueError('动画标识无效')
 if not 0<length<=3600:raise ValueError('动画时长无效')
 with tempfile.TemporaryDirectory(prefix='creator-motion-thumb-') as td:
  tmp=Path(td);token=secrets.token_hex(32);listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen(1);listener.settimeout(.5)
  cmd=[str(player), '-force-d3d11','-batchmode','-creator-bundles',str(bundles),'-creator-output',str(tmp),'-creator-port',str(listener.getsockname()[1]),'-creator-token',token,'-creator-connect','-creator-motion',str(base['shy']),'-screen-width','192','-screen-height','192','-logFile',str(tmp/'player.log')]+extra
  from render_shader_cache import for_player
  shaders=for_player(player,film)
  if shaders:cmd+=['-creator-render-shaders',str(shaders)]
  if entry:
   manifest=tmp/'manifest.json';manifest.write_text(json.dumps({'motions':[entry]},ensure_ascii=False),encoding='utf8');cmd+=['-creator-film-motions',str(manifest)]
  startup=subprocess.STARTUPINFO();startup.dwFlags|=subprocess.STARTF_USESHOWWINDOW;startup.wShowWindow=0;proc=None;conn=None;reader=None
  try:
   proc=subprocess.Popen(cmd,cwd=player.parent,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,startupinfo=startup,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0));deadline=time.monotonic()+60
   while time.monotonic()<deadline and proc.poll() is None:
    try:conn,_=listener.accept();break
    except TimeoutError:pass
   if not conn:raise RuntimeError((tmp/'error.txt').read_text(encoding='utf8')[-1000:] if (tmp/'error.txt').exists() else '预览 Player 启动失败')
   conn.settimeout(30);reader=conn.makefile('rb')
   if reader.readline(256).strip()!=('creator-session '+token).encode():raise RuntimeError('预览认证失败')
   def request(obj):
    conn.sendall((json.dumps({'token':token,**obj})+'\n').encode());reply=json.loads(reader.readline(65536))
    if not reply.get('ok'):raise RuntimeError(reply.get('error','预览失败'))
   def value(keys,t):
    if t<=keys[0]['time']:return keys[0]['value']
    for a,b in zip(keys,keys[1:]):
     if t<=b['time']:
      f=(t-a['time'])/(b['time']-a['time']);return a['value']+(b['value']-a['value'])*f
    return keys[-1]['value']
   frames=[];duration=min(length,4);count=12
   for i in range(count):
    t=min(length*i/count,length-.0001);cmdstate={'id':i*2+1,'actorPosition':[0,0,0],'actorRotation':[0,0,0],'cameraPosition':[0,.85,2.4] if not face else [0,1.35,.75],'cameraRotation':[0,180,0],'fov':35,'motionId':motion,'motionActive':not bool(face),'motionTime':t,'idleMotionTime':0,'physicsEnabled':False}
    if face:
     layers=[]
     for channel in face.get('channels',[]):
      name=channel.get('shape','');keys=channel.get('keys',[])
      if keys and re.fullmatch(r'b_(brow|eye|iris|mouth)\.[a-z]+_\d{3}',name):layers.append({'name':name,'weight':max(0,min(1,value(keys,t)/100))})
     cmdstate.update(hasArrangement=True,cameraEnabled=True,sceneVisible=False,actorInstances=[{'id':'ttmr','position':[0,0,0],'rotation':[0,0,0],'visible':True,'motionId':'shy','motionActive':False,'motionTime':0,'idleMotionTime':0,'faceWeight':0,'faceShapes':layers[:96]}])
    request(cmdstate);request({'id':i*2+2,'kind':'frame','frameWidth':192,'frameHeight':192});image=(tmp/'export-frame.png').read_bytes()
    if not image.startswith(b'\x89PNG\r\n\x1a\n') or len(image)>2*1024*1024:raise ValueError('预览图片无效')
    frames.append('data:image/png;base64,'+base64.b64encode(image).decode('ascii'))
   return {'assetId':asset_id,'duration':duration,'frames':frames}
  finally:
   if reader:reader.close()
   if conn:conn.close()
   listener.close()
   if proc and proc.poll() is None:
    proc.terminate()
    try:proc.wait(timeout=10)
    except subprocess.TimeoutExpired:subprocess.run(['taskkill','/pid',str(proc.pid),'/t','/f'],capture_output=True,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0));proc.wait(timeout=10)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--asset-id',required=True);p.add_argument('--bundles',required=True);p.add_argument('--player',required=True);p.add_argument('--catalog-root',required=True);args=p.parse_args()
 try:print(json.dumps(generate(args.asset_id,args.bundles,args.player,args.catalog_root),separators=(',',':')),flush=True)
 except Exception as e:print(str(e)[:2000],file=sys.stderr,flush=True);sys.exit(1)
