using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

[Serializable] public sealed class CreatorCompositionNode {
 public CreatorCompositionLayout layout,leftLayout,rightLayout;
 public CreatorClipMask[] masks,leftMasks,rightMasks;
 public string png;
 public string kind,id,leftId,rightId,transition,speaker,text,style,color,colorEnd,nameTextColor;
 public float progress,x,y,scale=1,opacity=1;
 public CreatorEffectLayer[] effects,leftEffects,rightEffects;
 public CreatorUIDraw[] draws;
}
[Serializable] public sealed class CreatorCompositionState {
 public int version;public double time;public CreatorCompositionNode[] nodes;
 public static void Validate(CreatorCompositionState state,CreatorMediaDraw[] media,CreatorUIGraph ui) {
  if(state==null)return;
  if(state.version!=1||!Finite(state.time,0,3600)||state.nodes==null||state.nodes.Length>256)throw new Exception("Invalid composition");
  var ids=new HashSet<string>();var mediaIds=new HashSet<string>((media??Array.Empty<CreatorMediaDraw>()).Select(d=>d.id));int worlds=0;
  foreach(var n in state.nodes){
   if(n==null||string.IsNullOrEmpty(n.id)||n.id.Length>100||!ids.Add(n.id))throw new Exception("Invalid composition layer");
   CreatorPostEffects.ValidateLayers(n.effects);CreatorPostEffects.ValidateLayers(n.leftEffects);CreatorPostEffects.ValidateLayers(n.rightEffects);
   CreatorClipMask.Validate(n.masks);CreatorClipMask.Validate(n.leftMasks);CreatorClipMask.Validate(n.rightMasks);
   CreatorCompositionLayout.Validate(n.layout);CreatorCompositionLayout.Validate(n.leftLayout);CreatorCompositionLayout.Validate(n.rightLayout);
   switch(n.kind){
    case "world":if(++worlds>1)throw new Exception("Duplicate world output");break;
    case "media":if(!mediaIds.Contains(n.id))throw new Exception("Missing media layer");break;
    case "transition":if(!mediaIds.Contains(n.leftId??"")||!mediaIds.Contains(n.rightId??"")||n.leftId==n.rightId||!new[]{"dissolve","black","wipe"}.Contains(n.transition)||!Finite(n.progress,0,1))throw new Exception("Invalid clip transition");break;
    case "dialogue":if(n.text==null||n.text.Length>500||n.speaker==null||n.speaker.Length>100||!new[]{"box","subtitle","game"}.Contains(n.style)||!Finite(n.x,-2,2)||!Finite(n.y,-2,2)||!Finite(n.scale,.1f,5)||!Finite(n.opacity,0,1))throw new Exception("Invalid composition dialogue");break;
    case "ui":ui.Set(n.draws);break;
    case "codeUI":if(string.IsNullOrEmpty(n.png)||n.png.Length>1200000)throw new Exception("Invalid code UI image");break;
    case "effect":break;
    default:throw new Exception("Unknown composition layer");
   }
  }
 }
 static bool Finite(double v,double min,double max)=>v>=min&&v<=max;
}

[Serializable] public sealed class CreatorCompositionLayout {
 public float x,y,scale=1,width=1,height=1,opacity=1,rotation,cropLeft,cropRight,cropTop,cropBottom,originX,originY;
 public bool flipX,flipY;
 public Vector2 Point(Vector2 point,float aspect) {
  var pivot=new Vector2(.5f+originX,.5f+originY);
  Vector2 d=point-pivot;d.x*=width*scale*aspect*(flipX?-1:1);d.y*=height*scale*(flipY?-1:1);
  float a=rotation*Mathf.Deg2Rad,s=Mathf.Sin(a),c=Mathf.Cos(a);
  return pivot+new Vector2(x+(c*d.x-s*d.y)/aspect,y+s*d.x+c*d.y);
 }
 public static void Validate(CreatorCompositionLayout p){if(p==null)return;foreach(var v in new[]{p.x,p.y,p.scale,p.width,p.height,p.opacity,p.rotation,p.originX,p.originY,p.cropLeft,p.cropRight,p.cropTop,p.cropBottom})if(float.IsNaN(v)||float.IsInfinity(v))throw new Exception("Invalid composition transform");if(Mathf.Abs(p.x)>10||Mathf.Abs(p.y)>10||p.scale<.001f||p.scale>20||p.width<.001f||p.width>20||p.height<.001f||p.height>20||p.opacity<0||p.opacity>1||Mathf.Abs(p.rotation)>36000||Mathf.Abs(p.originX)>.5f||Mathf.Abs(p.originY)>.5f||Mathf.Min(p.cropLeft,p.cropRight,p.cropTop,p.cropBottom)<0||p.cropLeft+p.cropRight>=.999f||p.cropBottom+p.cropTop>=.999f)throw new Exception("Invalid composition transform");}
}
