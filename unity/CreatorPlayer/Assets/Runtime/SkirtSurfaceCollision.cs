using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

// A final-pose garment contact pass. All geometric tests use renderer-local coordinates.
// The source skinned mesh stays intact and remains the input for the next pose.
public sealed class SkirtSurfaceCollision : MonoBehaviour
{
    public struct Metrics { public int samples, overlaps, triangleSamples, triangleOverlaps, lowerTriangleOverlaps; public float totalDepth, triangleDepth; }
    sealed class Leg
    {
        public Transform upper, knee;
        public Vector3 a, axis, span, low, high;
        public float length, radius;
        public void Update(Matrix4x4 worldToMesh)
        {
            a = worldToMesh.MultiplyPoint3x4(upper.position);
            var b = worldToMesh.MultiplyPoint3x4(knee.position);
            span = b-a;
            length = span.magnitude; axis = length > 1e-6f ? span/length : Vector3.down;
            low = Vector3.Min(a,b)-Vector3.one*radius;
            high = Vector3.Max(a,b)+Vector3.one*radius;
        }
        public Vector3 Offset(Vector3 p) => p - (a + axis * Mathf.Clamp(Vector3.Dot(p-a,axis),0,length));
    }
    struct Triangle { public int a,b,c; }
    readonly Leg[] legs = new Leg[2];
    readonly List<Leg> contactLegs = new List<Leg>();
    readonly List<int> cloth = new List<int>(), vertexSamples = new List<int>();
    readonly List<Triangle> triangles = new List<Triangle>(), triangleSamples = new List<Triangle>();
    readonly List<Vector2Int> clothEdges = new List<Vector2Int>();
    readonly List<Vector3> vertices = new List<Vector3>();
    Vector3[] restOut, outward;
    bool[] movable;
    float[] shifts;
    Transform hips;
    GarmentBodyEnvelope envelope;
    Vector3 bindRight, bindUp;
    Mesh baked;
    SkinnedMeshRenderer skin;
    MeshRenderer display;
    bool diagnostics, originalEnabled, measureOnly, authoredGarment, openGarment;
    int lastRevision = -1;
    bool hasSkirt;
    float hemBelowKnee;
    internal BodyContactSurface bodyContact;
    public Metrics before, after;
    public bool ProjectionRan { get; private set; }
    public string Description => hasSkirt ? $"garment vertices={cloth.Count} triangles={triangles.Count} body triangles={envelope.TriangleCount} thigh radii={legs[0].radius:F4}/{legs[1].radius:F4} hem below knees={hemBelowKnee:F4}" : "no skirt panels";

