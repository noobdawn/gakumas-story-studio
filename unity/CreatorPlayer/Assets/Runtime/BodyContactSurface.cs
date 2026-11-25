using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

// Uses one baked body for the skirt, sleeves and the obstacle surfaces seen by the hair.
// All geometry here is in the original body renderer's coordinate system.
internal sealed class BodyContactSurface
{
    internal readonly Transform space;
    readonly Transform hips,neck,leftArm,rightArm;
    readonly Transform[] elbows,wrists;
    internal readonly ContactMeshTree obstacles,hands;
    readonly Sleeve[] sleeves;
    List<Vector3> posed;
    bool mapsReady;
    internal Vector3 Forward {get;private set;}
    internal Vector3 Right {get;private set;}

    static float SleeveWeight(string[] names,BoneWeight w,string side)
    {
        float Part(int i,float v)=>names[i].StartsWith(side,StringComparison.Ordinal) && names[i].Contains("Sleeve")?v:0;
        return Part(w.boneIndex0,w.weight0)+Part(w.boneIndex1,w.weight1)+Part(w.boneIndex2,w.weight2)+Part(w.boneIndex3,w.weight3);
    }
    static bool IsArm(string name,string side) => name.StartsWith(side,StringComparison.Ordinal) &&
        (name.Contains("Arm") || name.Contains("Hand") || name.Contains("Sleeve") || name.Contains("Wrist"));
    static bool IsTorso(string name) => name.StartsWith("Spine",StringComparison.Ordinal) || name=="Hips" || name.Contains("Bust") || name.Contains("Shoulder") || name=="Neck";
    internal static BodyContactSurface Create(SkinnedMeshRenderer skin,Mesh baked,List<Vector3> points)
    {
        var bones=skin.bones;
        Transform Find(string n)=>Array.Find(bones,b=>b && b.name==n);
        var hips=Find("Hips");var neck=Find("Neck");var left=Find("LeftArm");var right=Find("RightArm");
        var weights=skin.sharedMesh.boneWeights;
        if(!hips || !neck || !left || !right || weights.Length!=points.Count)return null;
        return new BodyContactSurface(skin.transform,bones,weights,baked.triangles,points,hips,neck,left,right);
    }
    BodyContactSurface(Transform space,Transform[] bones,BoneWeight[] weights,int[] triangles,List<Vector3> points,
                       Transform hips,Transform neck,Transform leftArm,Transform rightArm)
    {
        this.space=space;this.hips=hips;this.neck=neck;this.leftArm=leftArm;this.rightArm=rightArm;
        string[] names=bones.Select(b=>b?b.name:"").ToArray();
        var dominant=weights.Select(w=>names[w.boneIndex0]).ToArray();
        var sleeveList=new List<Sleeve>();
        elbows=new Transform[2];wrists=new Transform[2];
        List<int> Select(Func<int,int,int,bool> use)
        {
            var output=new List<int>();
            for(int k=0;k<triangles.Length;k+=3)
            {
                int a=triangles[k],b=triangles[k+1],c=triangles[k+2];
                if(use(a,b,c)){output.Add(a);output.Add(b);output.Add(c);}
            }
            return output;
        }
        int Score(bool a,bool b,bool c)=>(a?1:0)+(b?1:0)+(c?1:0);
        var islands=Enumerable.Range(0,weights.Length).ToArray();
        int Island(int i){while(islands[i]!=i){islands[i]=islands[islands[i]];i=islands[i];}return i;}
        for(int i=0;i<triangles.Length;i+=3){int group=Island(triangles[i]);islands[Island(triangles[i+1])]=group;islands[Island(triangles[i+2])]=group;}
        var barrier=dominant.Select(n=>IsTorso(n) || n.Contains("Skirt") || n.Contains("Jacket") || n.Contains("Leg") || n.EndsWith("Foot") || n.Contains("ToeBase")).ToArray();
        var hand=new bool[barrier.Length];
        for(int side=0;side<2;side++)
        {
            string prefix=side==0?"Left":"Right";
            var sw=weights.Select(w=>SleeveWeight(names,w,prefix)).ToArray();
            var arm=dominant.Select(n=>IsArm(n,prefix)).ToArray();
            for(int i=0;i<arm.Length;i++)
            {
                bool fingerOrPalm=arm[i] && dominant[i].Contains("Hand") && dominant[i]!=prefix+"Hand_H";
                hand[i]|=fingerOrPalm;
                barrier[i]|=(arm[i] && !fingerOrPalm) || sw[i]>.1f;
            }
            Transform Find(string suffix)=>Array.Find(bones,b=>b && b.name==prefix+suffix);
            var shoulder=Find("Arm");var elbow=elbows[side]=Find("ForeArm");var wrist=wrists[side]=Find("Hand");
            if(!sw.Any(w=>w>.1f))continue;
            if(!shoulder || !elbow || !wrist)continue;
            var armIslands=new HashSet<int>(Enumerable.Range(0,weights.Length).Where(i=>dominant[i]==prefix+"Arm").Select(Island));
            armIslands.IntersectWith(Enumerable.Range(0,weights.Length).Where(i=>dominant[i]==prefix+"ForeArm").Select(Island));
            var fore=dominant.Select(n=>n.StartsWith(prefix+"ForeArm",StringComparison.Ordinal) || n.StartsWith(prefix+"Hand",StringComparison.Ordinal)).ToArray();
            bool Skin(int i)=>armIslands.Count==0?sw[i]<.01f:armIslands.Contains(Island(i));
            var obstacle=Select((a,b,c)=>Score(fore[a],fore[b],fore[c])>=2 && Skin(a) && Skin(b) && Skin(c));
            var outer=Select((a,b,c)=>sw[a]+sw[b]+sw[c]>=1.35f);
            var edit=Select((a,b,c)=>sw[a]+sw[b]+sw[c]>.01f);
            if(obstacle.Count==0 || outer.Count==0)continue;
            int shell=outer.GroupBy(Island).OrderByDescending(g=>g.Count()).First().Key;
            var shellFaces=Select((a,b,c)=>Island(a)==shell && sw[a]+sw[b]+sw[c]>.01f);
            var bare=Enumerable.Range(0,points.Count).Where(i=>dominant[i].StartsWith(prefix+"Arm",StringComparison.Ordinal) && Skin(i)).ToArray();
            sleeveList.Add(new Sleeve(space,shoulder,elbow,wrist,points,weights,sw,outer,edit,shellFaces,obstacle,bare));
        }
        sleeves=sleeveList.ToArray();obstacles=new ContactMeshTree(Select((a,b,c)=>Score(barrier[a],barrier[b],barrier[c])>=2),points);
        bool Full(int i)=>barrier[i] || hand[i];
        hands=new ContactMeshTree(Select((a,b,c)=>Score(Full(a),Full(b),Full(c))>=2 && Score(barrier[a],barrier[b],barrier[c])<2),points);
        UpdateBasis();
    }
    internal Vector3 Point(Transform joint)=>space.InverseTransformPoint(joint.position);
    void UpdateBasis()
    {
        Right=(Point(rightArm)-Point(leftArm)).normalized;
        Forward=Vector3.Cross(Right,Point(neck)-Point(hips)).normalized;
    }
    internal bool Update(List<Vector3> points,Mesh mesh)
    {
        UpdateBasis();posed=points;mapsReady=false;
        bool changed=false;foreach(var sleeve in sleeves)changed|=sleeve.Solve(points,Right,mesh);
        return changed;
    }
    internal bool PrepareHair()
    {
        if(posed==null || Forward.sqrMagnitude<.5f)return false;
        if(!mapsReady){obstacles.Refit(posed);hands.Refit(posed);mapsReady=true;}
        return true;
    }
    internal Vector3 BendNormal(bool left)
    {
        int side=left?0:1;if(!elbows[side] || !wrists[side])return Forward;
        var e=Point(elbows[side]);return Vector3.Cross(e-Point(left?leftArm:rightArm),Point(wrists[side])-e).normalized;
    }

