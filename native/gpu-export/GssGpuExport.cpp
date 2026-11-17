// Windows/D3D11 NVENC proof of concept. No CPU pixel readback.
// Contract: H.264, CFR, no B frames/lookahead; timestamps are frame indices.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <d3d11_4.h>
#include <wrl/client.h>
#include <atomic>
#include <condition_variable>
#include <deque>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>
#include <chrono>
#include <sstream>
#include "include/nvEncodeAPI.h"
using Microsoft::WRL::ComPtr;
namespace {
constexpr int PoolSize=8;
using Clock=std::chrono::steady_clock;
double milliseconds(Clock::time_point start){return std::chrono::duration<double,std::milli>(Clock::now()-start).count();}
// Each file has exactly one writer. Profiling never queries the session lock.
struct TraceFile {
 HANDLE handle=INVALID_HANDLE_VALUE;
 ~TraceFile(){if(handle!=INVALID_HANDLE_VALUE)CloseHandle(handle);}
 void open(const std::wstring& path){handle=CreateFileW(path.c_str(),GENERIC_WRITE,FILE_SHARE_READ,nullptr,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr);if(handle==INVALID_HANDLE_VALUE)throw std::runtime_error("Cannot create GPU diagnostic trace");}
};
struct Trace {
 HANDLE handle;int index,count=0;double globalMs;Clock::time_point start,last;
 const char* names[12]{};double values[12]{};
 Trace(HANDLE h,int i,double global=0):handle(h),index(i),globalMs(global){if(handle!=INVALID_HANDLE_VALUE)start=last=Clock::now();}
 void mark(const char* name){if(handle==INVALID_HANDLE_VALUE)return;auto now=Clock::now();names[count]=name;values[count++]=std::chrono::duration<double,std::milli>(now-last).count();last=now;}
 ~Trace(){if(handle==INVALID_HANDLE_VALUE)return;try{std::ostringstream s;s<<"{\"index\":"<<index<<",\"globalLockMs\":"<<globalMs<<",\"nativeTotalMs\":"<<milliseconds(start);for(int i=0;i<count;i++)s<<",\""<<names[i]<<"\":"<<values[i];s<<"}\n";auto line=s.str();DWORD written=0;WriteFile(handle,line.data(),static_cast<DWORD>(line.size()),&written,nullptr);}catch(...){/* Diagnostic failures must not throw during unwinding. */}}
};
struct Slot {
 ComPtr<ID3D11Texture2D> texture;
 NV_ENC_REGISTERED_PTR registered=nullptr;
 NV_ENC_INPUT_PTR mapped=nullptr;
 NV_ENC_OUTPUT_PTR bitstream=nullptr;
 HANDLE ready=nullptr;
 bool eventRegistered=false;
 std::atomic<bool> busy{false};
 int index=0;
};
struct Session {
 int width,height,fps;
 HMODULE library=nullptr;
 HANDLE file=INVALID_HANDLE_VALUE, metadata=INVALID_HANDLE_VALUE;
 NV_ENCODE_API_FUNCTION_LIST api{};
 void* encoder=nullptr;
 HANDLE flushed=nullptr;
 bool initialized=false,flushRegistered=false,closed=false;
 ComPtr<ID3D11Texture2D> source;
 ComPtr<ID3D11Device> device;
 ComPtr<ID3D11DeviceContext> context;
 ComPtr<ID3D11Multithread> multithread;
 BOOL previousProtection=FALSE;
 NV_ENC_BUFFER_FORMAT format=NV_ENC_BUFFER_FORMAT_UNDEFINED;
 Slot slots[PoolSize];
 std::atomic<int> accepted{0},completed{0};
 std::atomic<bool> failed{false},stopping{false};
 std::mutex mutex,errorMutex,encoderMutex;
 std::condition_variable changed;
 std::deque<int> pending;
 std::string error;
 std::thread output;
 TraceFile submitTrace,outputTrace;
 Session(int w,int h,int rate):width(w),height(h),fps(rate){}
 void openTrace(){
  wchar_t test[8]{},directory[32768]{};GetEnvironmentVariableW(L"CREATOR_TEST_INSTANCE",test,8);
  if(std::wstring(test)!=L"1")return;DWORD size=GetEnvironmentVariableW(L"CREATOR_GPU_TRACE_DIR",directory,32768);if(!size)return;if(size>=32768)throw std::runtime_error("GPU trace directory too long");
  static unsigned serial=0;auto prefix=std::wstring(directory)+L"\\gpu-"+std::to_wstring(GetCurrentProcessId())+L"-"+std::to_wstring(++serial);
  submitTrace.open(prefix+L"-submit.jsonl");outputTrace.open(prefix+L"-output.jsonl");
 }
 void fail(const std::string& message){std::lock_guard<std::mutex> guard(errorMutex);if(!failed){error=message;failed=true;}changed.notify_all();}
 void check(NVENCSTATUS code,const char* operation){if(code!=NV_ENC_SUCCESS)throw std::runtime_error(std::string(operation)+": NVENC "+std::to_string(code));}
 static void write(HANDLE handle,const void* data,DWORD size){DWORD count=0;if(!WriteFile(handle,data,size,&count,nullptr)||count!=size)throw std::runtime_error("GPU video output write failed");}
 void initialize(){
  source->GetDevice(&device);device->GetImmediateContext(&context);
  if(FAILED(context.As(&multithread)))throw std::runtime_error("D3D11 multithread protection unavailable");
  previousProtection=multithread->SetMultithreadProtected(TRUE);
  D3D11_TEXTURE2D_DESC desc{};source->GetDesc(&desc);
  if(desc.Width!=static_cast<UINT>(width)||desc.Height!=static_cast<UINT>(height)||desc.SampleDesc.Count!=1)throw std::runtime_error("Unexpected source texture size/samples");
  if(desc.Format==DXGI_FORMAT_R8G8B8A8_UNORM||desc.Format==DXGI_FORMAT_R8G8B8A8_UNORM_SRGB||desc.Format==DXGI_FORMAT_R8G8B8A8_TYPELESS){format=NV_ENC_BUFFER_FORMAT_ABGR;desc.Format=DXGI_FORMAT_R8G8B8A8_UNORM;}
  else if(desc.Format==DXGI_FORMAT_B8G8R8A8_UNORM||desc.Format==DXGI_FORMAT_B8G8R8A8_UNORM_SRGB||desc.Format==DXGI_FORMAT_B8G8R8A8_TYPELESS){format=NV_ENC_BUFFER_FORMAT_ARGB;desc.Format=DXGI_FORMAT_B8G8R8A8_UNORM;}
  else throw std::runtime_error("Unsupported source texture format");
  library=LoadLibraryExW(L"nvEncodeAPI64.dll",nullptr,LOAD_LIBRARY_SEARCH_SYSTEM32);
  if(!library)throw std::runtime_error("NVIDIA encoder driver unavailable");
  auto create=reinterpret_cast<NVENCSTATUS(NVENCAPI*)(NV_ENCODE_API_FUNCTION_LIST*)>(GetProcAddress(library,"NvEncodeAPICreateInstance"));
  if(!create)throw std::runtime_error("NVENC API entry missing");
  api.version=NV_ENCODE_API_FUNCTION_LIST_VER;check(create(&api),"CreateInstance");
  NV_ENC_OPEN_ENCODE_SESSION_EX_PARAMS open{};open.version=NV_ENC_OPEN_ENCODE_SESSION_EX_PARAMS_VER;open.device=device.Get();open.deviceType=NV_ENC_DEVICE_TYPE_DIRECTX;open.apiVersion=NVENCAPI_VERSION;
  check(api.nvEncOpenEncodeSessionEx(&open,&encoder),"OpenSession");
  uint32_t count=0;check(api.nvEncGetInputFormatCount(encoder,NV_ENC_CODEC_H264_GUID,&count),"FormatCount");
  std::vector<NV_ENC_BUFFER_FORMAT> formats(count);check(api.nvEncGetInputFormats(encoder,NV_ENC_CODEC_H264_GUID,formats.data(),count,&count),"Formats");
  bool supported=false;for(auto f:formats)if(f==format)supported=true;if(!supported)throw std::runtime_error("RGB texture input unsupported");
  NV_ENC_CAPS_PARAM caps{};caps.version=NV_ENC_CAPS_PARAM_VER;caps.capsToQuery=NV_ENC_CAPS_ASYNC_ENCODE_SUPPORT;int async=0;
  check(api.nvEncGetEncodeCaps(encoder,NV_ENC_CODEC_H264_GUID,&caps,&async),"AsyncCaps");if(!async)throw std::runtime_error("Asynchronous NVENC required for this prototype");
  NV_ENC_PRESET_CONFIG preset{};preset.version=NV_ENC_PRESET_CONFIG_VER;preset.presetCfg.version=NV_ENC_CONFIG_VER;
  check(api.nvEncGetEncodePresetConfigEx(encoder,NV_ENC_CODEC_H264_GUID,NV_ENC_PRESET_P4_GUID,NV_ENC_TUNING_INFO_HIGH_QUALITY,&preset),"Preset");
  auto config=preset.presetCfg;config.profileGUID=NV_ENC_H264_PROFILE_HIGH_GUID;config.gopLength=fps*2;config.frameIntervalP=1;
  config.rcParams.rateControlMode=NV_ENC_PARAMS_RC_CONSTQP;config.rcParams.constQP={18,18,18};config.rcParams.enableLookahead=0;config.rcParams.lookaheadDepth=0;config.rcParams.zeroReorderDelay=1;config.rcParams.enableAQ=0;config.rcParams.enableTemporalAQ=0;
  config.encodeCodecConfig.h264Config.repeatSPSPPS=1;config.encodeCodecConfig.h264Config.idrPeriod=config.gopLength;
  NV_ENC_INITIALIZE_PARAMS init{};init.version=NV_ENC_INITIALIZE_PARAMS_VER;init.encodeGUID=NV_ENC_CODEC_H264_GUID;init.presetGUID=NV_ENC_PRESET_P4_GUID;init.tuningInfo=NV_ENC_TUNING_INFO_HIGH_QUALITY;
  init.encodeWidth=width;init.encodeHeight=height;init.darWidth=width;init.darHeight=height;init.frameRateNum=fps;init.frameRateDen=1;init.enableEncodeAsync=1;init.enablePTD=1;init.encodeConfig=&config;
  check(api.nvEncInitializeEncoder(encoder,&init),"Initialize");
  initialized=true;flushed=CreateEventW(nullptr,FALSE,FALSE,nullptr);if(!flushed)throw std::runtime_error("Flush event allocation failed");
  NV_ENC_EVENT_PARAMS flush{};flush.version=NV_ENC_EVENT_PARAMS_VER;flush.completionEvent=flushed;check(api.nvEncRegisterAsyncEvent(encoder,&flush),"RegisterFlushEvent");flushRegistered=true;
  desc.MipLevels=1;desc.ArraySize=1;desc.Usage=D3D11_USAGE_DEFAULT;desc.BindFlags=D3D11_BIND_RENDER_TARGET|D3D11_BIND_SHADER_RESOURCE;desc.CPUAccessFlags=0;desc.MiscFlags=0;
  for(auto& slot:slots){
   if(FAILED(device->CreateTexture2D(&desc,nullptr,&slot.texture)))throw std::runtime_error("Encoder texture allocation failed");
   NV_ENC_REGISTER_RESOURCE reg{};reg.version=NV_ENC_REGISTER_RESOURCE_VER;reg.resourceType=NV_ENC_INPUT_RESOURCE_TYPE_DIRECTX;reg.width=width;reg.height=height;reg.resourceToRegister=slot.texture.Get();reg.bufferFormat=format;reg.bufferUsage=NV_ENC_INPUT_IMAGE;
   check(api.nvEncRegisterResource(encoder,&reg),"RegisterResource");slot.registered=reg.registeredResource;
   NV_ENC_CREATE_BITSTREAM_BUFFER buffer{};buffer.version=NV_ENC_CREATE_BITSTREAM_BUFFER_VER;check(api.nvEncCreateBitstreamBuffer(encoder,&buffer),"CreateBitstream");slot.bitstream=buffer.bitstreamBuffer;
   slot.ready=CreateEventW(nullptr,FALSE,FALSE,nullptr);if(!slot.ready)throw std::runtime_error("Completion event allocation failed");
   NV_ENC_EVENT_PARAMS event{};event.version=NV_ENC_EVENT_PARAMS_VER;event.completionEvent=slot.ready;check(api.nvEncRegisterAsyncEvent(encoder,&event),"RegisterEvent");slot.eventRegistered=true;
  }
  output=std::thread([this]{consume();});
 }
 void submit(int index,double globalMs){
  Trace trace(submitTrace.handle,index,globalMs);
  if(failed)throw std::runtime_error("GPU export session failed");
  if(index!=accepted.load())throw std::runtime_error("GPU frame sequence mismatch");
  if(!source)throw std::runtime_error("GPU source missing");if(!encoder)initialize();
  trace.mark("initializeMs");
  auto& slot=slots[index%PoolSize];
  {std::unique_lock<std::mutex> lock(mutex);if(!changed.wait_for(lock,std::chrono::seconds(30),[&]{return !slot.busy||failed;}))throw std::runtime_error("Encoder backpressure timeout");}
  if(failed)throw std::runtime_error("Encoder output failed");slot.busy=true;slot.index=index;
  trace.mark("poolWaitMs");
  // Only the Unity render thread uses the immediate context.
  context->CopyResource(slot.texture.Get(),source.Get());
  trace.mark("copyMs");
  std::lock_guard<std::mutex> encodeGuard(encoderMutex);
  trace.mark("encoderLockMs");
  NV_ENC_MAP_INPUT_RESOURCE map{};map.version=NV_ENC_MAP_INPUT_RESOURCE_VER;map.registeredResource=slot.registered;
  auto mapStatus=api.nvEncMapInputResource(encoder,&map);
  trace.mark("mapMs");
  if(mapStatus!=NV_ENC_SUCCESS)throw std::runtime_error("MapInput frame "+std::to_string(index)+" completed "+std::to_string(completed.load())+": NVENC "+std::to_string(mapStatus));
  slot.mapped=map.mappedResource;
  NV_ENC_PIC_PARAMS pic{};pic.version=NV_ENC_PIC_PARAMS_VER;pic.inputBuffer=slot.mapped;pic.bufferFmt=format;pic.inputWidth=width;pic.inputHeight=height;pic.outputBitstream=slot.bitstream;pic.completionEvent=slot.ready;pic.pictureStruct=NV_ENC_PIC_STRUCT_FRAME;pic.inputTimeStamp=index;pic.inputDuration=1;
  check(api.nvEncEncodePicture(encoder,&pic),"EncodePicture");
  trace.mark("encodeMs");
  {std::lock_guard<std::mutex> lock(mutex);pending.push_back(index%PoolSize);accepted++;}changed.notify_all();
 }
 void consume(){
  try{while(true){
   int number;
   {std::unique_lock<std::mutex> lock(mutex);changed.wait(lock,[&]{return stopping||!pending.empty();});if(pending.empty())break;number=pending.front();pending.pop_front();}
   auto& slot=slots[number];Trace trace(outputTrace.handle,slot.index);if(WaitForSingleObject(slot.ready,30000)!=WAIT_OBJECT_0)throw std::runtime_error("NVENC completion timeout");
   trace.mark("eventWaitMs");
   std::lock_guard<std::mutex> encodeGuard(encoderMutex);
   trace.mark("encoderLockMs");
   NV_ENC_LOCK_BITSTREAM bits{};bits.version=NV_ENC_LOCK_BITSTREAM_VER;bits.outputBitstream=slot.bitstream;bits.doNotWait=0;check(api.nvEncLockBitstream(encoder,&bits),"LockBitstream");
   trace.mark("bitstreamLockMs");
   try{
    if(bits.outputTimeStamp!=static_cast<uint64_t>(slot.index)||slot.index!=completed)throw std::runtime_error("Encoded timestamp/order mismatch");
    write(file,bits.bitstreamBufferPtr,bits.bitstreamSizeInBytes);
    auto line=std::string("{\"index\":")+std::to_string(slot.index)+",\"timestamp\":"+std::to_string(bits.outputTimeStamp)+",\"duration\":1,\"timebaseNum\":1,\"timebaseDen\":"+std::to_string(fps)+",\"bytes\":"+std::to_string(bits.bitstreamSizeInBytes)+"}\n";
    write(metadata,line.data(),static_cast<DWORD>(line.size()));
    trace.mark("writeMs");
   }catch(...){api.nvEncUnlockBitstream(encoder,slot.bitstream);throw;}
   check(api.nvEncUnlockBitstream(encoder,slot.bitstream),"UnlockBitstream");trace.mark("unlockMs");check(api.nvEncUnmapInputResource(encoder,slot.mapped),"UnmapInput");trace.mark("unmapMs");slot.mapped=nullptr;slot.busy=false;completed++;changed.notify_all();
  }}catch(const std::exception& e){fail(e.what());}
 }
 void close(){
  if(closed)return;closed=true;
  bool drained=!initialized;
  if(initialized&&flushRegistered){
   NV_ENC_PIC_PARAMS eos{};eos.version=NV_ENC_PIC_PARAMS_VER;eos.encodePicFlags=NV_ENC_PIC_FLAG_EOS;eos.completionEvent=flushed;
   NVENCSTATUS status;{std::lock_guard<std::mutex> guard(encoderMutex);status=api.nvEncEncodePicture(encoder,&eos);}
   if(status==NV_ENC_SUCCESS)drained=WaitForSingleObject(flushed,30000)==WAIT_OBJECT_0;
   if(!drained)fail("NVENC flush failed or timed out");
  }
  stopping=true;changed.notify_all();if(output.joinable())output.join();
  if(encoder){
   // On a failed flush destroy the session before releasing D3D resources;
   // do not pretend outstanding textures are safe to recycle.
   if(drained){
    for(auto& slot:slots){if(slot.mapped)api.nvEncUnmapInputResource(encoder,slot.mapped);if(slot.eventRegistered){NV_ENC_EVENT_PARAMS event{};event.version=NV_ENC_EVENT_PARAMS_VER;event.completionEvent=slot.ready;api.nvEncUnregisterAsyncEvent(encoder,&event);}if(slot.bitstream)api.nvEncDestroyBitstreamBuffer(encoder,slot.bitstream);if(slot.registered)api.nvEncUnregisterResource(encoder,slot.registered);}
    if(flushRegistered){NV_ENC_EVENT_PARAMS event{};event.version=NV_ENC_EVENT_PARAMS_VER;event.completionEvent=flushed;api.nvEncUnregisterAsyncEvent(encoder,&event);}
   }
   if(api.nvEncDestroyEncoder(encoder)!=NV_ENC_SUCCESS)fail("NVENC session destruction failed");encoder=nullptr;
  }
  if(multithread)multithread->SetMultithreadProtected(previousProtection);
 }
 ~Session(){
  close();
  for(auto& slot:slots)if(slot.ready)CloseHandle(slot.ready);
  if(flushed)CloseHandle(flushed);
  if(file!=INVALID_HANDLE_VALUE)CloseHandle(file);if(metadata!=INVALID_HANDLE_VALUE)CloseHandle(metadata);if(library)FreeLibrary(library);
 }
};
std::mutex globalMutex;
std::unique_ptr<Session> session;
std::string lastError;
void __stdcall renderEvent(int index){auto start=Clock::now();std::lock_guard<std::mutex> guard(globalMutex);if(!session)return;try{session->submit(index,milliseconds(start));}catch(const std::exception& e){session->fail(e.what());}}
}
#define API extern "C" __declspec(dllexport)
API int GssCreate(int width,int height,int fps,const wchar_t* path){
 std::lock_guard<std::mutex> guard(globalMutex);
 try{
  if(session)throw std::runtime_error("GPU session already active");
  if(!path||width<16||height<16||width>1920||height>1920||width%2||height%2||(fps!=24&&fps!=25&&fps!=30&&fps!=60))throw std::runtime_error("Invalid GPU video configuration");
  auto next=std::make_unique<Session>(width,height,fps);
  next->file=CreateFileW(path,GENERIC_WRITE,FILE_SHARE_READ,nullptr,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr);if(next->file==INVALID_HANDLE_VALUE)throw std::runtime_error("GPU output exists or cannot be created");
  std::wstring metadata(path);auto dot=metadata.rfind(L'.');if(dot!=std::wstring::npos)metadata.resize(dot);metadata+=L".frames.jsonl";
  next->metadata=CreateFileW(metadata.c_str(),GENERIC_WRITE,FILE_SHARE_READ,nullptr,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr);if(next->metadata==INVALID_HANDLE_VALUE)throw std::runtime_error("GPU metadata exists or cannot be created");
  next->openTrace();
  session=std::move(next);lastError.clear();return 0;
 }catch(const std::exception& e){lastError=e.what();return -1;}
}
API int GssSetTexture(void* texture){std::lock_guard<std::mutex> guard(globalMutex);if(!session||!texture)return -1;auto* resource=static_cast<ID3D11Resource*>(texture);if(FAILED(resource->QueryInterface(IID_PPV_ARGS(&session->source)))){session->fail("Source is not a D3D11 texture");return -1;}return 0;}
API void* GssGetRenderEventFunc(){return reinterpret_cast<void*>(&renderEvent);}
API int GssAccepted(){std::lock_guard<std::mutex> guard(globalMutex);return !session||session->failed?-1:session->accepted.load();}
API int GssCompleted(){std::lock_guard<std::mutex> guard(globalMutex);return !session||session->failed?-1:session->completed.load();}
API const char* GssError(){static thread_local std::string value;std::lock_guard<std::mutex> guard(globalMutex);if(session){std::lock_guard<std::mutex> lock(session->errorMutex);value=session->error;}else value=lastError;return value.c_str();}
API int GssDestroy(){std::lock_guard<std::mutex> guard(globalMutex);int result=0;if(session){session->close();if(session->failed){result=-1;std::lock_guard<std::mutex> lock(session->errorMutex);lastError=session->error;}}session.reset();return result;}
