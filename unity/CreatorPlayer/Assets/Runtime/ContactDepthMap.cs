using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

// Front and back surfaces of a posed mesh patch viewed along a contact direction.
// A column keeps the full height range over its cell, including edge-on triangles.
internal sealed class ContactDepthMap
{
    const int Size=72;
    readonly int[] faces, used;
    readonly Vector3[] projected;
    readonly float[] low=new float[Size*Size], high=new float[Size*Size];
    Vector3 x,y,z;
    Vector2 start,scale;
    bool ready;
    public ContactDepthMap(List<int> indices,int vertexCount)
    {
        faces=indices.ToArray();used=faces.Distinct().ToArray();projected=new Vector3[vertexCount];
    }
    public void Build(List<Vector3> points,Vector3 direction,Vector3 lateral)
    {
        ready=false;if(used.Length==0 || direction.sqrMagnitude<1e-10f)return;
        z=direction.normalized;x=Vector3.ProjectOnPlane(lateral,z).normalized;
        if(x.sqrMagnitude<.5f)x=Vector3.Cross(z,Mathf.Abs(z.y)<.8f?Vector3.up:Vector3.right).normalized;
        y=Vector3.Cross(z,x);
        var min=new Vector2(float.MaxValue,float.MaxValue);var max=-min;
        foreach(int i in used)
        {
            var p=points[i];var q=new Vector3(Vector3.Dot(p,x),Vector3.Dot(p,y),Vector3.Dot(p,z));
            projected[i]=q;min=Vector2.Min(min,q);max=Vector2.Max(max,q);
        }
        start=min-Vector2.one*.002f;
        scale=new Vector2(Size/(max.x-start.x+.002f),Size/(max.y-start.y+.002f));
        foreach(int i in used){var p=projected[i];p.x=(p.x-start.x)*scale.x;p.y=(p.y-start.y)*scale.y;projected[i]=p;}
        Array.Fill(low,float.PositiveInfinity);Array.Fill(high,float.NegativeInfinity);
        for(int i=0;i<faces.Length;i+=3)Raster(projected[faces[i]],projected[faces[i+1]],projected[faces[i+2]]);
        ready=true;
    }
    void Raster(Vector3 a,Vector3 b,Vector3 c)
    {
        var ab=b-a;var ac=c-a;float area=ab.x*ac.y-ab.y*ac.x;
        if(area<0){var swap=b;b=c;c=swap;ab=b-a;ac=c-a;area=-area;}
        int left=Mathf.Max(0,Mathf.FloorToInt(Mathf.Min(a.x,Mathf.Min(b.x,c.x))));
        int right=Mathf.Min(Size-1,Mathf.FloorToInt(Mathf.Max(a.x,Mathf.Max(b.x,c.x))));
        int bottom=Mathf.Max(0,Mathf.FloorToInt(Mathf.Min(a.y,Mathf.Min(b.y,c.y))));
        int top=Mathf.Min(Size-1,Mathf.FloorToInt(Mathf.Max(a.y,Mathf.Max(b.y,c.y))));
        float uPad=(Mathf.Abs(ac.x)+Mathf.Abs(ac.y))*.5f,vPad=(Mathf.Abs(ab.x)+Mathf.Abs(ab.y))*.5f;
        float wPad=(Mathf.Abs(b.x-c.x)+Mathf.Abs(b.y-c.y))*.5f;
        float minZ=Mathf.Min(a.z,Mathf.Min(b.z,c.z)),maxZ=Mathf.Max(a.z,Mathf.Max(b.z,c.z));
        float inv=area>1e-7f?1/area:0;
        float zPad=.5f*(Mathf.Abs(ac.y*ab.z-ab.y*ac.z)+Mathf.Abs(ab.x*ac.z-ac.x*ab.z))*inv;
        for(int iy=bottom;iy<=top;iy++)for(int ix=left;ix<=right;ix++)
        {
            float px=ix+.5f-a.x,py=iy+.5f-a.y;
            float u=px*ac.y-py*ac.x,v=ab.x*py-ab.y*px;
            if(u < -uPad || v < -vPad || u+v>area+wPad)continue;
            float h=a.z+(u*ab.z+v*ac.z)*inv;
            int k=iy*Size+ix;
            low[k]=Mathf.Min(low[k],inv==0?minZ:Mathf.Clamp(h-zPad,minZ,maxZ));
            high[k]=Mathf.Max(high[k],inv==0?maxZ:Mathf.Clamp(h+zPad,minZ,maxZ));
        }
    }
    public bool Sample(Vector3 p,out float near,out float far)
    {
        near=far=0;if(!ready)return false;
        int ix=Mathf.FloorToInt((Vector3.Dot(p,x)-start.x)*scale.x),iy=Mathf.FloorToInt((Vector3.Dot(p,y)-start.y)*scale.y);
        if((uint)ix>=Size || (uint)iy>=Size)return false;
        int k=iy*Size+ix;if(low[k]>high[k])return false;
        float h=Vector3.Dot(p,z);near=low[k]-h;far=high[k]-h;return true;
    }
}
