using System;
using System.IO;
using UnityEngine;

// Artificial sRGB textures exercise the real dialogue compositor, with no game assets.
public static class CreatorDialogueColorTests {
 public static void Run(){
  var active=RenderTexture.active;var srgb=GL.sRGBWrite;
  var panel=new Texture2D(8,8,TextureFormat.RGBA32,false);
  var name=new Texture2D(8,8,TextureFormat.RGBA32,false);
  var read=new Texture2D(640,360,TextureFormat.RGBA32,false,true);int checks=0;
  Action<Texture2D,Color32> fill=(t,c)=>{var pixels=new Color32[64];for(int i=0;i<pixels.Length;i++)pixels[i]=c;t.SetPixels32(pixels);t.Apply();};
  Action<Color32,Color32,string> check=(actual,expected,label)=>{if(Math.Abs(actual.r-expected.r)>2||Math.Abs(actual.g-expected.g)>2||Math.Abs(actual.b-expected.b)>2||actual.a<253)throw new Exception("Dialogue color "+label+": "+actual+" expected "+expected);checks++;};
  try{using(var layer=new CreatorDialogueLayer(Shader.Find("Creator/UIGraph"))){
   fill(panel,new Color32(192,180,170,255));
   foreach(var color in new[]{new Color32(87,87,109,255),new Color32(38,180,235,255),new Color32(110,164,252,255)}){
    fill(name,color);var texture=(RenderTexture)layer.Render(640,360,"","test","game",panel,name);
    RenderTexture.active=texture;read.ReadPixels(new Rect(0,0,640,360),0,0);read.Apply();
    check(read.GetPixel(160,124),color,"name");check(read.GetPixel(400,40),new Color32(192,180,170,255),"panel");
   }
   var output=Environment.GetEnvironmentVariable("GSS_PLAYER_OUTPUT");if(!string.IsNullOrEmpty(output)){File.WriteAllText(Path.Combine(output,"dialogue-color-checks.json"),"{\"checks\":"+checks+",\"passed\":true,\"tolerance\":2}");File.WriteAllBytes(Path.Combine(output,"dialogue-color-check.png"),read.EncodeToPNG());}
  }}finally{RenderTexture.active=active;GL.sRGBWrite=srgb;UnityEngine.Object.DestroyImmediate(panel);UnityEngine.Object.DestroyImmediate(name);UnityEngine.Object.DestroyImmediate(read);}
 }
}
