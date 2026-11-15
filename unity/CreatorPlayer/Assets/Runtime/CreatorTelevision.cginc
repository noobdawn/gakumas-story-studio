// Stateless analog signal approximation. All clocks derive from story time.
// Hash controls coherent row/block signals, never full-screen pixel static.
float signalHash(float2 p){p=frac(p*float2(.1031,.11369));p+=dot(p,p.yx+19.19);return frac((p.x+p.y)*p.x);}
float rowSignal(float row,float tick){float a=signalHash(float2(row+_Seed,tick)),b=signalHash(float2(row+_Seed,tick+1));return lerp(a,b,smoothstep(0,1,frac(_StoryTime*24)))*2-1;}
float3 toYIQ(float3 c){return float3(dot(c,float3(.299,.587,.114)),dot(c,float3(.596,-.274,-.322)),dot(c,float3(.211,-.523,.312)));}
float3 fromYIQ(float3 c){return float3(c.x+.956*c.y+.621*c.z,c.x-.272*c.y-.647*c.z,c.x-1.106*c.y+1.703*c.z);}
float4 televisionImage(float2 uv) {
    float tick=floor(_StoryTime*24),row=floor(uv.y*480);
    float phase=frac(uv.y-_StoryTime*_EffectParams.w+signalHash(float2(_Seed,7)));
    float distanceToBand=min(phase,1-phase);
    float band=1-smoothstep(_EffectParams.z*.15,_EffectParams.z*.5,distanceToBand);
    float coherent=rowSignal(floor(row/6),tick);
    float shift=_EffectParams.x*(coherent*.006+sin(uv.y*36+_StoryTime*4)*.002);
    shift+=band*_EffectParams.y*(.025+.012*sin(uv.y*180+_StoryTime*9));
    float2 displaced=float2(saturate(uv.x+shift),uv.y);
    float4 src=tex2D(_Clean,displaced);
    float offset=_EffectParams2.x*(.0025+band*.007);
    float4 left=tex2D(_Clean,saturate(displaced-float2(offset,0))),right=tex2D(_Clean,saturate(displaced+float2(offset,0)));
    float3 center=toYIQ(LinearToGammaSpace(max(0,src.rgb)));
    // Transparent neighbors cannot inject their hidden RGB into chroma.
    float3 lc=toYIQ(LinearToGammaSpace(max(0,lerp(src.rgb,left.rgb,saturate(left.a/max(src.a,.00001))))));
    float3 rc=toYIQ(LinearToGammaSpace(max(0,lerp(src.rgb,right.rgb,saturate(right.a/max(src.a,.00001))))));
    center.y=lc.y;center.z=rc.z;
    float block=signalHash(float2(floor(uv.x*160)+floor(_StoryTime*30),row+_Seed))-.5;
    center.x=center.x*(1-band*_EffectParams.y*.22)+block*_EffectParams2.y*(.025+band*.12);
    return float4(GammaToLinearSpace(saturate(fromYIQ(center))),src.a);
}
float4 televisionEffect(v2f_img i):SV_Target {return effectMix(i.uv,televisionImage(i.uv));}
