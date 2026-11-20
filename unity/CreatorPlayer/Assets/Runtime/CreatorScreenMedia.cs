using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using Process = System.Diagnostics.Process;
using ProcessStartInfo = System.Diagnostics.ProcessStartInfo;
using UnityEngine;
using UnityEngine.Video;

[Serializable] public class CreatorMediaDraw {public string id,file,kind;public float[] points,uv,color,pivot;public double time,fps;public int width,height;public long frameCount;}

public sealed class CreatorScreenMedia:IDisposable {
 static readonly bool TraceFrames=Environment.GetEnvironmentVariable("CREATOR_TEST_INSTANCE")=="1"&&Environment.GetEnvironmentVariable("CREATOR_MEDIA_TRACE")=="1";
 static void Trace(Item item,string phase){if(TraceFrames)Debug.Log($"ScreenMedia {phase} wanted={item.wanted} rendered={item.rendered} actual={item.video.frame} playing={item.video.isPlaying}");}
 [Serializable] public class EditEvent {public string id,phase;public float dx,dy,scale=1;}
 sealed class Item:IDisposable {
  public double fps;
  public string file,error,recoveryFile;
  public Texture2D image,exactImage;
  public VideoPlayer video;
  public RenderTexture target;
  public long rendered=-1,wanted=-1,exactFrame=-1,received,receivedAtSeek;
  public bool requested;
  public float waitStarted,recoveryStarted;
  public Process recovery;
  public Texture Texture {
   get {
    if(image)return image;
    if(exactImage&&exactFrame==wanted)return exactImage;
    return target;
   }
  }

