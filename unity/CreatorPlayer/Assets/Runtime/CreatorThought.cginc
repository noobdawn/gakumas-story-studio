// Screen-space elliptical vignette; the center and source coverage stay intact.
float4 thoughtEffect(v2f_img i):SV_Target {
    float4 src=tex2D(_Clean,i.uv);
    float distanceFromCenter=length((i.uv-.5)*2);
    float edge=smoothstep(_EffectParams.x,_EffectParams.x+_EffectParams.y,distanceFromCenter);
    return effectMix(i.uv,float4(src.rgb*(1-edge*_EffectParams.z),src.a));
}
