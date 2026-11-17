using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.Rendering;

[Serializable] public class CreatorEffectParameters {public float tone,bloom,threshold,radius,softness,darkness,edgeProtection,lineJitter,bandStrength,bandWidth,rollSpeed,chromaOffset,signalNoise;}
[Serializable] public class CreatorEffectLayer {public int effectVersion;public string effectType;public CreatorEffectParameters parameters;public float weight,strength;public int seed;public CreatorCompositionLayout layout;}
[Serializable] public class CreatorEffectTarget {public string target;public CreatorEffectLayer[] layers;}
[Serializable] public class CreatorEffectState {public bool enabled,serial;public float time;public CreatorEffectTarget[] targets;}

// Independent creative compositor, not the game's original post-processing.
// Native material replay against black/white recovers coverage without replacing
// original cutout/eye/transparent material programs. Must be visually validated.
public sealed class CreatorPostEffects:IDisposable {
 readonly Material material;CreatorEffectState state;readonly List<RenderTexture> temporaries=new List<RenderTexture>();
 public bool Enabled=>state!=null&&state.enabled;
 public CreatorPostEffects(Shader shader){if(!shader)throw new Exception("Story effects shader missing");material=new Material(shader);}
 public void Set(CreatorEffectState s){
  if(s!=null){if(float.IsNaN(s.time)||float.IsInfinity(s.time)||s.time<0||s.time>3600||s.targets==null||s.targets.Length>5)throw new Exception("Invalid story effects");var ids=new HashSet<string>();foreach(var t in s.targets){if(t==null||!new[]{"background","actors","media","dialogue","transition"}.Contains(t.target)||!ids.Add(t.target)||t.layers==null||t.layers.Length>32)throw new Exception("Invalid effect target");ValidateLayers(t.layers);}}state=s;
 }
 RenderTexture Make(int w,int h,int depth=0,int samples=1){var r=RenderTexture.GetTemporary(w,h,depth,RenderTextureFormat.ARGBHalf,RenderTextureReadWrite.Linear,samples);r.filterMode=FilterMode.Bilinear;r.wrapMode=TextureWrapMode.Clamp;temporaries.Add(r);return r;}
 public void Clear(){foreach(var r in temporaries)RenderTexture.ReleaseTemporary(r);temporaries.Clear();}
 CreatorEffectLayer[] Layers(string target)=>state?.targets?.FirstOrDefault(t=>t.target==target)?.layers??Array.Empty<CreatorEffectLayer>();
 static bool Range(float v,float min,float max)=>!float.IsNaN(v)&&!float.IsInfinity(v)&&v>=min&&v<=max;
 public static void ValidateLayers(CreatorEffectLayer[] layers){if(layers==null)return;if(layers.Length>32)throw new Exception("Too many composition effects");foreach(var l in layers){
  if(l==null||l.effectVersion!=2||l.parameters==null||!Range(l.weight,0,1)||!Range(l.strength,0,1)||l.seed<0||l.seed>999999)throw new Exception("Dedicated effect v2 required");CreatorCompositionLayout.Validate(l.layout);var p=l.parameters;bool valid=false;
  switch(l.effectType){
   case "memory":valid=Range(p.tone,0,1)&&Range(p.bloom,0,1)&&Range(p.threshold,0,2)&&Range(p.radius,0,3);break;
   case "thought":valid=Range(p.radius,0,1)&&Range(p.softness,.01f,1)&&Range(p.darkness,0,1);break;
   case "television":valid=Range(p.lineJitter,0,1)&&Range(p.bandStrength,0,1)&&Range(p.bandWidth,.02f,.5f)&&Range(p.rollSpeed,0,2)&&Range(p.chromaOffset,0,1)&&Range(p.signalNoise,0,1);break;
   case "soft":valid=Range(p.radius,0,3)&&Range(p.edgeProtection,0,1);break;
  }if(!valid)throw new Exception("Unknown dedicated effect or invalid algorithm parameters");
 }}
 public RenderTexture Blank(int w,int h){var r=Make(w,h);var old=RenderTexture.active;try{RenderTexture.active=r;GL.Clear(false,true,Color.black);}finally{RenderTexture.active=old;}return r;}
 public RenderTexture Copy(Texture t,int w,int h){var r=Make(w,h);Graphics.Blit(t,r);return r;}
 public void Composite(RenderTexture output,Texture source){if(source)Graphics.Blit(source,output,material,1);}
 public Texture TransformLayer(Texture source,CreatorCompositionLayout p,int w,int h){
  if(p==null)return source;CreatorCompositionLayout.Validate(p);
  if(p.x==0&&p.y==0&&p.scale==1&&p.width==1&&p.height==1&&p.opacity==1)return source;
  SetLayout(p);var result=Make(w,h);Graphics.Blit(source,result,material,8);return result;
 }
 void SetLayout(CreatorCompositionLayout p){p=p??new CreatorCompositionLayout();material.SetVector("_Layout",new Vector4(p.x,p.y,p.scale*p.width,p.scale*p.height));material.SetFloat("_LayoutOpacity",p.opacity);}
 public Texture Transition(Texture left,Texture right,string kind,float progress,int w,int h){var result=Make(w,h);material.SetTexture("_Right",right);material.SetFloat("_Progress",progress);material.SetFloat("_TransitionKind",kind=="black"?1:kind=="wipe"?2:0);Graphics.Blit(left,result,material,4);return result;}
 public Texture Apply(Texture clean,string target,int w,int h)=>ApplyLayers(clean,Layers(target),w,h,state?.serial==true);
 public Texture ApplyLayers(Texture clean,CreatorEffectLayer[] layers,int w,int h,bool serial=true){
  ValidateLayers(layers);Texture lower=clean;
  foreach(var l in layers??Array.Empty<CreatorEffectLayer>()){
   if(l.weight<=0||l.strength<=0)continue;
   var next=Make(w,h);material.SetTexture("_Clean",serial?lower:clean);material.SetTexture("_Lower",lower);material.SetFloat("_Weight",l.weight);material.SetFloat("_Strength",l.strength);material.SetFloat("_Seed",l.seed);material.SetFloat("_StoryTime",state?.time??0);
   SetLayout(l.layout);var p=l.parameters;int pass;
   switch(l.effectType){
    case "memory":pass=0;material.SetVector("_EffectParams",new Vector4(p.tone,p.bloom,p.threshold,p.radius));break;
    case "thought":pass=7;material.SetVector("_EffectParams",new Vector4(p.radius,p.softness,p.darkness,0));break;
    case "television":pass=5;material.SetVector("_EffectParams",new Vector4(p.lineJitter,p.bandStrength,p.bandWidth,p.rollSpeed));material.SetVector("_EffectParams2",new Vector4(p.chromaOffset,p.signalNoise,0,0));break;
    case "soft":pass=6;material.SetVector("_EffectParams",new Vector4(p.radius,p.edgeProtection,0,0));break;
    default:throw new Exception("Unknown effect algorithm");
   }
   bool previous=GL.sRGBWrite;try{GL.sRGBWrite=false;Graphics.Blit(serial?lower:clean,next,material,pass);}finally{GL.sRGBWrite=previous;}lower=next;
  }return lower;
 }
 public void Overlay(RenderTexture output,Texture source,string target){if(!source)return;var processed=Apply(source,target,output.width,output.height);Graphics.Blit(processed,output,material,1);}
 struct Draw {public Renderer renderer;public Material material;public int submesh,pass,queue;public float distance;}
 static int Pass(Material m,string mode){var tag=new ShaderTagId("LightMode");for(int p=0;p<m.passCount;p++)if(m.shader.FindPassTagValue(p,tag).name==mode)return p;return -1;}
 static List<Draw> Draws(Camera camera,Renderer[] actors){var list=new List<Draw>();foreach(var r in actors){if(!r||!r.enabled||r.forceRenderingOff||!r.gameObject.activeInHierarchy)continue;var mats=r.sharedMaterials;for(int i=0;i<mats.Length;i++){var m=mats[i];if(!m)continue;int pass=Pass(m,"VLActor");if(pass<0)pass=Pass(m,"UniversalForward");if(pass<0)pass=Pass(m,"SRPDefaultUnlit");if(pass<0)pass=0;list.Add(new Draw{renderer=r,material=m,submesh=i,pass=pass,queue=m.renderQueue,distance=Vector3.Distance(camera.transform.position,r.bounds.center)});if(r.gameObject.layer==30&&m.renderQueue<=2500){pass=Pass(m,"UniversalForwardOutline");if(pass>=0)list.Add(new Draw{renderer=r,material=m,submesh=i,pass=pass,queue=2500,distance=0});}}}return list.OrderBy(d=>d.queue).ThenBy(d=>d.queue>2500?-d.distance:d.distance).ToList();}
 RenderTexture Coverage(Camera camera,RenderTexture full,List<Draw> draws,Color clear){var target=Make(full.width,full.height,0,full.antiAliasing);var cmd=new CommandBuffer{name="Story actor coverage"};try{cmd.SetRenderTarget(new RenderTargetIdentifier(target),new RenderTargetIdentifier(full));cmd.ClearRenderTarget(false,true,clear);cmd.SetViewProjectionMatrices(camera.worldToCameraMatrix,GL.GetGPUProjectionMatrix(camera.projectionMatrix,true));foreach(var d in draws)cmd.DrawRenderer(d.renderer,d.material,d.submesh,d.pass);Graphics.ExecuteCommandBuffer(cmd);}finally{cmd.Release();}return target;}
 public RenderTexture World(Camera camera,int w,int h,Renderer[] actors,Action fit,int scale=1){
  if(scale!=1&&scale!=2)throw new Exception("Invalid world supersampling");
  var previous=RenderTexture.active;
  try{var world=WorldInner(camera,w*scale,h*scale,actors,fit);return scale==1?world:Copy(world,w,h);}
  finally{RenderTexture.active=previous;}
 }
 RenderTexture WorldInner(Camera camera,int w,int h,Renderer[] actors,Action fit){
  var pipeline=GraphicsSettings.currentRenderPipeline as UnityEngine.Rendering.Universal.UniversalRenderPipelineAsset;
  int samples=camera.allowMSAA&&pipeline?pipeline.msaaSampleCount:1;
  var old=camera.targetTexture;var previous=RenderTexture.active;var full=Make(w,h,24,samples);var actorFlags=actors.Where(r=>r).Select(r=>(r,r.shadowCastingMode)).ToArray();
  try{camera.targetTexture=full;fit();using(CreatorExportProfiler.Measure("worldRenderMs"))camera.Render();if(Layers("background").Length==0&&Layers("actors").Length==0)return full;
   // Take the coverage while native camera globals and original depth are current.
   var draws=Draws(camera,actors);RenderTexture black,white;using(CreatorExportProfiler.Measure("coverageMs")){using(CreatorExportProfiler.Measure("coverageRenderMs"))black=Coverage(camera,full,draws,Color.black);using(CreatorExportProfiler.Measure("coverageRenderMs"))white=Coverage(camera,full,draws,Color.white);}
   var background=Make(w,h,24,samples);foreach(var flag in actorFlags)flag.r.shadowCastingMode=ShadowCastingMode.ShadowsOnly;
   camera.targetTexture=background;fit();using(CreatorExportProfiler.Measure("backgroundRenderMs"))camera.Render();foreach(var flag in actorFlags)flag.r.shadowCastingMode=flag.shadowCastingMode;
   var foreground=Make(w,h);material.SetTexture("_Background",background);material.SetTexture("_Black",black);material.SetTexture("_White",white);Graphics.Blit(full,foreground,material,2);
   Texture processedBg,processedActor;using(CreatorExportProfiler.Measure("worldFilterMs")){processedBg=Apply(background,"background",w,h);processedActor=Apply(foreground,"actors",w,h);}var output=Make(w,h);material.SetTexture("_Clean",background);material.SetTexture("_Background",processedBg);material.SetTexture("_Actors",processedActor);material.SetTexture("_Black",black);material.SetTexture("_White",white);Graphics.Blit(full,output,material,3);return output;
  }finally{foreach(var flag in actorFlags)if(flag.r)flag.r.shadowCastingMode=flag.shadowCastingMode;camera.targetTexture=old;fit();RenderTexture.active=previous;}
 }
 public void Dispose(){Clear();UnityEngine.Object.Destroy(material);}
}
