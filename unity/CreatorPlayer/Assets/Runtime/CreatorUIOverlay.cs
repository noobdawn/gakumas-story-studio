using System;
using UnityEngine;

[Serializable] public class CreatorUIRect { public float x,y,w,h; public float[] color; }
public static class CreatorUIOverlay {
 public static void Validate(CreatorUIRect[] rects) {
  if(rects==null)return;if(rects.Length>192)throw new Exception("Too many UI overlays");
  foreach(var r in rects) {if(r==null||r.color==null||r.color.Length!=4)throw new Exception("Invalid UI rectangle");foreach(var n in new[]{r.x,r.y,r.w,r.h,r.color[0],r.color[1],r.color[2],r.color[3]})if(float.IsNaN(n)||float.IsInfinity(n)||n<0||n>1.00001f)throw new Exception("Invalid UI coordinate");}
 }
 static Rect Pixels(CreatorUIRect r,int width,int height) {float l=Mathf.Floor(r.x*width),t=Mathf.Floor(r.y*height);return new Rect(l,t,Mathf.Ceil((r.x+r.w)*width)-l,Mathf.Ceil((r.y+r.h)*height)-t);}
 public static void Draw(CreatorUIRect[] rects) {
  if(rects==null)return;var old=GUI.color;foreach(var r in rects){GUI.color=new Color(r.color[0],r.color[1],r.color[2],r.color[3]);GUI.DrawTexture(Pixels(r,Screen.width,Screen.height),Texture2D.whiteTexture);}GUI.color=old;
 }
 public static void Composite(Texture2D image,CreatorUIRect[] rects) {
  if(rects==null||rects.Length==0)return;int w=image.width,h=image.height;var pixels=image.GetPixels32();
  foreach(var r in rects){var box=Pixels(r,w,h);Color color=new Color(r.color[0],r.color[1],r.color[2],r.color[3]);for(int y=Mathf.Max(0,(int)box.yMin);y<Mathf.Min(h,(int)box.yMax);y++)for(int x=Mathf.Max(0,(int)box.xMin);x<Mathf.Min(w,(int)box.xMax);x++){int i=(h-1-y)*w+x;pixels[i]=Color.Lerp(pixels[i],color,color.a);}}
  image.SetPixels32(pixels);image.Apply();
 }
}