    public bool Configure(SkinnedMeshRenderer renderer, bool report, bool observeOnly, bool authored = false, bool open = false)
    {
        skin=renderer; originalEnabled=skin.enabled; diagnostics=report; measureOnly=observeOnly; authoredGarment=authored; openGarment=open;
        baked=new Mesh {name="GSS posed clothing"};baked.MarkDynamic();skin.BakeMesh(baked);baked.GetVertices(vertices);
        bodyContact=BodyContactSurface.Create(skin,baked,vertices);
        hasSkirt=ConfigureSkirt();
        return hasSkirt || bodyContact!=null;
    }
    bool ConfigureSkirt()
    {
        var bones=skin.bones;
        bool[] garment=bones.Select(b=>b && (b.name.Contains("Skirt") || b.name.Contains("Jacket"))).ToArray();
        bool[] legBones=bones.Select(b=>b && (b.name.StartsWith("LeftUpLeg") || b.name.StartsWith("RightUpLeg") ||
            b.name.StartsWith("LeftLeg") || b.name.StartsWith("RightLeg"))).ToArray();
        if(!garment.Contains(true))return false;
        hips=Array.Find(bones,b=>b && b.name=="Hips");
        if(!hips)return false;
        for(int i=0;i<2;i++)
        {
            string side=i==0?"Left":"Right";
            legs[i]=new Leg {upper=Array.Find(bones,b=>b && b.name==side+"UpLeg"),knee=Array.Find(bones,b=>b && b.name==side+"Leg")};
            if(!legs[i].upper || !legs[i].knee)return false;
        }
        var weights=skin.sharedMesh.boneWeights;
        if(weights.Length!=vertices.Count)return false;
        var toMesh=skin.transform.worldToLocalMatrix;
        var radii=new[]{new List<float>(),new List<float>()};
        foreach(var leg in legs)leg.Update(toMesh);
        movable=new bool[weights.Length];restOut=new Vector3[weights.Length];outward=new Vector3[weights.Length];shifts=new float[weights.Length];
        var samples=new List<int>();
        var middle=(legs[0].a+legs[1].a)*.5f;
        var down=(legs[0].axis+legs[1].axis).normalized;
        var meshToHips=hips.worldToLocalMatrix*skin.transform.localToWorldMatrix;
        bindRight=meshToHips.MultiplyVector((legs[0].a-legs[1].a).normalized);bindUp=meshToHips.MultiplyVector(-down);
        bool[] legSurface=new bool[weights.Length];
        for(int i=0;i<weights.Length;i++)
        {
            var w=weights[i];
            float clothWeight=(garment[w.boneIndex0]?w.weight0:0)+(garment[w.boneIndex1]?w.weight1:0)
                +(garment[w.boneIndex2]?w.weight2:0)+(garment[w.boneIndex3]?w.weight3:0);
            float legWeight=(legBones[w.boneIndex0]?w.weight0:0)+(legBones[w.boneIndex1]?w.weight1:0)
                +(legBones[w.boneIndex2]?w.weight2:0)+(legBones[w.boneIndex3]?w.weight3:0);
            legSurface[i]=clothWeight<.01f && legWeight>.20f;
            if(clothWeight>.1f)
            {
                var radial=Vector3.ProjectOnPlane(vertices[i]-middle,down);
                if(radial.sqrMagnitude>1e-8f)
                {
                    movable[i]=true;cloth.Add(i);
                    restOut[i]=meshToHips.MultiplyVector(radial.normalized);
                    if(clothWeight>=.5f)samples.Add(i);
                }
            }
            if(clothWeight>.01f || w.weight0<.75f)continue;
            for(int side=0;side<2;side++)
            {
                var leg=legs[side];
                if(bones[w.boneIndex0]!=leg.upper || leg.length<=1e-6f)continue;
                float t=Vector3.Dot(vertices[i]-leg.a,leg.axis)/leg.length;
                if(t>=.15f && t<=.8f)radii[side].Add(leg.Offset(vertices[i]).magnitude);
            }
        }
        if(cloth.Count==0)return false;
        var kneeMiddle=(legs[0].a+legs[0].span+legs[1].a+legs[1].span)*.5f;
        hemBelowKnee=cloth.Max(i=>Vector3.Dot(vertices[i]-kneeMiddle,down));
        for(int i=0;i<2;i++)
        {
            var values=radii[i];values.Sort();
            legs[i].radius=values.Count>=16 ? Mathf.Clamp(values[(int)((values.Count-1)*.85f)]+.004f,.035f,.12f)
                : Mathf.Clamp(legs[i].length*.145f,.035f,.10f);
            contactLegs.Add(legs[i]);
            string side=i==0?"Left":"Right";
            var foot=Array.Find(bones,b=>b && b.name==side+"Foot");
            var toe=Array.Find(bones,b=>b && b.name==side+"ToeBase");
            void AddLower(Transform from,Transform to,float fraction)
            {
                if(!from || !to)return;
                var shape=new Leg{upper=from,knee=to};shape.Update(toMesh);
                if(shape.length<1e-5f)return;
                var cross=new List<float>();
                for(int v=0;v<weights.Length;v++)if(bones[weights[v].boneIndex0]==from)
                {
                    float u=Vector3.Dot(vertices[v]-shape.a,shape.axis)/shape.length;
                    if(u>.15f && u<.8f)cross.Add(shape.Offset(vertices[v]).magnitude);
                }
                cross.Sort();float fallback=shape.length*fraction;
                shape.radius=cross.Count>=8?Mathf.Clamp(cross[(cross.Count-1)*4/5]+.002f,fallback*.6f,fallback*1.6f):fallback;
                contactLegs.Add(shape);
            }
            AddLower(legs[i].knee,foot,.095f);AddLower(foot,toe,.28f);
        }
        // Baked topology remains readable when CPU access to the imported index buffer is disabled.
        var indices=baked.triangles;
        envelope=new GarmentBodyEnvelope(indices,legSurface,movable);
        var seenEdges = new HashSet<ulong>();
        void AddEdge(int a,int b)
        {
            if(a>b){int t=a;a=b;b=t;}
            if(seenEdges.Add(((ulong)(uint)a<<32)|(uint)b))clothEdges.Add(new Vector2Int(a,b));
        }
        for(int i=0;i+2<indices.Length;i+=3)
        {
            int a=indices[i],b=indices[i+1],c=indices[i+2];
            if((movable[a]?1:0)+(movable[b]?1:0)+(movable[c]?1:0)>=2)
            {
                triangles.Add(new Triangle{a=a,b=b,c=c});
                AddEdge(a,b);AddEdge(b,c);AddEdge(c,a);
            }
        }
        int count=Math.Min(512,samples.Count);
        for(int i=0;i<count;i++)vertexSamples.Add(samples[(int)((long)i*samples.Count/count)]);
        count=Math.Min(1200,triangles.Count);
        for(int i=0;i<count;i++)triangleSamples.Add(triangles[(int)((long)i*triangles.Count/count)]);
        return true;
    }

