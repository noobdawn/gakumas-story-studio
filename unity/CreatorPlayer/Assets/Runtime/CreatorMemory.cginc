// Linear-light highlight diffusion and luminance-driven faded print toning.
float4 memoryImage(float2 uv) {
    float4 src=tex2D(_Clean,uv);float3 glow=0;float coverage=0;
    float2 radius=float2(_MainTex_TexelSize.x/abs(_MainTex_TexelSize.y),1)*_EffectParams.w*.01;
    [unroll] for(int y=-2;y<=2;y++) [unroll] for(int x=-2;x<=2;x++) {
        float w=exp(-.5*(x*x+y*y));float4 s=tex2D(_Clean,saturate(uv+float2(x,y)*radius*.5));
        glow+=max(0,s.rgb-_EffectParams.z)*s.a*w;coverage+=s.a*w;
    }
    float lum=dot(max(0,src.rgb),float3(.2126,.7152,.0722));
    float3 printColor=lerp(float3(.055,.043,.065),float3(1.04,.90,.69),saturate(lum));
    float3 toned=lerp(src.rgb,printColor,_EffectParams.x);
    return float4(max(0,toned+glow/max(coverage,.00001)*_EffectParams.y),src.a);
}
float4 memoryEffect(v2f_img i):SV_Target {return effectMix(i.uv,memoryImage(i.uv));}
