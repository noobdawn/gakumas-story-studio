using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using UnityEngine;
using UnityEngine.Rendering;

// Opt-in D3D11/NVENC proof of concept. No full-size pixels cross to the CPU.
// The native plugin owns its encoding pool and retains the source texture.
public sealed class CreatorGpuVideoExport : IDisposable {
 const string Plugin="GSSGpuExport";
 [DllImport(Plugin,CallingConvention=CallingConvention.Cdecl)] static extern int GssCreate(int width,int height,int fps,[MarshalAs(UnmanagedType.LPWStr)] string outputFile);
 [DllImport(Plugin,CallingConvention=CallingConvention.Cdecl)] static extern int GssSetTexture(IntPtr texture);
 [DllImport(Plugin,CallingConvention=CallingConvention.Cdecl)] static extern IntPtr GssGetRenderEventFunc();
 [DllImport(Plugin,CallingConvention=CallingConvention.Cdecl)] static extern int GssAccepted();
 [DllImport(Plugin,CallingConvention=CallingConvention.Cdecl)] static extern int GssCompleted();
 [DllImport(Plugin,CallingConvention=CallingConvention.Cdecl)] static extern IntPtr GssError();
 [DllImport(Plugin,CallingConvention=CallingConvention.Cdecl)] static extern int GssDestroy();

 static string fault;
 RenderTexture display;
 IntPtr renderEvent;
 bool nativeSession,disposed;
 public int Width {get;private set;}
 public int Height {get;private set;}
 public int Submitted {get;private set;}
 public string OutputPath {get;private set;}
 public int Accepted {get{EnsureActive();return ReadCount(GssAccepted());}}
 public int Completed {get{EnsureActive();return ReadCount(GssCompleted());}}

 public CreatorGpuVideoExport(int width,int height,int fps,string directory) {
  if(fault!=null)throw new InvalidOperationException("GPU export requires restarting the Player: "+fault);
  ValidateSettings(width,height,fps);
  if(SystemInfo.graphicsDeviceType!=GraphicsDeviceType.Direct3D11||QualitySettings.activeColorSpace!=ColorSpace.Linear)
   throw new InvalidOperationException("GPU export requires Direct3D11 and Linear color space");
  Width=width;Height=height;OutputPath=Path.Combine(Path.GetFullPath(directory),"export-gpu.h264");
  if(File.Exists(OutputPath))throw new IOException("GPU export temporary video already exists");
  try {
   display=new RenderTexture(width,height,0,RenderTextureFormat.ARGB32,RenderTextureReadWrite.sRGB) {
    name="Creator GPU export display",antiAliasing=1,filterMode=FilterMode.Point,useMipMap=false,autoGenerateMips=false
   };
   if(!display.Create())throw new InvalidOperationException("GPU export texture allocation failed");
   // GetNativeTexturePtr synchronizes with the render thread. Cache it once.
   var texture=display.GetNativeTexturePtr();
   if(texture==IntPtr.Zero)throw new InvalidOperationException("GPU export texture is unavailable");
   int created=GssCreate(width,height,fps,OutputPath);nativeSession=true;
   if(created<0)throw NativeError();
   if(GssSetTexture(texture)<0)throw NativeError();
   renderEvent=GssGetRenderEventFunc();
   if(renderEvent==IntPtr.Zero)throw new InvalidOperationException("GPU export render callback is unavailable");
  }catch{Dispose();throw;}
 }

 public static void ValidateSettings(int width,int height,int fps) {
  if(width<16||height<16||width>1920||height>1920||(width&1)!=0||(height&1)!=0||
   (fps!=24&&fps!=25&&fps!=30&&fps!=60))throw new ArgumentException("Invalid GPU export dimensions or frame rate");
 }

 public void Submit(RenderTexture source,int index) {
  EnsureActive();
  if(index!=Submitted||index<0||index>=216000)throw new InvalidOperationException("GPU export frame sequence is invalid");
  if(!source||source.width!=Width||source.height!=Height)throw new InvalidOperationException("GPU export frame size changed");
  if(Accepted!=Submitted)throw new InvalidOperationException("GPU export source texture is still in use");
  var previous=RenderTexture.active;var previousSrgb=GL.sRGBWrite;
  try {
   // ReadPixels/PNG previously normalized Unity's bottom-up image orientation.
   // D3D11/NVENC consumes top-down rows directly, so normalize on the GPU.
   using(CreatorExportProfiler.Measure("gpuConvertMs")){GL.sRGBWrite=true;Graphics.Blit(source,display,new Vector2(1,-1),new Vector2(0,1));}
   // Ordered after the blit. Native copies to its own pool before Accepted rises.
   using(CreatorExportProfiler.Measure("gpuSubmitMs"))GL.IssuePluginEvent(renderEvent,index);
   Submitted++;
  }finally{GL.sRGBWrite=previousSrgb;RenderTexture.active=previous;}
 }

 void EnsureActive(){if(disposed||!nativeSession)throw new InvalidOperationException("GPU export is not active");}
 static int ReadCount(int value) {
  if(value<0)throw NativeError();
  return value;
 }
 static Exception NativeError() {
  var pointer=GssError();string message="Native GPU export failed";
  if(pointer!=IntPtr.Zero){int length=0;while(length<4096&&Marshal.ReadByte(pointer,length)!=0)length++;if(length>0){var bytes=new byte[length];Marshal.Copy(pointer,bytes,0,length);message=Encoding.UTF8.GetString(bytes);}}
  return new InvalidOperationException(message);
 }
 public void Fault(string reason){fault=reason??"incomplete render callback";}
 public void Dispose() {
  if(disposed)return;disposed=true;
  try {
   // Native destruction is serialized with its render callback, retains the
   // source until safe, emits EOS, and joins the output worker.
   if(nativeSession){nativeSession=false;if(GssDestroy()<0){var error=NativeError();Fault(error.Message);throw error;}}
  }finally{
   if(display){display.Release();UnityEngine.Object.Destroy(display);display=null;}
  }
 }
}
