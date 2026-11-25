using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

// Approximate research solver. Serialized values and collision layouts come from
// the local model, but the original game's update rules are not available here.
public sealed class ActorClothPhysics : MonoBehaviour
{
    [Serializable] public sealed class BoneData
    {
        public string name; public int colliderType, collisionMask;
        public float radiusA, radiusB, damping, stiffness, spring, pendulum, mass;
        public Vector3 referencePosition; public Quaternion referenceRotation;
    }
    [Serializable] public sealed class ColliderData
    {
        public string name; public int type, collisionMask;
        public Vector3 vectorA, vectorB; public float radiusA, radiusB;
    }
    [Serializable] public sealed class Data
    {
        public string source; public BoneData[] dynamic; public ColliderData[] @static;
    }
    sealed class Segment
    {
        public BoneData data, childData; public Transform bone, child;
        public Vector3 localPosition; public Quaternion localRotation;
        public Vector3 position, previous; public bool initialized;
        public bool hasChain, authoredOnly;
        public int sleeveSide;
        public bool reachesPelvis;
        public float hybridCap;
        public BodyCollider[] obstacles;
        public Anchor anchor;
        public ActorQuartzPose.Limit limit;
        public Quaternion poseLocal;
    }
    sealed class Link
    {
        public Segment left, right;
        public float radius, smoothing, restLength;
        public BodyCollider[] obstacles;
    }
    sealed class Anchor
    {
        public Transform bone;
        public Matrix4x4 lastInverse, transport;
    }
    sealed class BodyCollider
    {
        public ColliderData data;
        public Transform bone, end, limbParent;
        public Vector3 endOffset, lateral, depthAxis;
        public Vector3 a, b, side;
        public float ra, rb, width;
        public bool head, torso;
        public int sleeveSide;
        public bool lowerBody;
        public void Update()
        {
            a = bone.TransformPoint(data.vectorA);
            b = a;
            if (end)
            {
                b = end.TransformPoint(endOffset);
                var x = bone.TransformVector(lateral);
                width = x.magnitude;
                side = x.normalized;
                ra = rb = bone.TransformVector(depthAxis).magnitude;
                return;
            }
            Vector3 scale = bone.lossyScale;
            float radialScale = Mathf.Max(Mathf.Abs(scale.x), Mathf.Abs(scale.y), Mathf.Abs(scale.z));
            ra = Mathf.Max(0, data.radiusA * radialScale);
            rb = Mathf.Max(0, data.radiusB * radialScale);
            if (limbParent)
            {
                var span = limbParent.position - bone.position;
                float length = span.magnitude;
                var axis = length > 1e-6f ? span/length : Vector3.zero;
                float start = Mathf.Clamp(data.vectorA.x*radialScale, 0, length);
                float finish = Mathf.Clamp(data.vectorA.y*radialScale, 0, length-start);
                a = bone.position + axis*start;
                b = limbParent.position - axis*finish;
            }
            else if (data.type == 1)
            {
                int axis = Mathf.Clamp(Mathf.RoundToInt(data.vectorB.x), 0, 2);
                var dir = bone.TransformVector(axis == 0 ? Vector3.right : axis == 1 ? Vector3.up : Vector3.forward);
                var offset = dir * Mathf.Max(0, data.vectorB.y * .5f - Mathf.Max(data.radiusA, data.radiusB));
                a -= offset;
                b += offset;
            }
            else ra = rb = Mathf.Max(ra, rb);
        }
    }
    public struct ContactMetrics { public int pairs, overlaps, headPairs, torsoPairs, headOverlaps, torsoOverlaps; public float maxDepth, totalDepth, headDepth, torsoDepth; }

