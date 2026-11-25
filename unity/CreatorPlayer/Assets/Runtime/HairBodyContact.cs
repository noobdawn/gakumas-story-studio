using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

// Preserve strand cross sections by distributing a common surface clearance along
// the skinned strand. Each new sample starts from the animation and cloth solution.
internal sealed class HairBodyContact
{
    sealed class Joint
    {
        public Transform bone;
        public float weight,increment;
        public Vector3 raw,displayed;
    }
    sealed class Strand
    {
        public Joint[] joints;
        public bool left,back;
        public Vector3 shift;
        public float maxOffset;
    }
    sealed class Skin
    {
        readonly SkinnedMeshRenderer skin;
        readonly Mesh baked=new Mesh{name="Hair body contact samples"};
        readonly List<Vector3> points=new List<Vector3>();
        readonly ContactMeshTree[] patches;
        readonly Transform space;
        bool visible;
        internal bool Visible=>skin.enabled && !skin.forceRenderingOff && skin.gameObject.activeInHierarchy;
        public Skin(SkinnedMeshRenderer skin,Transform space,Dictionary<Transform,(int group,float weight)> bindings,int groupCount)
        {
            this.skin=skin;this.space=space;baked.MarkDynamic();Bake();
            var bones=skin.bones;var weights=skin.sharedMesh.boneWeights;var groups=new int[bones.Length];var influence=new float[bones.Length];
            for(int i=0;i<bones.Length;i++)
            {
                groups[i]=-1;
                for(var b=bones[i];b;b=b.parent)if(bindings.TryGetValue(b,out var joint)){groups[i]=joint.group;influence[i]=joint.weight;break;}
            }
            var tris=baked.triangles;patches=new ContactMeshTree[groupCount];
            for(int g=0;g<groupCount;g++)
            {
                float Part(int b,float v)=>groups[b]==g?influence[b]*v:0;
                var mobility=new float[weights.Length];var faces=new List<int>();
                for(int i=0;i<weights.Length;i++)
                {
                    var w=weights[i];mobility[i]=Part(w.boneIndex0,w.weight0)+Part(w.boneIndex1,w.weight1)+Part(w.boneIndex2,w.weight2)+Part(w.boneIndex3,w.weight3);
                }
                for(int i=0;i<tris.Length;i+=3)
                {
                    int a=tris[i],b=tris[i+1],c=tris[i+2];
                    if(Mathf.Max(mobility[a],Mathf.Max(mobility[b],mobility[c]))<.04f)continue;
                    faces.Add(a);faces.Add(b);faces.Add(c);
                }
                if(faces.Count>0)patches[g]=new ContactMeshTree(faces,points,mobility);
            }
        }
        void Bake()
        {
            skin.BakeMesh(baked);baked.GetVertices(points);
            var map=space.worldToLocalMatrix*skin.transform.localToWorldMatrix;
            for(int i=0;i<points.Count;i++)points[i]=map.MultiplyPoint3x4(points[i]);
        }
        public void Collect(){visible=Visible;if(!visible)return;Bake();foreach(var patch in patches)patch?.Refit(points);}
        public bool Crosses(int group,ContactMeshTree body,Vector3 move)=>visible && patches[group]!=null && patches[group].Crosses(body,move);
        public void Dispose()=>UnityEngine.Object.Destroy(baked);
    }
    readonly BodyContactSurface body;
    readonly Strand[] strands;
    readonly Skin[] skins;
    int revision=-1;
    double lastTime=-1;
    bool applied;
    public static HairBodyContact Create(ActorClothPhysics hair,BodyContactSurface body,IEnumerable<Transform> dynamicBones)
    {
        var bones=new HashSet<Transform>(dynamicBones);var groups=new List<Strand>();
        var bindings=new Dictionary<Transform,(int,float)>();
        var children=bones.ToLookup(b=>b.parent);
        foreach(var root in bones.Where(b=>!bones.Contains(b.parent) || children[b.parent].Count()!=1))
        {
            if(root.name.Contains("Front") || root.name.Contains("Bangs"))continue;
            var chain=new List<Transform>();float length=0;
            for(var b=root;b;)
            {
                chain.Add(b);var child=children[b].Count()==1?children[b].First():null;
                if(!child)break;length+=Vector3.Distance(body.Point(b),body.Point(child));b=child;
            }
            if(chain.Count<2 || length<.09f)continue;
            var joints=new List<Joint>();float distance=0,last=0;
            foreach(var b in chain)
            {
                if(joints.Count>0)distance+=Vector3.Distance(body.Point(joints[joints.Count-1].bone),body.Point(b));
                float w=Mathf.Clamp01(distance/Mathf.Min(length*.45f,.065f));
                joints.Add(new Joint{bone=b,weight=w,increment=w-last});bindings[b]=(groups.Count,w);last=w;
            }
            groups.Add(new Strand{joints=joints.ToArray(),left=root.name.StartsWith("Left",StringComparison.Ordinal),back=root.name.Contains("Back"),maxOffset=Mathf.Min(.14f,length*.55f)});
        }
        if(groups.Count==0)return null;
        var meshes=hair.GetComponentsInChildren<SkinnedMeshRenderer>(true).Where(s=>s.enabled && s.sharedMesh && s.sharedMesh.boneWeights.Length==s.sharedMesh.vertexCount);
        return new HairBodyContact(body,groups.ToArray(),meshes.Select(s=>new Skin(s,body.space,bindings,groups.Count)).ToArray());
    }
    HairBodyContact(BodyContactSurface body,Strand[] strands,Skin[] skins){this.body=body;this.strands=strands;this.skins=skins;}
    void Restore()
    {
        if(!applied)return;
        foreach(var strand in strands)foreach(var j in strand.joints)
            if((j.bone.localPosition-j.displayed).sqrMagnitude<1e-12f)j.bone.localPosition=j.raw;
        applied=false;
    }
    internal void Invalidate(){Restore();revision=-1;lastTime=-1;foreach(var strand in strands)strand.shift=Vector3.zero;}
    public void Dispose(){foreach(var skin in skins)skin.Dispose();}
    bool Hits(int group,Vector3 shift)
    {
        foreach(var mesh in skins)if(mesh.Crosses(group,body.obstacles,shift))return true;
        return false;
    }
    readonly Vector3[] directions=new Vector3[32];
    Vector3 Clearance(int id,float dt)
    {
        var strand=strands[id];var prior=dt>0?strand.shift:Vector3.zero;float last=prior.magnitude;
        bool rawHit=Hits(id,Vector3.zero);
        if(!rawHit)
        {
            if(last<1e-5f)return Vector3.zero;
            var release=Vector3.MoveTowards(prior,Vector3.zero,dt*.40f);
            if(!Hits(id,release))return release;
            if(!Hits(id,prior))return prior;
        }
        if(last>.001f)
        {
            var reduced=Vector3.MoveTowards(prior,Vector3.zero,dt*.35f);
            if(!Hits(id,reduced))return reduced;
            if(!Hits(id,prior))return prior;
            var extended=prior.normalized*Mathf.Min(strand.maxOffset,last+.006f);
            if(!Hits(id,extended))return extended;
        }
        var front=body.Forward*(strand.back?-1:1);var outward=body.Right*(strand.left?-1:1);
        var bend=body.BendNormal(strand.left);var up=Vector3.Cross(body.Forward,body.Right).normalized;
        directions[0]=last>.001f?prior/last:bend;directions[1]=bend;directions[2]=-bend;
        directions[3]=front;directions[4]=-front;directions[5]=outward;directions[6]=(outward+front).normalized;
        directions[7]=(up+front).normalized;directions[8]=(outward+up).normalized;
        int count=9;
        for(int y=-1;y<=1;y++)for(int z=-1;z<=1;z++)for(int x=-1;x<=1;x++)
        {
            if(x==0 && y==0 && z==0)continue;
            var dir=(x*outward+y*up+z*front).normalized;bool duplicate=false;
            for(int k=0;k<count;k++)if(Vector3.Dot(directions[k],dir)>.995f){duplicate=true;break;}
            if(!duplicate)directions[count++]=dir;
        }
        // Follow the previous contact around the moving cuff before considering
        // a different side. A shorter displacement from the raw pose can otherwise
        // move a strand across an entire arm in a single displayed frame.
        if(last>.001f)
        {
            for(float delta=.006f;delta<.126f;delta+=.008f)for(int i=0;i<count;i++)
            {
                var candidate=Vector3.ClampMagnitude(prior+directions[i]*delta,strand.maxOffset);
                if(!Hits(id,candidate))return candidate;
            }
        }
        const float step=.012f;
        for(float radius=step;radius<strand.maxOffset+step;radius+=step)
        {
            float r=Mathf.Min(radius,strand.maxOffset);
            for(int i=0;i<count;i++)
            {
                var dir=directions[i];if(dir.sqrMagnitude<.5f || (i==1 && last<=.001f))continue;
                if(Hits(id,dir*r))continue;
                float low=Mathf.Max(0,r-step),high=r;
                for(int j=0;j<3;j++){float mid=(low+high)*.5f;if(Hits(id,dir*mid))low=mid;else high=mid;}
                var result=dir*Mathf.Min(r,high+.0015f);
                if(dt>0 && last>.001f){var smooth=Vector3.MoveTowards(prior,result,dt*.7f);if(!Hits(id,smooth))return smooth;}
                return Hits(id,result)?dir*r:result;
            }
        }
        return prior;
    }
    public void SetDisplay(bool enabled,int frame,double clock)
    {
        if(!enabled){Invalidate();return;}
        if(frame>=0 && revision==frame)return;
        Restore();if(!Array.Exists(skins,s=>s.Visible) || !body.PrepareHair())return;
        foreach(var mesh in skins)mesh.Collect();
        bool continuous=lastTime>=0 && clock>lastTime && clock-lastTime<=.25;
        for(int i=0;i<strands.Length;i++)
        {
            var strand=strands[i];strand.shift=Clearance(i,continuous?(float)(clock-lastTime):0);
            var move=body.space.TransformVector(strand.shift);
            foreach(var j in strand.joints){j.raw=j.bone.localPosition;if(j.increment>0)j.bone.position+=move*j.increment;j.displayed=j.bone.localPosition;}
        }
        applied=true;lastTime=clock;revision=frame;
    }
}
