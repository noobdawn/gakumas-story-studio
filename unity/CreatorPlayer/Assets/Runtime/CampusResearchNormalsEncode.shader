Shader "Hidden/Research/CampusNormalsEncode"
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
            TEXTURE2D(_ResearchNormal);
            struct Varyings { float4 positionCS : SV_POSITION; float2 uv : TEXCOORD0; };
            Varyings Vert(uint id : SV_VertexID) { Varyings o;o.positionCS=GetFullScreenTriangleVertexPosition(id);o.uv=GetFullScreenTriangleTexCoord(id);return o; }
            float4 Frag(Varyings i) : SV_Target
            {
                float3 n=SAMPLE_TEXTURE2D(_ResearchNormal,sampler_PointClamp,i.uv).rgb;
                float lengthSquared=dot(n,n);
                n=lengthSquared>0.00001?n*rsqrt(lengthSquared):float3(0,0,1);
                return float4(n*.5+.5,1);
            }
            ENDHLSL
        }
    }
}
