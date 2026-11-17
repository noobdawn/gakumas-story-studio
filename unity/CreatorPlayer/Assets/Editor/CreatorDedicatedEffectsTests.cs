using System;
using System.IO;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using UnityEditor;
using UnityEngine;

// Artificial textures only. Batch Editor tests are NOT visible Player acceptance.
public static class CreatorDedicatedEffectsTests {
 static readonly List<string> checks=new List<string>();
 static void Check(bool ok,string name){if(!ok)throw new Exception(name);checks.Add(name);}
 static Color[] Pixels(Texture t){var old=RenderTexture.active;var image=new Texture2D(t.width,t.height,TextureFormat.RGBAFloat,false,true);try{RenderTexture.active=(RenderTexture)t;image.ReadPixels(new Rect(0,0,t.width,t.height),0,0);image.Apply();return image.GetPixels();}finally{RenderTexture.active=old;UnityEngine.Object.DestroyImmediate(image);}}
 static float Difference(Color[] a,Color[] b)=>a.Zip(b,(x,y)=>Mathf.Abs(x.r-y.r)+Mathf.Abs(x.g-y.g)+Mathf.Abs(x.b-y.b)+Mathf.Abs(x.a-y.a)).Average();
 static CreatorEffectLayer Layer(string type)=>new CreatorEffectLayer{effectVersion=2,effectType=type,weight=1,strength=1,seed=37,parameters=new CreatorEffectParameters{tone=.65f,bloom=.35f,threshold=.65f,radius=1.2f,edgeProtection=.25f,lineJitter=.3f,bandStrength=.45f,bandWidth=.12f,rollSpeed=.18f,chromaOffset=.4f,signalNoise=.06f}};
 public static void Run(){
  string report=Path.GetFullPath(Environment.GetEnvironmentVariable("GSS_CHECK_REPORT") ?? throw new Exception("Set GSS_CHECK_REPORT"));
  var shader=Shader.Find("Hidden/Creator/StoryEffects");Check(shader&&shader.isSupported,"shader supported");
  var texture=new Texture2D(96,64,TextureFormat.RGBAFloat,false,true);texture.filterMode=FilterMode.Bilinear;texture.wrapMode=TextureWrapMode.Clamp;
  var input=new Color[96*64];for(int y=0;y<64;y++)for(int x=0;x<96;x++)input[y*96+x]=new Color(x/95f,y/63f,(x/8%2==0)?.8f:.1f,x<12?0:x<24?.4f:1);texture.SetPixels(input);texture.Apply();
  var old=RenderTexture.active;bool oldSrgb=GL.sRGBWrite;
  using(var fx=new CreatorPostEffects(shader))try{
   Func<CreatorEffectLayer[],float,Color[]> sample=(layers,time)=>{fx.Clear();fx.Set(new CreatorEffectState{enabled=true,time=time,targets=Array.Empty<CreatorEffectTarget>()});return Pixels(fx.ApplyLayers(texture,layers,96,64));};
   var memory=Layer("memory");var tv=Layer("television");var soft=Layer("soft");
   var m=sample(new[]{memory},1.25f);var t=sample(new[]{tv},1.25f);var s=sample(new[]{soft},1.25f);
   Check(Difference(m,t)>.01f&&Difference(m,s)>.01f&&Difference(t,s)>.001f,"three distinct algorithm outputs");
   Check(Difference(t,sample(new[]{tv},1.25f))==0,"same story time exact repeat");sample(new[]{tv},18);Check(Difference(t,sample(new[]{tv},1.25f))==0,"seek back exact repeat");
   Check(Difference(t,sample(new[]{tv},1.5f))>.0001f,"TV temporal variation");
   Check(Difference(sample(new[]{memory,tv},2),sample(new[]{tv,memory},2))>.0001f,"effect chain order matters");
   Check(m.Where((v,i)=>Mathf.Abs(v.a-input[i].a)>.001f).Count()==0&&s.Where((v,i)=>Mathf.Abs(v.a-input[i].a)>.001f).Count()==0,"memory and soft preserve coverage");
   Check(t.All(v=>float.IsFinite(v.r)&&float.IsFinite(v.g)&&float.IsFinite(v.b)&&v.a>=0&&v.a<=1),"TV finite colors and valid coverage");
   Check(t.Where(v=>v.a==0).All(v=>v.r==0&&v.g==0&&v.b==0),"transparent output has zero RGB");
   tv.strength=0;Check(ReferenceEquals(texture,fx.ApplyLayers(texture,new[]{tv},96,64)),"zero strength exact bypass");tv.strength=1;
   foreach(var change in new Action<CreatorEffectLayer>[] {l=>l.effectType="bad",l=>l.effectVersion=1,l=>l.parameters.bandWidth=0,l=>l.parameters.signalNoise=float.NaN}){var bad=Layer("television");change(bad);bool rejected=false;try{CreatorPostEffects.ValidateLayers(new[]{bad});}catch{rejected=true;}Check(rejected,"invalid wire layer rejected "+checks.Count);}
   texture.SetPixels(Enumerable.Repeat(new Color(.25f,.25f,.25f,.4f),input.Length).ToArray());texture.Apply();soft.parameters.edgeProtection=0;
   var uniform=sample(new[]{soft},2);Check(uniform.All(v=>Mathf.Abs(v.r-.25f)<.001f&&Mathf.Abs(v.a-.4f)<.001f),"linear light and fractional alpha preserved");
   // Product semantics: recall is grayscale even when bloom is enabled.
   texture.SetPixels(input);texture.Apply();memory.parameters.tone=1;
   foreach(float bloom in new[]{0f,.5f}){memory.parameters.bloom=bloom;var gray=sample(new[]{memory},2);Check(gray.All(v=>Mathf.Abs(v.r-v.g)<.001f&&Mathf.Abs(v.g-v.b)<.001f),"memory grayscale with bloom "+bloom);}
   texture.SetPixels(Enumerable.Repeat(new Color(.25f,.5f,.75f,.4f),input.Length).ToArray());texture.Apply();
   var thought=Layer("thought");thought.parameters.radius=.35f;thought.parameters.softness=.55f;thought.parameters.darkness=.65f;
   var vignette=sample(new[]{thought},2);int center=32*96+48,edge=32*96+95,shoulder=32*96+72;
   Check(Mathf.Abs(vignette[center].r-.25f)<.001f&&Mathf.Abs(vignette[center].b-.75f)<.001f,"thought keeps center unchanged");
   Check(vignette[edge].r<.1f&&vignette[shoulder].r>vignette[edge].r&&vignette[shoulder].r<vignette[center].r,"thought dark edges with smooth shoulder");
   Check(vignette.All(v=>Mathf.Abs(v.a-.4f)<.001f&&Mathf.Abs(v.b-3*v.r)<.002f),"thought preserves alpha and hue");
   thought.parameters.softness=1;Check(sample(new[]{thought},2)[shoulder].r>vignette[shoulder].r,"thought softness widens falloff");thought.parameters.softness=.55f;
   thought.parameters.radius=.7f;Check(Mathf.Abs(sample(new[]{thought},2)[shoulder].r-.25f)<.001f,"thought radius expands clear center");thought.parameters.radius=.35f;
   thought.strength=0;Check(ReferenceEquals(texture,fx.ApplyLayers(texture,new[]{thought},96,64)),"thought zero strength exact bypass");thought.strength=1;
   thought.parameters.darkness=0;Check(sample(new[]{thought},2).All(v=>Mathf.Abs(v.r-.25f)<.001f),"thought zero darkness unchanged");thought.parameters.darkness=.65f;
   var combined=sample(new[]{memory,thought},2);Check(combined.All(v=>Mathf.Abs(v.r-v.g)<.001f&&Mathf.Abs(v.g-v.b)<.001f)&&combined[edge].r<combined[center].r,"recall and thought stack");
   foreach(var change in new Action<CreatorEffectLayer>[] {l=>l.parameters.softness=0,l=>l.parameters.darkness=2,l=>l.parameters.radius=float.NaN}){var bad=Layer("thought");bad.parameters.radius=.35f;bad.parameters.softness=.55f;bad.parameters.darkness=.65f;change(bad);bool rejected=false;try{CreatorPostEffects.ValidateLayers(new[]{bad});}catch{rejected=true;}Check(rejected,"invalid thought parameters rejected "+checks.Count);}
   // Full-canvas transforms and localized effect mixing use real GPU pixels.
   texture.SetPixels(Enumerable.Repeat(new Color(1,0,0,.4f),input.Length).ToArray());texture.Apply();
   var placed=Pixels(fx.TransformLayer(texture,new CreatorCompositionLayout{x=.25f,width=.5f,height=.5f,opacity=.5f},96,64));
   Check(placed[32*96+72].r>.99f&&Mathf.Abs(placed[32*96+72].a-.2f)<.001f,"composition scale position and fractional opacity");
   Check(placed[32*96+12].a==0&&placed[5*96+72].a==0,"composition transparent outside resized bounds");
   memory.parameters.tone=1;memory.parameters.bloom=0;memory.layout=new CreatorCompositionLayout{x=.25f,width=.5f,opacity=.5f};
   var regional=sample(new[]{memory},2);Check(regional[32*96+12].r>.99f&&regional[32*96+12].g<.001f,"effect region preserves outside");
   Check(regional[32*96+72].r<.9f&&regional[32*96+72].g>.01f&&Mathf.Abs(regional[32*96+72].a-.4f)<.001f,"effect region opacity blends inside");memory.layout=null;
   // Category actor effects must composite the displaced mask, not the old mask.
   var composite=new Material(shader);var tiny=new List<Texture2D>();Func<Color,Texture2D> solid=color=>{var tx=new Texture2D(1,1,TextureFormat.RGBAFloat,false,true);tx.SetPixel(0,0,color);tx.Apply();tiny.Add(tx);return tx;};var result=new RenderTexture(4,4,0,RenderTextureFormat.ARGBHalf,RenderTextureReadWrite.Linear);result.Create();
   try{composite.SetTexture("_Clean",solid(new Color(0,.25f,0,1)));composite.SetTexture("_Background",solid(new Color(0,.25f,0,1)));composite.SetTexture("_Black",solid(Color.black));composite.SetTexture("_White",solid(new Color(.5f,.5f,.5f,1)));composite.SetTexture("_Actors",solid(new Color(1,0,0,0)));GL.sRGBWrite=false;Graphics.Blit(solid(new Color(.5f,.125f,0,1)),result,composite,3);Check(Pixels(result).All(v=>Mathf.Abs(v.r)<.001f&&Mathf.Abs(v.g-.25f)<.001f),"actor category composites displaced alpha");}
   finally{foreach(var tx in tiny)UnityEngine.Object.DestroyImmediate(tx);UnityEngine.Object.DestroyImmediate(composite);result.Release();UnityEngine.Object.DestroyImmediate(result);}
   // Exercise the actual RenderStory wrapper, including a throw after Blank/Blit.
   var go=new GameObject("RenderStory isolated test");var player=go.AddComponent<CreatorPrototypePlayer>();var flags=BindingFlags.NonPublic|BindingFlags.Instance;var type=typeof(CreatorPrototypePlayer);
   type.GetField("body",flags).SetValue(player,go);player.enabled=false;type.GetField("storyEffects",flags).SetValue(player,fx);var render=type.GetMethod("RenderStory",flags);var target=new RenderTexture(8,8,0);target.Create();
   try{
    var red=new Texture2D(4,4,TextureFormat.RGBA32,false);var blue=new Texture2D(4,4,TextureFormat.RGBA32,false);
    red.SetPixels(Enumerable.Repeat(Color.red,16).ToArray());red.Apply();blue.SetPixels(Enumerable.Repeat(Color.blue,16).ToArray());blue.Apply();
    try{var redNode=new CreatorCompositionNode{kind="codeUI",id="red",png=Convert.ToBase64String(red.EncodeToPNG())};var blueNode=new CreatorCompositionNode{kind="codeUI",id="blue",png=Convert.ToBase64String(blue.EncodeToPNG()),layout=new CreatorCompositionLayout{width=.5f,height=.5f,opacity=.5f}};
     var cs=new CreatorCompositionState{version=1,time=0,nodes=new[]{redNode,blueNode}};type.GetMethod("SetCodeImages",flags).Invoke(player,new object[]{cs});type.GetField("composition",flags).SetValue(player,cs);
     var pix=Pixels((Texture)render.Invoke(player,new object[]{96,64}));Check(Mathf.Abs(pix[32*96+48].r-.5f)<.002f&&Mathf.Abs(pix[32*96+48].b-.5f)<.002f&&pix[0].r>.99f,"code UI ordered alpha composite and resize");
     cs.nodes=new[]{blueNode,redNode};pix=Pixels((Texture)render.Invoke(player,new object[]{96,64}));Check(pix[32*96+48].r>.99f&&pix[32*96+48].b<.001f,"code UI reverse order occlusion");
     type.GetMethod("SetCodeImages",flags).Invoke(player,new object[]{null});
    }finally{UnityEngine.Object.DestroyImmediate(red);UnityEngine.Object.DestroyImmediate(blue);}
    foreach(bool bound in new[]{false,true})foreach(bool srgb in new[]{false,true})foreach(int mode in new[]{0,1,2}){
    var nodes=mode==0?Array.Empty<CreatorCompositionNode>():mode==1?new[]{new CreatorCompositionNode{kind="effect",effects=new[]{memory}}}:new CreatorCompositionNode[]{new CreatorCompositionNode{kind="effect",effects=new[]{memory}},null};
    type.GetField("composition",flags).SetValue(player,new CreatorCompositionState{version=1,time=2,nodes=nodes});RenderTexture.active=bound?target:null;GL.sRGBWrite=srgb;bool threw=false;
    try{render.Invoke(player,new object[]{8,8});}catch(TargetInvocationException){threw=true;}
    Check(threw==(mode==2)&&RenderTexture.active==(bound?target:null)&&GL.sRGBWrite==srgb,"RenderStory target restore "+bound+" "+srgb+" "+mode);
   }}finally{type.GetField("storyEffects",flags).SetValue(player,null);UnityEngine.Object.DestroyImmediate(go);target.Release();UnityEngine.Object.DestroyImmediate(target);}
   Check(!ShaderUtil.GetShaderMessages(shader).Any(x=>x.severity.ToString()=="Error"),"no shader compiler errors");
   File.WriteAllText(report,"{\"checks\":["+string.Join(",",checks.Select(x=>"\""+x+"\""))+"],\"visiblePreviewAccepted\":false}");
  }finally{RenderTexture.active=old;GL.sRGBWrite=oldSrgb;UnityEngine.Object.DestroyImmediate(texture);}
 }
}
