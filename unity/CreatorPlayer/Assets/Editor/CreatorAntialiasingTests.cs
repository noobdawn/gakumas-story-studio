using System;
using System.IO;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

// Batch-mode GPU checks against the same pipeline that is about to be packaged.
public static class CreatorAntialiasingTests {
 public static void Run(){
  var go=new GameObject("AA verification camera");var camera=go.AddComponent<Camera>();camera.enabled=false;camera.cullingMask=0;camera.clearFlags=CameraClearFlags.SolidColor;
  var active=RenderTexture.active;var settings=new CreatorRenderSettings();int checks=0;
  Action<bool,string> check=(ok,message)=>{if(!ok)throw new Exception("AA check: "+message);checks++;};
  try{using(var effects=new CreatorPostEffects(Shader.Find("Hidden/Creator/StoryEffects"))){
   var samples=new[]{1,1,1,2,4,8,4};
   for(int aa=0;aa<samples.Length;aa++){
    settings.antialiasing=aa;CreatorLinearRendering.ConfigureCamera(camera,settings);
    check(settings.MsaaSamples==samples[aa]&&camera.allowMSAA==(samples[aa]>1),"camera samples "+aa);
    check(camera.GetUniversalAdditionalCameraData().antialiasing==(aa==1?AntialiasingMode.FastApproximateAntialiasing:aa==2||aa==6?AntialiasingMode.SubpixelMorphologicalAntiAliasing:AntialiasingMode.None),"post AA "+aa);
    foreach(int scale in new[]{1,2}){
     bool sawWorld=false;
     var result=effects.World(camera,64,32,Array.Empty<Renderer>(),()=>{if(camera.targetTexture){sawWorld=true;check(camera.targetTexture.width==64*scale&&camera.targetTexture.height==32*scale&&camera.targetTexture.antiAliasing==samples[aa],"world target "+aa+" / "+scale);}},scale);
     check(sawWorld&&result.width==64&&result.height==32&&result.antiAliasing==(scale==1?samples[aa]:1),"resolved output "+aa+" / "+scale);
     check(camera.targetTexture==null&&RenderTexture.active==active,"capture state restored");effects.Clear();
    }
   }
   CreatorLinearRendering.ConfigureCamera(camera);check(!camera.allowMSAA&&((UniversalRenderPipelineAsset)GraphicsSettings.currentRenderPipeline).msaaSampleCount==1,"SMAA default restored");
  }}finally{UnityEngine.Object.DestroyImmediate(go);RenderTexture.active=active;}
  string report=Environment.GetEnvironmentVariable("GSS_CHECK_REPORT");
  if(!string.IsNullOrEmpty(report))File.WriteAllText(Path.ChangeExtension(report,"antialiasing.json"),"{\"checks\":"+checks+",\"ok\":true}");
  Debug.Log("Antialiasing GPU checks passed: "+checks);
 }
}