    [Tooltip("JSON exported from the locally owned outfit resources.")]
    public TextAsset metadata;
    public Transform actorRoot;
    public bool simulateInLateUpdate = true;
    public bool simulateSkirt = true;
    // Broader coverage is an approximation, not the source ActorSwing solver.
    public bool includeOtherDynamic = false;
    // Experimental: choose a lower-overlap direction after enforcing the angle cap.
    public bool refineContacts = false;
    [Tooltip("Experimental approximation for keeping a jacket outside matching skirt chains.")]
    public bool separateClothingLayers = false;
    [Range(0f, .15f)] public float layerSeparation = .06f;
    [Tooltip("Experimental: test original hand proxies against jacket chains despite their source masks.")]
    public bool experimentalHandCollisions = false;
    [Range(0f, .1f)] public float handCollisionPadding = .02f;
    [Range(0f, 2f)] public float gravityScale = .35f;
    [Range(0f, 60f)] public float maxAngle = 30f;
    // Negative leaves the general angle unchanged; may be limited per sampled pose.
    public float skirtMaxAngle = -1f;
    [Range(0f, 1f)] public float collisionRadiusScale = .5f;
    [Range(1, 8)] public int constraintIterations = 4;
    const float StepSeconds = 1f / 60f;
    readonly List<Segment> segments = new List<Segment>();
    readonly List<Anchor> anchors = new List<Anchor>();
    readonly List<BodyCollider> colliders = new List<BodyCollider>();
    readonly List<Link> links = new List<Link>();
    ActorQuartzPose quartz;
    public ActorPhysicsMode Mode { get; private set; } = ActorPhysicsMode.Quartz;
    bool UseAuthored => Mode == ActorPhysicsMode.Quartz || Mode == ActorPhysicsMode.Hybrid;
    ActorQuartzPose ActiveQuartz => UseAuthored ? quartz : null;
    bool isHair, hasPreviousAnchor;
    Matrix4x4 beforeBlend;
    internal bool IsHair => isHair;
    public int QuartzDrivers => ActiveQuartz?.Count ?? 0;
    public int SkirtDrivers => ActiveQuartz?.Skirts ?? 0;
    public int HairDrivers => ActiveQuartz?.Hair ?? 0;
    public float SkirtDriverAngle => ActiveQuartz?.MaxSkirtAngle ?? 0;
    public float HairDriverAngle => ActiveQuartz?.MaxHairAngle ?? 0;
    public int ChainLinks => UseAuthored ? links.Count : 0;
    public bool OpenGarment { get; private set; }
    bool bindingsDirty;
    float accumulator;
    public int SegmentCount => segments.Count;
    public int ColliderCount => colliders.Count;
    public SkirtSurfaceCollision surfaceCollision;
    public FringeFaceContact fringeContact;
    internal HairBodyContact hairBodyContact;
    void OnDestroy()=>hairBodyContact?.Dispose();
    // The hair prefab does not own the body's static proxies. Share their live
    // transform bindings with this actor instance, never with another actor.
    public void AddExternalColliders(ActorClothPhysics bodySolver)
    {
        if(!bodySolver || bodySolver==this)throw new ArgumentException("Missing body collider source");
        colliders.AddRange(bodySolver.colliders);
        var hips=bodySolver.actorRoot.GetComponentsInChildren<Transform>(true).FirstOrDefault(t=>t.name=="Hips");
        if(hips)foreach(var s in segments)
            s.reachesPelvis=Vector3.Dot(s.child.position-hips.position,bodySolver.actorRoot.up)<.16f*Mathf.Abs(bodySolver.actorRoot.lossyScale.y);
        AddTorsoCoverage(bodySolver);
        if(bodySolver.surfaceCollision && bodySolver.surfaceCollision.bodyContact!=null)
            hairBodyContact=HairBodyContact.Create(this,bodySolver.surfaceCollision.bodyContact,segments.Select(s=>s.bone));
        bindingsDirty = true;
    }
    public void AddFaceColliders(Transform face, ColliderData[] shapes)
    {
        var nodes = face.GetComponentsInChildren<Transform>(true).ToDictionary(t => t.name);
        foreach (var shape in shapes)
        {
            if (!nodes.TryGetValue(shape.name, out var bone)) throw new InvalidOperationException("Missing face collider: " + shape.name);
            colliders.Add(new BodyCollider { data = shape, bone = bone, head = true });
        }
        bindingsDirty = true;
    }

    // Supplement only the hair groups missing an authored spine proxy. Fit the cross section
    // in the bind pose, then follow both ends of the animated spine on this actor.
    void AddTorsoCoverage(ActorClothPhysics body)
    {
        var skin = body.actorRoot.GetComponentsInChildren<SkinnedMeshRenderer>(true).First(s => s.name == "Geo_Body");
        var bones = skin.bones;
        var spineNames = new[] { "Hips", "Spine", "Spine1", "Spine2", "Neck" };
        int hairMask = segments.Aggregate(0, (mask, s) => mask | s.childData.collisionMask);
        Mesh baked = null;
        try
        {
            Vector3[] vertices = null;
            BoneWeight[] weights = null;
            for (int j = 0; j < spineNames.Length - 1; j++)
            {
                var lower = Array.Find(bones, t => t && t.name == spineNames[j]);
                var upper = Array.Find(bones, t => t && t.name == spineNames[j + 1]);
                if (!lower || !upper) continue;
                int covered = 0;
                foreach(var c in body.colliders.Where(c=>c.bone==lower))
                {
                    c.Update();
                    var p=Vector3.Lerp(lower.position,upper.position,.85f);
                    ClosestCollision(p,0,c,out var center,out float radius);
                    if((p-center).sqrMagnitude<radius*radius)covered|=c.data.collisionMask;
                }
                int missing = hairMask & ~covered;
                if (missing == 0) continue;
                if (!baked)
                {
                    baked = new Mesh(); skin.BakeMesh(baked);
                    vertices = baked.vertices; weights = skin.sharedMesh.boneWeights;
                }
                Vector3 axis = upper.position - lower.position;
                if (axis.sqrMagnitude < 1e-8f) continue;
                var lateral = Vector3.ProjectOnPlane(body.actorRoot.right, axis).normalized;
                var forward = Vector3.Cross(lateral, axis.normalized).normalized;
                var xs = new List<float>(); var zs = new List<float>();
                for (int i = 0; i < weights.Length; i++)
                {
                    var w = weights[i];
                    var dominant = bones[w.boneIndex0];
                    if (dominant != lower && dominant != upper && !(j==spineNames.Length-2 && dominant && dominant.name.Contains("Bust"))) continue;
                    var delta = skin.transform.TransformPoint(vertices[i]) - lower.position;
                    var t = Vector3.Dot(delta, axis) / axis.sqrMagnitude;
                    if (t < -.15f || t > 1.15f) continue;
                    xs.Add(Vector3.Dot(delta, lateral)); zs.Add(Vector3.Dot(delta, forward));
                }
                xs.Sort(); zs.Sort();
                var left = Array.Find(bones, t => t && t.name == "LeftArm");
                var right = Array.Find(bones, t => t && t.name == "RightArm");
                float span = left && right ? Vector3.Distance(left.position,right.position) : 2 * axis.magnitude;
                float x = span * .43f, z = span * .28f;
                Vector3 offset = Vector3.zero;
                if (xs.Count >= 12)
                {
                    int low = xs.Count / 25, high = xs.Count - 1 - low;
                    offset = lateral * ((xs[low] + xs[high]) * .5f) + forward * ((zs[low] + zs[high]) * .5f);
                    x = Mathf.Clamp((xs[high] - xs[low]) * .5f, span * .24f, span * .55f);
                    z = Mathf.Clamp((zs[high] - zs[low]) * .5f, span * .17f, span * .36f);
                }
                colliders.Add(new BodyCollider {
                    data = new ColliderData { name=lower.name, collisionMask=missing, vectorA=lower.InverseTransformVector(offset) },
                    bone=lower, end=upper, endOffset=upper.InverseTransformVector(offset),
                    lateral=lower.InverseTransformVector(lateral*x), depthAxis=lower.InverseTransformVector(forward*z), torso=true
                });
            }
        }
        finally { if (baked) Destroy(baked); }
    }
    public string DebugFirstBackStep { get; private set; }
    public Vector3[] GetTipPositions() => segments.Select(s=>s.child.position).ToArray();
    public void GetBindRotations(Dictionary<Transform,Quaternion> rotations)
    {
        foreach(var s in segments)rotations.Add(s.bone,s.localRotation);
    }

