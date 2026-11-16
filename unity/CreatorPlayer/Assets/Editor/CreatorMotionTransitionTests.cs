using System;
using System.Collections.Generic;
using System.Reflection;
using UnityEngine;
using UnityEngine.Animations;
using UnityEngine.Playables;

// Synthetic clips only. Real Humanoid body-height probes remain local research evidence.
public static class CreatorMotionTransitionTests {
 public static void Run() {
  var root=new GameObject("Motion transition regression");
  var animated=new GameObject("Animated");animated.transform.SetParent(root.transform,false);
  var animator=root.AddComponent<Animator>();
  var player=root.AddComponent<CreatorPrototypePlayer>();player.enabled=false;
  var graph=PlayableGraph.Create("Transition regression");graph.SetTimeUpdateMode(DirectorUpdateMode.Manual);
  var a=new AnimationClip();var b=new AnimationClip();
  a.SetCurve("Animated",typeof(Transform),"localPosition.y",AnimationCurve.Constant(0,2,1));
  b.SetCurve("Animated",typeof(Transform),"localPosition.y",AnimationCurve.Constant(0,2,2));
  var current=AnimationClipPlayable.Create(graph,a);var previous=AnimationClipPlayable.Create(graph,b);
  var mixer=AnimationMixerPlayable.Create(graph,2);var output=AnimationPlayableOutput.Create(graph,"Motion",animator);
  var layers=new CreatorAnimationLayers(graph);
  var flags=BindingFlags.Instance|BindingFlags.NonPublic;var type=typeof(CreatorPrototypePlayer);
  Action<string,object> set=(name,value)=>type.GetField(name,flags).SetValue(player,value);
  set("graph",graph);set("mainLayers",layers);set("clip",a);set("motion",current);set("mainMixer",mixer);set("mainOutput",output);
  ((Dictionary<string,AnimationClipPlayable>)type.GetField("mainMotions",flags).GetValue(player)).Add("previous",previous);
  set("mainBlendId","previous");set("mainBlendTime",.5f);set("mainBlendWeight",.5f);
  graph.Play();var sample=type.GetMethod("Sample",flags);
  try {
   for(int cycle=0;cycle<3;cycle++) {
    set("mainBlendActive",true);sample.Invoke(player,new object[]{.5f});
    if(!mixer.GetInput(0).IsValid()||!mixer.GetInput(1).IsValid())throw new Exception("Blend must connect both clips");
    set("mainBlendActive",false);sample.Invoke(player,new object[]{1f});
    if(mixer.GetInput(0).IsValid()||mixer.GetInput(1).IsValid())throw new Exception("Direct sampling retained inactive blend inputs");
    if(Mathf.Abs(animated.transform.localPosition.y-1)>.001f||root.transform.position!=Vector3.zero)throw new Exception("Direct pose depends on prior blend");
   }
   Debug.Log("Motion transition regression passed: three blend/direct cycles; inactive inputs released; direct pose and root stable.");
  } finally {set("mainLayers",null);set("graph",default(PlayableGraph));layers.Dispose();if(graph.IsValid())graph.Destroy();UnityEngine.Object.DestroyImmediate(root);UnityEngine.Object.DestroyImmediate(a);UnityEngine.Object.DestroyImmediate(b);}
 }
}
