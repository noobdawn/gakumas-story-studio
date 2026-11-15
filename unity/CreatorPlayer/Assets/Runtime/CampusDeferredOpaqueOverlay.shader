Shader "Hidden/Research/CampusDeferredOpaqueOverlay"
{
    SubShader
    {
        Tags { "RenderPipeline"="UniversalPipeline" }
        Pass
        {
            Cull Off ZWrite On ZTest LEqual
            Blend Off
            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #include "Packages/com.unity.render-pipelines.core/ShaderLibrary/Common.hlsl"
            #include "Packages/com.unity.render-pipelines.core/ShaderLibrary/GlobalSamplers.hlsl"
            TEXTURE2D(_ResearchNativeLighting);
            TEXTURE2D(_ResearchEmission);
            TEXTURE2D_FLOAT(_ResearchDepth);
            TEXTURE2D(_ResearchAO);
            float _ResearchEmissionScale;
            float _ResearchAOStrength;
            struct Varyings { float4 positionCS : SV_POSITION; float2 uv : TEXCOORD0; };
            struct Output { float4 color : SV_Target; float depth : SV_Depth; };
            Varyings Vert(uint id : SV_VertexID)
            {
                Varyings o;
                o.positionCS = GetFullScreenTriangleVertexPosition(id);
                o.uv = GetFullScreenTriangleTexCoord(id);
                return o;
            }
            Output Frag(Varyings i)
            {
                float depth = SAMPLE_TEXTURE2D(_ResearchDepth, sampler_PointClamp, i.uv).r;
#if UNITY_REVERSED_Z
                clip(depth - 0.000001);
#else
                clip(0.999999 - depth);
#endif
                Output o;
                float3 light = SAMPLE_TEXTURE2D(_ResearchNativeLighting, sampler_PointClamp, i.uv).rgb;
                float3 emission = SAMPLE_TEXTURE2D(_ResearchEmission, sampler_PointClamp, i.uv).rgb;
                float ao = SAMPLE_TEXTURE2D(_ResearchAO, sampler_PointClamp, i.uv).r;
                o.color = float4(light * lerp(1, saturate(ao), saturate(_ResearchAOStrength)) + emission * _ResearchEmissionScale, 1);
                o.depth = depth;
                return o;
            }
            ENDHLSL
        }
    }
}
