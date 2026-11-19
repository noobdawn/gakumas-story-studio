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
        public BodyCollider[] obstacles;
        public Anchor anchor;
    }
    sealed class Anchor
    {
        public Transform bone;
        public Matrix4x4 lastInverse, transport;
    }
    sealed class BodyCollider
    {
        public ColliderData data;
        public Transform bone, end;
        public Vector3 endOffset, lateral, depthAxis;
        public Vector3 a, b, side;
        public float ra, rb, width;
        public bool head, torso;
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
            if (data.type == 1)
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
    bool bindingsDirty;
    float accumulator;
    public int SegmentCount => segments.Count;
    public int ColliderCount => colliders.Count;
    public SkirtSurfaceCollision surfaceCollision;
    public FringeFaceContact fringeContact;
    // The hair prefab does not own the body's static proxies. Share their live
    // transform bindings with this actor instance, never with another actor.
    public void AddExternalColliders(ActorClothPhysics bodySolver)
    {
        if(!bodySolver || bodySolver==this)throw new ArgumentException("Missing body collider source");
        colliders.AddRange(bodySolver.colliders);
        AddTorsoCoverage(bodySolver);
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
        var spineNames = new[] { "Spine", "Spine1", "Spine2", "Neck" };
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
                int covered = body.colliders.Where(c => c.bone == lower).Aggregate(0, (mask,c) => mask | c.data.collisionMask);
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
                    if (dominant != lower && dominant != upper) continue;
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

    public void Configure(Transform root, Data data)
    {
        if (!root || data?.dynamic == null || data.@static == null) throw new ArgumentException("Missing actor or swing metadata");
        actorRoot=root;segments.Clear();colliders.Clear();accumulator=0;bindingsDirty=true;
        var transforms=root.GetComponentsInChildren<Transform>(true);
        if(transforms.GroupBy(t=>t.name).Any(g=>g.Count()>1)) throw new InvalidOperationException("Duplicate actor bone names");
        var byName=transforms.ToDictionary(t=>t.name);
        var specs=data.dynamic.ToDictionary(d=>d.name);
        int Depth(Transform t){int d=0;while(t.parent){d++;t=t.parent;}return d;}
        foreach(var spec in data.dynamic.Where(d=>includeOtherDynamic || d.name.Contains("Jacket") || d.name.Contains("Skirt"))
                    .OrderBy(d=>d.name.Contains("Skirt")?0:1)
                    .ThenBy(d=>byName.ContainsKey(d.name)?Depth(byName[d.name]):int.MaxValue))
        {
            if(!byName.TryGetValue(spec.name,out var bone)) throw new InvalidOperationException("Missing dynamic bone: "+spec.name);
            var child=Enumerable.Range(0,bone.childCount).Select(bone.GetChild).FirstOrDefault(c=>specs.ContainsKey(c.name));
            if(!child) continue;
            segments.Add(new Segment {data=spec, childData=specs[child.name], bone=bone,child=child,
                                      localPosition=bone.localPosition,localRotation=bone.localRotation});
        }
        foreach(var spec in data.@static)
            if(byName.TryGetValue(spec.name,out var bone)) colliders.Add(new BodyCollider {data=spec,bone=bone,torso=spec.name.StartsWith("Spine",StringComparison.Ordinal)});
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
    public void ResetSimulation()
    {
        accumulator=0;
        foreach(var s in segments){s.bone.localPosition=s.localPosition;s.bone.localRotation=s.localRotation;s.initialized=false;}
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
        foreach(var s in segments)Transport(s,fromPrevious);
        foreach(var anchor in anchors)anchor.lastInverse=anchor.bone.worldToLocalMatrix;
    }
    public void MoveHistoryToCurrentAnchors()
    {
        foreach(var anchor in anchors)anchor.transport=anchor.bone.localToWorldMatrix*anchor.lastInverse;
        foreach(var s in segments)Transport(s,s.anchor.transport);
    }
    void PrepareColliders()
    {
        foreach (var c in colliders) c.Update();
        if (!bindingsDirty) return;
        foreach (var s in segments)
            s.obstacles = colliders.Where(c => (s.childData.collisionMask & c.data.collisionMask) != 0).ToArray();
        bindingsDirty = false;
    }
    void Solve(float dt, bool advance)
    {
        PrepareColliders();
        foreach(var s in segments){s.bone.localPosition=s.localPosition;s.bone.localRotation=s.localRotation;}
        foreach(var s in segments)
        {
            var firstStep=!s.initialized;
            if(!simulateSkirt && s.data.name.Contains("Skirt"))continue;
            var origin=s.bone.position;var restTip=s.child.position;var restDirection=restTip-origin;var length=restDirection.magnitude;
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
                if(separateClothingLayers && s.data.name.Contains("Jacket"))point=ResolveLayer(point,s);
                if(experimentalHandCollisions && s.data.name.Contains("Jacket"))
                    foreach(var c in colliders)
                        if(c.bone.name=="LeftHand" || c.bone.name=="RightHand")
                            point=ResolveCollision(point,radius+handCollisionPadding,c);
            }
            var directionFinal=point-origin;if(directionFinal.sqrMagnitude<1e-12f)directionFinal=restDirection;
            float angleLimit=skirtMaxAngle>=0f&&s.data.name.Contains("Skirt")?skirtMaxAngle:maxAngle;
            var desired=Vector3.RotateTowards(restDirection,directionFinal.normalized*length,angleLimit*Mathf.Deg2Rad,0);
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
            if(advance){s.previous=old;s.position=s.child.position;}
        }
        foreach(var anchor in anchors)anchor.lastInverse=anchor.bone.worldToLocalMatrix;
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
                if((segment.childData.collisionMask & c.data.collisionMask)==0)continue;
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
                if((s.childData.collisionMask & c.data.collisionMask)==0)continue;
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
        if(!simulateInLateUpdate || segments.Count==0)return;
        accumulator+=Mathf.Min(Time.deltaTime,.1f);
        while(accumulator>=StepSeconds){Step(StepSeconds);accumulator-=StepSeconds;}
    }
    void OnDisable(){if(segments.Count>0)ResetSimulation();}
}

