using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

// The native face fragment program shades skin using this comparison shadow map.
// Own the texture and face material per instance, including actors sharing a hair bundle.
public sealed class ActorHairShadow : MonoBehaviour
{
    const int Size = 512;
    const string Keyword = "_ACTOR_SHADOWS";
    static readonly int WorldToShadow = Shader.PropertyToID("_WorldToActorShadow");
    static readonly int ShadowMap = Shader.PropertyToID("_ActorShadowmapTexture");
    static readonly int ShadowParams = Shader.PropertyToID("_ActorShadowParams");
    static readonly int Offset0 = Shader.PropertyToID("_ActorShadowOffset0");
    static readonly int Offset1 = Shader.PropertyToID("_ActorShadowOffset1");
    static readonly int LightDirection = Shader.PropertyToID("_LightDirection");
    static readonly int ShadowBias = Shader.PropertyToID("_ShadowBias");
    const string PunctualCaster = "_CASTING_PUNCTUAL_LIGHT_SHADOW";
    static readonly Matrix4x4 clipToTexture = Matrix4x4.Translate(Vector3.one * .5f) * Matrix4x4.Scale(Vector3.one * .5f);
    static readonly List<ActorHairShadow> activeFaces = new List<ActorHairShadow>();
    static readonly Plane[] planes = new Plane[6];

    struct Caster { public Renderer renderer; public Material material; public int slot, pass; }
    readonly List<Caster> casters = new List<Caster>();
    readonly List<int> skinSlots = new List<int>();
    MaterialPropertyBlock bindings;
    MeshRenderer face;
    Material skin;
    RenderTexture map;

    public static void Bind(GameObject hair, MeshRenderer face)
    {
        var slots = face.sharedMaterials;
        var source = System.Array.Find(slots, m => m && m.shader.name == "Campus/Actor/Default"
                                                  && m.GetFloat("_ShaderType") == 9);
        if (!source) return;
        var shadow = face.gameObject.AddComponent<ActorHairShadow>();
        shadow.face = face;
        foreach (var r in hair.GetComponentsInChildren<SkinnedMeshRenderer>(true)) {
            var materials = r.sharedMaterials;
            for (int i = 0; i < materials.Length; i++) {
                var m = materials[i];
                if (!m || m.shader != source.shader || !m.GetShaderPassEnabled("SHADOWCASTER")) continue;
                float type = m.GetFloat("_ShaderType");
                if (type != 8 && !(type == 1 && m.IsKeywordEnabled("_ALPHATEST_ON"))) continue;
                int pass = m.FindPass("ShadowCaster");
                if (pass >= 0) shadow.casters.Add(new Caster { renderer=r, material=m, slot=i, pass=pass });
            }
        }
        if (shadow.casters.Count == 0) { Destroy(shadow); return; }
        shadow.skin = new Material(source) { name = source.name, hideFlags = HideFlags.DontSave };
        shadow.bindings = new MaterialPropertyBlock();
        for (int i = 0; i < slots.Length; i++) {
            if (slots[i] != source) continue;
            slots[i] = shadow.skin;
            shadow.skinSlots.Add(i);
        }
        face.sharedMaterials = slots;
    }

    void OnEnable() => activeFaces.Add(this);
    void OnDisable() => activeFaces.Remove(this);
    void OnDestroy()
    {
        if (map) { map.Release(); Destroy(map); }
        if (skin) Destroy(skin);
    }

