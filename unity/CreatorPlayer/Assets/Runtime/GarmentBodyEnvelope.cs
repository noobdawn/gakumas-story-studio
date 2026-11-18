using System.Collections.Generic;
using UnityEngine;

// Horizontal convex sections of the posed lower-body mesh. Crossing an edge of a
// triangle contributes to the section even when neither of its vertices is in it.
public sealed class GarmentBodyEnvelope
{
    const int Rings=48, Sides=24;
    readonly Vector2[] normals=new Vector2[Sides];
    readonly float[] support=new float[Rings*Sides];
    readonly Vector3[] coordinates;
    readonly List<int> points=new List<int>();
    readonly List<Vector2Int> edges=new List<Vector2Int>();
    float lower,upper,invStep;
    Vector3 right,up,forward,origin;
    public int TriangleCount { get; }

    public GarmentBodyEnvelope(int[] indices,bool[] leg,bool[] movable)
    {
        coordinates=new Vector3[leg.Length];
        for(int i=0;i<Sides;i++)
        {
            float angle=(2*Mathf.PI/Sides)*i;
            normals[i]=new Vector2(Mathf.Cos(angle),Mathf.Sin(angle));
        }
        var used=new bool[leg.Length];
        var seen=new HashSet<ulong>();
        void Edge(int a,int b)
        {
            if(a>b){int t=a;a=b;b=t;}
            if(seen.Add(((ulong)(uint)a<<32)|(uint)b))edges.Add(new Vector2Int(a,b));
        }
        for(int i=0;i+2<indices.Length;i+=3)
        {
            int a=indices[i],b=indices[i+1],c=indices[i+2];
            if(movable[a] || movable[b] || movable[c] || (leg[a]?1:0)+(leg[b]?1:0)+(leg[c]?1:0)<2)continue;
            used[a]=used[b]=used[c]=true;
            TriangleCount++;
            Edge(a,b);Edge(b,c);Edge(c,a);
        }
        for(int i=0;i<used.Length;i++)if(used[i])points.Add(i);
    }

    public void Update(List<Vector3> vertices,Vector3 center,Vector3 x,Vector3 y)
    {
        origin=center;up=y.normalized;right=Vector3.ProjectOnPlane(x,up).normalized;forward=Vector3.Cross(right,up);
        for(int i=0;i<support.Length;i++)support[i]=float.NegativeInfinity;
        lower=float.PositiveInfinity;upper=float.NegativeInfinity;
        foreach(int i in points)
        {
            var delta=vertices[i]-origin;
            var p=new Vector3(Vector3.Dot(delta,right),Vector3.Dot(delta,up),Vector3.Dot(delta,forward));
            coordinates[i]=p;lower=Mathf.Min(lower,p.y);upper=Mathf.Max(upper,p.y);
        }
        if(upper-lower<1e-5f)return;
        invStep=(Rings-1)/(upper-lower);
        foreach(int i in points)
        {
            var p=coordinates[i];int ring=Mathf.Clamp((int)((p.y-lower)*invStep),0,Rings-2);
            Include(ring,p.x,p.z);Include(ring+1,p.x,p.z);
        }
        foreach(var edge in edges)
        {
            Vector3 a=coordinates[edge.x],b=coordinates[edge.y];
            if(a.y>b.y){var tmp=a;a=b;b=tmp;}
            int first=(int)((a.y-lower)*invStep)+1,last=Mathf.Min(Rings-1,(int)((b.y-lower)*invStep));
            for(int j=first;j<=last;j++)
            {
                float t=(lower+j/invStep-a.y)/(b.y-a.y);
                float px=Mathf.Lerp(a.x,b.x,t),pz=Mathf.Lerp(a.z,b.z,t);
                // Adjacent centers must bound the whole slab when interpolated.
                Include(j-1,px,pz);Include(j,px,pz);if(j+1<Rings)Include(j+1,px,pz);
            }
        }
    }
    void Include(int ring,float x,float z)
    {
        int offset=ring*Sides;
        for(int k=0;k<Sides;k++)
        {
            float v=x*normals[k].x+z*normals[k].y;
            if(v>support[offset+k])support[offset+k]=v;
        }
    }
    public float Exit(Vector3 p,Vector3 direction)
    {
        var delta=p-origin;
        float y=Vector3.Dot(delta,up);
        if(y<lower || y>upper || upper-lower<1e-5f)return 0;
        float u=(y-lower)*invStep;
        int ring=Mathf.Clamp((int)u,0,Rings-2),offset=ring*Sides;
        float weight=Mathf.Clamp01(u-ring);
        if(float.IsNegativeInfinity(support[offset]) || float.IsNegativeInfinity(support[offset+Sides]))return 0;
        float x=Vector3.Dot(delta,right),z=Vector3.Dot(delta,forward);
        float dx=Vector3.Dot(direction,right),dz=Vector3.Dot(direction,forward),distance=float.PositiveInfinity;
        for(int k=0;k<Sides;k++)
        {
            Vector2 n=normals[k];float alignment=n.x*dx+n.y*dz;
            if(alignment<.35f)continue;
            float clearance=Mathf.Lerp(support[offset+k],support[offset+Sides+k],weight)+.005f-(n.x*x+n.y*z);
            if(clearance<=0)return 0;
            distance=Mathf.Min(distance,clearance/alignment);
        }
        return float.IsPositiveInfinity(distance)?0:distance;
    }
}
