using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

// Native Campus/Actor/Default reads this from $Globals at byte offset 2560.
// White is a neutral research multiplier, not a captured original-game value.
// Scope it to this camera so preview/export cameras do not inherit each other's input.
[ExecuteAlways, RequireComponent(typeof(Camera)), DisallowMultipleComponent]
public sealed class ActorEyeHighlightBinding : MonoBehaviour
{
    [ColorUsage(false, true)] public Color highlightColor = Color.white;
    static readonly int Property = Shader.PropertyToID("_EyeHighlightColor");
    readonly Stack<Vector4> previousValues = new Stack<Vector4>();
    Camera target;
    void OnEnable()
    {
        target = GetComponent<Camera>();
        RenderPipelineManager.beginCameraRendering += Begin;
        RenderPipelineManager.endCameraRendering += End;
    }
    void Begin(ScriptableRenderContext context, Camera camera)
    {
        if (camera != target) return;
        previousValues.Push(Shader.GetGlobalVector(Property));
        Shader.SetGlobalColor(Property, highlightColor);
    }
    void End(ScriptableRenderContext context, Camera camera)
    {
        if (camera == target && previousValues.Count > 0)
            Shader.SetGlobalVector(Property, previousValues.Pop());
    }
    void OnDisable()
    {
        RenderPipelineManager.beginCameraRendering -= Begin;
        RenderPipelineManager.endCameraRendering -= End;
        while (previousValues.Count > 0) Shader.SetGlobalVector(Property, previousValues.Pop());
    }
}
