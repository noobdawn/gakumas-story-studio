Shader "Hidden/Research/CampusShadowAOCombine"
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
            #include "Packages/com.unity.render-pipelines.core/ShaderLibrary/Common.hlsl"
            #include "Packages/com.unity.render-pipelines.core/ShaderLibrary/GlobalSamplers.hlsl"
            TEXTURE2D(_ResearchAOFactor);
            TEXTURE2D(_ResearchShadowInput);
            float _ResearchAOStrength;
            struct Varyings { float4 positionCS : SV_POSITION; float2 uv : TEXCOORD0; };
            Varyings Vert(uint id : SV_VertexID) { Varyings o;o.positionCS=GetFullScreenTriangleVertexPosition(id);o.uv=GetFullScreenTriangleTexCoord(id);return o; }
            float4 Frag(Varyings i) : SV_Target
            {
                float4 shadow=SAMPLE_TEXTURE2D(_ResearchShadowInput,sampler_PointClamp,i.uv);
                float ao=SAMPLE_TEXTURE2D(_ResearchAOFactor,sampler_PointClamp,i.uv).r;
                shadow.g*=lerp(1,saturate(ao),saturate(_ResearchAOStrength));
                return shadow;
            }
            ENDHLSL
        }
    }
}
