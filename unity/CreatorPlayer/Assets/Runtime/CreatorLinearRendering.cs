using System;
using System.Linq;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.SceneManagement;

// Integrates the validated static research passes. Lighting and post are still
// approximations; the original game runtime components are not present.
public sealed class CreatorLinearRendering : IDisposable {
    readonly CreatorSceneLightingFeature sceneFeature;
    readonly Camera camera;
    readonly Volume volume;
    readonly VolumeProfile profile;
    readonly Tonemapping tone;
    readonly Bloom bloom;
    readonly ColorAdjustments colorAdjustments;
    CreatorRenderSettings settings=new CreatorRenderSettings();
    public CreatorRenderSettings Settings=>settings;
    readonly Light fallbackLight;
    Light sceneLight;
    bool is2D,sceneVisible=true;
    public CreatorLinearRendering(Camera camera,CreatorSceneLightingFeature feature,Light fallbackLight,AssetBundle shaders) {
        this.camera=camera;sceneFeature=feature;this.fallbackLight=fallbackLight;
        ConfigureCamera(camera);
        var native=shaders.LoadAllAssets<Shader>();
        sceneFeature.originalShader=native.FirstOrDefault(s=>s.name=="Hidden/Campus/StencilDeferred");
        sceneFeature.aoShader=native.FirstOrDefault(s=>s.name=="Hidden/VL/ScreenSpaceAmbientOcclusion");
        sceneFeature.targetCameraName="";sceneFeature.SetActive(false);
        volume=new GameObject("Creator Linear Post").AddComponent<Volume>();SceneManager.MoveGameObjectToScene(volume.gameObject,camera.gameObject.scene);
        volume.isGlobal=true;volume.priority=10000;profile=ScriptableObject.CreateInstance<VolumeProfile>();volume.sharedProfile=profile;
        tone=profile.Add<Tonemapping>(true);tone.mode.Override(TonemappingMode.Neutral);
        bloom=profile.Add<Bloom>(true);bloom.threshold.Override(1f);bloom.intensity.Override(.15f);
        colorAdjustments=profile.Add<ColorAdjustments>(true);colorAdjustments.postExposure.Override(0);
        Shader.SetGlobalVector("_GlobalLightParameter",Vector4.zero);Shader.SetGlobalColor("_VLEyeSpecColor",Color.black);
        foreach(var n in new[]{"_VLFogParams","_VLFogSphere","_VLFogColor","_VLFogSphereColor"})Shader.SetGlobalVector(n,Vector4.zero);
        RenderPipelineManager.beginCameraRendering += RenderHairShadows;
    }
    void RenderHairShadows(ScriptableRenderContext context,Camera target) => ActorHairShadow.Render(context,target,settings.shadows);
    public static void ConfigureCamera(Camera camera,CreatorRenderSettings settings=null) {
        settings=settings??new CreatorRenderSettings();settings.Validate();
        camera.allowHDR=true;camera.allowMSAA=settings.MsaaSamples>1;
        var pipeline=GraphicsSettings.currentRenderPipeline as UniversalRenderPipelineAsset;
        if(pipeline&&pipeline.msaaSampleCount!=settings.MsaaSamples)pipeline.msaaSampleCount=settings.MsaaSamples;
        var data=camera.GetUniversalAdditionalCameraData();data.renderPostProcessing=true;
        data.antialiasing=settings.UsesSmaa?AntialiasingMode.SubpixelMorphologicalAntiAliasing:settings.antialiasing==1?AntialiasingMode.FastApproximateAntialiasing:AntialiasingMode.None;data.antialiasingQuality=AntialiasingQuality.High;
        if(!camera.GetComponent<ActorEyeHighlightBinding>())camera.gameObject.AddComponent<ActorEyeHighlightBinding>();
        camera.GetComponent<ActorEyeHighlightBinding>().highlightColor=Color.white*settings.eyeHighlight;
    }
    public static void PrepareActor(GameObject actor) {
        foreach(var r in actor.GetComponentsInChildren<Renderer>(true)) {
            var mats=r.sharedMaterials.Where(m=>m).ToArray();
            // Rebuilt face decals/round eyes keep their ordinary URP pass.
            if(mats.Length>0&&mats.All(m=>m.shader&&m.shader.name=="Campus/Actor/Default"))r.gameObject.layer=30;
        }
    }
    public void ClearScene() {
        sceneFeature.SetActive(false);sceneFeature.ReleaseTargets();sceneFeature.researchDecals.Clear();
        sceneFeature.reflectionProbes=Array.Empty<ReflectionProbe>();sceneLight=null;
        UpdateBackground(is2D,false);
    }
    public void SetScene(Scene scene) {
        sceneFeature.SetActive(false);sceneFeature.ReleaseTargets();sceneFeature.researchDecals.Clear();
        var roots=scene.GetRootGameObjects();
        foreach(var v in roots.SelectMany(r=>r.GetComponentsInChildren<Volume>(true)))v.enabled=false;
        var lights=roots.SelectMany(r=>r.GetComponentsInChildren<Light>(true)).ToArray();
        sceneLight=lights.FirstOrDefault(l=>l.enabled&&l.gameObject.activeInHierarchy&&l.type==LightType.Directional);
        var supported=new[]{"Environment/Default","Environment/Vegetation","Environment/Emission","Environment/SimpleWater"};
        if(!sceneFeature.originalShader||!sceneFeature.aoShader)throw new Exception("场景渲染 Shader 不完整，请通过新版宿主启动并准备资源");
        foreach(var r in roots.SelectMany(r=>r.GetComponentsInChildren<Renderer>(true))) {
            var mats=r.sharedMaterials.Where(m=>m).ToArray();
            if(mats.Length>0&&mats.All(m=>m.renderQueue<=2500&&m.shader&&supported.Contains(m.shader.name)))r.gameObject.layer=31;
        }
        sceneFeature.nativeEnabled=true;sceneFeature.useGI=true;sceneFeature.setScreenToWorld=true;
        sceneFeature.indirectScale=.85f;sceneFeature.indirectTint=Vector3.one;
        sceneFeature.lightDirection=sceneLight?-sceneLight.transform.forward:Vector3.up;
        sceneFeature.directStrength=sceneLight?sceneLight.intensity:0;
        sceneFeature.directColor=sceneLight?(GraphicsSettings.lightsUseLinearIntensity?sceneLight.color.linear:sceneLight.color):Color.white;
        sceneFeature.shadowEnabled=sceneLight;sceneFeature.researchFixEmptyShadowFade=true;
        sceneFeature.aoEnabled=true;sceneFeature.aoUseOriginalChannel=true;sceneFeature.aoStrength=.5f;
        // Original projector masks remain the explicit candidate, never the old guessed shift.
        sceneFeature.researchDecalUseOriginalMask=true;sceneFeature.researchDecalsEnabled=true;
        sceneFeature.researchDecals.AddRange(roots.SelectMany(r=>r.GetComponentsInChildren<DecalProjector>(true)).Where(d=>d&&d.isActiveAndEnabled));
        sceneFeature.reflectionProbes=roots.SelectMany(r=>r.GetComponentsInChildren<ReflectionProbe>(true)).ToArray();
        sceneFeature.SetActive(true);Apply(settings);
    }
    public void Apply(CreatorRenderSettings value){
        value.Validate();settings=value;ConfigureCamera(camera,settings);
        sceneFeature.directStrength=(sceneLight?sceneLight.intensity:0)*settings.directLight;
        sceneFeature.indirectScale=settings.indirectLight;sceneFeature.emissionScale=settings.emission;
        SceneNativeLighting.SetLightmapScale(settings.indirectLight);
        sceneFeature.shadowEnabled=settings.shadows&&sceneLight;
        sceneFeature.aoEnabled=settings.ao;sceneFeature.aoStrength=settings.aoStrength;sceneFeature.aoRadius=settings.aoRadius;
        sceneFeature.researchDecalsEnabled=settings.decals;
        sceneFeature.ssrIntensity=settings.reflectionIntensity;sceneFeature.ssrSmoothness=settings.reflectionSmoothness;
        sceneFeature.ssrDistance=settings.ssrDistance;sceneFeature.ssrThickness=settings.ssrThickness;sceneFeature.ssrQuality=settings.ssrQuality;
        tone.mode.Override(settings.tonemapping==2?TonemappingMode.ACES:TonemappingMode.Neutral);
        bloom.intensity.Override(settings.bloomIntensity);bloom.threshold.Override(settings.bloomThreshold);colorAdjustments.postExposure.Override(settings.exposure);
        UpdateBackground(is2D,sceneVisible);
    }
    public void UpdateBackground(bool fixedImage,bool visible) {
        is2D=fixedImage;sceneVisible=visible;
        // A display-ready 2D illustration must not be tone-mapped a second time.
        tone.active=!is2D&&settings.tonemapping!=0;bloom.active=!is2D&&settings.bloom;colorAdjustments.active=!is2D;
        sceneFeature.reflectionsEnabled=settings.reflections&&!is2D&&visible;sceneFeature.probesEnabled=settings.reflectionProbes;sceneFeature.ssrEnabled=settings.ssr;
        if(fallbackLight)fallbackLight.enabled=!sceneLight||is2D||!visible;
        camera.clearFlags=!is2D&&visible&&sceneLight?CameraClearFlags.Skybox:CameraClearFlags.SolidColor;
    }
    public static Texture2D ReadDisplay(RenderTexture rt, bool gpuColor=false) {
        var old=RenderTexture.active;
        if(gpuColor) {
            RenderTexture converted=null;Texture2D image=null;var oldSrgb=GL.sRGBWrite;
            try {
                // GPU hardware sRGB encoding into an 8-bit target; keep the PNG
                // exit unchanged so this path can be compared independently.
                converted=RenderTexture.GetTemporary(rt.width,rt.height,0,RenderTextureFormat.ARGB32,RenderTextureReadWrite.sRGB);
                converted.filterMode=FilterMode.Point;
                using(CreatorExportProfiler.Measure("gpuConvertMs")){GL.sRGBWrite=true;Graphics.Blit(rt,converted);}
                RenderTexture.active=converted;
                image=new Texture2D(rt.width,rt.height,TextureFormat.RGBA32,false,true);
                using(CreatorExportProfiler.Measure("readPixels8Ms"))image.ReadPixels(new Rect(0,0,rt.width,rt.height),0,0);
                using(CreatorExportProfiler.Measure("apply8Ms"))image.Apply();
                return image;
            }finally{GL.sRGBWrite=oldSrgb;RenderTexture.active=old;if(converted)RenderTexture.ReleaseTemporary(converted);}
        }
        Texture2D linear=null;
        try {
            RenderTexture.active=rt;using(CreatorExportProfiler.Measure("floatTextureMs"))linear=new Texture2D(rt.width,rt.height,TextureFormat.RGBAFloat,false,true);
            using(CreatorExportProfiler.Measure("readPixelsMs"))linear.ReadPixels(new Rect(0,0,rt.width,rt.height),0,0);using(CreatorExportProfiler.Measure("floatApplyMs"))linear.Apply();
            Color[] pixels;using(CreatorExportProfiler.Measure("getPixelsMs"))pixels=linear.GetPixels();
            using(CreatorExportProfiler.Measure("gammaMs")){for(int i=0;i<pixels.Length;i++){var p=pixels[i];pixels[i]=new Color(Mathf.LinearToGammaSpace(p.r),Mathf.LinearToGammaSpace(p.g),Mathf.LinearToGammaSpace(p.b),p.a);}}
            Texture2D result;using(CreatorExportProfiler.Measure("rgbTextureMs")){result=new Texture2D(rt.width,rt.height,TextureFormat.RGB24,false);result.SetPixels(pixels);}using(CreatorExportProfiler.Measure("rgbApplyMs"))result.Apply();return result;
        }finally{RenderTexture.active=old;if(linear)UnityEngine.Object.Destroy(linear);}
    }
    public void Dispose(){RenderPipelineManager.beginCameraRendering-=RenderHairShadows;sceneFeature.SetActive(false);sceneFeature.ReleaseTargets();if(volume)UnityEngine.Object.Destroy(volume.gameObject);if(profile)UnityEngine.Object.Destroy(profile);}
}