    public void Configure(Transform root, Data data, ActorQuartzPose.Profile authored = null, bool legacyGarmentsOnly = false)
    {
        if (!root || data?.dynamic == null || data.@static == null) throw new ArgumentException("Missing actor or swing metadata");
        actorRoot=root;segments.Clear();colliders.Clear();accumulator=0;bindingsDirty=true;
        isHair=data.source!=null && data.source.EndsWith("_hair",StringComparison.Ordinal);
        var transforms=root.GetComponentsInChildren<Transform>(true);
        if(transforms.GroupBy(t=>t.name).Any(g=>g.Count()>1)) throw new InvalidOperationException("Duplicate actor bone names");
        var byName=transforms.ToDictionary(t=>t.name);
        quartz = authored == null ? null : new ActorQuartzPose(root, byName, authored.drivers);
        var limits = authored?.limits.ToDictionary(l => l.bone);
        var specs=data.dynamic.ToDictionary(d=>d.name);
        int Depth(Transform t){int d=0;while(t.parent){d++;t=t.parent;}return d;}
        foreach(var spec in data.dynamic.Where(d=>includeOtherDynamic || d.name.Contains("Jacket") || d.name.Contains("Skirt"))
                    .OrderBy(d=>d.name.Contains("Skirt")?0:1)
                    .ThenBy(d=>byName.ContainsKey(d.name)?Depth(byName[d.name]):int.MaxValue))
        {
            if(!byName.TryGetValue(spec.name,out var bone)) throw new InvalidOperationException("Missing dynamic bone: "+spec.name);
            var child=Enumerable.Range(0,bone.childCount).Select(bone.GetChild).FirstOrDefault(c=>specs.ContainsKey(c.name));
            if(!child) continue;
            var segment = new Segment {data=spec, childData=specs[child.name], bone=bone,child=child,
                                       localPosition=bone.localPosition,localRotation=bone.localRotation};
            if(spec.name.Contains("Sleeve"))segment.sleeveSide=SideOf(spec.name);
            segment.authoredOnly=legacyGarmentsOnly && !spec.name.Contains("Skirt") && !spec.name.Contains("Jacket");
            if(isHair && spec.name.Contains("Hair") && !spec.name.Contains("Back"))
                segment.hybridCap=spec.name.Contains("Front") ? 12f : spec.name.Contains("Side") ? 22f : 0f;
            if(limits!=null)limits.TryGetValue(spec.name, out segment.limit);
            segments.Add(segment);
        }
        foreach(var spec in data.@static)
            if(byName.TryGetValue(spec.name,out var bone))
            {
                var collider = new BodyCollider {data=spec,bone=bone,torso=spec.name.StartsWith("Spine",StringComparison.Ordinal)};
                int side=SideOf(spec.name);
                if(side!=0 && spec.type==2)
                {
                    string prefix=side<0?"Left":"Right", part=spec.name.Substring(prefix.Length);
                    string parent=part switch {"Arm"=>"Shoulder","ForeArm"=>"Arm","Hand"=>"ForeArm","Leg"=>"UpLeg","Foot"=>"Leg","ToeBase"=>"Foot",_=>null};
                    if(parent!=null)byName.TryGetValue(prefix+parent,out collider.limbParent);
                    if(part=="ForeArm" || part=="Hand")collider.sleeveSide=side;
                }
                collider.lowerBody=spec.collisionMask!=0 && (spec.name=="Hips" || (side!=0 && (spec.name.EndsWith("Leg") || spec.name.EndsWith("Foot") || spec.name.EndsWith("ToeBase"))));
                colliders.Add(collider);
            }
        if(!isHair)AddLimbCoverage(byName);
        links.Clear();
        OpenGarment=false;
        if(authored!=null)
        {
            bool open=false, closed=false;
            var byTip = segments.ToDictionary(s=>s.child.name);
            foreach(var layer in authored.layers)
            {
                int count=layer.bones.Length;
                int pairs=count>2 && layer.around ? count : count-1;
                for(int i=0;i<pairs;i++)
                {
                    string a=layer.bones[i], b=layer.bones[(i+1)%count];
                    if(string.IsNullOrEmpty(a) || string.IsNullOrEmpty(b) || a==b ||
                       !byTip.TryGetValue(a,out var left) || !byTip.TryGetValue(b,out var right))continue;
                    left.hasChain=right.hasChain=true;
                    if(a.Contains("Skirt") || a.Contains("Jacket"))
                    {
                        if(layer.around)closed=true;else open=true;
                    }
                    links.Add(new Link {left=left,right=right,radius=Mathf.Max(0,layer.radius),
                        smoothing=Mathf.Clamp01(layer.smoothing),restLength=Vector3.Distance(root.InverseTransformPoint(left.child.position),root.InverseTransformPoint(right.child.position))});
                }
            }
            OpenGarment=open && !closed;
        }
        // A hard pose change can also move the head or hips inside the actor. Each chain
        // uses its first animated parent, outside the chain of simulated rotations.
        var dynamicBones=new HashSet<Transform>(segments.Select(s=>s.bone));
        var byAnchor=new Dictionary<Transform,Anchor>();
        anchors.Clear();
        foreach(var s in segments)
        {
            var parent=s.bone.parent?s.bone.parent:root;
            for(var t=parent;t && t!=root;t=t.parent)
                if(dynamicBones.Contains(t))parent=t.parent;
            if(!byAnchor.TryGetValue(parent,out s.anchor))
            {
                s.anchor=new Anchor{bone=parent};
                anchors.Add(s.anchor);
                byAnchor.Add(parent,s.anchor);
            }
        }
        ResetSimulation();
    }
    static int SideOf(string name) => name.StartsWith("Left",StringComparison.Ordinal)?-1:name.StartsWith("Right",StringComparison.Ordinal)?1:0;
    static bool ExtraContact(Segment s,BodyCollider c) => (s.sleeveSide!=0 && s.sleeveSide==c.sleeveSide) || (s.reachesPelvis && c.lowerBody);
    static bool Matches(Segment s,BodyCollider c) => (s.childData.collisionMask & c.data.collisionMask)!=0 || ExtraContact(s,c);