    public static void Render(ScriptableRenderContext context, Camera camera, bool enabled)
    {
        if ((camera.cullingMask & (1 << 30)) == 0 || activeFaces.Count == 0) return;
        GeometryUtility.CalculateFrustumPlanes(camera, planes);
        CommandBuffer cmd = null;
        try {
            foreach (var item in activeFaces) {
                if (!item.skin || !item.face.enabled || item.face.forceRenderingOff ||
                    item.face.shadowCastingMode == ShadowCastingMode.ShadowsOnly ||
                    !GeometryUtility.TestPlanesAABB(planes, item.face.bounds)) continue;
                if (!enabled) { item.skin.DisableKeyword(Keyword); continue; }
                if (cmd == null) {
                    cmd = CommandBufferPool.Get("Actor hair shadows");
                    cmd.DisableShaderKeyword(PunctualCaster);
                }
                item.Record(cmd, camera);
            }
            if (cmd == null) return;
            cmd.SetViewProjectionMatrices(camera.worldToCameraMatrix, camera.projectionMatrix);
            cmd.SetGlobalVector(LightDirection, Shader.GetGlobalVector(LightDirection));
            cmd.SetGlobalVector(ShadowBias, Shader.GetGlobalVector(ShadowBias));
            if (Shader.IsKeywordEnabled(PunctualCaster)) cmd.EnableShaderKeyword(PunctualCaster);
            context.ExecuteCommandBuffer(cmd);
        } finally { if (cmd != null) CommandBufferPool.Release(cmd); }
    }

    void Record(CommandBuffer cmd, Camera camera)
    {
        if (!map) {
            map = new RenderTexture(Size, Size, 16, RenderTextureFormat.Shadowmap) {
                name="Actor hair shadow", filterMode=FilterMode.Bilinear, wrapMode=TextureWrapMode.Clamp, hideFlags=HideFlags.DontSave
            };
        }
        if (!map.IsCreated() && !map.Create()) { skin.DisableKeyword(Keyword); return; }
        var bounds = face.bounds;
        float radius = Mathf.Max(.01f, bounds.extents.magnitude * 1.18f);
        Vector3 toCamera = camera.orthographic ? -camera.transform.forward : (camera.transform.position-bounds.center).normalized;
        // A camera-relative character key places the fringe shadow just below the strands.
        Vector3 light = (toCamera + camera.transform.up * .24f + camera.transform.right * .14f).normalized;
        var lightPose = Matrix4x4.TRS(bounds.center + light * (2 * radius),
                                      Quaternion.LookRotation(-light, camera.transform.up), Vector3.one);
        var view = Matrix4x4.Scale(new Vector3(1,1,-1)) * lightPose.inverse;
        var projection = Matrix4x4.Ortho(-radius, radius, -radius, radius, radius * .02f, radius * 4);
        cmd.SetRenderTarget(map);
        cmd.SetViewport(new Rect(0, 0, Size, Size));
        cmd.ClearRenderTarget(true, false, Color.clear);
        cmd.SetViewProjectionMatrices(view, projection);
        cmd.SetGlobalVector(LightDirection, light);
        cmd.SetGlobalVector(ShadowBias, new Vector4(-radius / Size,0,0,0));
        foreach (var c in casters)
            if (c.renderer.enabled && !c.renderer.forceRenderingOff && c.renderer.shadowCastingMode != ShadowCastingMode.Off &&
                c.renderer.gameObject.activeInHierarchy)
                cmd.DrawRenderer(c.renderer, c.material, c.slot, c.pass);
        // Same clip-to-shadow texture transform as URP's directional shadow slices.
        if (SystemInfo.usesReversedZBuffer) projection.SetRow(2, -projection.GetRow(2));
        var matrix = clipToTexture * projection * view;
        const float tap = .5f / Size;
        foreach (int slot in skinSlots) {
            face.GetPropertyBlock(bindings, slot);
            bindings.SetMatrix(WorldToShadow, matrix);
            bindings.SetTexture(ShadowMap, map);
            bindings.SetVector(Offset0, new Vector4(-tap, -tap, tap, -tap));
            bindings.SetVector(Offset1, new Vector4(-tap, tap, tap, tap));
            bindings.SetVector(ShadowParams, new Vector4(1, 0, 0, 0));
            face.SetPropertyBlock(bindings, slot);
        }
        skin.EnableKeyword(Keyword);
    }
}