  public void CloseRecovery(){
   if(recovery!=null){
    try{
     if(!recovery.HasExited){recovery.Kill();recovery.WaitForExit(1000);}
    }catch(InvalidOperationException){} // The decoder exited between the status check and Kill.
    finally{recovery.Dispose();recovery=null;}
   }
   if(recoveryFile!=null){try{File.Delete(recoveryFile);}catch(IOException){}recoveryFile=null;}
  }
  public void Dispose(){
   CloseRecovery();if(video){video.Stop();UnityEngine.Object.Destroy(video.gameObject);}
   if(target){target.Release();UnityEngine.Object.Destroy(target);}
   if(image)UnityEngine.Object.Destroy(image);if(exactImage)UnityEngine.Object.Destroy(exactImage);
  }
 }
 readonly string root,decoder,sessionDirectory;readonly Transform parent;readonly CreatorUIGraph graph;readonly Dictionary<string,Item> items=new Dictionary<string,Item>();
 CreatorMediaDraw[] draws=Array.Empty<CreatorMediaDraw>();public string Error{get;private set;}
 int dragControl;
 string selected,dragId;bool editable,snap,resizing;Vector2 down,pivot;Rect originalBounds;EditEvent edit;float dragScale=1;Vector2 delta;readonly Queue<EditEvent> events=new Queue<EditEvent>();
 public CreatorScreenMedia(Shader shader,string directory,Transform parent,string decoderPath,string sessionDirectory){
  root=string.IsNullOrEmpty(directory)?null:Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;
  decoder=string.IsNullOrEmpty(decoderPath)?Path.GetFullPath(Path.Combine(Application.dataPath,"../../tools/ffmpeg.exe")):decoderPath;
  this.sessionDirectory=sessionDirectory;this.parent=parent;graph=new CreatorUIGraph(shader,null,key=>items[key].Texture);
 }
 static bool Finite(double v)=>!double.IsNaN(v)&&!double.IsInfinity(v);
 static void Values(float[] a,int length,float min,float max){if(a==null||a.Length!=length||a.Any(x=>!Finite(x)||x<min||x>max))throw new Exception("Invalid media layout");}
 string FilePath(CreatorMediaDraw d){if(root==null)throw new Exception("Media library unavailable");var file=Path.GetFullPath(d.file??"");if(!file.StartsWith(root,StringComparison.OrdinalIgnoreCase)||!File.Exists(file)||!new DirectoryInfo(Path.GetDirectoryName(file)).Name.EndsWith(".media",StringComparison.OrdinalIgnoreCase)||Path.GetFileName(file)!=(d.kind=="image"?"image.png":"video.mp4"))throw new Exception("Invalid media file");return file;}
 void Begin(CreatorMediaDraw[] value){
  Error=null;value=value??Array.Empty<CreatorMediaDraw>();if(value.Length>32)throw new Exception("Too many screen media layers");var ids=new HashSet<string>();
  foreach(var d in value){if(d==null||string.IsNullOrEmpty(d.id)||d.id.Length>100||!ids.Add(d.id)||!new[]{"image","video"}.Contains(d.kind))throw new Exception("Invalid media layer");Values(d.points,8,-1000,1000);Values(d.uv,4,0,1);Values(d.color,4,0,1);Values(d.pivot,2,-1000,1000);if(!Finite(d.time)||d.time<0||d.time>3600||d.width<1||d.height<1||d.width>4096||d.height>4096||d.kind=="video"&&(!Finite(d.fps)||d.fps<=0||d.fps>60||d.frameCount<1))throw new Exception("Invalid media dimensions or time");FilePath(d);}
  if(items.Any(k=>!ids.Contains(k.Key)||value.Any(d=>d.id==k.Key&&FilePath(d)!=k.Value.file)))graph.Set(Array.Empty<CreatorUIDraw>());
  foreach(var key in items.Keys.Where(x=>!ids.Contains(x)).ToArray()){items[key].Dispose();items.Remove(key);}
  foreach(var d in value){string file=FilePath(d);if(items.TryGetValue(d.id,out var old)&&old.file!=file){old.Dispose();items.Remove(d.id);}
   if(!items.TryGetValue(d.id,out var item)){item=new Item{file=file};items.Add(d.id,item);if(d.kind=="image"){if(new FileInfo(file).Length>100*1024*1024)throw new Exception("Image exceeds 100 MB");item.image=new Texture2D(2,2,TextureFormat.RGBA32,false,true);if(!item.image.LoadImage(File.ReadAllBytes(file)))throw new Exception("Image decode failed");item.image.wrapMode=TextureWrapMode.Clamp;item.image.filterMode=FilterMode.Bilinear;}
    else{var go=new GameObject("Screen video "+d.id);go.transform.SetParent(parent,false);var video=go.AddComponent<VideoPlayer>();item.video=video;item.target=new RenderTexture(d.width,d.height,0,RenderTextureFormat.ARGB32,RenderTextureReadWrite.sRGB);item.target.wrapMode=TextureWrapMode.Clamp;item.target.filterMode=FilterMode.Bilinear;item.target.Create();video.playOnAwake=false;video.source=VideoSource.Url;video.url=new Uri(file).AbsoluteUri;video.audioOutputMode=VideoAudioOutputMode.None;video.renderMode=VideoRenderMode.RenderTexture;video.targetTexture=item.target;video.aspectRatio=VideoAspectRatio.NoScaling;video.skipOnDrop=false;video.waitForFirstFrame=true;video.isLooping=false;video.sendFrameReadyEvents=true;var captured=item;video.errorReceived+=(v,message)=>captured.error=message;video.frameReady+=(v,frame)=>{captured.rendered=frame;captured.received++;Trace(captured,"frame-ready");};video.seekCompleted+=v=>Trace(captured,"seek-complete");video.Prepare();}
   }
   if(item.video){item.fps=d.fps;long frame=Math.Max(0,Math.Min(d.frameCount-1,(long)Math.Floor(d.time*d.fps+0.0001)));if(item.wanted!=frame){item.CloseRecovery();item.wanted=frame;item.requested=false;item.waitStarted=Time.realtimeSinceStartup;}}
  }
  draws=value;
 }
 void StartExactFrame(Item item,float now){
  if(!File.Exists(decoder))throw new FileNotFoundException("找不到创作器的视频解码工具");
  // The prepared proxy starts at zero and has a constant frame rate. Accurate input
  // seeking discards frames before this timestamp, strictly between N-1 and N.
  var seconds=(Math.Max(0,item.wanted-.5)/item.fps).ToString("0.000000000",CultureInfo.InvariantCulture);
  item.recoveryFile=Path.Combine(sessionDirectory,"media-frame-"+Guid.NewGuid().ToString("N")+".png");
  var args="-hide_banner -nostdin -loglevel error -threads 2 -ss "+seconds+" -i \""+item.file+
    "\" -map 0:v:0 -frames:v 1 -an -threads 1 -compression_level 1 -f image2 \""+item.recoveryFile+"\"";
  item.recoveryStarted=now;
  item.recovery=Process.Start(new ProcessStartInfo(decoder,args){UseShellExecute=false,CreateNoWindow=true});
  if(item.recovery==null)throw new IOException("无法启动视频帧解码");
  Trace(item,"exact-start");
 }

