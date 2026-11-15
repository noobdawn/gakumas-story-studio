using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Experimental.Rendering;
using UnityEngine.Rendering;
using UnityEngine.Rendering.RenderGraphModule;
using UnityEngine.Rendering.Universal;

// Research-only opaque replacement. Original runtime bindings, stencil,
// shadows, AO composition, reflections, and temporal effects are not restored.
public sealed partial class CreatorSceneLightingFeature : ScriptableRendererFeature
{
    public bool nativeEnabled;
    public string targetCameraName = "Audit Camera";
    public bool useGI = true;
    public bool fullSizeBlackGI;
    public Color fullSizeFallbackGI = Color.black;
    public float indirectScale = .85f;
    public Vector3 indirectTint = Vector3.one;
    public float directStrength = .2f; public Color directColor = Color.white;
    public bool setScreenToWorld;
    public bool pointEnabled;
    public Vector3 pointPosition;
    public Color pointColor = Color.white;
    public float pointRange = 3f;
    public struct PointSample
    {
        public Vector3 position;
        public Color color;
        public float range;
        public bool isSpot;
        public Vector3 direction;
        public float innerSpotAngle, outerSpotAngle;
    }
    public readonly List<PointSample> pointLights = new List<PointSample>();
    public float emissionScale = 1f;
    public Vector3 lightDirection = Vector3.up;
    public Shader originalShader;
    public Shader overlayShader;
    public Shader aoShader,normalEncodeShader,shadowAOCombineShader;
    public Shader screenShadowShader;
    public bool shadowEnabled;
    // Opt-in research path: original DepthID and decal projector passes.
    public bool researchDecalsEnabled;
    [Range(0,24)] public int researchDecalMaskShift=4;
    public bool researchDecalUseOriginalMask=true;
    public readonly List<DecalProjector> researchDecals = new List<DecalProjector>();
    public float shadowDebugMode;
    public bool researchOverrideShadowParams;
    // Opt-in workaround for the tested URP 17 empty-shadowmap fade discrepancy.
    public bool researchFixEmptyShadowFade;
    public Vector4 researchShadowParams,researchRestoreShadowParams;
    public Texture2D screenShadowOverride;
    public bool aoEnabled;
    public bool aoUseOriginalChannel;
    public float aoRadius=.5f,aoIntensity=1f,aoFalloff=20f,aoStrength=1f;
    public static readonly List<string> Observations = new List<string>();
    public static readonly Dictionary<string, RenderTexture> Outputs = new Dictionary<string, RenderTexture>();
    public static int LightingExecutions;
    public static int AOExecutions;
    public static int ShadowExecutions;
    public static int DecalExecutions;
    readonly string[] names = { "slot0-albedo", "slot1-material", "slot2-normal-id", "slot3-gi-hypothesis", "slot4-emission-hypothesis" };
    readonly GraphicsFormat[] formats = { GraphicsFormat.R8G8B8A8_SRGB, GraphicsFormat.R8G8B8A8_UNorm,
        GraphicsFormat.R16G16B16A16_SFloat, GraphicsFormat.B10G11R11_UFloatPack32, GraphicsFormat.B10G11R11_UFloatPack32 };
    readonly List<RTHandle> handles = new List<RTHandle>();
    RenderTexture geometryDepth, lightingColor, lightingDepth;
    RTHandle geometryDepthHandle, lightingHandle, lightingDepthHandle, whiteHandle, blackHandle, fullBlackHandle;
    RTHandle encodedNormalHandle,aoHandle,aoBlurHandle,aoFinalHandle,shadowAOHandle;
    RTHandle screenShadowHandle;
    RTHandle depthIdHandle,depthIdDepthHandle;
    RenderTexture depthIdDepth;
    Texture2D fullBlackTexture;
    Material originalMaterial, pointMaterial, overlayMaterial,aoMaterial,normalEncodeMaterial,shadowAOCombineMaterial,screenShadowMaterial;
    Mesh triangle, sphere, decalCube;
    StudyPass pass;
    int targetWidth, targetHeight;

