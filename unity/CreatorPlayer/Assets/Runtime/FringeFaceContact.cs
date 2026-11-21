using System;
using System.Collections.Generic;
using UnityEngine;

// Test the visible skinned fringe against the displayed face. Limit the rotations
// of the strands that crossed the skin, so both sides of a strand and its outline
// continue to use the original skeleton, thickness, normals and materials.
public sealed class FringeFaceContact : MonoBehaviour
{
    public struct Metrics { public int samples,before,after; public float beforeDepth,afterDepth; }
    [Serializable] public struct RotationSample { public string bone; public Quaternion solved,displayed; }
    sealed class Joint
    {
        public Transform bone;
        public Quaternion bind,solved,checkedRotation,previousSolved,displayed,spatial,carried;
        public float reach;
    }
    sealed class Strand
    {
        public readonly List<Joint> joints=new List<Joint>();
        public float weight,limit,checkedWeight,conservative,lower,upper;
        public bool touchesForehead,repair;
        public void SetWeight(float value)
        {
            weight=value;
            foreach(var joint in joints)
                joint.bone.localRotation=Quaternion.SlerpUnclamped(joint.bind,joint.solved,value);
        }
    }
    struct Influence
    {
        public int a,b,c,d;
        public bool Movable => a>=0 || b>=0 || c>=0 || d>=0;
        public void Mark(Strand[] groups)
        {
            if(a>=0)groups[a].touchesForehead=true;
            if(b>=0)groups[b].touchesForehead=true;
            if(c>=0)groups[c].touchesForehead=true;
            if(d>=0)groups[d].touchesForehead=true;
        }
        public void Limit(Strand[] groups,float fraction)
        {
            if(a>=0)groups[a].limit=Mathf.Min(groups[a].limit,fraction);
            if(b>=0)groups[b].limit=Mathf.Min(groups[b].limit,fraction);
            if(c>=0)groups[c].limit=Mathf.Min(groups[c].limit,fraction);
            if(d>=0)groups[d].limit=Mathf.Min(groups[d].limit,fraction);
        }
    }
    struct Sample
    {
        public int a,b,c;
        public float bindZ,padding;
        public Vector3 Position(Vector3[] v)
        {
            if(b<0)return v[a];
            return c<0?(v[a]+v[b])*.5f:(v[a]+v[b]+v[c])/3f;
        }
    }
    enum CheckPhase { Raw, Padded, SpatialResult, Refine, Guard, Measure }
    sealed class HairMesh
    {
        readonly SkinnedMeshRenderer skin;
        readonly Transform face;
        readonly ForeheadSurface surface;
        readonly Mesh baked=new Mesh{name="Fringe contact samples"};
        readonly List<Vector3> vertices=new List<Vector3>();
        readonly List<Sample> samples=new List<Sample>();
        readonly Influence[] influence;
        readonly Vector3[] points;
        readonly int[] active;
        float[] spatialDepth,trialDepth;
        public bool HasSamples=>samples.Count>0;
        public bool Visible=>skin.enabled && !skin.forceRenderingOff && skin.gameObject.activeInHierarchy;