    // Distance along the original outward side to the capsule exit. A front panel which
    // crossed the axis must still emerge in front. Nearest-surface projection can invert it.
    float Exit(Vector3 p,Vector3 n)
    {
        float push=0;
        foreach(var leg in contactLegs)
        {
            float r=leg.radius+.003f;
            var delta=leg.Offset(p);
            if(openGarment && (delta.sqrMagnitude>=r*r || Vector3.Dot(delta,n)<=0))continue;
            if(delta.sqrMagnitude>r*r*2.25f)continue;
            float along=Vector3.Dot(delta,n);
            float square=r*r-(delta.sqrMagnitude-along*along);
            if(square>0)push=Mathf.Max(push,Mathf.Sqrt(square)-along);
        }
        return openGarment ? push : Mathf.Max(push,envelope.Exit(p,n));
    }
    float Depth(Vector3 p) => Mathf.Max(0,legs[0].radius-legs[0].Offset(p).magnitude,legs[1].radius-legs[1].Offset(p).magnitude);
    Metrics Measure()
    {
        var m=new Metrics{samples=vertexSamples.Count,triangleSamples=triangleSamples.Count*4};
        foreach(int i in vertexSamples){float d=Depth(vertices[i]);if(d>0){m.overlaps++;m.totalDepth+=d;}}
        void Point(Vector3 p){float d=Depth(p);if(d>1e-5f){m.triangleOverlaps++;m.triangleDepth+=d;}
            foreach(var leg in contactLegs)if(leg!=legs[0] && leg!=legs[1] && leg.Offset(p).sqrMagnitude<(leg.radius-.00001f)*(leg.radius-.00001f)){m.lowerTriangleOverlaps++;break;}}
        foreach(var t in triangleSamples)
        {
            var a=vertices[t.a];var b=vertices[t.b];var c=vertices[t.c];
            Point((a+b+c)/3);Point((a+b)*.5f);Point((b+c)*.5f);Point((c+a)*.5f);
        }
        return m;
    }
    void Constraint(int a,int b,int c)
    {
        bool edge=c<0;
        var n=outward[a]+outward[b];var p=vertices[a]+vertices[b];
        if(!edge){n+=outward[c];p+=vertices[c];}
        if(n.sqrMagnitude<1e-8f)return;
        float distance=Exit(p/(edge?2:3),n.normalized);
        if(distance<.0001f)return;
        if(movable[a])shifts[a]=Mathf.Max(shifts[a],distance);
        if(movable[b])shifts[b]=Mathf.Max(shifts[b],distance);
        if(!edge&&movable[c])shifts[c]=Mathf.Max(shifts[c],distance);
    }
    static bool EdgeHitsLeg(Vector3 a,Vector3 edge,Leg leg)
    {
        ActorClothPhysics.ClosestSegmentParameters(a,edge,leg.a,leg.span,out float t,out float u);
        return ((a-leg.a)+edge*t-leg.span*u).sqrMagnitude < leg.radius*leg.radius;
    }
    static bool InsideFace(Vector3 p,Vector3 a,Vector3 b,Vector3 c,Vector3 normal)
    {
        return Vector3.Dot(Vector3.Cross(b-a,p-a),normal)>=0 &&
               Vector3.Dot(Vector3.Cross(c-b,p-b),normal)>=0 &&
               Vector3.Dot(Vector3.Cross(a-c,p-c),normal)>=0;
    }
    static bool FaceHitsLeg(Vector3 a,Vector3 b,Vector3 c,Leg leg)
    {
        var ab=b-a;var ac=c-a;var normal=Vector3.Cross(ab,ac);
        float r2=leg.radius*leg.radius*normal.sqrMagnitude;
        float start=Vector3.Dot(leg.a-a,normal), end=start+Vector3.Dot(leg.span,normal);
        if(start*end>0 && Mathf.Min(start*start,end*end)>=r2)return false;
        // Edge half-planes are unchanged by projection along the triangle normal.
        if(r2>0 && ((start*start<r2 && InsideFace(leg.a,a,b,c,normal)) ||
                     (end*end<r2 && InsideFace(leg.a+leg.span,a,b,c,normal)) ||
                     (start*end<0 && InsideFace(leg.a+leg.span*(start/(start-end)),a,b,c,normal))))return true;
        return EdgeHitsLeg(a,ab,leg) || EdgeHitsLeg(b,c-b,leg) || EdgeHitsLeg(a,ac,leg);
    }
    bool GarmentHitsLeg()
    {
        foreach(int i in cloth)
        {
            var p=vertices[i];
            foreach(var leg in contactLegs)if(leg.Offset(p).sqrMagnitude<leg.radius*leg.radius)return true;
        }
        // A long hem triangle can cut a thigh while all three vertices are outside.
        foreach(var face in triangles)
        {
            var a=vertices[face.a];var b=vertices[face.b];var c=vertices[face.c];
            var lo=Vector3.Min(a,Vector3.Min(b,c));var hi=Vector3.Max(a,Vector3.Max(b,c));
            foreach(var leg in contactLegs)
            {
                if(lo.x>leg.high.x || lo.y>leg.high.y || lo.z>leg.high.z ||
                   hi.x<leg.low.x || hi.y<leg.low.y || hi.z<leg.low.z)continue;
                if(FaceHitsLeg(a,b,c,leg))return true;
            }
        }
        return false;
    }
    bool ApplyLowerHem()
    {
        // At a crossed shin or pointed foot the hip's outward direction can
        // graze the capsule. Use the local normal and keep pinned vertices fixed.
        bool changed=false;
        for(int pass=0;pass<8;pass++)
        {
            bool moved=false;
            foreach(var t in triangles)
            {
                var a=vertices[t.a];var b=vertices[t.b];var c=vertices[t.c];
                var low=Vector3.Min(a,Vector3.Min(b,c));var high=Vector3.Max(a,Vector3.Max(b,c));
                foreach(var leg in contactLegs)
                {
                    if(leg==legs[0] || leg==legs[1] || low.x>leg.high.x || low.y>leg.high.y || low.z>leg.high.z || high.x<leg.low.x || high.y<leg.low.y || high.z<leg.low.z)continue;
                    void Project(int i,int j,int k,int count)
                    {
                        var point=vertices[i];if(count>1)point+=vertices[j];if(count>2)point+=vertices[k];point/=count;
                        var radial=leg.Offset(point);float len=radial.magnitude;if(len>=leg.radius+.0015f)return;
                        int free=(movable[i]?1:0)+(count>1 && movable[j]?1:0)+(count>2 && movable[k]?1:0);if(free==0)return;
                        var normal=len>1e-6f?radial/len:outward[i];var delta=normal*((leg.radius+.002f-len)*count/free);
                        if(movable[i])vertices[i]+=delta;if(count>1 && movable[j])vertices[j]+=delta;if(count>2 && movable[k])vertices[k]+=delta;
                        moved=true;
                    }
                    Project(t.a,t.a,t.a,1);Project(t.b,t.b,t.b,1);Project(t.c,t.c,t.c,1);
                    Project(t.a,t.b,t.c,3);Project(t.a,t.b,t.a,2);Project(t.b,t.c,t.b,2);Project(t.c,t.a,t.c,2);
                }
            }
            if(!moved)break;
            changed=true;
        }
        return changed;
    }
    public void SetGarmentMode(bool authored,bool open)
    {
        authoredGarment=authored;openGarment=open;lastRevision=-1;
    }
    public void SetDisplay(bool active,int revision)
    {
        if(!originalEnabled)return;
        if(!active || skin.forceRenderingOff)
        {
            lastRevision=-1;
            ProjectionRan=false;
            skin.enabled=originalEnabled;
            if(display)display.enabled=false;
            return;
        }
        if(revision>=0 && revision==lastRevision)return;
        skin.BakeMesh(baked);baked.GetVertices(vertices);
        var toMesh=skin.transform.worldToLocalMatrix;
        foreach(var leg in contactLegs)leg.Update(toMesh);
        if(diagnostics && hasSkirt)before=Measure();
        bool changed=false;
        ProjectionRan=hasSkirt && !measureOnly && (!authoredGarment || GarmentHitsLeg());
        if(ProjectionRan)
        {
            var basis=toMesh*hips.localToWorldMatrix;
            if(!openGarment)envelope.Update(vertices,(legs[0].a+legs[1].a)*.5f,basis.MultiplyVector(bindRight),basis.MultiplyVector(bindUp));
            foreach(int i in cloth)
            {
                outward[i]=basis.MultiplyVector(restOut[i]).normalized;
                // Separate pant legs and open coat panels have their own outward side.
                // A hip-wide envelope would stretch their inner seams across the gap.
                if(openGarment)
                {
                    var radial=Vector3.zero;float closest=float.PositiveInfinity;
                    foreach(var leg in contactLegs){var offset=leg.Offset(vertices[i]);float gap=offset.magnitude-leg.radius;if(gap<closest){radial=offset;closest=gap;}}
                    if(radial.sqrMagnitude>1e-10f)outward[i]=radial.normalized;
                }
                float d=Exit(vertices[i],outward[i]);shifts[i]=0;
                if(d>0){vertices[i]+=outward[i]*d;changed=true;}
            }
            for(int pass=0;pass<3;pass++)
            {
                foreach(var t in triangles)
                    Constraint(t.a,t.b,t.c);
                foreach(var edge in clothEdges)Constraint(edge.x,edge.y,-1);
                bool moved=false;
                foreach(int i in cloth)if(shifts[i]>0){vertices[i]+=outward[i]*Mathf.Min(.035f,shifts[i]);shifts[i]=0;moved=true;}
                if(!moved)break;
                changed=true;
            }
        }
        if(ProjectionRan)changed|=ApplyLowerHem();
        if(diagnostics && hasSkirt)after=Measure();
        if(bodyContact!=null && !measureOnly)changed|=bodyContact.Update(vertices,baked);
        if(changed)
        {
            baked.SetVertices(vertices);baked.RecalculateBounds();
            if(!display)
            {
                var go=new GameObject("Garment contact surface");go.transform.SetParent(skin.transform,false);
                go.AddComponent<MeshFilter>().sharedMesh=baked;display=go.AddComponent<MeshRenderer>();
                display.sharedMaterials=skin.sharedMaterials;display.shadowCastingMode=skin.shadowCastingMode;
                display.receiveShadows=skin.receiveShadows;display.lightProbeUsage=skin.lightProbeUsage;
                display.reflectionProbeUsage=skin.reflectionProbeUsage;display.probeAnchor=skin.probeAnchor;
                display.renderingLayerMask=skin.renderingLayerMask;
            }
            display.gameObject.layer=skin.gameObject.layer;display.forceRenderingOff=false;
        }
        if(display)display.enabled=changed;
        skin.enabled=!changed;
        lastRevision=revision;
    }
    void OnDestroy(){if(skin)skin.enabled=originalEnabled;if(display)Destroy(display.gameObject);if(baked)Destroy(baked);}
}
