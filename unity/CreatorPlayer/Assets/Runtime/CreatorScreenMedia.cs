using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEngine;
using UnityEngine.Video;

[Serializable] public class CreatorMediaDraw {public string id,file,kind;public float[] points,uv,color,pivot;public double time,fps;public int width,height;public long frameCount;}

public sealed class CreatorScreenMedia:IDisposable {
 static readonly bool TraceFrames=Environment.GetEnvironmentVariable("CREATOR_TEST_INSTANCE")=="1"&&Environment.GetEnvironmentVariable("CREATOR_MEDIA_TRACE")=="1";
 static void Trace(Item item,string phase){if(TraceFrames)Debug.Log($"ScreenMedia {phase} wanted={item.wanted} rendered={item.rendered} actual={item.video.frame} playing={item.video.isPlaying}");}
 [Serializable] public class EditEvent {public string id,phase;public float dx,dy,scale=1;}
 sealed class Item:IDisposable {
  public double fps;public string file,error;public Texture2D image;public VideoPlayer video;public RenderTexture target;public long rendered=-1,wanted=-1;public bool requested;
  public Texture Texture=>image?(Texture)image:target;
  public void Dispose(){if(video){video.Stop();UnityEngine.Object.Destroy(video.gameObject);}if(target){target.Release();UnityEngine.Object.Destroy(target);}if(image)UnityEngine.Object.Destroy(image);}
 }
 readonly string root;readonly Transform parent;readonly CreatorUIGraph graph;readonly Dictionary<string,Item> items=new Dictionary<string,Item>();
 CreatorMediaDraw[] draws=Array.Empty<CreatorMediaDraw>();public string Error{get;private set;}
 string selected,dragId;bool editable,snap,resizing;Vector2 down,pivot;Rect originalBounds;EditEvent edit;float dragScale=1;Vector2 delta;readonly Queue<EditEvent> events=new Queue<EditEvent>();
 public CreatorScreenMedia(Shader shader,string directory,Transform parent){root=string.IsNullOrEmpty(directory)?null:Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;this.parent=parent;graph=new CreatorUIGraph(shader,null,key=>items[key].Texture);}
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
    else{var go=new GameObject("Screen video "+d.id);go.transform.SetParent(parent,false);var video=go.AddComponent<VideoPlayer>();item.video=video;item.target=new RenderTexture(d.width,d.height,0,RenderTextureFormat.ARGB32,RenderTextureReadWrite.sRGB);item.target.wrapMode=TextureWrapMode.Clamp;item.target.filterMode=FilterMode.Bilinear;item.target.Create();video.playOnAwake=false;video.source=VideoSource.Url;video.url=new Uri(file).AbsoluteUri;video.audioOutputMode=VideoAudioOutputMode.None;video.renderMode=VideoRenderMode.RenderTexture;video.targetTexture=item.target;video.aspectRatio=VideoAspectRatio.NoScaling;video.skipOnDrop=false;video.waitForFirstFrame=true;video.isLooping=false;video.sendFrameReadyEvents=true;var captured=item;video.errorReceived+=(v,message)=>captured.error=message;video.frameReady+=(v,frame)=>{captured.rendered=frame;Trace(captured,"frame-ready");};video.seekCompleted+=v=>Trace(captured,"seek-complete");video.Prepare();}
   }
   if(item.video){item.fps=d.fps;long frame=Math.Max(0,Math.Min(d.frameCount-1,(long)Math.Floor(d.time*d.fps+0.0001)));if(item.wanted!=frame){item.wanted=frame;item.requested=false;}}
  }
  draws=value;
 }
 void ResetRequests(){foreach(var item in items.Values)if(item.video){Trace(item,"failed");item.video.Pause();item.requested=false;}}
 public IEnumerator Apply(CreatorMediaDraw[] value){
  try{Begin(value);}catch(Exception e){Error=e.Message;yield break;}
  float until=Time.realtimeSinceStartup+45;
  while(true){bool ready=true;foreach(var item in items.Values){if(item.error!=null){Error="视频解码失败："+item.error;ResetRequests();yield break;}if(!item.video)continue;var v=item.video;if(!v.isPrepared){ready=false;continue;}
    if(v.frameCount>0)item.wanted=Math.Min(item.wanted,(long)v.frameCount-1);
    if(item.rendered==item.wanted){v.Pause();continue;}
    ready=false;if(!item.requested){try{
     // Keep the decoder paused while seeking. Play/StepForward can deliver a later
     // frame on Windows, leaving an exact-frame waiter stuck after Pause().
     // Seek inside the frame, away from timestamp rounding at its leading edge.
     item.requested=true;v.Pause();Trace(item,"seek");v.time=(item.wanted+.5)/item.fps;
    }catch(Exception e){item.error=e.Message;}}
   }
   if(ready)break;if(Time.realtimeSinceStartup>until){ResetRequests();Error="视频帧读取超时，请重试播放；若仍失败，请检查视频解码日志";yield break;}yield return null;
  }
  // frameReady signals the decoded frame; wait until the texture upload has completed.
  if(items.Values.Any(i=>i.video))yield return new WaitForEndOfFrame();
  try{graph.Set(draws.Select(d=>new CreatorUIDraw{texture=d.id,points=d.points,uv=d.uv,color=d.color,linearInput=d.kind=="video"&&QualitySettings.activeColorSpace==ColorSpace.Linear}).ToArray());}catch(Exception e){Error=e.Message;}
 }
 public void Select(string id,bool canEdit,bool useSnap){selected=id;editable=canEdit;snap=useSnap;if(dragId!=null&&(dragId!=id||!editable))End();}
 public EditEvent TakeEvent(){if(events.Count>0)return events.Dequeue();var result=edit;edit=null;return result;}
 void Push(string phase){var value=new EditEvent{id=dragId,phase=phase,dx=delta.x,dy=delta.y,scale=dragScale};if(phase=="move")edit=value;else{if(edit!=null){events.Enqueue(edit);edit=null;}events.Enqueue(value);}}
 void End(){if(dragId==null)return;Push("end");dragId=null;GUIUtility.hotControl=0;}
 static CreatorUIDraw Draw(CreatorMediaDraw d)=>new CreatorUIDraw{texture=d.id,points=d.points,uv=d.uv,color=d.color,linearInput=d.kind=="video"&&QualitySettings.activeColorSpace==ColorSpace.Linear};
 public Texture RenderItem(string id,int w,int h){var d=draws.FirstOrDefault(x=>x.id==id);if(d==null)throw new Exception("Composition media not prepared: "+id);graph.Set(new[]{Draw(d)});return graph.Render(w,h);}
 public Texture Render(int w,int h){graph.Set(draws.Select(Draw).ToArray());return graph.Render(w,h);}
 public void Draw(){graph.Draw();}
 public void Composite(Texture2D image){if(Error!=null)throw new Exception(Error);graph.Composite(image);}
 static Rect Bounds(CreatorMediaDraw d){float x0=float.MaxValue,x1=float.MinValue,y0=float.MaxValue,y1=float.MinValue;for(int i=0;i<4;i++){float x=d.points[2*i]*Screen.width,y=(1-d.points[2*i+1])*Screen.height;x0=Math.Min(x0,x);x1=Math.Max(x1,x);y0=Math.Min(y0,y);y1=Math.Max(y1,y);}return Rect.MinMaxRect(x0,y0,x1,y1);}
 float Snap(float low,float high,IEnumerable<float> targets){float best=7,result=0;foreach(float point in targets)foreach(float edge in new[]{low,(low+high)*.5f,high})if(Mathf.Abs(point-edge)<best){result=point-edge;best=Mathf.Abs(result);}return result;}
 public void Handles(){
  var d=draws.FirstOrDefault(x=>x.id==selected);if(d==null||!editable)return;var e=Event.current;var bounds=Bounds(d);var handle=new Rect(bounds.xMax-6,bounds.yMax-6,12,12);int control=GUIUtility.GetControlID(FocusType.Passive);
  if(e.type==EventType.Repaint){var old=GUI.color;GUI.color=new Color(.35f,.8f,1,.9f);GUI.DrawTexture(new Rect(bounds.xMin,bounds.yMin,bounds.width,1),Texture2D.whiteTexture);GUI.DrawTexture(new Rect(bounds.xMin,bounds.yMax,bounds.width,1),Texture2D.whiteTexture);GUI.DrawTexture(new Rect(bounds.xMin,bounds.yMin,1,bounds.height),Texture2D.whiteTexture);GUI.DrawTexture(new Rect(bounds.xMax,bounds.yMin,1,bounds.height),Texture2D.whiteTexture);GUI.DrawTexture(handle,Texture2D.whiteTexture);GUI.color=old;}
  if(e.type==EventType.MouseDown&&e.button==0&&(handle.Contains(e.mousePosition)||bounds.Contains(e.mousePosition))){dragId=d.id;down=e.mousePosition;pivot=new Vector2(d.pivot[0]*Screen.width,(1-d.pivot[1])*Screen.height);originalBounds=bounds;resizing=handle.Contains(down);delta=Vector2.zero;dragScale=1;GUIUtility.hotControl=control;Push("begin");e.Use();}
  else if(e.type==EventType.MouseDrag&&dragId==d.id){if(resizing){var initial=down-pivot;dragScale=Mathf.Clamp(Vector2.Dot(e.mousePosition-pivot,initial)/Mathf.Max(1,initial.sqrMagnitude),.01f,100);}else{var movement=e.mousePosition-down;if(snap&&!e.alt){var xs=new List<float>{0,Screen.width*.5f,Screen.width};var ys=new List<float>{0,Screen.height*.5f,Screen.height};foreach(var other in draws.Where(x=>x.id!=dragId)){var b=Bounds(other);xs.AddRange(new[]{b.xMin,b.center.x,b.xMax});ys.AddRange(new[]{b.yMin,b.center.y,b.yMax});}movement.x+=Snap(originalBounds.xMin+movement.x,originalBounds.xMax+movement.x,xs);movement.y+=Snap(originalBounds.yMin+movement.y,originalBounds.yMax+movement.y,ys);}delta=new Vector2(movement.x/Screen.width,-movement.y/Screen.height);}Push("move");e.Use();}
  else if(e.type==EventType.MouseUp&&dragId!=null){End();e.Use();}
 }
 public void Dispose(){graph.Dispose();foreach(var item in items.Values)item.Dispose();items.Clear();}
}
