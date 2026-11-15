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
    }
    sealed class BodyCollider { public ColliderData data; public Transform bone; }
    public struct ContactMetrics { public int pairs, overlaps; public float maxDepth, totalDepth; }

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
    readonly List<BodyCollider> colliders = new List<BodyCollider>();
    float accumulator;
    public int SegmentCount => segments.Count;
    public int ColliderCount => colliders.Count;
    public SkirtSurfaceCollision surfaceCollision;
    // The hair prefab does not own the body's static proxies. Share their live
    // transform bindings with this actor instance, never with another actor.
    public void AddExternalColliders(ActorClothPhysics bodySolver)
    {
        if(!bodySolver || bodySolver==this)throw new ArgumentException("Missing body collider source");
        colliders.AddRange(bodySolver.colliders);
    }
    public string DebugFirstBackStep { get; private set; }
    public Vector3[] GetTipPositions() => segments.Select(s=>s.child.position).ToArray();

    public void Configure(Transform root, Data data)
    {
        if (!root || data?.dynamic == null || data.@static == null) throw new ArgumentException("Missing actor or swing metadata");
        actorRoot=root;segments.Clear();colliders.Clear();accumulator=0;
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
            if(byName.TryGetValue(spec.name,out var bone)) colliders.Add(new BodyCollider {data=spec,bone=bone});
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
            var velocity=(s.position-s.previous)*(1f-damping);
            var point=s.position+velocity+Physics.gravity*(gravityScale*dt*dt);
            var stiffness=Mathf.Clamp(s.data.stiffness,0f,.3f);
            point=Vector3.Lerp(point,restTip,stiffness);
            var radius=Mathf.Clamp(s.childData.radiusA*collisionRadiusScale,0f,.04f);
            for(int iteration=0;iteration<constraintIterations;iteration++)
            {
                var direction=point-origin;if(direction.sqrMagnitude<1e-12f)direction=restDirection;
                point=origin+direction.normalized*length;
                foreach(var c in colliders)
                {
                    if((s.childData.collisionMask & c.data.collisionMask)==0)continue;
                    point=ResolveCollision(point,radius,c);
                }
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
            var rotation=Quaternion.FromToRotation(restDirection,desired);
            if(firstStep && s.data.name=="RightBackJacket1_S")DebugFirstBackStep=$"origin={origin.ToString("F8")} rest={restTip.ToString("F8")} point={point.ToString("F8")} desired={desired.ToString("F8")} angle={Quaternion.Angle(Quaternion.identity,rotation):F8}";
            s.bone.rotation=rotation*s.bone.rotation;
            s.previous=old;s.position=s.child.position;
        }
        if(surfaceCollision){
            var oldTips=segments.Select(x=>x.child.position).ToArray();surfaceCollision.Step();
            for(int i=0;i<segments.Count;i++){var delta=segments[i].child.position-oldTips[i];segments[i].position+=delta;segments[i].previous+=delta;}
        }
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
        var d=col.data;var center=col.bone.TransformPoint(d.vectorA);closest=center;float bodyRadius=Mathf.Max(d.radiusA,d.radiusB);
        if(d.type==1)
        {
            int axis=Mathf.Clamp(Mathf.RoundToInt(d.vectorB.x),0,2);
            Vector3 dir=col.bone.TransformDirection(axis==0?Vector3.right:axis==1?Vector3.up:Vector3.forward).normalized;
            float half=Mathf.Max(0,d.vectorB.y*.5f-bodyRadius);
            float x=Mathf.Clamp(Vector3.Dot(point-center,dir),-half,half);closest=center+dir*x;
            float blend=half>1e-5f?(x+half)/(2*half):.5f;bodyRadius=Mathf.Lerp(d.radiusA,d.radiusB,blend);
        }
        minimum=bodyRadius+radius;
    }
    public ContactMetrics MeasureContacts()
    {
        var result=new ContactMetrics();
        foreach(var s in segments)
        {
            var point=s.child.position;var radius=Mathf.Clamp(s.childData.radiusA*collisionRadiusScale,0f,.04f);
            foreach(var c in colliders)
            {
                if((s.childData.collisionMask & c.data.collisionMask)==0)continue;
                ClosestCollision(point,radius,c,out var closest,out var minimum);result.pairs++;
                var depth=minimum-Vector3.Distance(point,closest);
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

