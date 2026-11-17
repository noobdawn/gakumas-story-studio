using System;

[Serializable]
public sealed class CreatorRenderSettings {
    public float eyeHighlight=1,directLight=1,indirectLight=.85f,emission=1;
    public bool shadows=true,decals=true,ao=true,reflections=true,reflectionProbes=true,ssr=false,bloom=true;
    public float aoStrength=.5f,aoRadius=.5f,reflectionIntensity=1,reflectionSmoothness=.6f,ssrDistance=25,ssrThickness=.2f;
    public int ssrQuality=1,tonemapping=1,antialiasing=2;
    // Keep the existing 0/1/2 project values: None, FXAA, SMAA High.
    public int MsaaSamples=>antialiasing==3?2:antialiasing==4||antialiasing==6?4:antialiasing==5?8:1;
    public bool UsesSmaa=>antialiasing==2||antialiasing==6;
    public float exposure=0,bloomIntensity=.15f,bloomThreshold=1;
    static bool Range(float v,float lo,float hi)=>!float.IsNaN(v)&&!float.IsInfinity(v)&&v>=lo&&v<=hi;
    public void Validate(){
        if(!Range(eyeHighlight,0,3)||!Range(directLight,0,3)||!Range(indirectLight,0,3)||!Range(emission,0,3)||!Range(aoStrength,0,1)||!Range(aoRadius,.05f,2)||!Range(reflectionIntensity,0,2)||!Range(reflectionSmoothness,0,.99f)||!Range(ssrDistance,1,100)||!Range(ssrThickness,.01f,1)||ssrQuality<0||ssrQuality>2||tonemapping<0||tonemapping>2||antialiasing<0||antialiasing>6||!Range(exposure,-4,4)||!Range(bloomIntensity,0,2)||!Range(bloomThreshold,0,5))throw new Exception("渲染参数无效");
    }
}
