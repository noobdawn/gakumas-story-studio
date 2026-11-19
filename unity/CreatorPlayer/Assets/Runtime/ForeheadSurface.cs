using System;
using System.Collections.Generic;
using UnityEngine;

// Coordinates are those of the displayed face mesh. Its authored front is +Z.
// Each cell indexes actual skin triangles. Depth is interpolated on the triangle,
// so the forehead and temples retain the shape of this character and expression.
public sealed class ForeheadSurface
{
    const int Columns=32, Rows=24;
    struct Triangle
    {
        public Vector3 a;
        public float ux,uy,vx,vy,zx,zy;
        public float Depth(float dx,float dy)=>a.z+dx*zx+dy*zy;
    }
    readonly List<int>[] cells=new List<int>[Columns*Rows];
    readonly float[] maximumDepth=new float[Columns*Rows];
    readonly int[] coveringTriangle=new int[Columns*Rows];
    readonly List<Triangle> triangles=new List<Triangle>();
    readonly List<int> indices=new List<int>();
    readonly int[] tracked;
    readonly Vector3[] previous;
    readonly float left, bottom, xScale, yScale;
    public readonly Bounds bounds;
    public readonly float margin;
    public int Revision { get; private set; }
    public bool Available => indices.Count>0;

    public ForeheadSurface(Mesh mesh,Material[] materials)
    {
        bounds=mesh.bounds;
        var bind=mesh.vertices;
        float width=Mathf.Max(.001f,bounds.size.x), height=Mathf.Max(.001f,bounds.size.y);
        left=bounds.min.x-.03f*width;
        bottom=bounds.min.y+.32f*height;
        xScale=Columns/(1.06f*width);
        yScale=Rows/(bounds.max.y+.04f*height-bottom);
        margin=.013f*width;
        var used=new HashSet<int>();
        for(int s=0;s<Math.Min(materials.Length,mesh.subMeshCount);s++)
        {
            var material=materials[s];
            if(!material || !(material.name=="m_fce" || material.name.StartsWith("m_fce (",StringComparison.Ordinal)))continue;
            var faces=mesh.GetTriangles(s);
            for(int i=0;i+2<faces.Length;i+=3)
            {
                int a=faces[i],b=faces[i+1],c=faces[i+2];
                if(bind[a].y<bottom-margin && bind[b].y<bottom-margin && bind[c].y<bottom-margin)continue;
                if(bind[a].z<bounds.center.z && bind[b].z<bounds.center.z && bind[c].z<bounds.center.z)continue;
                indices.Add(a);indices.Add(b);indices.Add(c);
                used.Add(a);used.Add(b);used.Add(c);
            }
        }
        tracked=new int[used.Count];used.CopyTo(tracked);
        previous=new Vector3[tracked.Length];
        for(int i=0;i<cells.Length;i++)cells[i]=new List<int>();
        Update(bind);
    }

    int Column(float x)=>Mathf.FloorToInt((x-left)*xScale);
    int Row(float y)=>Mathf.FloorToInt((y-bottom)*yScale);
    public void Update(Vector3[] vertices)
    {
        bool changed=Revision==0;
        for(int i=0;i<tracked.Length;i++)
        {
            var p=vertices[tracked[i]];
            if(!p.Equals(previous[i]))changed=true;
            previous[i]=p;
        }
        if(!changed)return;
        for(int i=0;i<cells.Length;i++){cells[i].Clear();maximumDepth[i]=float.NegativeInfinity;coveringTriangle[i]=-1;}
        triangles.Clear();
        float halfX=.5f/xScale,halfY=.5f/yScale;
        for(int i=0;i<indices.Count;i+=3)
        {
            var a=vertices[indices[i]];var b=vertices[indices[i+1]];var c=vertices[indices[i+2]];
            var ab=b-a;var ac=c-a;
            float det=ab.x*ac.y-ab.y*ac.x;
            if(Mathf.Abs(det)<1e-11f)continue;
            int id=triangles.Count;
            float inverse=1f/det;
            var t=new Triangle{a=a,ux=ac.y*inverse,uy=-ac.x*inverse,vx=-ab.y*inverse,vy=ab.x*inverse};
            t.zx=t.ux*ab.z+t.vx*ac.z;t.zy=t.uy*ab.z+t.vy*ac.z;
            triangles.Add(t);
            int x0=Math.Max(0,Column(Mathf.Min(a.x,Mathf.Min(b.x,c.x))));
            int x1=Math.Min(Columns-1,Column(Mathf.Max(a.x,Mathf.Max(b.x,c.x))));
            int y0=Math.Max(0,Row(Mathf.Min(a.y,Mathf.Min(b.y,c.y))));
            int y1=Math.Min(Rows-1,Row(Mathf.Max(a.y,Mathf.Max(b.y,c.y))));
            // Each barycentric coordinate is linear across a cell. Its extrema and
            // the face depth bound rule out empty cells before any runtime hair sample.
            float radiusU=Mathf.Abs(t.ux)*halfX+Mathf.Abs(t.uy)*halfY;
            float radiusV=Mathf.Abs(t.vx)*halfX+Mathf.Abs(t.vy)*halfY;
            float radiusW=Mathf.Abs(t.ux+t.vx)*halfX+Mathf.Abs(t.uy+t.vy)*halfY;
            float radiusZ=Mathf.Abs(t.zx)*halfX+Mathf.Abs(t.zy)*halfY;
            for(int y=y0;y<=y1;y++)for(int x=x0;x<=x1;x++)
            {
                float dx=left+(2*x+1)*halfX-a.x,dy=bottom+(2*y+1)*halfY-a.y;
                float u=t.ux*dx+t.uy*dy,v=t.vx*dx+t.vy*dy,w=1-u-v;
                if(u+radiusU<-.00003f || v+radiusV<-.00003f || w+radiusW<-.00003f)continue;
                int cell=y*Columns+x;
                if(cells[cell].Count==0 && u-radiusU>=0 && v-radiusV>=0 && w-radiusW>=0)coveringTriangle[cell]=id;
                else coveringTriangle[cell]=-1;
                cells[cell].Add(id);
                maximumDepth[cell]=Mathf.Max(maximumDepth[cell],t.Depth(dx,dy)+radiusZ+.000001f);
            }
        }
        Revision++;
    }

    public bool TryDepth(Vector3 p,out float depth,float minimum=float.NegativeInfinity)
    {
        depth=float.NegativeInfinity;
        int x=Column(p.x),y=Row(p.y);
        if(x<0 || x>=Columns || y<0 || y>=Rows)return false;
        int cell=y*Columns+x;
        if(maximumDepth[cell]<minimum)return false;
        int covering=coveringTriangle[cell];
        if(covering>=0)
        {
            var t=triangles[covering];depth=t.Depth(p.x-t.a.x,p.y-t.a.y);return true;
        }
        foreach(int id in cells[cell])
        {
            var t=triangles[id];
            float dx=p.x-t.a.x,dy=p.y-t.a.y;
            float u=dx*t.ux+dy*t.uy,v=dx*t.vx+dy*t.vy;
            if(u<-.00002f || v<-.00002f || u+v>1.00002f)continue;
            depth=Mathf.Max(depth,t.Depth(dx,dy));
        }
        return !float.IsNegativeInfinity(depth);
    }
    public bool IsFrontHair(Vector3 p)
    {
        if(p.z<bounds.center.z || p.y<bottom-bounds.size.y*.20f)return false;
        // The rear cap and intentional buried roots must stay on their authored side.
        return !TryDepth(p,out var z) || p.z>=z-.08f*bounds.size.x;
    }
}