        public HairMesh(SkinnedMeshRenderer skin,Transform face,ForeheadSurface surface,Dictionary<Transform,int> groups,Strand[] strands)
        {
            this.skin=skin;this.face=face;this.surface=surface;
            baked.MarkDynamic();skin.BakeMesh(baked);baked.GetVertices(vertices);
            points=new Vector3[vertices.Count];influence=new Influence[vertices.Count];
            var weights=skin.sharedMesh.boneWeights;
            if(weights.Length!=vertices.Count){active=Array.Empty<int>();return;}
            var bones=skin.bones;
            var strandByBone=new int[bones.Length];
            for(int i=0;i<bones.Length;i++)
            {
                strandByBone[i]=-1;
                for(var t=bones[i];t;t=t.parent)if(groups.TryGetValue(t,out int id)){strandByBone[i]=id;break;}
            }
            int Id(float w,int bone)=>w>.0001f?strandByBone[bone]:-1;
            var toFace=face.worldToLocalMatrix*skin.transform.localToWorldMatrix;
            var used=new HashSet<int>();
            var front=new bool[vertices.Count];
            for(int i=0;i<vertices.Count;i++)
            {
                var w=weights[i];
                influence[i]=new Influence{a=Id(w.weight0,w.boneIndex0),b=Id(w.weight1,w.boneIndex1),
                    c=Id(w.weight2,w.boneIndex2),d=Id(w.weight3,w.boneIndex3)};
                points[i]=toFace.MultiplyPoint3x4(vertices[i]);
                front[i]=surface.IsFrontHair(points[i]);
            }
            void Add(int a,int b,int c)
            {
                if(!influence[a].Movable && (b<0 || !influence[b].Movable) && (c<0 || !influence[c].Movable))return;
                var s=new Sample{a=a,b=b,c=c,padding=surface.margin};
                var bind=s.Position(points);s.bindZ=bind.z;
                // Only protect the authored outer surface. Roots that intentionally sit
                // inside the scalp must not pull otherwise free strands toward bind pose.
                if(surface.TryDepth(bind,out var z))
                {
                    if(bind.z-z<0)return;
                    s.padding=Mathf.Min(s.padding,Mathf.Max(0,bind.z-z-.0002f));
                }
                influence[a].Mark(strands);
                if(b>=0)influence[b].Mark(strands);
                if(c>=0)influence[c].Mark(strands);
                samples.Add(s);used.Add(a);if(b>=0)used.Add(b);if(c>=0)used.Add(c);
            }
            var edges=new HashSet<ulong>();
            void Edge(int a,int b) {
                if(a>b){int t=a;a=b;b=t;}
                if(edges.Add(((ulong)(uint)a<<32)|(uint)b))Add(a,b,-1);
            }
            for(int i=0;i<front.Length;i++)if(front[i])Add(i,-1,-1);
            var indices=baked.triangles;
            for(int i=0;i+2<indices.Length;i+=3)
            {
                int a=indices[i],b=indices[i+1],c=indices[i+2];
                if(!front[a]||!front[b]||!front[c])continue;
                Add(a,b,c);Edge(a,b);Edge(b,c);Edge(c,a);
            }
            active=new int[used.Count];used.CopyTo(active);
            spatialDepth=new float[samples.Count];
            trialDepth=new float[samples.Count];
        }
        public void Dispose(){UnityEngine.Object.Destroy(baked);}
        public bool Check(Strand[] groups,CheckPhase phase,ref Metrics metrics)
        {
            skin.BakeMesh(baked);baked.GetVertices(vertices);
            var toFace=face.worldToLocalMatrix*skin.transform.localToWorldMatrix;
            foreach(int i in active)points[i]=toFace.MultiplyPoint3x4(vertices[i]);
            bool hit=false;
            bool padded=phase==CheckPhase.Raw || phase==CheckPhase.Padded;
            bool spatial=padded || phase==CheckPhase.SpatialResult;
            bool trial=phase==CheckPhase.Raw || phase==CheckPhase.Refine || phase==CheckPhase.Guard;
            for(int i=0;i<samples.Count;i++)
            {
                var s=samples[i];
                var p=s.Position(points);
                if(spatial)spatialDepth[i]=float.NegativeInfinity;
                if(trial)trialDepth[i]=float.NegativeInfinity;
                if(!surface.TryDepth(p,out var z,p.z-s.padding))continue;
                float depth=z-p.z;
                if(spatial)spatialDepth[i]=depth;
                if(trial)trialDepth[i]=depth;
                if(depth>.00005f)
                {
                    if(padded){metrics.before++;metrics.beforeDepth=Mathf.Max(metrics.beforeDepth,depth);}
                    else {metrics.after++;metrics.afterDepth=Mathf.Max(metrics.afterDepth,depth);}
                }
                float deficit=depth+s.padding;
                if(padded){if(deficit<=.0001f)continue;}
                else
                {
                    if(phase!=CheckPhase.Refine && phase!=CheckPhase.Guard)continue;
                    float clearance=phase==CheckPhase.Refine ? .25f*s.padding : 0;
                    if(depth+clearance<=Mathf.Max(.00005f,spatialDepth[i]+.000002f))continue;
                }
                hit=true;
                // Estimate the safe fraction along the return to the authored strand.
                // The next pass reskins the actual curved, multi-joint motion.
                float travel=s.bindZ-p.z;
                float fraction=padded && travel>deficit?Mathf.Clamp(1-(deficit+.00035f)/travel,0,.82f):0;
                influence[s.a].Limit(groups,fraction);
                if(s.b>=0)influence[s.b].Limit(groups,fraction);
                if(s.c>=0)influence[s.c].Limit(groups,fraction);
            }
            if(padded)metrics.samples+=samples.Count;
            return hit;
        }
        public void RelaxBounds(Strand[] groups)
        {
            for(int i=0;i<samples.Count;i++)
            {
                var s=samples[i];
                float target=.000035f-s.padding*.25f, raw=trialDepth[i];
                if(raw<=target)continue;
                // Use the skin clearance at both ends of the actual correction.
                // Points outside the depth query were already clear of the padding.
                float safe=float.IsNegativeInfinity(spatialDepth[i])?-s.padding:spatialDepth[i];
                if(raw<=safe+.000002f)continue;
                float fraction=Mathf.Clamp01((target-safe)/(raw-safe));
                influence[s.a].Limit(groups,fraction);
                if(s.b>=0)influence[s.b].Limit(groups,fraction);
                if(s.c>=0)influence[s.c].Limit(groups,fraction);
            }
        }
        public void AcceptDepths(){var old=spatialDepth;spatialDepth=trialDepth;trialDepth=old;}
    }

