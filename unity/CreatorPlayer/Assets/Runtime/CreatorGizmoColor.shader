Shader "Creator/GizmoColor" {
 Properties { _Color ("Color", Color) = (1,0,0,1) }
 SubShader { Tags { "RenderPipeline"="UniversalPipeline" "Queue"="Transparent+20" }
  Pass { Tags { "LightMode"="UniversalForward" } Cull Off ZWrite Off ZTest Always
   HLSLPROGRAM
   #pragma vertex vert
   #pragma fragment frag
   #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
   struct A { float4 positionOS:POSITION; }; struct V { float4 positionCS:SV_POSITION; };
   CBUFFER_START(UnityPerMaterial) float4 _Color; CBUFFER_END
   V vert(A i){V o;o.positionCS=TransformObjectToHClip(i.positionOS.xyz);return o;}
   half4 frag(V i):SV_Target{return _Color;}
   ENDHLSL
  }
 }
}