    void AddLimbCoverage(Dictionary<string,Transform> bones)
    {
        var skin=actorRoot.GetComponentsInChildren<SkinnedMeshRenderer>(true).FirstOrDefault(s=>s.name=="Geo_Body");
        if(!skin || !skin.sharedMesh)return;
        int hemMask=segments.Where(s=>s.data.name.Contains("Skirt") || s.data.name.Contains("Jacket"))
            .Aggregate(0,(mask,s)=>mask | Mathf.Max(0,s.childData.collisionMask));
        var mesh=new Mesh();
        try
        {
            skin.BakeMesh(mesh);
            var points=mesh.vertices;var weights=skin.sharedMesh.boneWeights;var skinBones=skin.bones;
            foreach(string side in new[]{"Left","Right"})
            {
                int armMask=colliders.Where(c=>c.data.name==side+"Arm" || c.data.name==side+"ForeArm").Aggregate(0,(m,c)=>m|c.data.collisionMask);
                void Fit(string from,string to,int mask,float proportion,bool arm)
                {
                    if(!bones.TryGetValue(side+from,out var parent) || !bones.TryGetValue(side+to,out var tip))return;
                    var existing=colliders.Where(c=>c.bone==tip && c.limbParent==parent && c.data.collisionMask!=0).ToArray();
                    if(existing.Length>0 && (mask & ~existing.Aggregate(0,(m,c)=>m|c.data.collisionMask))==0)return;
                    var start=skin.transform.InverseTransformPoint(parent.position);
                    var axis=skin.transform.InverseTransformPoint(tip.position)-start;
                    float len=axis.magnitude;if(len<1e-5f)return;axis/=len;
                    var near=new List<float>();var far=new List<float>();
                    for(int i=0;i<weights.Length;i++)
                    {
                        var joint=skinBones[weights[i].boneIndex0];
                        if(!joint || !joint.name.StartsWith(side+from,StringComparison.Ordinal))continue;
                        var d=points[i]-start;float u=Vector3.Dot(d,axis)/len;
                        if(u<.12f || u>.90f)continue;
                        (u<.5f?near:far).Add((d-axis*(u*len)).magnitude);
                    }
                    float Radius(List<float> values,float fallback){values.Sort();return values.Count<6?fallback:Mathf.Clamp(values[(values.Count-1)*4/5],fallback*.55f,fallback*1.7f);}
                    float localRadius=len*proportion;
                    float scale=Mathf.Abs(skin.transform.lossyScale.x)/Mathf.Max(1e-6f,Mathf.Abs(tip.lossyScale.x));
                    colliders.Add(new BodyCollider{bone=tip,limbParent=parent,sleeveSide=arm?SideOf(side):0,lowerBody=!arm,
                        data=new ColliderData{name=tip.name,type=2,collisionMask=mask,radiusA=Radius(far,localRadius*.80f)*scale,radiusB=Radius(near,localRadius)*scale}});
                }
                Fit("Arm","ForeArm",armMask,.20f,true);Fit("ForeArm","Hand",armMask,.15f,true);
                Fit("UpLeg","Leg",hemMask,.15f,false);Fit("Leg","Foot",hemMask,.10f,false);Fit("Foot","ToeBase",hemMask,.28f,false);
            }
        }
        finally {Destroy(mesh);}
    }
    public void SetMode(ActorPhysicsMode mode)
    {
        if(Mode==mode)return;
        Mode=mode;
        ResetSimulation();
        if(surfaceCollision)surfaceCollision.SetGarmentMode(SkirtDrivers>0 || ChainLinks>0,UseAuthored && OpenGarment);
    }
    public void ResetSimulation()
    {
        accumulator=0;hasPreviousAnchor=false;
        hairBodyContact?.Invalidate();
        if(fringeContact)fringeContact.Invalidate();
        foreach(var s in segments){s.bone.localPosition=s.localPosition;s.bone.localRotation=s.localRotation;s.initialized=false;}
        quartz?.Reset();
    }
    // Caller must evaluate animation before stepping; fixed timestep only.
    public void Step(float dt)
    {
        if(Mathf.Abs(dt-StepSeconds)>.00001f)throw new ArgumentOutOfRangeException(nameof(dt),"Use a fixed 1/60 second step");
        Solve(dt, true);
    }
    public void ApplyCurrentPose() => Solve(0f, false);
    static void Transport(Segment segment,Matrix4x4 fromPrevious)
    {
        if(!segment.initialized)return;
        segment.position=fromPrevious.MultiplyPoint3x4(segment.position);
        segment.previous=fromPrevious.MultiplyPoint3x4(segment.previous);
    }
    public void MoveHistory(Matrix4x4 fromPrevious)
    {
        hairBodyContact?.Invalidate();
        if(fringeContact)fringeContact.Invalidate();
        foreach(var s in segments)Transport(s,fromPrevious);
        foreach(var anchor in anchors)anchor.lastInverse=anchor.bone.worldToLocalMatrix;
    }
    internal void CaptureBlendFrame() => beforeBlend=transform.worldToLocalMatrix;
    internal void FollowBlendFrame()
    {
        // Both samples follow only the rigid change of head frame caused by the
        // blend weight. Motion within either clip still reaches the Verlet solver.
        var map=transform.localToWorldMatrix*beforeBlend;
        foreach(var s in segments)Transport(s,map);
        var inverse=map.inverse;
        foreach(var anchor in anchors)anchor.lastInverse=anchor.lastInverse*inverse;
    }
    public void MoveHistoryToCurrentAnchors(bool continuousFade=false)
    {
        if(!continuousFade)hairBodyContact?.Invalidate();
        if(fringeContact && !continuousFade)fringeContact.Invalidate();
        ActiveQuartz?.Apply();
        foreach(var anchor in anchors)anchor.transport=anchor.bone.localToWorldMatrix*anchor.lastInverse;
        foreach(var s in segments)Transport(s,s.anchor.transport);
    }
    void PrepareColliders()
    {
        foreach (var c in colliders) c.Update();
        if (!bindingsDirty) return;
        foreach (var s in segments)
            s.obstacles = colliders.Where(c => Matches(s,c)).ToArray();
        foreach (var link in links)
        {
            int mask=link.left.childData.collisionMask & link.right.childData.collisionMask;
            link.obstacles=colliders.Where(c => (c.data.collisionMask & mask)!=0 || (ExtraContact(link.left,c) && ExtraContact(link.right,c))).ToArray();
        }
        bindingsDirty = false;
    }
    void Solve(float dt, bool advance)
    {
        foreach(var s in segments)if(UseAuthored || !s.authoredOnly){s.bone.localPosition=s.localPosition;s.bone.localRotation=s.localRotation;}
        ActiveQuartz?.Apply();
        PrepareColliders();
        foreach(var s in segments)
        {
            var firstStep=!s.initialized;
            if((s.authoredOnly && !UseAuthored) || (!simulateSkirt && s.data.name.Contains("Skirt")))continue;
            var origin=s.bone.position;var restTip=s.child.position;var restDirection=restTip-origin;var length=restDirection.magnitude;
            s.poseLocal=s.bone.localRotation;
            if(length<.00001f)continue;
            if(!s.initialized){s.position=restTip;s.previous=restTip;s.initialized=true;}
            var old=s.position;
            var damping=Mathf.Clamp01(s.data.damping);
            var velocity=advance?(s.position-s.previous)*(1f-damping):Vector3.zero;
            var point=s.position+velocity+Physics.gravity*(gravityScale*dt*dt);
            var stiffness=Mathf.Clamp(s.data.stiffness,0f,.3f);
            point=Vector3.Lerp(point,restTip,stiffness);
            var radius=TipRadius(s);
            for(int iteration=0;iteration<constraintIterations;iteration++)
            {
                var direction=point-origin;if(direction.sqrMagnitude<1e-12f)direction=restDirection;
                point=origin+direction.normalized*length;
                foreach(var c in s.obstacles) point=ResolveCollision(point,radius,c);
                if(separateClothingLayers && (!UseAuthored || !s.hasChain) && s.data.name.Contains("Jacket"))point=ResolveLayer(point,s);
                if(experimentalHandCollisions && s.data.name.Contains("Jacket"))
                    foreach(var c in colliders)
                        if(c.bone.name=="LeftHand" || c.bone.name=="RightHand")
                            point=ResolveCollision(point,radius+handCollisionPadding,c);
            }
            var directionFinal=point-origin;if(directionFinal.sqrMagnitude<1e-12f)directionFinal=restDirection;
            float angleLimit=skirtMaxAngle>=0f&&s.data.name.Contains("Skirt")?skirtMaxAngle:maxAngle;
            var desired=UseAuthored && s.limit!=null ? directionFinal.normalized*length :
                Vector3.RotateTowards(restDirection,directionFinal.normalized*length,angleLimit*Mathf.Deg2Rad,0);
            if(refineContacts && s.data.name.Contains("Skirt"))desired=RefineDirection(s,origin,restDirection,desired,length,radius,angleLimit);
            // Contact is evaluated after the swing cone. Rotate on the fixed-length sphere
            // so restoring bone length cannot put the tip back inside the collider.
            for(int pass=0;pass<2;pass++)
                foreach(var c in s.obstacles)
                {
                    desired=RotateOutside(origin,desired,restDirection,.5f,radius*.75f,c);
                    desired=RotateOutside(origin,desired,restDirection,1f,radius,c);
                }
            var rotation=Quaternion.FromToRotation(restDirection,desired);
            if(firstStep && s.data.name=="RightBackJacket1_S")DebugFirstBackStep=$"origin={origin.ToString("F8")} rest={restTip.ToString("F8")} point={point.ToString("F8")} desired={desired.ToString("F8")} angle={Quaternion.Angle(Quaternion.identity,rotation):F8}";
            s.bone.rotation=rotation*s.bone.rotation;
            if(UseAuthored)ApplyLimit(s);
            if(advance){s.previous=old;s.position=s.child.position;}
        }
        if(ChainLinks>0)SolveLinks(advance);
        if(Mode==ActorPhysicsMode.Hybrid && isHair)StabilizeHair(advance);
        if(advance)hasPreviousAnchor=true;
        foreach(var anchor in anchors)anchor.lastInverse=anchor.bone.worldToLocalMatrix;
    }
    void StabilizeHair(bool advance)
    {
        foreach(var s in segments)
        {
            if(!s.initialized)continue;
            var before=s.child.position;
            if(s.hybridCap>0)
            {
                var delta=Quaternion.Inverse(s.poseLocal)*s.bone.localRotation;
                float angle=Quaternion.Angle(Quaternion.identity,delta), knee=s.hybridCap*.7f;
                if(angle>knee)
                {
                    float band=s.hybridCap-knee;
                    float limited=knee+band*(1-Mathf.Exp(-(angle-knee)/band));
                    s.bone.localRotation=s.poseLocal*Quaternion.SlerpUnclamped(Quaternion.identity,delta,limited/angle);
                }
            }
            if(!advance)continue;
            var tip=s.child.position;
            var velocity=s.position-s.previous;
            var outward=before-tip;
            if(outward.sqrMagnitude>1e-12f)
            {
                outward.Normalize();
                var anchorMotion=hasPreviousAnchor ? s.anchor.bone.TransformPoint(s.anchor.lastInverse.MultiplyPoint3x4(s.previous))-s.previous : Vector3.zero;
                velocity-=outward*Mathf.Max(0,Vector3.Dot(velocity-anchorMotion,outward));
            }
            // Also transport descendants of a limited parent. Both Verlet samples must follow the correction.
            s.position=tip;s.previous=tip-velocity;
        }
    }
    static void ApplyLimit(Segment s)
    {
        if(s.limit==null)return;
        var angles=(Quaternion.Inverse(s.poseLocal)*s.bone.localRotation).eulerAngles;
        for(int i=0;i<3;i++)angles[i]=Mathf.Clamp(Mathf.DeltaAngle(0,angles[i]),s.limit.minimum[i],s.limit.maximum[i]);
        s.bone.localRotation=s.poseLocal*Quaternion.Euler(angles);
    }
    static void OffsetTip(Segment segment,Vector3 offset)
    {
        if(offset.sqrMagnitude<1e-12f)return;
        var direction=segment.child.position-segment.bone.position;
        if(direction.sqrMagnitude<1e-12f)return;
        segment.bone.rotation=Quaternion.FromToRotation(direction,direction+offset)*segment.bone.rotation;
        ApplyLimit(segment);
    }
    // Parameters of the nearest points on two finite segments, also valid for sphere colliders.
    internal static void ClosestSegmentParameters(Vector3 a,Vector3 edge,Vector3 c,Vector3 axis,out float t,out float u)
    {
        var r=a-c;
        float aa=edge.sqrMagnitude, bb=axis.sqrMagnitude, ab=Vector3.Dot(edge,axis);
        float ar=Vector3.Dot(edge,r), br=Vector3.Dot(axis,r);
        float determinant=aa*bb-ab*ab;
        t=determinant>1e-12f ? Mathf.Clamp01((ab*br-bb*ar)/determinant) : 0;
        u=bb>1e-12f ? Mathf.Clamp01((t*ab+br)/bb) : 0;
        t=aa>1e-12f ? Mathf.Clamp01((u*ab-ar)/aa) : 0;
    }
    void SolveLinks(bool advance)
    {
        float scale=Mathf.Abs(actorRoot.lossyScale.x);
        foreach(var link in links)
        {
            var left=link.left;var right=link.right;
            if(!left.initialized || !right.initialized)continue;
            var a=left.child.position;var b=right.child.position;
            var ab=b-a;float length=ab.magnitude;
            if(length<1e-6f)continue;
            float radius=link.radius*scale;
            float minimum=Mathf.Max(2*radius,(left.childData.radiusA+right.childData.radiusA)*scale);
            float gap=Mathf.Max(0,minimum-length);
            float change=gap>0 ? gap : (link.restLength*scale-length)*link.smoothing;
            var rightPush=ab*(.5f*change/length);var leftPush=-rightPush;
            foreach(var col in link.obstacles)
            {
                var axis=col.b-col.a;
                ClosestSegmentParameters(a,ab,col.a,axis,out float t,out float u);
                var normal=(a+ab*t)-(col.a+axis*u);
                float distance=normal.magnitude,clearance=radius+Mathf.Lerp(col.ra,col.rb,u);
                if(distance>=clearance || distance<1e-6f)continue;
                var push=normal*((clearance-distance)/distance);
                float w=1-t,denominator=w*w+t*t;
                leftPush+=push*(w/denominator);rightPush+=push*(t/denominator);
            }
            OffsetTip(left,leftPush);OffsetTip(right,rightPush);
        }
        if(advance)
            foreach(var s in segments)if(s.initialized)
            {
                var tip=s.child.position;
                s.previous+=tip-s.position;
                s.position=tip;
            }
    }
    float TipRadius(Segment s) => Mathf.Clamp(s.childData.radiusA*collisionRadiusScale,0f,.04f) * Mathf.Abs(actorRoot.lossyScale.x);
    static Vector3 RotateOutside(Vector3 origin,Vector3 direction,Vector3 rest,float fraction,float radius,BodyCollider c)
    {
        var p=origin+direction*fraction;
        ClosestCollision(p,radius,c,out var center,out float clearance);
        if((p-center).sqrMagnitude>=clearance*clearance) return direction;
        var toward=center-origin;
        float d=toward.magnitude, length=direction.magnitude, lever=length*fraction;
        if(d<1e-6f || lever<1e-6f) return direction;
        var axis=toward/d;
        float cosine=(lever*lever+d*d-clearance*clearance)/(2f*lever*d);
        // A pinned root inside the shape can have no feasible direction. Keep its authored
        // orientation instead of flipping the entire strand to satisfy an impossible contact.
        if(cosine<=-1f) return direction;
        var tangent=Vector3.ProjectOnPlane(direction,axis);
        if(tangent.sqrMagnitude<1e-10f)tangent=Vector3.ProjectOnPlane(rest,axis);
        if(tangent.sqrMagnitude<1e-10f)return direction;
        cosine=Mathf.Clamp(cosine,-1,1);
        var outside=(axis*cosine+tangent.normalized*Mathf.Sqrt(1-cosine*cosine))*length;
        return Vector3.RotateTowards(rest,outside,65f*Mathf.Deg2Rad,0);
    }
    Vector3 RefineDirection(Segment segment,Vector3 origin,Vector3 rest,Vector3 original,float length,float radius,float angleLimit)
    {
        float Score(Vector3 offset) {
            float score=0;var point=origin+offset;
            foreach(var c in colliders) {
                if(!Matches(segment,c))continue;
                ClosestCollision(point,radius,c,out var closest,out var minimum);
                float depth=minimum-Vector3.Distance(point,closest);
                if(depth>0)score+=depth*depth;
            }
            return score;
        }
        var best=original;float bestScore=Score(best);if(bestScore<1e-10f)return best;
        var axis=rest.normalized;var tangent=Vector3.Cross(axis,Mathf.Abs(axis.y)<.9f?Vector3.up:Vector3.right).normalized;var bitangent=Vector3.Cross(axis,tangent).normalized;
        for(int ring=1;ring<=2;ring++) {
            float angle=angleLimit*Mathf.Deg2Rad*ring/2f;
            for(int i=0;i<12;i++) {
                float phi=i*Mathf.PI/6f;var offset=(axis*Mathf.Cos(angle)+(tangent*Mathf.Cos(phi)+bitangent*Mathf.Sin(phi))*Mathf.Sin(angle))*length;
                float score=Score(offset);if(score+1e-10f<bestScore){bestScore=score;best=offset;}
            }
        }
        return best;
    }
    Vector3 ResolveLayer(Vector3 point,Segment jacket)
    {
        int index=jacket.data.name.IndexOf("Jacket",StringComparison.Ordinal);
        if(index<0)return point;
        string prefix=jacket.data.name.Substring(0,index)+"Skirt";
        var hips=colliders.FirstOrDefault(c=>c.bone.name=="Hips");
        if(hips==null)return point;
        foreach(var skirt in segments)
        {
            if(!skirt.data.name.StartsWith(prefix,StringComparison.Ordinal))continue;
            var a=skirt.bone.position;var b=skirt.child.position;var ab=b-a;
            float t=ab.sqrMagnitude>1e-10f?Mathf.Clamp01(Vector3.Dot(point-a,ab)/ab.sqrMagnitude):0;
            var nearest=a+ab*t;var delta=point-nearest;var distance=delta.magnitude;
            if(distance>=layerSeparation)continue;
            // Push outward from the pelvis rather than selecting the nearest side,
            // which could push an already-crossed jacket farther inside the skirt.
            var outward=point-hips.bone.position;outward.y=0;
            if(outward.sqrMagnitude<1e-8f)outward=hips.bone.TransformDirection(Vector3.forward);
            point+=outward.normalized*(layerSeparation-distance);
        }
        return point;
    }
    // Type interpretation is provisional: type 1 is treated as a tapered capsule,
    // type 2 as a sphere. Verify shapes and transforms against the source game.
    static Vector3 ResolveCollision(Vector3 point,float radius,BodyCollider col)
    {
        ClosestCollision(point,radius,col,out var closest,out var minimum);
        var delta=point-closest;float length=delta.magnitude;
        if(length>=minimum)return point;
        // Resolve a coincident point in the local outward direction.
        var normal=length>1e-6f?delta/length:col.bone.TransformDirection(Vector3.forward);
        return closest+normal*minimum;
    }
    static void ClosestCollision(Vector3 point,float radius,BodyCollider col,out Vector3 closest,out float minimum)
    {
        var ab=col.b-col.a;
        float t=ab.sqrMagnitude>1e-10f?Mathf.Clamp01(Vector3.Dot(point-col.a,ab)/ab.sqrMagnitude):.5f;
        closest=col.a+ab*t;
        float bodyRadius=Mathf.Lerp(col.ra,col.rb,t);
        if(col.width>1e-6f)
        {
            var delta=point-closest;var stretched=delta+col.side*(Vector3.Dot(delta,col.side)*(bodyRadius/col.width-1));
            if(stretched.sqrMagnitude>1e-12f)bodyRadius*=delta.magnitude/stretched.magnitude;
        }
        minimum=bodyRadius+radius;
    }
    public ContactMetrics MeasureContacts()
    {
        PrepareColliders();
        var result=new ContactMetrics();
        foreach(var s in segments)
        {
            var point=s.child.position;var radius=TipRadius(s);
            foreach(var c in s.obstacles)
            {
                ClosestCollision(point,radius,c,out var closest,out var minimum);result.pairs++;
                var depth=minimum-Vector3.Distance(point,closest);
                if(c.head){result.headPairs++;if(depth>1e-5f){result.headOverlaps++;result.headDepth=Mathf.Max(result.headDepth,depth);}}
                if(c.torso){result.torsoPairs++;if(depth>1e-5f){result.torsoOverlaps++;result.torsoDepth=Mathf.Max(result.torsoDepth,depth);}}
                if(depth>0){result.overlaps++;result.totalDepth+=depth;result.maxDepth=Mathf.Max(result.maxDepth,depth);}
            }
        }
        return result;
    }
    // Diagnostic only: report the deepest proxy overlap; not a mesh collision test.
    public string DescribeDeepestContact()
    {
        float best=0; string name="none";
        foreach(var s in segments)
        {
            var point=s.child.position; var radius=Mathf.Clamp(s.childData.radiusA*collisionRadiusScale,0f,.04f);
            foreach(var c in colliders)
            {
                if(!Matches(s,c))continue;
                ClosestCollision(point,radius,c,out var closest,out var minimum);
                var depth=minimum-Vector3.Distance(point,closest);
                if(depth>best){best=depth;name=s.child.name+" / "+c.bone.name;}
            }
        }
        return $"{name} depth={best:F6}";
    }
    void OnEnable()
    {
        if(metadata && (actorRoot || transform)) Configure(actorRoot?actorRoot:transform,JsonUtility.FromJson<Data>(metadata.text));
    }
    void LateUpdate()
    {
        if(!simulateInLateUpdate || (segments.Count==0 && QuartzDrivers==0))return;
        accumulator+=Mathf.Min(Time.deltaTime,.1f);
        while(accumulator>=StepSeconds){Step(StepSeconds);accumulator-=StepSeconds;}
    }
    void OnDisable(){if(segments.Count>0 || QuartzDrivers>0)ResetSimulation();}
}

