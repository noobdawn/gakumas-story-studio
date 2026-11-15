using System;
using UnityEngine;

// Explicit research setting for the original environment shader. This is not
// a recovered game value; callers own the global's lifetime and calibration.
public static class SceneNativeLighting
{
    static readonly int LightmapScale = Shader.PropertyToID("_LightmapScaleColor");
    public static void SetLightmapScale(float scale)
    {
        if (float.IsNaN(scale) || float.IsInfinity(scale) || scale < 0f)
            throw new ArgumentOutOfRangeException(nameof(scale));
        Shader.SetGlobalColor(LightmapScale, new Color(scale, scale, scale, 1f));
    }
}
