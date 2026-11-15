Shader "Creator/SelectionShell" {
 Properties { _Color ("Color", Color) = (1,0.58,0.1,1) }
 SubShader {
  Tags { "RenderPipeline"="UniversalPipeline" "Queue"="Transparent+10" }
  Pass { Tags { "LightMode"="UniversalForward" } Cull Front ZWrite Off ZTest LEqual
   HLSLPROGRAM
   #pragma vertex vert
   #pragma fragment frag
   #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
   struct A { float4 positionOS:POSITION; float3 normalOS:NORMAL; };
   struct V { float4 positionCS:SV_POSITION; };
   CBUFFER_START(UnityPerMaterial) float4 _Color; CBUFFER_END
   V vert(A i) { V o;float3 world=TransformObjectToWorld(i.positionOS.xyz);float3 n=TransformObjectToWorldNormal(i.normalOS);float4 clip=TransformWorldToHClip(world);float4 normalClip=mul(UNITY_MATRIX_VP,float4(n,0));float2 direction=normalize(normalClip.xy+float2(1e-6,0));clip.xy+=direction*clip.w*float2(3.0/_ScreenParams.x,3.0/_ScreenParams.y);o.positionCS=clip;return o; }
   half4 frag(V i):SV_Target { return _Color; }
   ENDHLSL
  }
 }
}
