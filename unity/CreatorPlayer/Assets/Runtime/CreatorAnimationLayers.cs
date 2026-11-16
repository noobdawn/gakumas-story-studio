using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.Animations;
using UnityEngine.Playables;

[Serializable] public class CreatorMotionLayer {
 public string id, motionId, scope;
 public float time, weight;
 public bool additive;
}

// Each authored layer owns a playable: two simultaneous uses of one clip need independent clocks.
public sealed class CreatorAnimationLayers : IDisposable {
 readonly PlayableGraph graph;
 readonly AnimationLayerMixerPlayable mixer;
 readonly List<AnimationClipPlayable> nodes=new List<AnimationClipPlayable>();
 readonly List<AvatarMask> masks=new List<AvatarMask>();
 string signature;
 public CreatorAnimationLayers(PlayableGraph graph){this.graph=graph;mixer=AnimationLayerMixerPlayable.Create(graph,1);}
 static readonly string[] Scopes={"full","head","upperBody","lowerBody","leftArm","rightArm"};
 static bool Number(float x,float max)=>!float.IsNaN(x)&&!float.IsInfinity(x)&&x>=0&&x<=max;
 public static void Validate(CreatorMotionLayer[] layers){
  if(layers==null)return;
  if(layers.Length>32)throw new Exception("At most 32 simultaneous body layers are supported");
  var ids=new HashSet<string>();
  foreach(var x in layers)if(x==null||string.IsNullOrEmpty(x.id)||x.id.Length>200||!ids.Add(x.id)||string.IsNullOrEmpty(x.motionId)||x.motionId.Length>180||!Scopes.Contains(x.scope)||!Number(x.time,3600)||!Number(x.weight,1))throw new Exception("Invalid body layer");
 }
 static AvatarMask MakeMask(string scope){
  var mask=new AvatarMask();
  for(int i=0;i<(int)AvatarMaskBodyPart.LastBodyPart;i++)mask.SetHumanoidBodyPartActive((AvatarMaskBodyPart)i,false);
  Action<AvatarMaskBodyPart> on=p=>mask.SetHumanoidBodyPartActive(p,true);
  if(scope=="head"||scope=="upperBody")on(AvatarMaskBodyPart.Head);
  if(scope=="upperBody")on(AvatarMaskBodyPart.Body);
  if(scope=="upperBody"||scope=="leftArm"){on(AvatarMaskBodyPart.LeftArm);on(AvatarMaskBodyPart.LeftFingers);}
  if(scope=="upperBody"||scope=="rightArm"){on(AvatarMaskBodyPart.RightArm);on(AvatarMaskBodyPart.RightFingers);}
  if(scope=="lowerBody"){on(AvatarMaskBodyPart.Root);on(AvatarMaskBodyPart.LeftLeg);on(AvatarMaskBodyPart.RightLeg);}
  // Downloaded body clips use humanoid muscle bindings; generic face curves are handled separately.
  mask.transformCount=0;return mask;
 }
 // Release the previous base before callers reconnect its clips into a blend.
 public void DetachBase(){if(mixer.GetInput(0).IsValid())graph.Disconnect(mixer,0);}
 public void Evaluate(AnimationPlayableOutput output,Playable baseMotion,CreatorMotionLayer[] requested,Func<string,AnimationClip> resolve,Func<string,bool> nativeAdditive){
  requested=requested??Array.Empty<CreatorMotionLayer>();Validate(requested);
  string next=string.Join("|",requested.Select(x=>x.id+":"+x.motionId+":"+x.scope+":"+x.additive));
  if(signature!=next){
   // Resolve and validate all clips before modifying the graph.
   var clips=requested.Select(x=>{if(x.additive&&!nativeAdditive(x.motionId))throw new Exception("Motion has no native additive definition: "+x.motionId);return resolve(x.motionId);}).ToArray();
   for(int i=1;i<mixer.GetInputCount();i++)if(mixer.GetInput(i).IsValid())graph.Disconnect(mixer,i);
   foreach(var node in nodes)if(node.IsValid())graph.DestroyPlayable(node);
   foreach(var mask in masks)UnityEngine.Object.Destroy(mask);
   nodes.Clear();masks.Clear();mixer.SetInputCount(requested.Length+1);
   for(int i=0;i<requested.Length;i++){
    var node=AnimationClipPlayable.Create(graph,clips[i]);node.SetSpeed(0);node.SetApplyFootIK(false);node.SetApplyPlayableIK(false);
    graph.Connect(node,0,mixer,i+1);nodes.Add(node);mixer.SetLayerAdditive((uint)i+1,requested[i].additive);
    // Explicit full masks also reset a slot previously occupied by a partial mask.
    var mask=requested[i].scope=="full"?new AvatarMask():MakeMask(requested[i].scope);
    if(requested[i].scope=="full")for(int p=0;p<(int)AvatarMaskBodyPart.LastBodyPart;p++)mask.SetHumanoidBodyPartActive((AvatarMaskBodyPart)p,true);
    masks.Add(mask);mixer.SetLayerMaskFromAvatarMask((uint)i+1,mask);
   }
   signature=next;
  }
  DetachBase();
  graph.Connect(baseMotion,0,mixer,0);mixer.SetInputWeight(0,1);
  for(int i=0;i<requested.Length;i++){nodes[i].SetTime(requested[i].time);mixer.SetInputWeight(i+1,requested[i].weight);}
  output.SetSourcePlayable(mixer);graph.Evaluate(0);
 }
 public void Dispose(){foreach(var mask in masks)if(mask)UnityEngine.Object.Destroy(mask);masks.Clear();}
}
