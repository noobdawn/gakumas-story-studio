using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

// Fixed topology, refitted to the displayed pose. Node weight ranges bound a
// strand's tapered displacement without rebuilding the tree for every trial.
internal sealed class ContactMeshTree
{
    struct Face {public int a,b,c;public Vector3 centroid,lo,hi;}
    struct Node {public int start,count,left,right; public Vector3 lo,hi;public float wMin,wMax;}
    readonly Face[] faces;
    readonly Node[] nodes;
    readonly Vector3[] points;
    readonly float[] weights;
    readonly int[] source;
    int allocated;
    int witnessMoving=-1,witnessFixed=-1;
    ContactMeshTree witnessTarget;
    internal ContactMeshTree(IList<int> indices,IList<Vector3> bind,float[] mobility=null)
    {
        source=indices.Distinct().ToArray();var remap=new int[bind.Count];
        points=new Vector3[source.Length];weights=new float[source.Length];
        for(int i=0;i<source.Length;i++){int id=source[i];remap[id]=i;points[i]=bind[id];weights[i]=mobility==null?0:mobility[id];}
        faces=new Face[indices.Count/3];nodes=new Node[Math.Max(1,2*Mathf.NextPowerOfTwo((faces.Length+5)/6)-1)];
        for(int i=0;i<faces.Length;i++)
        {
            int a=remap[indices[3*i]],b=remap[indices[3*i+1]],c=remap[indices[3*i+2]];
            faces[i]=new Face{a=a,b=b,c=c,centroid=(points[a]+points[b]+points[c])/3};
        }
        if(faces.Length>0){Split(0,faces.Length);Bounds();}
    }
    int Split(int start,int count)
    {
        int id=allocated++;var node=new Node{start=start,count=count,left=-1,right=-1,wMin=1};
        if(count>6)
        {
            var lo=faces[start].centroid;var hi=lo;
            for(int i=start+1;i<start+count;i++){lo=Vector3.Min(lo,faces[i].centroid);hi=Vector3.Max(hi,faces[i].centroid);}
            var size=hi-lo;int axis=size.x>size.y?(size.x>size.z?0:2):(size.y>size.z?1:2);
            Array.Sort(faces,start,count,Comparer<Face>.Create((a,b)=>a.centroid[axis].CompareTo(b.centroid[axis])));
            node.left=Split(start,count/2);node.right=Split(start+count/2,count-count/2);
            node.wMin=Mathf.Min(nodes[node.left].wMin,nodes[node.right].wMin);node.wMax=Mathf.Max(nodes[node.left].wMax,nodes[node.right].wMax);
        }
        else for(int i=start;i<start+count;i++)
        {
            var f=faces[i];node.wMin=Mathf.Min(node.wMin,Mathf.Min(weights[f.a],Mathf.Min(weights[f.b],weights[f.c])));
            node.wMax=Mathf.Max(node.wMax,Mathf.Max(weights[f.a],Mathf.Max(weights[f.b],weights[f.c])));
        }
        nodes[id]=node;return id;
    }
    internal void Refit(IList<Vector3> pose)
    {
        for(int i=0;i<points.Length;i++)points[i]=pose[source[i]];Bounds();
    }
    void Bounds()
    {
        for(int i=allocated-1;i>=0;i--)
        {
            ref var n=ref nodes[i];
            if(n.left>=0){n.lo=Vector3.Min(nodes[n.left].lo,nodes[n.right].lo);n.hi=Vector3.Max(nodes[n.left].hi,nodes[n.right].hi);continue;}
            var low=points[faces[n.start].a];var high=low;
            for(int k=n.start;k<n.start+n.count;k++)
            {
                ref var f=ref faces[k];var a=points[f.a];var b=points[f.b];var c=points[f.c];
                f.lo=Vector3.Min(a,Vector3.Min(b,c));f.hi=Vector3.Max(a,Vector3.Max(b,c));
                low=Vector3.Min(low,f.lo);high=Vector3.Max(high,f.hi);
            }
            n.lo=low;n.hi=high;
        }
    }
    static bool IntersectsBounds(Vector3 a,Vector3 b,Vector3 lo,Vector3 hi) => a.x<=hi.x && b.x>=lo.x && a.y<=hi.y && b.y>=lo.y && a.z<=hi.z && b.z>=lo.z;
    internal bool Crosses(ContactMeshTree target,Vector3 move)
    {
        if(allocated==0 || target.allocated==0)return false;
        // Successive trials and frames often touch the same two triangles.
        if(witnessTarget==target && witnessMoving>=0)
        {
            var f=faces[witnessMoving];var g=target.faces[witnessFixed];
            if(Cuts(points[f.a]+move*weights[f.a],points[f.b]+move*weights[f.b],points[f.c]+move*weights[f.c],
                    target.points[g.a],target.points[g.b],target.points[g.c]))return true;
        }
        return Visit(0,target,0,Vector3.Min(move,Vector3.zero),Vector3.Max(move,Vector3.zero),move);
    }
    bool Visit(int i,ContactMeshTree target,int j,Vector3 neg,Vector3 pos,Vector3 move)
    {
        ref var a=ref nodes[i];ref var b=ref target.nodes[j];
        if(!IntersectsBounds(a.lo+neg*a.wMax+pos*a.wMin,a.hi+pos*a.wMax+neg*a.wMin,b.lo,b.hi))return false;
        if(b.left>=0 && (a.left<0 || b.count>a.count))return Visit(i,target,b.left,neg,pos,move)||Visit(i,target,b.right,neg,pos,move);
        if(a.left>=0)return Visit(a.left,target,j,neg,pos,move)||Visit(a.right,target,j,neg,pos,move);
        for(int k=a.start;k<a.start+a.count;k++)
        {
            var f=faces[k];var p=points[f.a]+move*weights[f.a];var q=points[f.b]+move*weights[f.b];var r=points[f.c]+move*weights[f.c];
            var lo=Vector3.Min(p,Vector3.Min(q,r));var hi=Vector3.Max(p,Vector3.Max(q,r));
            if(!IntersectsBounds(lo,hi,b.lo,b.hi))continue;
            for(int l=b.start;l<b.start+b.count;l++)
            {
                ref var g=ref target.faces[l];
                if(!IntersectsBounds(lo,hi,g.lo,g.hi) || !Cuts(p,q,r,target.points[g.a],target.points[g.b],target.points[g.c]))continue;
                witnessMoving=k;witnessFixed=l;witnessTarget=target;return true;
            }
        }
        return false;
    }
    static bool Straddles(float a,float b,float c)=>Mathf.Min(a,Mathf.Min(b,c))<0 && Mathf.Max(a,Mathf.Max(b,c))>0;
    static void Range(float a,float b,float c,float da,float db,float dc,out float lo,out float hi)
    {
        float x,y;
        if((da<0)==(db<0)){x=c+(a-c)*(dc/(dc-da));y=c+(b-c)*(dc/(dc-db));}
        else if((da<0)==(dc<0)){x=b+(a-b)*(db/(db-da));y=b+(c-b)*(db/(db-dc));}
        else{x=a+(b-a)*(da/(da-db));y=a+(c-a)*(da/(da-dc));}
        lo=Mathf.Min(x,y);hi=Mathf.Max(x,y);
    }
    static bool Cuts(Vector3 a,Vector3 b,Vector3 c,Vector3 x,Vector3 y,Vector3 z)
    {
        var n=Vector3.Cross(b-a,c-a);float dx=Vector3.Dot(x-a,n),dy=Vector3.Dot(y-a,n),dz=Vector3.Dot(z-a,n);
        if(!Straddles(dx,dy,dz))return false;
        var m=Vector3.Cross(y-x,z-x);float da=Vector3.Dot(a-x,m),db=Vector3.Dot(b-x,m),dc=Vector3.Dot(c-x,m);
        if(!Straddles(da,db,dc))return false;
        var line=Vector3.Cross(n,m);float lx=Mathf.Abs(line.x),ly=Mathf.Abs(line.y),lz=Mathf.Abs(line.z);
        int k=lx>ly?(lx>lz?0:2):(ly>lz?1:2);
        Range(a[k],b[k],c[k],da,db,dc,out float l1,out float h1);Range(x[k],y[k],z[k],dx,dy,dz,out float l2,out float h2);
        return Mathf.Min(h1,h2)-Mathf.Max(l1,l2)>1e-6f;
    }
}