 bool FrameReady(Item item,float now){
  var v=item.video;if(!v)return true;
  if(item.rendered==item.wanted||item.exactFrame==item.wanted){
   if(v.isPlaying)v.Pause();
   if(item.recovery!=null)item.CloseRecovery();
   return true;
  }
  if(item.recovery!=null){
   if(!item.recovery.HasExited){
    if(now-item.recoveryStarted>12)throw new IOException("读取源视频帧超时");
    return false;
   }
   if(item.recovery.ExitCode!=0||!File.Exists(item.recoveryFile))throw new IOException("无法从播放副本读取指定帧");
   item.exactFrame=-1;
   if(!item.exactImage)item.exactImage=new Texture2D(2,2,TextureFormat.RGBA32,false,false){wrapMode=TextureWrapMode.Clamp,filterMode=FilterMode.Bilinear};
   if(!item.exactImage.LoadImage(File.ReadAllBytes(item.recoveryFile))||item.exactImage.width!=item.target.width||item.exactImage.height!=item.target.height)throw new IOException("视频帧解码结果无效");
   item.exactFrame=item.wanted;
   item.CloseRecovery();
   Trace(item,"exact-ready");
   return true;
  }
  if(item.error==null&&v.isPrepared&&!item.requested){
   item.requested=true;item.receivedAtSeek=item.received;item.waitStarted=now;
   try{v.Pause();Trace(item,"seek");v.time=(item.wanted+.5)/item.fps;}catch(Exception e){item.error=e.Message;}
  }
  // Windows can finish a paused seek on the preceding frame, or omit frameReady
  // entirely. A layout-only edit may then request the same frame indefinitely.
  var waited=now-item.waitStarted;
  bool missed=item.requested&&item.received!=item.receivedAtSeek&&waited>=.15f;
  bool seekTimedOut=waited>=(item.requested?1.0f:2.0f);
  if((item.error!=null||missed||seekTimedOut)&&!items.Values.Any(other=>other.recovery!=null))StartExactFrame(item,now);
  return false;
 }

