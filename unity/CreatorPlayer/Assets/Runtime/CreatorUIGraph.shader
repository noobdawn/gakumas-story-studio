Shader "Creator/UIGraph" {
 Properties { _MainTex("Image",2D)="white"{} _Mask1("Mask 1",2D)="white"{} _Mask2("Mask 2",2D)="white"{} _Color("Tint",Color)=(1,1,1,1) }
 SubShader {
  Cull Off ZWrite Off ZTest Always
  Pass {
   Blend SrcAlpha OneMinusSrcAlpha, One OneMinusSrcAlpha
   CGPROGRAM
   #pragma vertex vert
   #pragma fragment frag
   #include "UnityCG.cginc"
   sampler2D _MainTex,_Mask1,_Mask2;float4 _Color,_Mask1A,_Mask1B,_Mask2A,_Mask2B;float _MaskCount,_Invert,_LinearInput,_AlphaOnly;
   struct Input {float4 vertex:POSITION;float2 uv:TEXCOORD0;};
   struct Vary {float4 vertex:SV_POSITION;float2 uv:TEXCOORD0;float2 screen:TEXCOORD1;};
   Vary vert(Input v){Vary o;o.vertex=UnityObjectToClipPos(v.vertex);o.uv=v.uv;o.screen=v.vertex.xy;return o;}
   float sampleMask(sampler2D tex,float2 screen,float4 a,float4 b){float2 p=float2(dot(float3(screen,1),a.xyz),dot(float3(screen,1),b.xyz));float inside=step(0,p.x)*step(p.x,1)*step(0,p.y)*step(p.y,1);return tex2D(tex,p).a*inside;}
   fixed4 frag(Vary i):SV_Target {float4 c=tex2D(_MainTex,i.uv);if(_AlphaOnly>0)c.rgb=1;if(_LinearInput>0)c.rgb=LinearToGammaSpace(c.rgb);c*=_Color;if(_MaskCount>0){float m=sampleMask(_Mask1,i.screen,_Mask1A,_Mask1B);if(_MaskCount>1)m=max(m,sampleMask(_Mask2,i.screen,_Mask2A,_Mask2B));c.a*=_Invert>0?1-m:m;}return c;}
   ENDCG
  }
  Pass {
   Blend Off
   CGPROGRAM
   #pragma vertex vert_img
   #pragma fragment frag
   #include "UnityCG.cginc"
   sampler2D _MainTex;
   float4 frag(v2f_img i):SV_Target{float4 c=tex2D(_MainTex,i.uv);return float4(c.a>0.00001?c.rgb/c.a:0,c.a);}
   ENDCG
  }
 }
}
