"""Render one local costume thumbnail in a disposable, no-window Player session."""
import argparse,base64,json,os,re,secrets,shutil,socket,subprocess,sys,tempfile,time
from pathlib import Path
import costume_catalog
ROOT=Path(__file__).resolve().parent

def render(asset_id,bundles,player,catalog_root=None):
 from resource_catalog import require_catalog,require_characters
 film=require_catalog(catalog_root)
 require_characters(film,bundles)
 if not re.fullmatch(r'asset-costume-[0-9a-f]{24}',asset_id):raise ValueError('服装标识无效')
 base=Path(bundles).resolve();player=Path(player).resolve();rows=costume_catalog.load(film)
 item=next((x for x in rows if 'asset-'+x['id']==asset_id),None)
 if not item or not item['knownCharacter'] or not item['bodyAvailable'] or not item['dependenciesAvailable']:raise ValueError('服装或角色资源不可用')
 if not player.is_file() or not (player.parent/'creator-performance-v1').is_file():raise ValueError('预览 Player 不支持该功能')
 if not item['thumbnailAvailable']:raise ValueError('服装依赖无法识别或不受支持')
 depnames=item['dependencyBundles']
 if depnames and not (player.parent/'creator-costume-dependencies-v1').is_file():raise ValueError('当前 Player 尚不支持此服装的额外身体资源')
 code=item['character'];filmBundles=(film/'bundles').resolve()
 def source(root,name):
  file=(root/name).resolve()
  if root not in file.parents or not file.is_file():raise ValueError('缺少本地预览资源：'+name)
  with file.open('rb') as f:
   if f.read(8)!=b'UnityFS\0':raise ValueError('本地预览资源格式无效：'+name)
  return file
 mapping={name:source(base,name) for name in ('shader.bundle','actor-shader.bundle','m_fdc.bundle')}
 mapping['mdl_chr_ttmr-casl-0002_body.bundle']=source(filmBundles,item['name']+'.bundle')
 mapping['mdl_chr_ttmr-base-0000_hair.bundle']=source(base,'mdl_chr_'+code+'-base-0000_hair.bundle')
 mapping['ttmr-face-exposed.bundle']=source(base,'ttmr-face-exposed.bundle' if code=='ttmr' else code+'-face-exposed.bundle')
 for name in depnames:mapping[name+'.bundle']=source(filmBundles,name+'.bundle')
 import base_motions
 motion=base_motions.resolve(film)['idle']
 if not motion.is_file():raise ValueError('缺少本地待机动作')
 with tempfile.TemporaryDirectory(prefix='creator-costume-preview-') as temporary:
  tmp=Path(temporary).resolve();stage=tmp/'bundles';stage.mkdir()
  for name,src in mapping.items():
   dest=stage/name
   try:os.link(src,dest)
   except OSError:
    with src.open('rb') as source_file,dest.open('xb') as target:shutil.copyfileobj(source_file,target,1024*1024)
  token=secrets.token_hex(32);listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen(1);listener.settimeout(.5);port=listener.getsockname()[1]
  command=[str(player), '-force-d3d11','-batchmode','-creator-bundles',str(stage),'-creator-output',str(tmp),'-creator-port',str(port),'-creator-token',token,'-creator-connect','-creator-motion',str(motion),'-screen-width','256','-screen-height','256','-logFile',str(tmp/'player.log')]
  from render_shader_cache import for_player
  shaders=for_player(player,film)
  if shaders:command+=['-creator-render-shaders',str(shaders)]
  if depnames:command+=['-creator-preload-costumes',','.join(depnames)]
  startup=subprocess.STARTUPINFO();startup.dwFlags|=subprocess.STARTF_USESHOWWINDOW;startup.wShowWindow=0
  proc=None;conn=None;reader=None
  try:
   proc=subprocess.Popen(command,cwd=player.parent,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,startupinfo=startup,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
   deadline=time.monotonic()+45
   while time.monotonic()<deadline and proc.poll() is None:
    try:conn,_=listener.accept();break
    except TimeoutError:pass
   if not conn:raise RuntimeError((tmp/'error.txt').read_text(encoding='utf8')[-1500:] if (tmp/'error.txt').exists() else '服装预览 Player 启动失败')
   conn.settimeout(15);reader=conn.makefile('rb')
   if reader.readline(256).strip()!=('creator-session '+token).encode():raise RuntimeError('预览连接认证失败')
   def request(obj):
    conn.sendall((json.dumps({'token':token,**obj})+'\n').encode());reply=json.loads(reader.readline(65536))
    if not reply.get('ok'):raise RuntimeError(reply.get('error','预览失败'))
   request({'id':1,'actorPosition':[0,0,0],'actorRotation':[0,0,0],'cameraPosition':[0,1,3],'cameraRotation':[0,180,0],'fov':45,'motionId':'shy','motionActive':True,'motionTime':0,'idleMotionTime':0,'physicsEnabled':False})
   request({'id':2,'kind':'frame','frameWidth':256,'frameHeight':256});image=(tmp/'export-frame.png').read_bytes()
   if len(image)<8 or len(image)>2*1024*1024 or not image.startswith(b'\x89PNG\r\n\x1a\n'):raise ValueError('预览图片无效')
   return {'assetId':asset_id,'dataUrl':'data:image/png;base64,'+base64.b64encode(image).decode('ascii')}
  finally:
   if reader:reader.close()
   if conn:conn.close()
   listener.close()
   if proc and proc.poll() is None:
    proc.terminate()
    try:proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
     subprocess.run(['taskkill','/pid',str(proc.pid),'/t','/f'],capture_output=True,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0));proc.wait(timeout=10)

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--asset-id',required=True);parser.add_argument('--bundles',required=True);parser.add_argument('--player',required=True);parser.add_argument('--catalog-root',required=True);args=parser.parse_args()
 try:print(json.dumps(render(args.asset_id,args.bundles,args.player,args.catalog_root),separators=(',',':')),flush=True)
 except Exception as e:print(str(e)[:2000],file=sys.stderr,flush=True);sys.exit(1)
