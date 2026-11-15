Shader "Creator/FaceDecalResearch" {
 Properties { _BaseMap ("Local atlas", 2D) = "white" {} _Weight ("Weight", Range(0,1)) = 0 }
 SubShader {
  Tags { "RenderPipeline"="UniversalPipeline" "Queue"="Transparent+10" "RenderType"="Transparent" }
  Pass {
   Name "FaceDecal" Tags { "LightMode"="UniversalForward" }
   Cull Back ZWrite Off ZTest LEqual Offset -1, -1 Blend DstColor Zero
   HLSLPROGRAM
   #pragma vertex vert
   #pragma fragment frag
   #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
   TEXTURE2D(_BaseMap); SAMPLER(sampler_BaseMap);
   float4x4 _ProjectorFromObject; float4 _AtlasScaleBias; float _Weight;
   struct Attributes { float4 positionOS:POSITION; };
   struct Varyings { float4 positionCS:SV_POSITION; float3 decal:TEXCOORD0; };
   Varyings vert(Attributes v) { Varyings o; o.positionCS=TransformObjectToHClip(v.positionOS.xyz); o.decal=mul(_ProjectorFromObject,v.positionOS).xyz; return o; }
   half4 frag(Varyings i):SV_Target {
    clip(0.5-max(max(abs(i.decal.x),abs(i.decal.y)),abs(i.decal.z)));
    float2 uv=(i.decal.xz+0.5)*_AtlasScaleBias.xy+_AtlasScaleBias.zw;
    half4 tex=SAMPLE_TEXTURE2D(_BaseMap,sampler_BaseMap,uv);
    return half4(lerp(half3(1,1,1),tex.rgb,tex.a*_Weight),1);
   }
   ENDHLSL
  }
 }
}
