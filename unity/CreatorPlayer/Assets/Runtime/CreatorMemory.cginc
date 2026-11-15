// Linear-light grayscale, with optional highlight diffusion before desaturation.
float4 memoryImage(float2 uv) {
    float4 src=tex2D(_Clean,uv);float3 glow=0;float coverage=0;
    float2 radius=float2(_MainTex_TexelSize.x/abs(_MainTex_TexelSize.y),1)*_EffectParams.w*.01;
    [unroll] for(int y=-2;y<=2;y++) [unroll] for(int x=-2;x<=2;x++) {
        float w=exp(-.5*(x*x+y*y));float4 s=tex2D(_Clean,saturate(uv+float2(x,y)*radius*.5));
        glow+=max(0,s.rgb-_EffectParams.z)*s.a*w;coverage+=s.a*w;
    }
    float3 color=max(0,src.rgb+glow/max(coverage,.00001)*_EffectParams.y);
    float lum=dot(color,float3(.2126,.7152,.0722));
    return float4(lerp(color,lum.xxx,_EffectParams.x),src.a);
}
float4 memoryEffect(v2f_img i):SV_Target {return effectMix(i.uv,memoryImage(i.uv));}
