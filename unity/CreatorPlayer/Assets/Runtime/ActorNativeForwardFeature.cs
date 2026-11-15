using System;
using UnityEngine;
using UnityEngine.Rendering.Universal;

// Native compiled shader supplied externally. This adapter does not reconstruct
// the unknown game runtime lighting constants or replace material render states.
public sealed class ActorNativeForwardFeature : ScriptableRendererFeature
{
    [Serializable] public sealed class Settings
    {
        public LayerMask actorLayers = 1 << 30;
        public bool performanceComparison;
        public bool drawTransparent = true;
        public RenderPassEvent injectionPoint = RenderPassEvent.AfterRenderingOpaques;
    }
    public Settings settings = new Settings();
    RenderObjects full, performance, fullTransparent, performanceTransparent;

    RenderObjects Make(string lightMode, bool transparent = false)
    {
        var draw = CreateInstance<RenderObjects>();
        draw.settings.passTag = "Actor reconstruction: " + lightMode;
        draw.settings.filterSettings.LayerMask = settings.actorLayers;
        // Native eye/highlight blending still lives in queues 2002/2204.
        // Moving it to the transparent queue changes the original order/stencil.
        draw.settings.filterSettings.RenderQueueType = transparent ? RenderQueueType.Transparent : RenderQueueType.Opaque;
        draw.settings.filterSettings.PassNames = new[] { lightMode };
        draw.settings.Event = transparent ? RenderPassEvent.BeforeRenderingTransparents : settings.injectionPoint;
        draw.Create();
        return draw;
    }
    public override void Create()
    {
        Dispose(true);
        full = Make("VLActor");
        performance = Make("UniversalForwardPerformance");
        fullTransparent = Make("VLActor", true);
        performanceTransparent = Make("UniversalForwardPerformance", true);
    }
    public override void AddRenderPasses(ScriptableRenderer renderer, ref RenderingData data)
    {
        var draw = settings.performanceComparison ? performance : full;
        if (draw) draw.AddRenderPasses(renderer, ref data);
        // Keep the original queue and blend/stencil state for transparent clothing
        // and hair props (observed queue 2501), rather than forcing them opaque.
        var transparent = settings.performanceComparison ? performanceTransparent : fullTransparent;
        if (settings.drawTransparent && transparent) transparent.AddRenderPasses(renderer, ref data);
    }
    protected override void Dispose(bool disposing)
    {
        if (full) UnityEngine.Rendering.CoreUtils.Destroy(full);
        if (performance) UnityEngine.Rendering.CoreUtils.Destroy(performance);
        if (fullTransparent) UnityEngine.Rendering.CoreUtils.Destroy(fullTransparent);
        if (performanceTransparent) UnityEngine.Rendering.CoreUtils.Destroy(performanceTransparent);
        full = performance = fullTransparent = performanceTransparent = null;
    }
}
