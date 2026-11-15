using System;
using UnityEngine;

// Compose nine-sliced sprites before drawing. One GUI quad avoids gaps between
// separately rasterized slices at fractional viewport positions and DPI scales.
public static class CreatorDialoguePanel {
 public static int[] Map(int length,int source,int first,int last,float scale) {
  int a=Mathf.Min(Mathf.RoundToInt(first*scale),length/2),b=Mathf.Min(Mathf.RoundToInt(last*scale),length/2);
  var map=new int[length];
  for(int i=0;i<length;i++)map[i]=Mathf.Clamp(i<a&&a>0?i*first/a:i>=length-b&&b>0?source-last+(i-(length-b))*last/b:first+(i-a)*(source-first-last)/Mathf.Max(1,length-a-b),0,source-1);
  return map;
 }
 public static Texture2D Compose(Texture2D background,Texture2D frame,int width,int height,float scale) {
  if(width<1||height<1||width>4096||height>4096||background.width!=frame.width||background.height!=frame.height)throw new ArgumentException("Invalid dialogue panel dimensions");
  int sw=background.width,sh=background.height;var xs=Map(width,sw,40,40,scale);var ys=Map(height,sh,40,40,scale);
  var bg=background.GetPixels32();var fg=frame.GetPixels32();var pixels=new Color32[width*height];
  for(int y=0;y<height;y++)for(int x=0;x<width;x++){
   int src=ys[y]*sw+xs[x];Color a=bg[src],b=fg[src];float alpha=b.a+a.a*(1-b.a);
   pixels[y*width+x]=alpha>0?new Color((b.r*b.a+a.r*a.a*(1-b.a))/alpha,(b.g*b.a+a.g*a.a*(1-b.a))/alpha,(b.b*b.a+a.b*a.a*(1-b.a))/alpha,alpha):Color.clear;
  }
  var texture=new Texture2D(width,height,TextureFormat.RGBA32,false){wrapMode=TextureWrapMode.Clamp,filterMode=FilterMode.Bilinear};texture.SetPixels32(pixels);texture.Apply(false);return texture;
 }
}
