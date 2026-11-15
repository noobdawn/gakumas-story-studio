using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

[Serializable] public sealed class CreatorCompositionNode {
 public string kind,id,leftId,rightId,transition,speaker,text,style,color,colorEnd;
 public float progress,x,y,scale=1,opacity=1;
 public CreatorEffectLayer[] effects,leftEffects,rightEffects;
 public CreatorUIDraw[] draws;
}
[Serializable] public sealed class CreatorCompositionState {
 public int version;public float time;public CreatorCompositionNode[] nodes;
 public static void Validate(CreatorCompositionState state,CreatorMediaDraw[] media,CreatorUIGraph ui) {
  if(state==null)return;
  if(state.version!=1||!Finite(state.time,0,3600)||state.nodes==null||state.nodes.Length>256)throw new Exception("Invalid composition");
  var ids=new HashSet<string>();var mediaIds=new HashSet<string>((media??Array.Empty<CreatorMediaDraw>()).Select(d=>d.id));int worlds=0;
  foreach(var n in state.nodes){
   if(n==null||string.IsNullOrEmpty(n.id)||n.id.Length>100||!ids.Add(n.id))throw new Exception("Invalid composition layer");
   CreatorPostEffects.ValidateLayers(n.effects);CreatorPostEffects.ValidateLayers(n.leftEffects);CreatorPostEffects.ValidateLayers(n.rightEffects);
   switch(n.kind){
    case "world":if(++worlds>1)throw new Exception("Duplicate world output");break;
    case "media":if(!mediaIds.Contains(n.id))throw new Exception("Missing media layer");break;
    case "transition":if(!mediaIds.Contains(n.leftId??"")||!mediaIds.Contains(n.rightId??"")||n.leftId==n.rightId||!new[]{"dissolve","black","wipe"}.Contains(n.transition)||!Finite(n.progress,0,1))throw new Exception("Invalid clip transition");break;
    case "dialogue":if(n.text==null||n.text.Length>500||n.speaker==null||n.speaker.Length>100||!new[]{"box","subtitle","game"}.Contains(n.style)||!Finite(n.x,-2,2)||!Finite(n.y,-2,2)||!Finite(n.scale,.1f,5)||!Finite(n.opacity,0,1))throw new Exception("Invalid composition dialogue");break;
    case "ui":ui.Set(n.draws);break;
    case "effect":break;
    default:throw new Exception("Unknown composition layer");
   }
  }
 }
 static bool Finite(float v,float min,float max)=>!float.IsNaN(v)&&!float.IsInfinity(v)&&v>=min&&v<=max;
}
