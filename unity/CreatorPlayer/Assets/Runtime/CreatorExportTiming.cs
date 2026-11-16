using System;
using System.Collections.Generic;
using UnityEngine;
using Stopwatch = System.Diagnostics.Stopwatch;

// Opt-in CPU wall-clock spans. Nested spans are inclusive, not additive GPU time.
[Serializable] public sealed class CreatorExportTiming {
 [Serializable] public sealed class Stage { public string name; public double ms; public int calls; }
 public string runId;
 public int frameIndex,unityFrame,screenWidth,screenHeight,previewCount,targetFrameRate,vSyncCount;
 public double queueMs,totalMs,previewMs;
 public long managedBytes;
 public int gc0;
 public List<Stage> stages=new List<Stage>();
 public void Add(string name,double ms){var s=stages.Find(x=>x.name==name);if(s==null){s=new Stage{name=name};stages.Add(s);}s.ms+=ms;s.calls++;}
 public void Count(string name){Add(name,0);}
 public void Snapshot(){unityFrame=Time.frameCount;screenWidth=Screen.width;screenHeight=Screen.height;previewCount=CreatorExportProfiler.PreviewCount;previewMs=CreatorExportProfiler.PreviewMs;managedBytes=GC.GetTotalMemory(false);gc0=GC.CollectionCount(0);targetFrameRate=Application.targetFrameRate;vSyncCount=QualitySettings.vSyncCount;}
}
public static class CreatorExportProfiler {
 public static CreatorExportTiming Current;
 public static bool PreviewEnabled;
 public static int PreviewCount;
 public static double PreviewMs;
 public static long Stamp()=>Stopwatch.GetTimestamp();
 public static double Elapsed(long start)=>(Stamp()-start)*1000.0/Stopwatch.Frequency;
 public static Scope Measure(string name)=>new Scope(Current,name);
 public readonly struct Scope:IDisposable {
  readonly CreatorExportTiming timing;readonly string name;readonly long start;
  public Scope(CreatorExportTiming timing,string name){this.timing=timing;this.name=name;start=timing==null?0:Stamp();}
  public void Dispose(){if(timing!=null)timing.Add(name,Elapsed(start));}
 }
}
