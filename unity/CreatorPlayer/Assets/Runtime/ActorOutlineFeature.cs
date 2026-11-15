using System;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

// Research renderer feature for the native Campus actor outline pass.
// The shader and its vertex-color/tangent data must be present separately.
public sealed class ActorOutlineFeature : ScriptableRendererFeature
{
    [Serializable]
    public sealed class OutlineSettings
    {
        [Range(0f, 1f)] public float width = .15f;
        public bool keepScreenWidth = true;
        [Min(.01f)] public float referenceDistance = 3f;
        [Range(1f, 179f)] public float referenceVerticalFov = 35f;
        [Min(.01f)] public float referenceOrthographicSize = .72f;
        [Min(1f)] public float maxCompensatedDistance = 100f;
        public LayerMask layerMask = ~0;
        public RenderPassEvent injectionPoint = RenderPassEvent.AfterRenderingOpaques;
    }

    public OutlineSettings settings = new OutlineSettings();
    RenderObjects drawFeature;

    public override void Create()
    {
        if (drawFeature) CoreUtils.Destroy(drawFeature);
        drawFeature = CreateInstance<RenderObjects>();
        drawFeature.settings.passTag = "Campus Actor Outline";
        drawFeature.settings.filterSettings.PassNames = new[] { "UniversalForwardOutline" };
        drawFeature.settings.filterSettings.LayerMask = settings.layerMask;
        drawFeature.settings.Event = settings.injectionPoint;
        drawFeature.Create();
    }

    public override void AddRenderPasses(ScriptableRenderer renderer, ref RenderingData renderingData)
    {
        if (!drawFeature) return;
        Shader.SetGlobalVector("_OutlineParam", BuildOutlineParams(renderingData.cameraData.camera, settings));
        drawFeature.AddRenderPasses(renderer, ref renderingData);
    }

    public static Vector4 BuildOutlineParams(Camera camera, OutlineSettings config)
    {
        var width = Mathf.Max(0, config.width);
        if (!config.keepScreenWidth || !camera) return new Vector4(width, width, 0, 0);
        if (camera.orthographic)
        {
            var compensated = width * camera.orthographicSize / Mathf.Max(.01f, config.referenceOrthographicSize);
            return new Vector4(compensated, compensated, 0, 0);
        }
        var fovRatio = Mathf.Tan(camera.fieldOfView * Mathf.Deg2Rad * .5f) /
                       Mathf.Tan(Mathf.Clamp(config.referenceVerticalFov, 1f, 179f) * Mathf.Deg2Rad * .5f);
        var maxDistance = Mathf.Max(1f, config.maxCompensatedDistance);
        var farWidth = width * fovRatio * maxDistance / Mathf.Max(.01f, config.referenceDistance);
        // The original vertex program computes lerp(x,y,saturate(distance*z*w)).
        // With x=0 this yields width proportional to vertex-camera distance up to maxDistance.
        return new Vector4(0, farWidth, 1f / maxDistance, 1f);
    }

    protected override void Dispose(bool disposing)
    {
        if (drawFeature) CoreUtils.Destroy(drawFeature);
        drawFeature = null;
    }
}