    sealed class StudyPass : ScriptableRenderPass
    {
        readonly CreatorSceneLightingFeature owner;
        delegate void ShadowFade(float distance, float border, out float scale, out float bias);
        static readonly ShadowFade urpShadowFade=FindUrpShadowFade();
        static ShadowFade FindUrpShadowFade()
        {
            try {
                var method=typeof(ShadowUtils).GetMethod("GetScaleAndBiasForLinearDistanceFade",System.Reflection.BindingFlags.NonPublic|System.Reflection.BindingFlags.Static);
                return method==null?null:(ShadowFade)Delegate.CreateDelegate(typeof(ShadowFade),method);
            } catch (Exception) { return null; }
        }
        sealed class GeometryData { public RendererListHandle list; public bool overrideShadow; public Vector4 shadowParams,restoreParams; }
        struct DecalDraw { public Matrix4x4 objectToWorld,normalToWorld; public Material material; public int pass,order,sequence; public float mask; }
        sealed class DecalData { public TextureHandle depth,normal; public Mesh cube; public DecalDraw[] draws; }
        sealed class LightData
        {
            public TextureHandle[] inputs;
            public TextureHandle depth, white, black, fullBlack;
            public Material material;
            public Mesh triangle;
            public bool useGI, fullSizeBlackGI;
            public float indirect, direct;
            public Vector3 direction, tint; public Color color;
            public bool setScreenToWorld;
            public Matrix4x4 screenToWorld;
            public int width, height;
        }
        sealed class OverlayData { public TextureHandle light, emission, depth, ao; public Material material; public float emissionScale,aoStrength; }
        sealed class NormalData { public TextureHandle source; public Material material; }
        sealed class AOBlurData { public TextureHandle source; public Material material; public int width,height,shaderPass; public Vector4 parameters; }
        sealed class ShadowAOData { public TextureHandle shadow,ao; public Material material; public float strength; }
        sealed class ShadowData { public TextureHandle depth,shadowMap; public Material material; public float debug; }
        sealed class AOData
        {
            public TextureHandle depth,normal;
            public Material material;
            public Vector4 topLeft,xExtent,yExtent,zExtent,parameters;
            public Matrix4x4 viewProjection;
            public int width,height;
            public float near;
        }
        sealed class PointData
        {
            public TextureHandle[] inputs;
            public TextureHandle depth, white;
            public Material material;
            public Mesh sphere;
            public PointSample[] points;
            public Matrix4x4 screenToWorld;
            public int width, height;
        }
        public StudyPass(CreatorSceneLightingFeature owner) { this.owner = owner; renderPassEvent = RenderPassEvent.AfterRenderingOpaques; }
        public override void RecordRenderGraph(RenderGraph graph, ContextContainer frame)
        {
            var camera = frame.Get<UniversalCameraData>();
            if (!camera.camera || (!string.IsNullOrEmpty(owner.targetCameraName) && camera.camera.name != owner.targetCameraName)) return;
            owner.EnsureTargets(camera.cameraTargetDescriptor.width,camera.cameraTargetDescriptor.height);
            var rendering = frame.Get<UniversalRenderingData>();
            var lightData = frame.Get<UniversalLightData>();
            var tags = new List<ShaderTagId> { new ShaderTagId("UniversalGBuffer") };
            var drawing = RenderingUtils.CreateDrawingSettings(tags, rendering, camera, lightData, camera.defaultOpaqueSortFlags);
            var filter = new FilteringSettings(RenderQueueRange.opaque, 1 << 31);
            var list = graph.CreateRendererList(new RendererListParams(rendering.cullResults, drawing, filter));
            var mainShadow=frame.Get<UniversalResourceData>().mainShadowsTexture;
            var shadowData=frame.Get<UniversalShadowData>();
            bool autoFix=false;Vector4 fixedParams=default,emptyParams=default;
            if(owner.nativeEnabled&&owner.researchFixEmptyShadowFade&&urpShadowFade!=null&&mainShadow.IsValid()&&lightData.mainLightIndex>=0&&lightData.mainLightIndex<lightData.visibleLights.Length){
                var desc=graph.GetTextureDesc(mainShadow);var main=lightData.visibleLights[lightData.mainLightIndex].light;
                float distance=camera.maxShadowDistance,border=shadowData.mainLightShadowCascadeBorder;
                if(desc.width==1&&desc.height==1&&main&&main.shadows!=LightShadows.None&&main.bakingOutput.lightmapBakeType==LightmapBakeType.Mixed&&main.bakingOutput.mixedLightingMode==MixedLightingMode.Shadowmask&&!shadowData.supportsSoftShadows&&distance>1f){
                    // Invoke the installed URP helper itself; if unavailable the guarded
                    // experiment stays off rather than approximating a restore value.
                    urpShadowFade(distance*distance,border,out float fullScale,out float fullBias);
                    urpShadowFade(distance,border,out float emptyScale,out float emptyBias);
                    fixedParams=new Vector4(main.shadowStrength,0,fullScale,fullBias);emptyParams=new Vector4(main.shadowStrength,0,emptyScale,emptyBias);autoFix=true;
                }
            }
            using (var builder = graph.AddRasterRenderPass<GeometryData>("Research native GBuffer", out var data))
            {
                data.list = list; builder.UseRendererList(list);
                data.overrideShadow=owner.researchOverrideShadowParams||autoFix;
                data.shadowParams=owner.researchOverrideShadowParams?owner.researchShadowParams:fixedParams;
                data.restoreParams=owner.researchOverrideShadowParams?owner.researchRestoreShadowParams:emptyParams;
                if(autoFix)builder.UseTexture(mainShadow,AccessFlags.Read);
                if(data.overrideShadow)builder.AllowGlobalStateModification(true);
                for (int i = 0; i < 5; ++i) builder.SetRenderAttachment(graph.ImportTexture(owner.handles[i]), i, AccessFlags.Write);
                builder.SetRenderAttachmentDepth(graph.ImportTexture(owner.geometryDepthHandle), AccessFlags.Write);
                builder.AllowPassCulling(false);
                builder.SetRenderFunc(static (GeometryData data, RasterGraphContext ctx) => {
                    ctx.cmd.ClearRenderTarget(RTClearFlags.All, Color.clear, 1f, 0);
                    if(data.overrideShadow)ctx.cmd.SetGlobalVector("_MainLightShadowParams",data.shadowParams);
                    ctx.cmd.DrawRendererList(data.list);
                    if(data.overrideShadow)ctx.cmd.SetGlobalVector("_MainLightShadowParams",data.restoreParams);
                });
            }
            if (!owner.nativeEnabled) return;
            owner.EnsureMaterials();
            if(owner.researchDecalsEnabled && owner.researchDecals.Count>0){
                owner.EnsureDecals();
                var depthDraw=RenderingUtils.CreateDrawingSettings(new List<ShaderTagId>{new ShaderTagId("DepthID")},rendering,camera,lightData,camera.defaultOpaqueSortFlags);
                var depthList=graph.CreateRendererList(new RendererListParams(rendering.cullResults,depthDraw,filter));
                using(var builder=graph.AddRasterRenderPass<GeometryData>("Research original DepthID",out var data)){
                    data.list=depthList;builder.UseRendererList(depthList);
                    builder.SetRenderAttachment(graph.ImportTexture(owner.depthIdHandle),0,AccessFlags.Write);
                    builder.SetRenderAttachmentDepth(graph.ImportTexture(owner.depthIdDepthHandle),AccessFlags.Write);builder.AllowPassCulling(false);
                    builder.SetRenderFunc(static (GeometryData d,RasterGraphContext ctx)=>{ctx.cmd.ClearRenderTarget(RTClearFlags.All,Color.clear,1f,0);ctx.cmd.DrawRendererList(d.list);});
                }
                var draws=BuildDecalDraws(owner.researchDecals,camera.camera,owner.researchDecalMaskShift,owner.researchDecalUseOriginalMask);
                using(var builder=graph.AddRasterRenderPass<DecalData>("Research original decal projectors",out var data)){
                    data.depth=graph.ImportTexture(owner.depthIdDepthHandle);builder.UseTexture(data.depth,AccessFlags.Read);
                    data.normal=graph.ImportTexture(owner.depthIdHandle);builder.UseTexture(data.normal,AccessFlags.Read);
                    data.cube=owner.decalCube;data.draws=draws;
                    for(int i=0;i<5;i++)builder.SetRenderAttachment(graph.ImportTexture(owner.handles[i]),i,AccessFlags.ReadWrite);
                    builder.SetRenderAttachmentDepth(graph.ImportTexture(owner.geometryDepthHandle),AccessFlags.Read);builder.AllowPassCulling(false);
                    builder.SetRenderFunc(static (DecalData d,RasterGraphContext ctx)=>{
                        foreach(var draw in d.draws){
                            var props=new MaterialPropertyBlock();props.SetTexture("_CameraDepthTexture",d.depth);props.SetTexture("_CameraNormalsTexture",d.normal);
                            props.SetMatrix("_NormalToWorld",draw.normalToWorld);props.SetFloat("_DecalLayerMaskFromDecal",draw.mask);
                            ctx.cmd.DrawMesh(d.cube,draw.objectToWorld,draw.material,0,draw.pass,props);
                            System.Threading.Interlocked.Increment(ref DecalExecutions);
                        }
                    });
                }
            }
            RTHandle screenShadow=owner.whiteHandle;
            var mainShadowMap=frame.Get<UniversalResourceData>().mainShadowsTexture;
            if(owner.shadowEnabled&&mainShadowMap.IsValid()){
                owner.EnsureShadow();screenShadow=owner.screenShadowHandle;
                using(var builder=graph.AddRasterRenderPass<ShadowData>("Research main light screen shadow",out var data)){
                    data.depth=graph.ImportTexture(owner.geometryDepthHandle);builder.UseTexture(data.depth,AccessFlags.Read);
                    data.shadowMap=mainShadowMap;builder.UseTexture(data.shadowMap,AccessFlags.Read);data.material=owner.screenShadowMaterial;data.debug=owner.shadowDebugMode;
                    builder.SetRenderAttachment(graph.ImportTexture(owner.screenShadowHandle),0,AccessFlags.Write);builder.AllowPassCulling(false);
                    builder.SetRenderFunc(static (ShadowData data,RasterGraphContext ctx)=>{
                        System.Threading.Interlocked.Increment(ref ShadowExecutions);
                        var props=new MaterialPropertyBlock();props.SetTexture("_ResearchDepth",data.depth);props.SetTexture("_MainLightShadowmapTexture",data.shadowMap);props.SetTexture("_ResearchShadowMap",data.shadowMap);props.SetFloat("_ResearchShadowDebug",data.debug);
                        ctx.cmd.DrawProcedural(Matrix4x4.identity,data.material,0,MeshTopology.Triangles,3,1,props);
                    });
                }
            }
            if(owner.aoEnabled){
                owner.EnsureAO();
                using(var builder=graph.AddRasterRenderPass<NormalData>("Research encoded GBuffer normals",out var data)){
                    data.source=graph.ImportTexture(owner.handles[2]);builder.UseTexture(data.source,AccessFlags.Read);data.material=owner.normalEncodeMaterial;
                    builder.SetRenderAttachment(graph.ImportTexture(owner.encodedNormalHandle),0,AccessFlags.Write);builder.AllowPassCulling(false);
                    builder.SetRenderFunc(static (NormalData data,RasterGraphContext ctx)=>{
                        var props=new MaterialPropertyBlock();props.SetTexture("_ResearchNormal",data.source);
                        ctx.cmd.DrawProcedural(Matrix4x4.identity,data.material,0,MeshTopology.Triangles,3,1,props);
                    });
                }
                using(var builder=graph.AddRasterRenderPass<AOData>("Research original SSAO",out var data)){
                    data.depth=graph.ImportTexture(owner.geometryDepthHandle);builder.UseTexture(data.depth,AccessFlags.Read);
                    data.normal=graph.ImportTexture(owner.encodedNormalHandle);builder.UseTexture(data.normal,AccessFlags.Read);
                    data.material=owner.aoMaterial;data.width=owner.targetWidth;data.height=owner.targetHeight;data.near=camera.camera.nearClipPlane;
                    data.parameters=new Vector4(owner.aoIntensity,owner.aoRadius,1,owner.aoFalloff);
                    var view=camera.GetViewMatrix();var projection=camera.GetProjectionMatrix();data.viewProjection=projection*view;
                    view.SetColumn(3,new Vector4(0,0,0,1));var inverse=(projection*view).inverse;
                    var tl=inverse.MultiplyPoint(new Vector4(-1,1,-1,1));var tr=inverse.MultiplyPoint(new Vector4(1,1,-1,1));
                    var bl=inverse.MultiplyPoint(new Vector4(-1,-1,-1,1));var far=inverse.MultiplyPoint(new Vector4(0,0,1,1));
                    data.topLeft=tl;data.xExtent=tr-tl;data.yExtent=bl-tl;data.zExtent=far;
                    builder.SetRenderAttachment(graph.ImportTexture(owner.aoHandle),0,AccessFlags.Write);builder.AllowPassCulling(false);
                    builder.SetRenderFunc(static (AOData data,RasterGraphContext ctx)=>{
                        System.Threading.Interlocked.Increment(ref AOExecutions);
                        var props=new MaterialPropertyBlock();props.SetTexture("_CameraDepthTexture",data.depth);props.SetTexture("_CameraNormalsTexture",data.normal);
                        props.SetVector("_BlitScaleBias",new Vector4(1,1,0,0));props.SetVector("_SSAOParams",data.parameters);
                        props.SetVector("_ProjectionParams2",new Vector4(1f/data.near,0,0,0));
                        props.SetVector("_CameraDepthTexture_TexelSize",new Vector4(1f/data.width,1f/data.height,data.width,data.height));
                        props.SetVectorArray("_CameraViewTopLeftCorner",new[]{data.topLeft,data.topLeft});
                        props.SetVectorArray("_CameraViewXExtent",new[]{data.xExtent,data.xExtent});props.SetVectorArray("_CameraViewYExtent",new[]{data.yExtent,data.yExtent});
                        props.SetVectorArray("_CameraViewZExtent",new[]{data.zExtent,data.zExtent});props.SetMatrixArray("_CameraViewProjections",new[]{data.viewProjection,data.viewProjection});
                        ctx.cmd.DrawProcedural(Matrix4x4.identity,data.material,0,MeshTopology.Triangles,3,1,props);
                    });
                }
                for(int blurPass=0;blurPass<2;blurPass++)
                using(var builder=graph.AddRasterRenderPass<AOBlurData>(blurPass==0?"Original SSAO horizontal blur":"Original SSAO vertical blur",out var data)){
                    data.source=graph.ImportTexture(blurPass==0?owner.aoHandle:owner.aoBlurHandle);builder.UseTexture(data.source,AccessFlags.Read);
                    data.material=owner.aoMaterial;data.width=owner.targetWidth;data.height=owner.targetHeight;data.shaderPass=blurPass==0?5:6;
                    data.parameters=new Vector4(owner.aoIntensity,owner.aoRadius,1,owner.aoFalloff);
                    builder.SetRenderAttachment(graph.ImportTexture(blurPass==0?owner.aoBlurHandle:owner.aoFinalHandle),0,AccessFlags.Write);builder.AllowPassCulling(false);
                    builder.SetRenderFunc(static (AOBlurData data,RasterGraphContext ctx)=>{
                        System.Threading.Interlocked.Increment(ref AOExecutions);
                        var props=new MaterialPropertyBlock();props.SetTexture("_BlitTexture",data.source);props.SetVector("_BlitScaleBias",new Vector4(1,1,0,0));
                        props.SetVector("_SSAOParams",data.parameters);props.SetVector("_SourceSize",new Vector4(data.width,data.height,1f/data.width,1f/data.height));
                        ctx.cmd.DrawProcedural(Matrix4x4.identity,data.material,data.shaderPass,MeshTopology.Triangles,3,1,props);
                    });
                }
                if(owner.aoUseOriginalChannel)
                using(var builder=graph.AddRasterRenderPass<ShadowAOData>("Research shadow and AO channels",out var data)){
                    data.shadow=graph.ImportTexture(screenShadow);builder.UseTexture(data.shadow,AccessFlags.Read);
                    data.ao=graph.ImportTexture(owner.aoFinalHandle);builder.UseTexture(data.ao,AccessFlags.Read);
                    data.material=owner.shadowAOCombineMaterial;data.strength=owner.aoStrength;
                    builder.SetRenderAttachment(graph.ImportTexture(owner.shadowAOHandle),0,AccessFlags.Write);builder.AllowPassCulling(false);
                    builder.SetRenderFunc(static (ShadowAOData data,RasterGraphContext ctx)=>{
                        var props=new MaterialPropertyBlock();props.SetTexture("_ResearchShadowInput",data.shadow);props.SetTexture("_ResearchAOFactor",data.ao);props.SetFloat("_ResearchAOStrength",data.strength);
                        ctx.cmd.DrawProcedural(Matrix4x4.identity,data.material,0,MeshTopology.Triangles,3,1,props);
                    });
                }
            }
            using (var builder = graph.AddRasterRenderPass<LightData>("Research original directional lighting", out var data))
            {
                data.inputs = new TextureHandle[4];
                for (int i = 0; i < 4; ++i) { data.inputs[i] = graph.ImportTexture(owner.handles[i]); builder.UseTexture(data.inputs[i], AccessFlags.Read); }
                data.depth = graph.ImportTexture(owner.geometryDepthHandle); builder.UseTexture(data.depth, AccessFlags.Read);
                data.white = graph.ImportTexture(owner.aoEnabled&&owner.aoUseOriginalChannel?owner.shadowAOHandle:screenShadow); builder.UseTexture(data.white, AccessFlags.Read);
                data.black = graph.ImportTexture(owner.blackHandle); builder.UseTexture(data.black, AccessFlags.Read);
                data.fullBlack = graph.ImportTexture(owner.fullBlackHandle); builder.UseTexture(data.fullBlack, AccessFlags.Read);
                data.material = owner.originalMaterial; data.triangle = owner.triangle;
                data.useGI = owner.useGI; data.fullSizeBlackGI = owner.fullSizeBlackGI; data.indirect = owner.indirectScale; data.tint = owner.indirectTint; data.direct = owner.directStrength; data.color=owner.directColor; data.direction = owner.lightDirection;
                data.width=owner.targetWidth;data.height=owner.targetHeight;
                var screenToNdc = new Matrix4x4(new Vector4(2f/data.width,0,0,0), new Vector4(0,2f/data.height,0,0), new Vector4(0,0,1,0), new Vector4(-1,-1,0,1));
                data.screenToWorld = (GL.GetGPUProjectionMatrix(camera.GetProjectionMatrix(), false) * camera.GetViewMatrix()).inverse * screenToNdc;
                data.setScreenToWorld = owner.setScreenToWorld;
                builder.SetRenderAttachment(graph.ImportTexture(owner.lightingHandle), 0, AccessFlags.Write);
                builder.SetRenderAttachmentDepth(graph.ImportTexture(owner.lightingDepthHandle), AccessFlags.Write);
                builder.AllowPassCulling(false);
                builder.SetRenderFunc(static (LightData data, RasterGraphContext ctx) => {
                    System.Threading.Interlocked.Increment(ref LightingExecutions);
                    ctx.cmd.ClearRenderTarget(RTClearFlags.All, Color.clear, 0f, 0);
                    var props = new MaterialPropertyBlock();
                    props.SetTexture("_UnityFBInput0", data.inputs[0]); props.SetTexture("_UnityFBInput1", data.inputs[1]);
                    props.SetTexture("_UnityFBInput2", data.inputs[2]); props.SetTexture("_UnityFBInput3", data.useGI ? data.inputs[3] : (data.fullSizeBlackGI ? data.fullBlack : data.black));
                    props.SetTexture("_CameraDepthTexture", data.depth); props.SetTexture("_LowResDepthTexture", data.depth);
                    props.SetTexture("_ScreenSpaceShadowmapTexture", data.white);
                    props.SetVector("_ScreenSize", new Vector4(data.width,data.height,1f/data.width,1f/data.height));
                    props.SetVector("_LightmapScaleColor", new Vector4(data.indirect*data.tint.x,data.indirect*data.tint.y,data.indirect*data.tint.z,1));
                    props.SetVector("_MainLightPosition", new Vector4(data.direction.x,data.direction.y,data.direction.z,0));
                    props.SetVector("_MainLightColor", new Vector4(data.direct*data.color.r,data.direct*data.color.g,data.direct*data.color.b,1));
                    props.SetInt("_MainLightLayerMask", -1);
                    if(data.setScreenToWorld) props.SetMatrixArray("_ScreenToWorld", new[]{data.screenToWorld,data.screenToWorld});
                    ctx.cmd.DrawMesh(data.triangle, Matrix4x4.identity, data.material, 0, 4, props);
                });
            }
            if ((owner.pointEnabled && owner.pointRange > 0f) || owner.pointLights.Count > 0)
            using (var builder = graph.AddRasterRenderPass<PointData>("Research original point lighting", out var data))
            {
                data.inputs = new TextureHandle[3];
                for(int i=0;i<3;i++){data.inputs[i]=graph.ImportTexture(owner.handles[i]);builder.UseTexture(data.inputs[i],AccessFlags.Read);}
                data.depth=graph.ImportTexture(owner.geometryDepthHandle);builder.UseTexture(data.depth,AccessFlags.Read);
                data.white=graph.ImportTexture(owner.aoEnabled&&owner.aoUseOriginalChannel?owner.shadowAOHandle:screenShadow);builder.UseTexture(data.white,AccessFlags.Read);
                data.material=owner.pointMaterial;data.sphere=owner.sphere;
                var points=new List<PointSample>(owner.pointLights);
                if(owner.pointEnabled && owner.pointRange>0f)points.Add(new PointSample{position=owner.pointPosition,color=owner.pointColor,range=owner.pointRange});
                data.points=points.ToArray();
                data.width=owner.targetWidth;data.height=owner.targetHeight;
                var screenToNdc=new Matrix4x4(new Vector4(2f/data.width,0,0,0),new Vector4(0,2f/data.height,0,0),new Vector4(0,0,1,0),new Vector4(-1,-1,0,1));
                data.screenToWorld=(GL.GetGPUProjectionMatrix(camera.GetProjectionMatrix(),false)*camera.GetViewMatrix()).inverse*screenToNdc;
                builder.SetRenderAttachment(graph.ImportTexture(owner.lightingHandle),0,AccessFlags.ReadWrite);
                builder.SetRenderAttachmentDepth(graph.ImportTexture(owner.lightingDepthHandle),AccessFlags.ReadWrite);
                builder.AllowPassCulling(false);
                builder.SetRenderFunc(static (PointData data,RasterGraphContext ctx)=>{
                    var props=new MaterialPropertyBlock();
                    props.SetTexture("_UnityFBInput0",data.inputs[0]);props.SetTexture("_UnityFBInput1",data.inputs[1]);props.SetTexture("_UnityFBInput2",data.inputs[2]);
                    props.SetTexture("_CameraDepthTexture",data.depth);props.SetTexture("_ScreenSpaceShadowmapTexture",data.white);
                    props.SetVector("_ScreenSize",new Vector4(data.width,data.height,1f/data.width,1f/data.height));
                    props.SetMatrixArray("_ScreenToWorld",new[]{data.screenToWorld,data.screenToWorld});
                    props.SetInt("_LightLayerMask",-1);
                    props.SetVector("_CustomLightProperty",Vector4.zero);
                    foreach(var point in data.points){
                        if(point.range<=0f)continue;
                        props.SetVector("_LightPosWS",new Vector4(point.position.x,point.position.y,point.position.z,1));
                        props.SetVector("_LightColor",new Vector4(point.color.r,point.color.g,point.color.b,1));
                        float angularScale=0f,angularBias=1f;
                        Vector3 direction=Vector3.forward;
                        if(point.isSpot){
                            float outer=Mathf.Clamp(point.outerSpotAngle,2.6f,179f);
                            float inner=Mathf.Clamp(point.innerSpotAngle,0f,outer);
                            float cosOuter=Mathf.Cos(outer*Mathf.Deg2Rad*.5f),cosInner=Mathf.Cos(inner*Mathf.Deg2Rad*.5f);
                            angularScale=1f/Mathf.Max(.001f,cosInner-cosOuter);angularBias=-cosOuter*angularScale;
                            direction=point.direction.normalized;
                        }
                        props.SetVector("_LightDirection",new Vector4(direction.x,direction.y,direction.z,0));
                        props.SetVector("_LightAttenuation",new Vector4(1f/(point.range*point.range),0,angularScale,angularBias));
                        ctx.cmd.DrawMesh(data.sphere,Matrix4x4.TRS(point.position,Quaternion.identity,Vector3.one*(point.range*2f)),data.material,0,1,props);
                    }
                });
            }
            using (var builder = graph.AddRasterRenderPass<OverlayData>("Research native light camera overlay", out var data))
            {
                data.light = graph.ImportTexture(owner.lightingHandle); builder.UseTexture(data.light, AccessFlags.Read);
                data.emission = graph.ImportTexture(owner.handles[4]); builder.UseTexture(data.emission, AccessFlags.Read);
                data.depth = graph.ImportTexture(owner.geometryDepthHandle); builder.UseTexture(data.depth, AccessFlags.Read);
                data.ao=graph.ImportTexture(owner.aoEnabled&&!owner.aoUseOriginalChannel?owner.aoFinalHandle:owner.whiteHandle);builder.UseTexture(data.ao,AccessFlags.Read);
                data.material = owner.overlayMaterial; data.emissionScale = owner.emissionScale;
                data.aoStrength=owner.aoEnabled&&!owner.aoUseOriginalChannel?owner.aoStrength:0;
                builder.SetRenderAttachment(frame.Get<UniversalResourceData>().activeColorTexture, 0, AccessFlags.ReadWrite);
                builder.SetRenderAttachmentDepth(frame.Get<UniversalResourceData>().activeDepthTexture, AccessFlags.ReadWrite);
                builder.SetRenderFunc(static (OverlayData data, RasterGraphContext ctx) => {
                    data.material.SetTexture("_ResearchNativeLighting", data.light);
                    data.material.SetTexture("_ResearchEmission", data.emission);
                    data.material.SetTexture("_ResearchDepth", data.depth);
                    data.material.SetTexture("_ResearchAO", data.ao);data.material.SetFloat("_ResearchAOStrength",data.aoStrength);
                    data.material.SetFloat("_ResearchEmissionScale", data.emissionScale);
                    ctx.cmd.DrawProcedural(Matrix4x4.identity, data.material, 0, MeshTopology.Triangles, 3, 1);
                });
            }
            if(Observations.Count==0)Observations.Add("Layer 31 GBuffer, original directional pass and depth-writing replacement recorded");
        }
        static DecalDraw[] BuildDecalDraws(List<DecalProjector> projectors,Camera camera,int maskShift,bool useOriginalMask)
        {
            var draws=new List<DecalDraw>();
            foreach(var d in projectors){
                if(!d||!d.isActiveAndEnabled||!d.material||!d.material.shader||!d.material.shader.isSupported||((camera.cullingMask&(1<<d.gameObject.layer))==0))continue;
                int pass=d.material.FindPass("DecalGBufferProjector");if(pass<0)continue;
                var t=d.transform;var rotate=Matrix4x4.Rotate(Quaternion.Euler(-90,0,0));
                var baseMatrix=d.scaleMode==DecalScaleMode.InheritFromHierarchy?t.localToWorldMatrix*rotate:Matrix4x4.TRS(t.position,t.rotation*Quaternion.Euler(-90,0,0),Vector3.one);
                var normal=baseMatrix;var col=normal.GetColumn(1);normal.SetColumn(1,normal.GetColumn(2));normal.SetColumn(2,col);
                var size=d.size;var pivot=d.pivot;var objectToWorld=baseMatrix*Matrix4x4.Translate(new Vector3(pivot.x,-pivot.z,pivot.y))*Matrix4x4.Scale(new Vector3(size.x,size.z,size.y));
                var center=objectToWorld.MultiplyPoint3x4(Vector3.zero);float radius=objectToWorld.MultiplyVector(Vector3.one).magnitude*.5f;
                float distance=Vector3.Distance(camera.transform.position,center),cullDistance=d.drawDistance+radius;
                if(distance>cullDistance)continue;
                float fade=d.fadeFactor*(d.fadeScale>=1f?1f:Mathf.Clamp01((cullDistance-distance)/(cullDistance*(1f-d.fadeScale))));
                float angleX=0,angleY=0;if(d.startAngleFade!=180f){float start=d.startAngleFade/180f;float range=Mathf.Max(.0001f,d.endAngleFade/180f-start);angleX=1f-(.25f-start)/range;angleY=-.25f/range;}
                normal.m30=d.uvScale.x;normal.m31=d.uvScale.y;normal.m32=d.uvBias.x;normal.m03=fade;normal.m13=angleX;normal.m23=angleY;normal.m33=d.uvBias.y;
                // The sampled original D3D11 projector shifts this bit field right by four.
                // This lossy mapping makes the sampled decals visible in the research setup;
                // it does not establish the original runtime's layer representation.
                uint mask=useOriginalMask?(uint)d.renderingLayerMask:((uint)d.renderingLayerMask & 0xffu) << Mathf.Clamp(maskShift,0,24);float maskBits=BitConverter.Int32BitsToSingle(unchecked((int)mask));
                draws.Add(new DecalDraw{objectToWorld=objectToWorld,normalToWorld=normal,material=d.material,pass=pass,mask=maskBits,order=d.material.HasProperty("_DrawOrder")?d.material.GetInt("_DrawOrder"):0,sequence=draws.Count});
            }
            // Mirror URP's material draw-order grouping; retain scene order within a material.
            draws.Sort((a,b)=>{int order=a.order.CompareTo(b.order);if(order!=0)return order;order=a.material.GetHashCode().CompareTo(b.material.GetHashCode());return order!=0?order:a.sequence.CompareTo(b.sequence);});
            return draws.ToArray();
        }
    }
    public override void Create() { pass = new StudyPass(this); ssrPass=new SSRPass(this); }
    public override void AddRenderPasses(ScriptableRenderer renderer, ref RenderingData data) { renderer.EnqueuePass(pass); if(reflectionsEnabled&&nativeEnabled)renderer.EnqueuePass(ssrPass); }
    RenderTexture NewColor(string name, GraphicsFormat format)
    {
        var descriptor = new RenderTextureDescriptor(targetWidth,targetHeight) { graphicsFormat=format, depthBufferBits=0, msaaSamples=1 };
        var rt = new RenderTexture(descriptor) { name=name };
        if (!rt.Create()) throw new Exception("Cannot create " + name);
        return rt;
    }
    RenderTexture NewDepth(string name)
    {
        var descriptor = new RenderTextureDescriptor(targetWidth,targetHeight) { graphicsFormat=GraphicsFormat.None, depthStencilFormat=GraphicsFormat.D24_UNorm_S8_UInt, msaaSamples=1 };
        var rt = new RenderTexture(descriptor) { name=name };
        if (!rt.Create()) throw new Exception("Cannot create " + name);
        return rt;
    }
    void EnsureTargets(int width,int height)
    {
        if(width<=0||height<=0)throw new Exception("Invalid camera dimensions");
        if(handles.Count!=0 && width==targetWidth && height==targetHeight)return;
        if(handles.Count!=0)ReleaseTargets();
        targetWidth=width;targetHeight=height;
        for (int i = 0; i < names.Length; ++i)
        {
            if (!SystemInfo.IsFormatSupported(formats[i], GraphicsFormatUsage.Render)) throw new Exception("Unsupported format " + formats[i]);
            var rt = NewColor(names[i], formats[i]); Outputs.Add(names[i],rt); handles.Add(RTHandles.Alloc(rt));
            Observations.Add(names[i]+" requested="+formats[i]+" property="+rt.graphicsFormat);
        }
        geometryDepth=NewDepth("Research geometry depth");geometryDepthHandle=RTHandles.Alloc(geometryDepth);
        lightingColor=NewColor("original directional light",GraphicsFormat.R16G16B16A16_SFloat);Outputs.Add("native-directional-light",lightingColor);lightingHandle=RTHandles.Alloc(lightingColor);
        lightingDepth=NewDepth("Research light pass depth");lightingDepthHandle=RTHandles.Alloc(lightingDepth);
        whiteHandle=RTHandles.Alloc(screenShadowOverride?screenShadowOverride:Texture2D.whiteTexture);blackHandle=RTHandles.Alloc(Texture2D.blackTexture);
        fullBlackTexture=new Texture2D(targetWidth,targetHeight,TextureFormat.RGBA32,false,true) { name="Research full-size fallback GI" };
        var blackPixels=new Color32[targetWidth*targetHeight];Color32 fallback=fullSizeFallbackGI;fallback.a=255;
        for(int i=0;i<blackPixels.Length;i++)blackPixels[i]=fallback;
        fullBlackTexture.SetPixels32(blackPixels);fullBlackTexture.Apply(false,true);fullBlackHandle=RTHandles.Alloc(fullBlackTexture);
    }
    void EnsureMaterials()
    {
        if (originalMaterial) return;
        if (!originalShader || !originalShader.isSupported) throw new Exception("Original deferred shader unavailable");
        originalMaterial = new Material(originalShader);
        originalMaterial.SetFloat("_LitDirStencilRef",0);originalMaterial.SetFloat("_LitDirStencilReadMask",0);
        originalMaterial.EnableKeyword("_INDIRECT_LIGHTING");originalMaterial.EnableKeyword("_DEFERRED_MAIN_LIGHT");originalMaterial.EnableKeyword("_DEFERRED_FIRST_LIGHT");
        pointMaterial=new Material(originalShader);pointMaterial.EnableKeyword("_POINT");
        pointMaterial.SetFloat("_LitPunctualStencilRef",0);pointMaterial.SetFloat("_LitPunctualStencilReadMask",0);
        var primitive=GameObject.CreatePrimitive(PrimitiveType.Sphere);sphere=primitive.GetComponent<MeshFilter>().sharedMesh;DestroyImmediate(primitive);
        var shader=overlayShader?overlayShader:Shader.Find("Hidden/Research/CampusDeferredOpaqueOverlay");if(!shader)throw new Exception("Native overlay shader unavailable");
        overlayMaterial=new Material(shader);
        triangle=new Mesh { name="Research clip triangle" };triangle.vertices=new[]{new Vector3(-1,-1,0),new Vector3(3,-1,0),new Vector3(-1,3,0)};triangle.triangles=new[]{0,1,2};
    }
    void EnsureAO()
    {
        if(aoMaterial)return;
        if(!aoShader||!aoShader.isSupported)throw new Exception("Original AO research shader unavailable");
        var shader=normalEncodeShader?normalEncodeShader:Shader.Find("Hidden/Research/CampusNormalsEncode");
        if(!shader)throw new Exception("Research normal encoding shader unavailable");
        var combineShader=shadowAOCombineShader?shadowAOCombineShader:Shader.Find("Hidden/Research/CampusShadowAOCombine");
        if(!combineShader)throw new Exception("Research shadow/AO channel shader unavailable");
        normalEncodeMaterial=new Material(shader);aoMaterial=new Material(aoShader);shadowAOCombineMaterial=new Material(combineShader);
        aoMaterial.EnableKeyword("_INTERLEAVED_GRADIENT");aoMaterial.EnableKeyword("_SOURCE_DEPTH_NORMALS");aoMaterial.EnableKeyword("_SAMPLE_COUNT_MEDIUM");
        var normal=NewColor("research encoded normals",GraphicsFormat.R16G16B16A16_SFloat);Outputs.Add("ao-encoded-normals",normal);encodedNormalHandle=RTHandles.Alloc(normal);
        var ao=NewColor("original AO",GraphicsFormat.R16G16B16A16_SFloat);Outputs.Add("original-ao",ao);aoHandle=RTHandles.Alloc(ao);
        var blur=NewColor("original AO horizontal blur",GraphicsFormat.R16G16B16A16_SFloat);Outputs.Add("ao-blur",blur);aoBlurHandle=RTHandles.Alloc(blur);
        var final=NewColor("original AO final",GraphicsFormat.R16G16B16A16_SFloat);Outputs.Add("ao-final",final);aoFinalHandle=RTHandles.Alloc(final);
        var combined=NewColor("research shadow AO channels",GraphicsFormat.R16G16B16A16_SFloat);Outputs.Add("shadow-ao-channels",combined);shadowAOHandle=RTHandles.Alloc(combined);
    }
    void EnsureDecals()
    {
        if(depthIdHandle!=null)return;
        var color=NewColor("research original DepthID",GraphicsFormat.R8G8B8A8_UNorm);Outputs.Add("depth-id",color);depthIdHandle=RTHandles.Alloc(color);
        depthIdDepth=NewDepth("Research DepthID depth");depthIdDepthHandle=RTHandles.Alloc(depthIdDepth);
        var primitive=GameObject.CreatePrimitive(PrimitiveType.Cube);decalCube=primitive.GetComponent<MeshFilter>().sharedMesh;DestroyImmediate(primitive);
    }
    void EnsureShadow()
    {
        if(screenShadowMaterial)return;
        var shader=screenShadowShader?screenShadowShader:Shader.Find("Hidden/Research/CampusScreenShadow");
        if(!shader)throw new Exception("Research screen shadow shader unavailable");
        screenShadowMaterial=new Material(shader);
        var rt=NewColor("research screen shadow",GraphicsFormat.R8G8B8A8_UNorm);Outputs.Add("screen-shadow",rt);screenShadowHandle=RTHandles.Alloc(rt);
    }
    public void ReleaseTargets()
    {
        if(ssrMaterial)CoreUtils.Destroy(ssrMaterial);ssrMaterial=null;
        foreach(var h in handles)h.Release();handles.Clear();
        geometryDepthHandle?.Release();lightingHandle?.Release();lightingDepthHandle?.Release();whiteHandle?.Release();blackHandle?.Release();fullBlackHandle?.Release();
        encodedNormalHandle?.Release();aoHandle?.Release();aoBlurHandle?.Release();aoFinalHandle?.Release();shadowAOHandle?.Release();encodedNormalHandle=null;aoHandle=null;aoBlurHandle=null;aoFinalHandle=null;shadowAOHandle=null;
        screenShadowHandle?.Release();screenShadowHandle=null;
        depthIdHandle?.Release();depthIdDepthHandle?.Release();depthIdHandle=null;depthIdDepthHandle=null;
        if(fullBlackTexture)DestroyImmediate(fullBlackTexture);
        foreach(var rt in Outputs.Values){rt.Release();DestroyImmediate(rt);}Outputs.Clear();
        if(geometryDepth){geometryDepth.Release();DestroyImmediate(geometryDepth);}if(lightingDepth){lightingDepth.Release();DestroyImmediate(lightingDepth);}
        if(depthIdDepth){depthIdDepth.Release();DestroyImmediate(depthIdDepth);depthIdDepth=null;}decalCube=null;
        if(originalMaterial)DestroyImmediate(originalMaterial);if(pointMaterial)DestroyImmediate(pointMaterial);if(overlayMaterial)DestroyImmediate(overlayMaterial);if(aoMaterial)DestroyImmediate(aoMaterial);if(normalEncodeMaterial)DestroyImmediate(normalEncodeMaterial);if(shadowAOCombineMaterial)DestroyImmediate(shadowAOCombineMaterial);if(screenShadowMaterial)DestroyImmediate(screenShadowMaterial);if(triangle)DestroyImmediate(triangle);
    }
}

