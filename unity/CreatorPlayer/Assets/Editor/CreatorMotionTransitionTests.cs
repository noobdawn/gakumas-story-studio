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
    set("mainBlendActive",true);sample.Invoke(player,new object[]{.5f,Array.Empty<CreatorMotionLayer>()});
    if(!mixer.GetInput(0).IsValid()||!mixer.GetInput(1).IsValid())throw new Exception("Blend must connect both clips");
    set("mainBlendActive",false);sample.Invoke(player,new object[]{1f,Array.Empty<CreatorMotionLayer>()});
    if(mixer.GetInput(0).IsValid()||mixer.GetInput(1).IsValid())throw new Exception("Direct sampling retained inactive blend inputs");
    if(Mathf.Abs(animated.transform.localPosition.y-1)>.001f||root.transform.position!=Vector3.zero)throw new Exception("Direct pose depends on prior blend");
   }
   var clock=new ActorPhysicsPlayback();
   var solvers=new[]{root.AddComponent<ActorClothPhysics>()};
   float sampled=-1;int evaluations=0;
   void Hold(float time,float overlay){
    var state=new[]{new CreatorMotionLayer{id="gesture",motionId="test",scope="upperBody",time=overlay,weight=1}};
    clock.Apply(true,time,"pose",0,1,state,root.transform,solvers,(baseTime,inputs)=>{
     if(baseTime!=0)throw new Exception("Held base pose moved");sampled=inputs[0].time;evaluations++;
    });
    if(sampled!=overlay)throw new Exception("Physics did not sample the current overlay");
   }
   Hold(0,0);Hold(.025f,.025f);Hold(.1f,.1f);
   int count=evaluations;Hold(.1f,.1f);
   if(evaluations!=count)throw new Exception("Repeated state advanced physics");
   Hold(.1f,.8f);Hold(0,0);Hold(1,1);
   foreach(int rate in new[]{24,25,30,60}){
    for(int index=0;index<=3600*rate;index++){
     var grid=ActorPhysicsPlayback.Clock.FromFrame(index,rate);
     ActorPhysicsPlayback.Clock seconds=index/(double)rate;
     var legacy=ActorPhysicsPlayback.Clock.FromLegacyTime((float)grid.seconds);
     if(grid.tick!=index*60/rate || seconds.tick!=grid.tick || legacy.tick!=grid.tick)
      throw new Exception("Timeline frame drifted off the fixed physics grid");
    }
   }
   int samples=0;
   for(int index=1740;index<=1920;index++){
    clock.Apply(true,ActorPhysicsPlayback.Clock.FromFrame(index,30),"held",0,1,null,root.transform,solvers,(t,l)=>samples++);
    if(samples!=(index==1740?1:2))throw new Exception("30 fps hold should sample exactly two 60 Hz poses per frame");
    samples=0;
   }
   TestPlacement();
   TestForehead();
   Debug.Log("Motion transition regression passed: three blend/direct cycles; inactive inputs released; direct pose and root stable.");
  } finally {set("mainLayers",null);set("graph",default(PlayableGraph));layers.Dispose();if(graph.IsValid())graph.Destroy();UnityEngine.Object.DestroyImmediate(root);UnityEngine.Object.DestroyImmediate(a);UnityEngine.Object.DestroyImmediate(b);}
 }

 static void TestPlacement() {
  GameObject Build(string name,out ActorClothPhysics solver) {
   var root=new GameObject(name);
   var anchor=new GameObject("Anchor").transform;anchor.SetParent(root.transform,false);
   var bone=new GameObject("Skirt").transform;bone.SetParent(anchor,false);
   var tip=new GameObject("Tip").transform;tip.SetParent(bone,false);tip.localPosition=new Vector3(.12f,.01f,.025f);
   solver=root.AddComponent<ActorClothPhysics>();solver.simulateInLateUpdate=false;
   solver.Configure(root.transform,new ActorClothPhysics.Data {
    dynamic=new[]{new ActorClothPhysics.BoneData{name="Skirt",stiffness=.04f,damping=.12f},new ActorClothPhysics.BoneData{name="Tip"}},
    @static=Array.Empty<ActorClothPhysics.ColliderData>()});
   return root;
  }
  var reference=Build("Reference",out var refSolver);var placed=Build("Placed",out var movedSolver);
  try {
   var refClock=new ActorPhysicsPlayback();var movedClock=new ActorPhysicsPlayback();
   string origin="old";
   placed.transform.SetPositionAndRotation(new Vector3(-1.1f,.15f,.4f),Quaternion.Euler(0,40,0));
   void Advance(float t,string clip) {
    refClock.Apply(true,t,clip,t,4,null,reference.transform,new[]{refSolver},(x,l)=>{},"new");
    movedClock.Apply(true,t,clip,t,4,null,placed.transform,new[]{movedSolver},(x,l)=>{},origin);
   }
   for(int i=0;i<=9;i++)Advance(i/30f,"idle");
   placed.transform.SetPositionAndRotation(Vector3.zero,Quaternion.identity);origin="new";
   Advance(10/30f,"idle");
   if(Vector3.Distance(refSolver.GetTipPositions()[0],movedSolver.GetTipPositions()[0])>.00005f)throw new Exception("Discontinuous placement introduced cloth velocity");
   var before=placed.transform.InverseTransformPoint(movedSolver.GetTipPositions()[0]);
   placed.transform.SetPositionAndRotation(new Vector3(.1f,.7f,1),Quaternion.Euler(0,-22,0));
   Advance(10/30f,"idle");
   if(Vector3.Distance(before,placed.transform.InverseTransformPoint(movedSolver.GetTipPositions()[0]))>.00005f)throw new Exception("Paused reblocking reset the cloth pose");
   placed.transform.SetPositionAndRotation(Vector3.zero,Quaternion.identity);
   Advance(11/30f,"new pose");
   if(Vector3.Distance(refSolver.GetTipPositions()[0],movedSolver.GetTipPositions()[0])>.00005f)throw new Exception("Combined placement and pose cut lost chain history");
   placed.transform.position=new Vector3(1.1f,0,.23f);
   Advance(12/30f,"new pose");
   if(Vector3.Distance(refSolver.GetTipPositions()[0],placed.transform.InverseTransformPoint(movedSolver.GetTipPositions()[0]))>.00005f)throw new Exception("Large move on the same placement lost chain history");
   placed.transform.position+=new Vector3(.02f,0,0);
   Advance(13/30f,"new pose");
   if(Vector3.Distance(refSolver.GetTipPositions()[0],placed.transform.InverseTransformPoint(movedSolver.GetTipPositions()[0]))<.0002f)throw new Exception("Continuous root movement should retain cloth inertia");
  } finally {UnityEngine.Object.DestroyImmediate(placed);UnityEngine.Object.DestroyImmediate(reference);}
 }
 static void TestForehead() {
  var mesh=new Mesh();
  var skin=new Material(Shader.Find("Hidden/InternalErrorShader")){name="m_fce"};
  try {
   var points=new[]{new Vector3(-1,0,0),new Vector3(1,0,.1f),new Vector3(0,1,.2f)};
   mesh.vertices=points;mesh.triangles=new[]{0,1,2};mesh.RecalculateBounds();
   var surface=new ForeheadSurface(mesh,new[]{skin});
   var sample=new Vector3(0,.5f,0);
   if(!surface.TryDepth(sample,out var z) || Mathf.Abs(z-.125f)>.00001f || surface.TryDepth(new Vector3(.95f,.95f,0),out _))
    throw new Exception("Fringe contact did not use the actual face triangle");
   points[2].z+=.1f;surface.Update(points);
   if(!surface.TryDepth(sample,out z) || Mathf.Abs(z-.175f)>.00001f)throw new Exception("Fringe surface ignored facial deformation");
  } finally {UnityEngine.Object.DestroyImmediate(skin);UnityEngine.Object.DestroyImmediate(mesh);}
 }
}