    readonly List<HairMesh> meshes=new List<HairMesh>();
    Strand[] groups;
    ForeheadSurface surface;
    bool diagnostics;
    int rawRevision=-1,faceRevision=-1;
    int checkedSlot=-1;
    double checkedTime,displayTime;
    Quaternion checkedHead;
    Vector3 checkedPosition;
    bool nearContact,settling;
    public Metrics current;
    static float Reach(Transform bone,Transform head)
    {
        float length=0;
        foreach(Transform child in bone)
        {
            var offset=head.InverseTransformVector(child.position-bone.position);
            length=Mathf.Max(length,offset.magnitude+Reach(child,head));
        }
        return length;
    }
    public bool Configure(MeshFilter face,Material[] materials,bool report)
    {
        surface=new ForeheadSurface(face.sharedMesh,materials);diagnostics=report;
        if(!surface.Available)return false;
        var bind=new Dictionary<Transform,Quaternion>();
        GetComponent<ActorClothPhysics>().GetBindRotations(bind);
        var roots=new Dictionary<Transform,int>();
        var membership=new Dictionary<Transform,int>();
        var strands=new List<Strand>();
        foreach(var pair in bind)
        {
            var root=pair.Key;
            for(var p=root.parent;p && p!=transform;p=p.parent)if(bind.ContainsKey(p))root=p;
            if(!roots.TryGetValue(root,out int id)){id=strands.Count;roots.Add(root,id);strands.Add(new Strand());}
            strands[id].joints.Add(new Joint{bone=pair.Key,bind=pair.Value,reach=Reach(pair.Key,face.transform)});
            membership.Add(pair.Key,id);
        }
        groups=strands.ToArray();
        foreach(var skin in GetComponentsInChildren<SkinnedMeshRenderer>(true))
        {
            if(!skin.enabled || !skin.sharedMesh)continue;
            var m=new HairMesh(skin,face.transform,surface,membership,groups);
            if(m.HasSamples)meshes.Add(m);else m.Dispose();
        }
        return meshes.Count>0;
    }
    public void SetFacePose(Vector3[] vertices)=>surface.Update(vertices);
    public RotationSample[] ReadRotations()
    {
        var samples=new List<RotationSample>();
        foreach(var group in groups)if(group.touchesForehead)
            foreach(var joint in group.joints)
                samples.Add(new RotationSample{bone=joint.bone.name,solved=joint.solved,displayed=joint.bone.localRotation});
        return samples.ToArray();
    }
    public void Invalidate(){rawRevision=-1;checkedSlot=-1;current=default;}
    bool CanReuse(int slot,double clock)
    {
        if(settling || slot!=checkedSlot || clock<=checkedTime || faceRevision!=surface.Revision ||
           Quaternion.Angle(checkedHead,transform.rotation)>=6f || (transform.position-checkedPosition).sqrMagnitude>=.025f*.025f)return false;
        float tolerance=nearContact?2f:5f;
        foreach(var strand in groups)if(strand.touchesForehead)
            foreach(var joint in strand.joints)
                if(Quaternion.Angle(joint.checkedRotation,joint.bone.localRotation)>tolerance)return false;
        return true;
    }
    public void SetDisplay(bool active,int revision,bool adaptive=false,double clock=0)
    {
        if(!active || !meshes.Exists(m=>m.Visible)){Invalidate();return;}
        if(revision>=0 && revision==rawRevision && faceRevision==surface.Revision)return;
        int slot=(int)Math.Floor(clock*15+1e-9);
        bool continuous=revision>=0 && rawRevision>=0 && checkedSlot>=0 && clock>=displayTime && clock-displayTime<=.25;
        bool reuse=adaptive && continuous && revision!=rawRevision && CanReuse(slot,clock);
        foreach(var group in groups)
        {
            if(revision<0 || rawRevision!=revision)
                foreach(var joint in group.joints)joint.solved=joint.bone.localRotation;
            if(!group.touchesForehead)continue;
            float start=reuse?group.checkedWeight:1;
            if(start!=1 || revision==rawRevision)group.SetWeight(start);
            else group.weight=1;
            if(adaptive && !reuse)foreach(var joint in group.joints)joint.checkedRotation=joint.solved;
        }
        rawRevision=revision;faceRevision=surface.Revision;current=default;
        if(!reuse)
        {
            CheckContact(revision>=0);
            if(revision>=0 && nearContact)RefineContact();
            settling=continuous && ApplyTemporalContact((float)(clock-displayTime));
            checkedSlot=slot;checkedTime=clock;checkedHead=transform.rotation;checkedPosition=transform.position;
            foreach(var group in groups)group.checkedWeight=group.weight;
        }
        else if(diagnostics)foreach(var mesh in meshes)if(mesh.Visible)mesh.Check(groups,CheckPhase.Measure,ref current);
        displayTime=clock;
        foreach(var group in groups)if(group.touchesForehead)foreach(var joint in group.joints)
        {
            joint.displayed=joint.bone.localRotation;
            joint.previousSolved=joint.solved;
        }
    }
    void CheckContact(bool trackDepth)
    {
        for(int pass=0;pass<3;pass++)
        {
            foreach(var group in groups)group.limit=1;
            bool hit=false;var measurement=new Metrics();
            var phase=trackDepth && pass==0?CheckPhase.Raw:CheckPhase.Padded;
            foreach(var mesh in meshes)if(mesh.Visible)hit|=mesh.Check(groups,phase,ref measurement);
            if(pass==0){nearContact=hit;current=measurement;}
            if(!hit)
            {
                current.after=measurement.before;
                current.afterDepth=measurement.beforeDepth;
                return;
            }
            bool changed=false;
            foreach(var group in groups)
            {
                if(group.limit>=1 || group.weight==0)continue;
                float w=group.weight*group.limit;
                group.SetWeight(pass==2 || w<.025f?0:w);
                changed=true;
            }
            if(!changed)break;
        }
        foreach(var mesh in meshes)if(mesh.Visible)mesh.Check(groups,CheckPhase.SpatialResult,ref current);
    }
    void RefineContact()
    {
        // The conservative pass can take a whole strand to bind when one
        // triangle just enters its padding. Use the measured clearances to
        // restore free swing, then test the actual weighted mesh.
        foreach(var group in groups){group.lower=group.conservative=group.weight;group.upper=group.touchesForehead?1:group.weight;group.limit=1;}
        foreach(var mesh in meshes)if(mesh.Visible)mesh.RelaxBounds(groups);
        foreach(var group in groups)if(group.touchesForehead && group.weight<1)
            group.SetWeight(Mathf.Lerp(group.conservative,1,group.limit));
        for(int pass=0;pass<4;pass++)
        {
            if(AcceptPose(CheckPhase.Refine,true))return;
            foreach(var group in groups)
            {
                if(group.limit<1)group.upper=group.weight;else group.lower=group.weight;
                if(group.lower<group.upper)group.SetWeight(pass==3?group.lower:(group.lower+group.upper)*.5f);
            }
        }
        if(!AcceptPose(CheckPhase.Guard,true))
            foreach(var group in groups)if(group.weight!=group.conservative)group.SetWeight(group.conservative);
    }
    bool ApplyTemporalContact(float elapsed)
    {
        bool changed=false;
        foreach(var group in groups)if(group.touchesForehead)
        {
            // Only the change in contact correction uses this distance budget.
            // Adjacent joints share it; their rotations all affect the same tips.
            float travel=0;
            foreach(var joint in group.joints)
            {
                joint.spatial=joint.bone.localRotation;
                joint.carried=joint.displayed*Quaternion.Inverse(joint.previousSolved)*joint.solved;
                travel+=joint.reach*Mathf.Deg2Rad*Quaternion.Angle(joint.carried,joint.spatial);
            }
            if(travel<=.00012f)continue;
            float fraction=Mathf.Min(1-Mathf.Exp(-12*elapsed),surface.margin*16*elapsed/travel);
            foreach(var joint in group.joints)joint.bone.localRotation=Quaternion.Slerp(joint.carried,joint.spatial,fraction);
            changed=true;
        }
        if(!changed)return false;
        // Padding gives a strand space to approach contact gradually. A displayed
        // sample crossing the skin must return toward the tested spatial solution.
        // Some authored samples already intersect at bind, so compare each point
        // against the depth achieved at that same point on this frame.
        if(AcceptPose())return true;
        foreach(var group in groups)if(group.limit<1)
            foreach(var joint in group.joints)joint.bone.localRotation=joint.displayed;
        if(AcceptPose())return true;
        // Shared vertices can make the previous pose unsafe for a second strand.
        // Start from the complete previous display and find the smallest safe
        // fraction of the spatial repair, keeping unrelated strands in place.
        foreach(var group in groups)if(group.touchesForehead)
            foreach(var joint in group.joints)joint.bone.localRotation=joint.displayed;
        if(AcceptPose())return true;
        foreach(var group in groups)group.repair=group.limit<1;
        for(int pass=0;pass<2;pass++)
        {
            SetRepair(1);
            if(AcceptPose())break;
            foreach(var group in groups)if(group.touchesForehead && (pass==1 || group.limit<1))group.repair=true;
        }
        float low=0,high=1;
        for(int pass=0;pass<5;pass++)
        {
            float trial=(low+high)*.5f;
            SetRepair(trial);
            if(AcceptPose())high=trial;else low=trial;
        }
        SetRepair(high);
        return true;
    }
    void SetRepair(float fraction)
    {
        foreach(var group in groups)if(group.repair)
            foreach(var joint in group.joints)joint.bone.localRotation=Quaternion.Slerp(joint.displayed,joint.spatial,fraction);
    }
    bool AcceptPose(CheckPhase phase=CheckPhase.Guard,bool keepDepths=false)
    {
        foreach(var group in groups)group.limit=1;
        var counts=new Metrics();
        bool hit=false;
        foreach(var mesh in meshes)if(mesh.Visible)hit|=mesh.Check(groups,phase,ref counts);
        if(hit)return false;
        // Keep the measured reference for temporal guards without reskinning.
        if(keepDepths)foreach(var mesh in meshes)if(mesh.Visible)mesh.AcceptDepths();
        current.after=counts.after;current.afterDepth=counts.afterDepth;
        return true;
    }
    void OnDestroy(){foreach(var mesh in meshes)mesh.Dispose();}
}
