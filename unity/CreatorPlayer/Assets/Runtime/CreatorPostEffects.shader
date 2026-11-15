Shader "Hidden/Creator/StoryEffects" {
 Properties {_MainTex("Source",2D)="white"{}}
 SubShader {Cull Off ZWrite Off ZTest Always
 CGINCLUDE
 #include "UnityCG.cginc"
 sampler2D _MainTex,_Clean,_Lower,_Background,_Actors,_Black,_White,_Right;
 float4 _MainTex_TexelSize,_Params,_TextureParams;
 float _Strength,_Weight,_Seed,_StoryTime,_Progress,_TransitionKind;
 float4 _EffectParams,_EffectParams2;
 // Intermediate textures are straight-alpha, linear ARGBHalf. Interpolation
 // across displaced coverage is premultiplied, then converted back to straight.
 float4 alphaMix(float4 a,float4 b,float w){float alpha=lerp(a.a,b.a,w);return float4(lerp(a.rgb*a.a,b.rgb*b.a,w)/max(alpha,.00001),alpha);}
 float4 effectMix(float2 uv,float4 processed){float4 src=tex2D(_Clean,uv);return alphaMix(tex2D(_Lower,uv),alphaMix(src,processed,_Strength),_Weight);}
 #include "CreatorMemory.cginc"
 #include "CreatorThought.cginc"
 #include "CreatorTelevision.cginc"
 #include "CreatorSoft.cginc"
 float4 copyLayer(v2f_img i):SV_Target {return tex2D(_MainTex,i.uv);}
 float mask(float2 uv){float3 diff=tex2D(_White,uv).rgb-tex2D(_Black,uv).rgb;return saturate(1-dot(diff,float3(.333333,.333333,.333333)));}
 float4 foreground(v2f_img i):SV_Target {float a=mask(i.uv);float3 full=tex2D(_MainTex,i.uv).rgb,bg=tex2D(_Background,i.uv).rgb;return float4(max(0,(full-bg*(1-a))/max(a,.0001)),a);}
 float4 combine(v2f_img i):SV_Target {float a=mask(i.uv);float3 full=tex2D(_MainTex,i.uv).rgb,bg=tex2D(_Background,i.uv).rgb,fg=tex2D(_Actors,i.uv).rgb;float3 cleanBg=tex2D(_Clean,i.uv).rgb;float3 cleanFg=max(0,(full-cleanBg*(1-a))/max(a,.0001));float movedAlpha=tex2D(_Actors,i.uv).a;return float4(max(0,full-cleanBg*(1-a)-cleanFg*a+bg*(1-movedAlpha)+fg*movedAlpha),1);}
 float4 clipTransition(v2f_img i):SV_Target {
   float4 a=tex2D(_MainTex,i.uv),b=tex2D(_Right,i.uv);float p=saturate(_Progress);
   if(_TransitionKind>1.5)return i.uv.x<p?b:a;
   if(_TransitionKind>.5){if(p<.5){a.rgb*=1-p*2;return a;}b.rgb*=p*2-1;return b;}
   float alpha=lerp(a.a,b.a,p);float3 premult=lerp(a.rgb*a.a,b.rgb*b.a,p);return float4(premult/max(alpha,.00001),alpha);
 }
 ENDCG
 Pass {CGPROGRAM
 #pragma vertex vert_img
 #pragma target 3.0
 #pragma fragment memoryEffect
 ENDCG}
 Pass {Blend SrcAlpha OneMinusSrcAlpha, One OneMinusSrcAlpha
 CGPROGRAM
 #pragma vertex vert_img
 #pragma fragment copyLayer
 ENDCG}
 Pass {CGPROGRAM
 #pragma vertex vert_img
 #pragma fragment foreground
 ENDCG}
 Pass {CGPROGRAM
 #pragma vertex vert_img
 #pragma fragment combine
 ENDCG}
 Pass {CGPROGRAM
 #pragma vertex vert_img
 #pragma fragment clipTransition
 ENDCG}
 Pass {CGPROGRAM
 #pragma target 3.0
 #pragma vertex vert_img
 #pragma fragment televisionEffect
 ENDCG}
 Pass {CGPROGRAM
 #pragma target 3.0
 #pragma vertex vert_img
 #pragma fragment softEffect
 ENDCG}
 Pass {CGPROGRAM
 #pragma target 3.0
 #pragma vertex vert_img
 #pragma fragment thoughtEffect
 ENDCG}

 }
}
