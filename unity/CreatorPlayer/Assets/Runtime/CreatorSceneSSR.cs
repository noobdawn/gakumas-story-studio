using UnityEngine;
using System;
using System.Linq;
using UnityEngine.Experimental.Rendering;
using UnityEngine.Rendering;
using UnityEngine.Rendering.RenderGraphModule;
using UnityEngine.Rendering.Universal;

public sealed partial class CreatorSceneLightingFeature {
    public Shader ssrShader;
    public bool reflectionsEnabled=true,probesEnabled=true,ssrEnabled=false;
    public ReflectionProbe[] reflectionProbes=Array.Empty<ReflectionProbe>();
    public float ssrIntensity=1,ssrSmoothness=.6f,ssrDistance=25,ssrThickness=.2f;
    public int ssrQuality=1;
    Material ssrMaterial;
    SSRPass ssrPass;
    sealed class SSRPass:ScriptableRenderPass {
        readonly CreatorSceneLightingFeature owner;
        sealed class Data {
            public TextureHandle color,depth,geometry,normal,surface,albedo,reflection;
            public Material material;public int pass,steps;public Vector4 parameters,eye;
            public Matrix4x4 vp,invVP,view;
            public bool trace;
            public Texture[] probes;
            public Vector4[] probePositions,probeMin,probeMax,probeDecode,probeSettings;
        }
        public SSRPass(CreatorSceneLightingFeature owner){this.owner=owner;renderPassEvent=(RenderPassEvent)((int)RenderPassEvent.BeforeRenderingTransparents-1);requiresIntermediateTexture=true;}
        public override void RecordRenderGraph(RenderGraph graph,ContextContainer frame){
            var camera=frame.Get<UniversalCameraData>();var resources=frame.Get<UniversalResourceData>();
            if(!owner.reflectionsEnabled||!owner.nativeEnabled||owner.geometryDepthHandle==null||owner.handles.Count<3||resources.isActiveTargetBackBuffer||!camera.camera||camera.camera.orthographic)return;
            if(!string.IsNullOrEmpty(owner.targetCameraName)&&camera.camera.name!=owner.targetCameraName)return;
            // Current extracted scenes contain at most eight probes. No synthetic environment fallback.
            var probes=owner.probesEnabled?owner.reflectionProbes.Where(p=>p&&p.isActiveAndEnabled&&p.mode!=ReflectionProbeMode.Realtime&&p.texture)
                .OrderByDescending(p=>p.importance).ThenBy(p=>p.bounds.size.x*p.bounds.size.y*p.bounds.size.z).Take(8).ToArray():Array.Empty<ReflectionProbe>();
            if(!owner.ssrEnabled&&probes.Length==0)return;
            if(!owner.ssrMaterial)owner.ssrMaterial=CoreUtils.CreateEngineMaterial(owner.ssrShader);
            var color=resources.activeColorTexture;var depth=resources.activeDepthTexture;
            if(!color.IsValid()||!depth.IsValid())return;
            var desc=graph.GetTextureDesc(color);desc.name="Creator SSR trace";desc.clearBuffer=true;
            desc.colorFormat=GraphicsFormat.R16G16B16A16_SFloat;desc.depthBufferBits=DepthBits.None;desc.msaaSamples=MSAASamples.None;
            if(owner.ssrQuality<2){desc.width=Mathf.Max(1,desc.width/2);desc.height=Mathf.Max(1,desc.height/2);}
            var reflection=owner.ssrEnabled?graph.CreateTexture(desc):color;
            var finalDesc=graph.GetTextureDesc(color);finalDesc.name="Creator SSR composite";finalDesc.clearBuffer=false;
            var result=graph.CreateTexture(finalDesc);
            for(int shaderPass=owner.ssrEnabled?0:1;shaderPass<2;shaderPass++){
                using(var builder=graph.AddRasterRenderPass<Data>(shaderPass==0?"Creator screen-space ray tracing":"Creator reflection composite",out var d)){
                    d.color=color;d.depth=depth;d.geometry=graph.ImportTexture(owner.geometryDepthHandle);
                    d.normal=graph.ImportTexture(owner.handles[2]);d.surface=graph.ImportTexture(owner.handles[1]);d.albedo=graph.ImportTexture(owner.handles[0]);d.reflection=reflection;
                    foreach(var texture in new[]{d.color,d.depth,d.geometry,d.normal,d.surface,d.albedo})builder.UseTexture(texture,AccessFlags.Read);
                    if(shaderPass==1)builder.UseTexture(reflection,AccessFlags.Read);
                    d.material=owner.ssrMaterial;d.pass=shaderPass;d.steps=owner.ssrQuality==0?32:owner.ssrQuality==1?64:96;
                    d.trace=owner.ssrEnabled;d.probes=probes.Select(p=>p.texture).ToArray();
                    d.probePositions=new Vector4[8];d.probeMin=new Vector4[8];d.probeMax=new Vector4[8];d.probeDecode=new Vector4[8];d.probeSettings=new Vector4[8];
                    for(int k=0;k<probes.Length;k++){
                        var p=probes[k];var pos=p.transform.position;var b=p.bounds;
                        d.probePositions[k]=new Vector4(pos.x,pos.y,pos.z,p.boxProjection?1:0);
                        d.probeMin[k]=b.min;d.probeMax[k]=b.max;d.probeDecode[k]=p.textureHDRDecodeValues;
                        d.probeSettings[k]=new Vector4(p.intensity,p.blendDistance,Mathf.Max(0,p.texture.mipmapCount-1),0);
                    }
                    d.parameters=new Vector4(owner.ssrIntensity,owner.ssrSmoothness,owner.ssrDistance,owner.ssrThickness);
                    var position=camera.camera.transform.position;d.eye=new Vector4(position.x,position.y,position.z,camera.camera.nearClipPlane);
                    // This pass requires an intermediate target; avoid the deprecated compatibility-mode accessor.
                    d.view=camera.GetViewMatrix();d.vp=GL.GetGPUProjectionMatrix(camera.GetProjectionMatrix(),true)*d.view;d.invVP=d.vp.inverse;
                    builder.SetRenderAttachment(shaderPass==0?reflection:result,0,AccessFlags.Write);
                    builder.SetRenderFunc(static(Data d,RasterGraphContext ctx)=>{
                        var p=new MaterialPropertyBlock();p.SetTexture("_SSRColor",d.color);p.SetTexture("_SSRDepth",d.depth);p.SetTexture("_SSRGeometryDepth",d.geometry);
                        p.SetTexture("_SSRNormal",d.normal);p.SetTexture("_SSRMaterial",d.surface);p.SetTexture("_SSRAlbedo",d.albedo);
                        if(d.pass==1)p.SetTexture("_SSRReflection",d.reflection);
                        p.SetInt("_SSREnabled",d.trace?1:0);p.SetInt("_ProbeCount",d.probes.Length);
                        for(int k=0;k<d.probes.Length;k++)p.SetTexture("_Probe"+k,d.probes[k]);
                        p.SetVectorArray("_ProbePosition",d.probePositions);p.SetVectorArray("_ProbeMin",d.probeMin);p.SetVectorArray("_ProbeMax",d.probeMax);p.SetVectorArray("_ProbeDecode",d.probeDecode);p.SetVectorArray("_ProbeSettings",d.probeSettings);
                        p.SetMatrix("_SSRVP",d.vp);p.SetMatrix("_SSRInvVP",d.invVP);p.SetMatrix("_SSRView",d.view);p.SetVector("_SSRCamera",d.eye);p.SetVector("_SSRParams",d.parameters);p.SetInt("_SSRSteps",d.steps);
                        ctx.cmd.DrawProcedural(Matrix4x4.identity,d.material,d.pass,MeshTopology.Triangles,3,1,p);
                    });
                }
            }
            resources.cameraColor=result;
        }
    }
}
