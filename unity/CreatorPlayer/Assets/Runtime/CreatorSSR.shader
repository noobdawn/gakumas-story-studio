Shader "Hidden/Creator/ScreenSpaceReflection" {
 SubShader {
  Tags { "RenderPipeline"="UniversalPipeline" }
  Cull Off ZWrite Off ZTest Always
  HLSLINCLUDE
  #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
  #include "Packages/com.unity.render-pipelines.core/ShaderLibrary/GlobalSamplers.hlsl"
  #include "Packages/com.unity.render-pipelines.core/ShaderLibrary/EntityLighting.hlsl"
  TEXTURE2D(_SSRColor); TEXTURE2D_FLOAT(_SSRDepth); TEXTURE2D_FLOAT(_SSRGeometryDepth);
  TEXTURE2D(_SSRNormal); TEXTURE2D(_SSRMaterial); TEXTURE2D(_SSRAlbedo); TEXTURE2D(_SSRReflection);
  float4x4 _SSRVP,_SSRInvVP,_SSRView;
  float4 _SSRParams; // intensity, minimum smoothness, maximum distance, thickness
  float4 _SSRCamera; // camera world position, near plane
  int _SSRSteps,_SSREnabled,_ProbeCount;
  TEXTURECUBE(_Probe0);TEXTURECUBE(_Probe1);TEXTURECUBE(_Probe2);TEXTURECUBE(_Probe3);
  TEXTURECUBE(_Probe4);TEXTURECUBE(_Probe5);TEXTURECUBE(_Probe6);TEXTURECUBE(_Probe7);
  float4 _ProbePosition[8],_ProbeMin[8],_ProbeMax[8],_ProbeDecode[8],_ProbeSettings[8];
  struct Varyings { float4 positionCS:SV_POSITION;float2 uv:TEXCOORD0; };
  Varyings Vert(uint id:SV_VertexID){Varyings o;o.positionCS=GetFullScreenTriangleVertexPosition(id);o.uv=GetFullScreenTriangleTexCoord(id);return o;}
  bool HasDepth(float d){
  #if UNITY_REVERSED_Z
   return d>0.000001;
  #else
   return d<0.999999;
  #endif
  }
  float3 World(float2 uv,float d){
  #if !UNITY_REVERSED_Z
   d=lerp(UNITY_NEAR_CLIP_VALUE,1,d);
  #endif
   return ComputeWorldSpacePosition(uv,d,_SSRInvVP);
  }
  float Eye(float3 p){return -mul(_SSRView,float4(p,1)).z;}
  bool Receiver(float2 uv,out float3 ws,out float3 n,out float3 material){
   ws=0;n=0;material=0;
   float depth=SAMPLE_TEXTURE2D(_SSRGeometryDepth,sampler_PointClamp,uv).r;
   if(!HasDepth(depth))return false;
   ws=World(uv,depth);
   float visible=SAMPLE_TEXTURE2D(_SSRDepth,sampler_PointClamp,uv).r;
   if(!HasDepth(visible)||abs(Eye(ws)-Eye(World(uv,visible)))>max(.01,Eye(ws)*.001))return false;
   n=SAMPLE_TEXTURE2D(_SSRNormal,sampler_PointClamp,uv).xyz;
   if(dot(n,n)<.01)return false;
   n=normalize(n);material=SAMPLE_TEXTURE2D(_SSRMaterial,sampler_PointClamp,uv).rgb;
   // Original deferred material buffer: R metallic, B smoothness.
   return material.b>=_SSRParams.y;
  }
  bool Project(float3 p,out float2 uv){
   float4 clip=mul(_SSRVP,float4(p,1));uv=0;
   if(clip.w<=0||Eye(p)<=_SSRCamera.w)return false;
   uv=clip.xy/clip.w;
  #if UNITY_UV_STARTS_AT_TOP
   uv.y=-uv.y;
  #endif
   uv=uv*.5+.5;return all(uv>0)&&all(uv<1);
  }
  float4 Trace(Varyings i):SV_Target{
   float3 ws,n,material;if(!Receiver(i.uv,ws,n,material))return 0;
   float3 incident=normalize(ws-_SSRCamera.xyz),direction=reflect(incident,n);
   float3 origin=ws+n*.03;
   float previous=0,previousDelta=-.03;
   [loop]for(int step=1;step<=_SSRSteps;step++){
    float t=(float)step/_SSRSteps,distance=.08+t*t*_SSRParams.z;
    float3 rayPoint=origin+direction*distance;float2 uv;
    if(!Project(rayPoint,uv))break;
    float depth=SAMPLE_TEXTURE2D_LOD(_SSRDepth,sampler_PointClamp,uv,0).r;
    if(!HasDepth(depth)){previous=distance;previousDelta=-_SSRParams.z;continue;}
    float delta=Eye(rayPoint)-Eye(World(uv,depth));
    if(delta>=0&&previousDelta<0){
     float low=previous,high=distance;
     [unroll]for(int refine=0;refine<5;refine++){
      float mid=(low+high)*.5;float3 q=origin+direction*mid;float2 u;
      if(!Project(q,u)){high=mid;continue;}
      float d=SAMPLE_TEXTURE2D_LOD(_SSRDepth,sampler_PointClamp,u,0).r;
      if(!HasDepth(d)||Eye(q)<Eye(World(u,d)))low=mid;else high=mid;
     }
     float3 hit=origin+direction*high;float2 hitUV;if(!Project(hit,hitUV))break;
     float hd=SAMPLE_TEXTURE2D_LOD(_SSRDepth,sampler_PointClamp,hitUV,0).r;
     float difference=Eye(hit)-Eye(World(hitUV,hd));
     if(HasDepth(hd)&&difference>=0&&difference<_SSRParams.w&&length(hitUV-i.uv)>.002){
      float edge=min(min(hitUV.x,hitUV.y),min(1-hitUV.x,1-hitUV.y));
      float confidence=saturate(edge/.08)*saturate(1-high/_SSRParams.z)*saturate(1-difference/_SSRParams.w);
      float3 reflected=SAMPLE_TEXTURE2D_LOD(_SSRColor,sampler_LinearClamp,hitUV,0).rgb;
      return float4(min(max(reflected,0),32)*confidence,confidence);
     }
    }
    previous=distance;previousDelta=delta;
   }
   return 0;
  }
  float ProbeWeight(int k,float3 ws){
   float3 edge=min(ws-_ProbeMin[k].xyz,_ProbeMax[k].xyz-ws);
   float nearest=min(edge.x,min(edge.y,edge.z));
   if(nearest<0)return 0;
   return _ProbeSettings[k].y>.0001?saturate(nearest/_ProbeSettings[k].y):1;
  }
  float3 ProbeDirection(int k,float3 ws,float3 ray){
   if(_ProbePosition[k].w<.5)return ray;
   float3 safeRay=float3(ray.x>=0?max(ray.x,.00001):min(ray.x,-.00001),ray.y>=0?max(ray.y,.00001):min(ray.y,-.00001),ray.z>=0?max(ray.z,.00001):min(ray.z,-.00001));
   float3 hit=max((_ProbeMax[k].xyz-ws)/safeRay,(_ProbeMin[k].xyz-ws)/safeRay);
   return ws+ray*min(hit.x,min(hit.y,hit.z))-_ProbePosition[k].xyz;
  }
  float3 Environment(float3 ws,float3 ray,float smoothness){
   float3 result=0;float remaining=1;
   // Priority and box volume ordering comes from the original scene probes.
   #define ADD_PROBE(K) if(_ProbeCount>K&&remaining>.001){float weight=ProbeWeight(K,ws)*remaining;if(weight>0){float4 tex=SAMPLE_TEXTURECUBE_LOD(_Probe##K,sampler_LinearClamp,ProbeDirection(K,ws,ray),(1-smoothness)*_ProbeSettings[K].z);result+=max(DecodeHDREnvironment(tex,_ProbeDecode[K]),0)*_ProbeSettings[K].x*weight;remaining-=weight;}}
   ADD_PROBE(0) ADD_PROBE(1) ADD_PROBE(2) ADD_PROBE(3)
   ADD_PROBE(4) ADD_PROBE(5) ADD_PROBE(6) ADD_PROBE(7)
   #undef ADD_PROBE
   return result;
  }
  float4 Composite(Varyings i):SV_Target{
   float4 base=SAMPLE_TEXTURE2D(_SSRColor,sampler_PointClamp,i.uv);
   float3 ws,n,material;if(!Receiver(i.uv,ws,n,material))return base;
   float3 albedo=SAMPLE_TEXTURE2D(_SSRAlbedo,sampler_PointClamp,i.uv).rgb;
   float3 f0=lerp(.04,albedo,saturate(material.r));
   float nv=saturate(dot(n,normalize(_SSRCamera.xyz-ws)));
   float3 fresnel=f0+(1-f0)*pow(1-nv,5);
   float mask=saturate((material.b-_SSRParams.y)/max(.01,1-_SSRParams.y));
   float3 reflected=Environment(ws,reflect(normalize(ws-_SSRCamera.xyz),n),saturate(material.b));
   if(_SSREnabled!=0){float4 traced=SAMPLE_TEXTURE2D(_SSRReflection,sampler_LinearClamp,i.uv);reflected=reflected*(1-saturate(traced.a))+traced.rgb;}
   return float4(base.rgb+reflected*fresnel*mask*_SSRParams.x,base.a);
  }
  ENDHLSL
  Pass { Name "Trace" HLSLPROGRAM
   #pragma target 4.5
   #pragma vertex Vert
   #pragma fragment Trace
   ENDHLSL }
  Pass { Name "Composite" HLSLPROGRAM
   #pragma target 4.5
   #pragma vertex Vert
   #pragma fragment Composite
   ENDHLSL }
 }
}