 public IEnumerator Apply(CreatorMediaDraw[] value){
  try{Begin(value);}catch(Exception e){Error=e.Message;yield break;}
  while(true){
   bool ready=true;
   try{float now=Time.realtimeSinceStartup;foreach(var item in items.Values)if(!FrameReady(item,now))ready=false;}
   catch(Exception e){
    foreach(var item in items.Values){item.CloseRecovery();item.requested=false;item.waitStarted=Time.realtimeSinceStartup;}
    Error="视频帧读取失败："+e.Message;yield break;
   }
   if(ready)break;yield return null;
  }
  // frameReady signals the decoded frame; wait until the texture upload has completed.
  if(items.Values.Any(i=>i.video))yield return new WaitForEndOfFrame();
  try{graph.Set(draws.Select(d=>new CreatorUIDraw{texture=d.id,points=d.points,uv=d.uv,color=d.color,linearInput=d.kind=="video"&&QualitySettings.activeColorSpace==ColorSpace.Linear}).ToArray());}catch(Exception e){Error=e.Message;}
 }
 public void Select(string id,bool canEdit,bool useSnap){selected=id;editable=canEdit;snap=useSnap;if(dragId!=null&&(dragId!=id||!editable))End();}
 public EditEvent TakeEvent(){if(events.Count>0)return events.Dequeue();var result=edit;edit=null;return result;}
 void Push(string phase){var value=new EditEvent{id=dragId,phase=phase,dx=delta.x,dy=delta.y,scale=dragScale};if(phase=="move")edit=value;else{if(edit!=null){events.Enqueue(edit);edit=null;}events.Enqueue(value);}}
 void End(){if(dragId==null)return;Push("end");dragId=null;}
 // Playback or a new selection can end the drag outside OnGUI. Only touch IMGUI capture from Handles.
 void ReleaseDragControl(){
  if(dragControl==0)return;
  if(GUIUtility.hotControl==dragControl)GUIUtility.hotControl=0;
  dragControl=0;
 }
 static CreatorUIDraw Draw(CreatorMediaDraw d)=>new CreatorUIDraw{texture=d.id,points=d.points,uv=d.uv,color=d.color,linearInput=d.kind=="video"&&QualitySettings.activeColorSpace==ColorSpace.Linear};
 public Texture RenderItem(string id,int w,int h){var d=draws.FirstOrDefault(x=>x.id==id);if(d==null)throw new Exception("Composition media not prepared: "+id);graph.Set(new[]{Draw(d)});return graph.Render(w,h);}
 public Texture Render(int w,int h){graph.Set(draws.Select(Draw).ToArray());return graph.Render(w,h);}
 public void Draw(){graph.Draw();}
 public void Composite(Texture2D image){if(Error!=null)throw new Exception(Error);graph.Composite(image);}
 static Rect Bounds(CreatorMediaDraw d){float x0=float.MaxValue,x1=float.MinValue,y0=float.MaxValue,y1=float.MinValue;for(int i=0;i<4;i++){float x=d.points[2*i]*Screen.width,y=(1-d.points[2*i+1])*Screen.height;x0=Math.Min(x0,x);x1=Math.Max(x1,x);y0=Math.Min(y0,y);y1=Math.Max(y1,y);}return Rect.MinMaxRect(x0,y0,x1,y1);}
 float Snap(float low,float high,IEnumerable<float> targets){float best=7,result=0;foreach(float point in targets)foreach(float edge in new[]{low,(low+high)*.5f,high})if(Mathf.Abs(point-edge)<best){result=point-edge;best=Mathf.Abs(result);}return result;}
 public void Handles(){
  if(dragId==null)ReleaseDragControl();
  var d=draws.FirstOrDefault(x=>x.id==selected);if(d==null||!editable)return;var e=Event.current;var bounds=Bounds(d);var handle=new Rect(bounds.xMax-6,bounds.yMax-6,12,12);int control=GUIUtility.GetControlID(FocusType.Passive);
  if(e.type==EventType.Repaint){var old=GUI.color;GUI.color=new Color(.35f,.8f,1,.9f);GUI.DrawTexture(new Rect(bounds.xMin,bounds.yMin,bounds.width,1),Texture2D.whiteTexture);GUI.DrawTexture(new Rect(bounds.xMin,bounds.yMax,bounds.width,1),Texture2D.whiteTexture);GUI.DrawTexture(new Rect(bounds.xMin,bounds.yMin,1,bounds.height),Texture2D.whiteTexture);GUI.DrawTexture(new Rect(bounds.xMax,bounds.yMin,1,bounds.height),Texture2D.whiteTexture);GUI.DrawTexture(handle,Texture2D.whiteTexture);GUI.color=old;}
  if(e.type==EventType.MouseDown&&e.button==0&&(handle.Contains(e.mousePosition)||bounds.Contains(e.mousePosition))){dragId=d.id;down=e.mousePosition;pivot=new Vector2(d.pivot[0]*Screen.width,(1-d.pivot[1])*Screen.height);originalBounds=bounds;resizing=handle.Contains(down);delta=Vector2.zero;dragScale=1;dragControl=control;GUIUtility.hotControl=control;Push("begin");e.Use();}
  else if(e.type==EventType.MouseDrag&&dragId==d.id){if(resizing){var initial=down-pivot;dragScale=Mathf.Clamp(Vector2.Dot(e.mousePosition-pivot,initial)/Mathf.Max(1,initial.sqrMagnitude),.01f,100);}else{var movement=e.mousePosition-down;if(snap&&!e.alt){var xs=new List<float>{0,Screen.width*.5f,Screen.width};var ys=new List<float>{0,Screen.height*.5f,Screen.height};foreach(var other in draws.Where(x=>x.id!=dragId)){var b=Bounds(other);xs.AddRange(new[]{b.xMin,b.center.x,b.xMax});ys.AddRange(new[]{b.yMin,b.center.y,b.yMax});}movement.x+=Snap(originalBounds.xMin+movement.x,originalBounds.xMax+movement.x,xs);movement.y+=Snap(originalBounds.yMin+movement.y,originalBounds.yMax+movement.y,ys);}delta=new Vector2(movement.x/Screen.width,-movement.y/Screen.height);}Push("move");e.Use();}
  else if(e.type==EventType.MouseUp&&dragId!=null){End();ReleaseDragControl();e.Use();}
 }
 public void Dispose(){graph.Dispose();foreach(var item in items.Values)item.Dispose();items.Clear();}
}
