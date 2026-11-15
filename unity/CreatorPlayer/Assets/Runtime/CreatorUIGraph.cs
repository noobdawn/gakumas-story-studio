using System;
using System.Collections.Generic;
using System.IO;
using System.Text.RegularExpressions;
using UnityEngine;

[Serializable] public class CreatorUIMask {public string texture;public float[] map;}
[Serializable] public class CreatorUIDraw {public string texture;public float[] points,uv,color,vertexUV;public CreatorUIMask[] masks;public bool invert,linearInput,alphaOnly;}

public sealed class CreatorUIGraph:IDisposable {
 readonly int maxDraws;readonly Func<string,Texture> resolver;readonly Material material;readonly string root;readonly Dictionary<string,Texture2D> textures=new Dictionary<string,Texture2D>();
 CreatorUIDraw[] draws=Array.Empty<CreatorUIDraw>();RenderTexture premult,straight;bool dirty=true;
 public CreatorUIGraph(Shader shader,string directory,Func<string,Texture> externalResolver=null,int maxDraws=512){this.maxDraws=maxDraws;resolver=externalResolver;if(!shader)throw new Exception("UI graph shader missing");material=new Material(shader);root=string.IsNullOrEmpty(directory)?null:Path.GetFullPath(Path.Combine(directory,"textures"));}
 static void Values(float[] a,int count,float low,float high){if(a==null||a.Length!=count)throw new Exception("Invalid UI data");foreach(float v in a)if(float.IsNaN(v)||float.IsInfinity(v)||v<low||v>high)throw new Exception("Invalid UI value");}
 Texture Texture(string key){if(resolver!=null)return resolver(key);if(string.IsNullOrEmpty(key))return Texture2D.whiteTexture;if(!Regex.IsMatch(key,"^[0-9a-f]{64}$"))throw new Exception("Invalid UI texture ID");if(textures.TryGetValue(key,out var t))return t;if(root==null)throw new Exception("UI textures unavailable");var file=Path.Combine(root,key+".png");if(!File.Exists(file))throw new Exception("UI texture missing: "+key);if(new FileInfo(file).Length>8*1024*1024)throw new Exception("UI texture too large");t=new Texture2D(2,2,TextureFormat.RGBA32,false,true);if(!t.LoadImage(File.ReadAllBytes(file)))throw new Exception("UI texture decode failed");t.wrapMode=TextureWrapMode.Clamp;t.filterMode=FilterMode.Bilinear;textures.Add(key,t);return t;}
 public void Set(CreatorUIDraw[] value){value=value??Array.Empty<CreatorUIDraw>();if(value.Length>maxDraws)throw new Exception("Too many UI primitives");foreach(var d in value){if(d==null)throw new Exception("Invalid UI primitive");Values(d.points,8,-1000,1000);Values(d.uv,4,0,1);if(d.vertexUV!=null)Values(d.vertexUV,8,0,1);Values(d.color,4,0,1);Texture(d.texture);if(d.masks!=null){if(d.masks.Length>2)throw new Exception("Too many UI masks");foreach(var m in d.masks){if(m==null)throw new Exception("Invalid UI mask");Values(m.map,6,-1e12f,1e12f);Texture(m.texture);}}}draws=value;dirty=true;}
 // UI blending deliberately stays in display RGB, matching CPU export compositing.
 RenderTexture Make(int w,int h,bool srgb){var r=new RenderTexture(w,h,0,RenderTextureFormat.ARGB32,srgb?RenderTextureReadWrite.sRGB:RenderTextureReadWrite.Linear);r.wrapMode=TextureWrapMode.Clamp;r.filterMode=FilterMode.Bilinear;r.Create();return r;}
 public RenderTexture Render(int w,int h){
  if(!premult||premult.width!=w||premult.height!=h){Release();premult=Make(w,h,false);straight=Make(w,h,true);dirty=true;}if(!dirty)return straight;var old=RenderTexture.active;var oldSrgb=GL.sRGBWrite;
  try{GL.sRGBWrite=false;RenderTexture.active=premult;GL.Clear(false,true,Color.clear);GL.PushMatrix();try{GL.LoadOrtho();foreach(var d in draws){material.SetTexture("_MainTex",Texture(d.texture));material.SetFloat("_LinearInput",d.linearInput?1:0);material.SetFloat("_AlphaOnly",d.alphaOnly?1:0);material.SetVector("_Color",new Vector4(d.color[0],d.color[1],d.color[2],d.color[3]));int count=d.masks?.Length??0;material.SetFloat("_MaskCount",count);material.SetFloat("_Invert",d.invert?1:0);
    for(int i=0;i<count;i++){var m=d.masks[i];string prefix="_Mask"+(i+1);material.SetTexture(prefix,Texture(m.texture));material.SetVector(prefix+"A",new Vector4(m.map[0],m.map[1],m.map[2],0));material.SetVector(prefix+"B",new Vector4(m.map[3],m.map[4],m.map[5],0));}
    material.SetPass(0);GL.Begin(GL.QUADS);for(int i=0;i<4;i++){GL.TexCoord2(d.vertexUV!=null?d.vertexUV[i*2]:i==0||i==3?d.uv[0]:d.uv[2],d.vertexUV!=null?d.vertexUV[i*2+1]:i<2?d.uv[1]:d.uv[3]);GL.Vertex3(d.points[i*2],d.points[i*2+1],0);}GL.End();}
   }finally{GL.PopMatrix();}Graphics.Blit(premult,straight,material,1);dirty=false;return straight;
  }finally{GL.sRGBWrite=oldSrgb;RenderTexture.active=old;}
 }
 public void Draw(){if(draws.Length>0&&Event.current.type==EventType.Repaint)GUI.DrawTexture(new Rect(0,0,Screen.width,Screen.height),Render(Screen.width,Screen.height),ScaleMode.StretchToFill,true);}
 Texture2D Read(int w,int h){var old=RenderTexture.active;try{RenderTexture.active=Render(w,h);var image=new Texture2D(w,h,TextureFormat.RGBA32,false);image.ReadPixels(new Rect(0,0,w,h),0,0);image.Apply();return image;}finally{RenderTexture.active=old;}}
 public void Capture(string file,int w,int h){var image=Read(w,h);try{File.WriteAllBytes(file,image.EncodeToPNG());}finally{UnityEngine.Object.Destroy(image);}}
 public void Composite(Texture2D image){if(draws.Length==0)return;var overlay=Read(image.width,image.height);try{var dest=image.GetPixels32();var source=overlay.GetPixels32();for(int i=0;i<dest.Length;i++){float a=source[i].a/255f;dest[i]=Color.Lerp(dest[i],source[i],a);}image.SetPixels32(dest);image.Apply();}finally{UnityEngine.Object.Destroy(overlay);}}
 void Release(){if(premult){premult.Release();UnityEngine.Object.Destroy(premult);}if(straight){straight.Release();UnityEngine.Object.Destroy(straight);}premult=straight=null;}
 public void Dispose(){Release();foreach(var t in textures.Values)UnityEngine.Object.Destroy(t);UnityEngine.Object.Destroy(material);}
}

