// Alpha-weighted spatial Gaussian with optional luminance edge protection.
// Preserve the target mask; background softening must not grow actor/UI coverage.
float4 softImage(float2 uv) {
    float4 src=tex2D(_Clean,uv);float3 sum=0;float weights=0;
    float lum=dot(src.rgb,float3(.2126,.7152,.0722));
    float2 radius=float2(_MainTex_TexelSize.x/abs(_MainTex_TexelSize.y),1)*_EffectParams.x*.01;
    [unroll] for(int y=-3;y<=3;y++) [unroll] for(int x=-3;x<=3;x++) {
        float4 s=tex2D(_Clean,saturate(uv+float2(x,y)*radius/3));
        float delta=abs(dot(s.rgb,float3(.2126,.7152,.0722))-lum);
        float w=exp(-.35*(x*x+y*y)-delta*_EffectParams.y*20)*s.a;
        sum+=s.rgb*w;weights+=w;
    }
    return float4(sum/max(weights,.00001),src.a);
}
float4 softEffect(v2f_img i):SV_Target {return effectMix(i.uv,softImage(i.uv));}