    sealed class Sleeve
    {
        struct Attachment { public int vertex,a,b,c;public Vector3 bary; }
        readonly Transform space,shoulder,elbow,wrist;
        readonly ContactDepthMap fore;
        readonly int[] bare,ids,remap,representative,outer;
        readonly Vector2Int[] edges;
        readonly Attachment[] lining;
        readonly int[] editableFaces;
        readonly Vector3[] oldNormals,newNormals,separation,liningNormals;
        readonly List<Vector3> normals=new List<Vector3>();
        readonly float[] mobility,restLength,push,radii=new float[12];
        readonly Vector3[] rest,points;
        public Sleeve(Transform space,Transform shoulder,Transform elbow,Transform wrist,List<Vector3> bind,BoneWeight[] skinning,float[] weights,
                      List<int> cuff,List<int> editable,List<int> shell,List<int> obstacle,int[] bare)
        {
            this.space=space;this.shoulder=shoulder;this.elbow=elbow;this.wrist=wrist;this.bare=bare;
            fore=new ContactDepthMap(obstacle,bind.Count);ids=editable.Distinct().ToArray();
            remap=new int[bind.Count];var weld=new Dictionary<(Vector3Int,BoneWeight),int>();var reps=new List<int>();
            foreach(int i in ids)
            {
                var key=(Vector3Int.RoundToInt(bind[i]*100000f),skinning[i]);
                if(!weld.TryGetValue(key,out int k)){weld[key]=k=reps.Count;reps.Add(i);}
                remap[i]=k;
            }
            representative=reps.ToArray();mobility=reps.Select(i=>Mathf.Clamp01((weights[i]-.045f)/.40f)).ToArray();
            rest=new Vector3[reps.Count];points=new Vector3[reps.Count];push=new float[reps.Count];
            outer=cuff.Select(i=>remap[i]).ToArray();var pairs=new HashSet<Vector2Int>();
            void Add(int a,int b){a=remap[a];b=remap[b];if(a!=b && mobility[a]+mobility[b]>0)pairs.Add(new Vector2Int(Math.Min(a,b),Math.Max(a,b)));}
            for(int i=0;i<editable.Count;i+=3){int a=editable[i],b=editable[i+1],c=editable[i+2];Add(a,b);Add(b,c);Add(c,a);}
            edges=pairs.ToArray();restLength=new float[edges.Length];
            editableFaces=editable.Select(i=>remap[i]).ToArray();oldNormals=new Vector3[reps.Count];newNormals=new Vector3[reps.Count];
            var shellSet=new HashSet<int>(shell.Select(i=>remap[i]));var attach=new List<Attachment>();
            for(int j=0;j<reps.Count;j++)
            {
                if(shellSet.Contains(j) || mobility[j]<=0)continue;
                var p=bind[reps[j]];float best=.016f*.016f;var match=new Attachment{vertex=-1};
                for(int k=0;k<shell.Count;k+=3)
                {
                    int a=shell[k],b=shell[k+1],c=shell[k+2];var va=bind[a];var vb=bind[b];var vc=bind[c];
                    if((p-Vector3.Max(Vector3.Min(p,Vector3.Max(va,Vector3.Max(vb,vc))),Vector3.Min(va,Vector3.Min(vb,vc)))).sqrMagnitude>=best)continue;
                    var bary=ClosestWeights(p,va,vb,vc);float d=(p-va*bary.x-vb*bary.y-vc*bary.z).sqrMagnitude;
                    if(d<best){best=d;match=new Attachment{vertex=j,a=remap[a],b=remap[b],c=remap[c],bary=bary};}
                }
                if(match.vertex>=0)attach.Add(match);
            }
            lining=attach.ToArray();separation=new Vector3[lining.Length];liningNormals=new Vector3[lining.Length];
        }
        static Vector3 ClosestWeights(Vector3 p,Vector3 a,Vector3 b,Vector3 c)
        {
            var ab=b-a;var ac=c-a;var ap=p-a;float d1=Vector3.Dot(ab,ap),d2=Vector3.Dot(ac,ap);
            if(d1<=0 && d2<=0)return Vector3.right;
            var bp=p-b;float d3=Vector3.Dot(ab,bp),d4=Vector3.Dot(ac,bp);if(d3>=0 && d4<=d3)return Vector3.up;
            float vc=d1*d4-d3*d2;if(vc<=0 && d1>=0 && d3<=0){float v=d1/Mathf.Max(1e-12f,d1-d3);return new Vector3(1-v,v,0);}
            var cp=p-c;float d5=Vector3.Dot(ab,cp),d6=Vector3.Dot(ac,cp);if(d6>=0 && d5<=d6)return Vector3.forward;
            float vb=d5*d2-d1*d6;if(vb<=0 && d2>=0 && d6<=0){float w=d2/Mathf.Max(1e-12f,d2-d6);return new Vector3(1-w,0,w);}
            float va=d3*d6-d5*d4;if(va<=0 && d4>=d3 && d5>=d6){float w=(d4-d3)/Mathf.Max(1e-12f,d4-d3+d5-d6);return new Vector3(0,1-w,w);}
            float n=va+vb+vc;if(n<1e-16f)return Vector3.right;
            return new Vector3(va,vb,vc)/n;
        }
        void Normals(Vector3[] positions,Vector3[] result)
        {
            Array.Clear(result,0,result.Length);
            for(int i=0;i<editableFaces.Length;i+=3){int a=editableFaces[i],b=editableFaces[i+1],c=editableFaces[i+2];var n=Vector3.Cross(positions[b]-positions[a],positions[c]-positions[a]);result[a]+=n;result[b]+=n;result[c]+=n;}
        }
        public bool Solve(List<Vector3> verts,Vector3 lateral,Mesh mesh)
        {
            var o=space.InverseTransformPoint(shoulder.position);var e=space.InverseTransformPoint(elbow.position);
            var upper=e-o;float length=upper.magnitude;if(length<1e-5f)return false;upper/=length;
            var lower=(space.InverseTransformPoint(wrist.position)-e).normalized;
            float bend=Vector3.Dot(upper,lower);if(bend>.65f)return false;
            var travel=-upper;fore.Build(verts,travel,lateral);
            bool touching=false;
            for(int i=0;i<representative.Length;i++)
            {
                points[i]=rest[i]=verts[representative[i]];
                if(mobility[i]>.08f && fore.Sample(points[i],out float lo,out float hi) && lo<.006f && hi>-.006f)touching=true;
            }
            if(!touching)return false;
            Normals(rest,oldNormals);
            for(int i=0;i<lining.Length;i++)
            {
                var t=lining[i];separation[i]=rest[t.vertex]-rest[t.a]*t.bary.x-rest[t.b]*t.bary.y-rest[t.c]*t.bary.z;
                liningNormals[i]=Vector3.Cross(rest[t.b]-rest[t.a],rest[t.c]-rest[t.a]);
            }
            for(int i=0;i<edges.Length;i++)restLength[i]=Vector3.Distance(rest[edges[i].x],rest[edges[i].y]);
            Array.Clear(radii,0,radii.Length);
            foreach(int i in bare)
            {
                var d=verts[i]-o;float along=Vector3.Dot(d,upper);float u=along/length;
                float r=(d-along*upper).magnitude;
                if(u<.06f || u>1.02f || r>length*.32f)continue;
                int bin=Mathf.Clamp((int)(u*(radii.Length-1)),0,radii.Length-1);
                radii[bin]=Mathf.Max(radii[bin],r+.0015f);
            }
            float Clearance(Vector3 p)=>fore.Sample(p,out _,out float hi)?Mathf.Clamp(hi+.002f,0,length*.64f):0;
            const int passes=80;
            for(int pass=0;pass<passes;pass++)
            {
                if(pass>0)for(int j=0;j<edges.Length;j++)
                {
                    int i=pass%2==0?j:edges.Length-1-j;int a=edges[i].x,b=edges[i].y;
                    var d=points[b]-points[a];float n=d.magnitude;if(n<1e-6f)continue;
                    d*=.82f*(1-restLength[i]/n)/(mobility[a]+mobility[b]);
                    points[a]+=d*mobility[a];points[b]-=d*mobility[b];
                }
                for(int i=0;i<lining.Length;i++)
                {
                    var t=lining[i];var basePoint=points[t.a]*t.bary.x+points[t.b]*t.bary.y+points[t.c]*t.bary.z;
                    var before=liningNormals[i];var after=Vector3.Cross(points[t.b]-points[t.a],points[t.c]-points[t.a]);
                    var offset=separation[i];if(before.sqrMagnitude>1e-14f && after.sqrMagnitude>1e-14f)offset=Quaternion.FromToRotation(before,after)*offset;
                    points[t.vertex]=Vector3.Lerp(points[t.vertex],basePoint+offset,.82f*mobility[t.vertex]);
                }
                if(pass%4!=0 && pass!=passes-1)continue;
                for(int j=0;j<points.Length;j++)
                {
                    var d=points[j]-o;float along=Vector3.Dot(d,upper),u=along/length;var radial=d-upper*along;
                    float r=radial.magnitude;
                    if(u>.06f && u<1 && r>1e-6f)
                    {
                        float idx=u*(radii.Length-1);int k=(int)idx;
                        float target=Mathf.Lerp(radii[k],radii[k+1],idx-k);
                        if(r<target)points[j]+=radial*((target-r)*mobility[j]/r);
                    }
                    push[j]=0;
                }
                for(int j=0;j<outer.Length;j+=3)
                {
                    int a=outer[j],b=outer[j+1],c=outer[j+2];var va=points[a];var vb=points[b];var vc=points[c];
                    float h=Mathf.Max(Clearance((va+vb+vc)/3),Mathf.Max(Clearance((va+vb)*.5f),Mathf.Max(Clearance((va+vc)*.5f),Clearance((vb+vc)*.5f))));
                    push[a]=Mathf.Max(push[a],Mathf.Max(h,Clearance(va)));push[b]=Mathf.Max(push[b],Mathf.Max(h,Clearance(vb)));push[c]=Mathf.Max(push[c],Mathf.Max(h,Clearance(vc)));
                }
                for(int j=0;j<points.Length;j++)points[j]+=travel*(push[j]*mobility[j]);
            }
            Normals(points,newNormals);mesh.GetNormals(normals);
            foreach(int i in ids)
            {
                int k=remap[i];verts[i]+=points[k]-rest[k];
                if(normals.Count==verts.Count && oldNormals[k].sqrMagnitude>1e-14f && newNormals[k].sqrMagnitude>1e-14f)
                    normals[i]=Quaternion.FromToRotation(oldNormals[k],newNormals[k])*normals[i];
            }
            if(normals.Count==verts.Count)mesh.SetNormals(normals);
            return true;
        }
    }
}
