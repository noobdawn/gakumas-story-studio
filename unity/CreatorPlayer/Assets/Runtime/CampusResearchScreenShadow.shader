Shader "Hidden/Research/CampusScreenShadow"
{
    SubShader
    {
        Tags { "RenderPipeline"="UniversalPipeline" }
        Pass
        {
            Cull Off ZWrite Off ZTest Always
            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE
            #pragma multi_compile_fragment _ _SHADOWS_SOFT
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"
            #include "Packages/com.unity.render-pipelines.core/ShaderLibrary/GlobalSamplers.hlsl"
            TEXTURE2D_FLOAT(_ResearchDepth);
            TEXTURE2D_FLOAT(_ResearchShadowMap);
            float _ResearchShadowDebug;
            struct Varyings { float4 positionCS : SV_POSITION; float2 uv : TEXCOORD0; };
            Varyings Vert(uint id : SV_VertexID) { Varyings o;o.positionCS=GetFullScreenTriangleVertexPosition(id);o.uv=GetFullScreenTriangleTexCoord(id);return o; }
            float4 Frag(Varyings i) : SV_Target
            {
                float depth=SAMPLE_TEXTURE2D(_ResearchDepth,sampler_PointClamp,i.uv).r;
                if(_ResearchShadowDebug > 3.5 && _ResearchShadowDebug < 4.5){float d=SAMPLE_TEXTURE2D(_ResearchShadowMap,sampler_PointClamp,i.uv).r;return float4(d,d,d,1);}
                if(_ResearchShadowDebug > 0.5 && _ResearchShadowDebug < 1.5)return float4(depth,depth,depth,1);
#if UNITY_REVERSED_Z
                if(depth<0.000001)return 1;
#else
                if(depth>0.999999)return 1;
                depth=lerp(UNITY_NEAR_CLIP_VALUE,1,depth);
#endif
                float3 positionWS=ComputeWorldSpacePosition(i.uv,depth,UNITY_MATRIX_I_VP);
                float4 shadowCoord=TransformWorldToShadowCoord(positionWS);
                if(_ResearchShadowDebug > 4.5){float d=SAMPLE_TEXTURE2D(_ResearchShadowMap,sampler_PointClamp,shadowCoord.xy).r;return float4(d,d,d,1);}
                if(_ResearchShadowDebug > 1.5 && _ResearchShadowDebug < 2.5)return float4(saturate(positionWS*.05+.5),1);
                if(_ResearchShadowDebug > 2.5 && _ResearchShadowDebug < 3.5)return float4(saturate(shadowCoord.xyz),1);
                float shadow=MainLightRealtimeShadow(shadowCoord);
                return float4(shadow,1,1,1);
            }
            ENDHLSL
        }
    }
}
