using System;
using UnityEngine;

[Serializable]
public sealed class CreatorGazeLayer {
    public float[] point;
    public float yaw, pitch, weight, eyes, head, body;
}

// The combined face mesh is in the character's authored bind coordinate system.
// Restore the sampled skeleton before the next state, including same-frame physics cache hits.
public sealed class CreatorGazePose {
    readonly Transform face, chest, neck, head;
    readonly Vector3 eyesLocal;
    Quaternion savedChest, savedNeck, savedHead;
    bool applied;

    public CreatorGazePose(Transform actor, Transform face, Vector3 eyesLocal) {
        this.face=face;
        this.eyesLocal=eyesLocal;
        head=face.parent;
        neck=head.parent;
        for(var bone=neck.parent;bone&&bone!=actor;bone=bone.parent){
            if(bone.name=="Spine2"||bone.name=="Spine1"){chest=bone;break;}
        }
    }
    CreatorGazeLayer[] layers;
    Vector2 authored;
    // On the flattened face mesh a small rotation moves the iris across the visible eye.
    // Work in sight-line degrees, then map the excursion to the authored eye rig.
    static readonly Vector2 MeshDegreesPerSightDegree=new Vector2(.32f,1f/3f);
    public bool Active=>layers!=null&&layers.Length>0;
    public bool Changed {get;private set;}
    public Vector2 EyeAngles {get;private set;}
    public void Configure(CreatorGazeLayer[] next,Vector2 authoredAngles){
        authoredAngles=new Vector2(authoredAngles.x/MeshDegreesPerSightDegree.x,authoredAngles.y/MeshDegreesPerSightDegree.y);
        Changed=authoredAngles!=authored||!Same(layers,next);
        layers=next;authored=authoredAngles;
    }
    static bool Same(CreatorGazeLayer[] a,CreatorGazeLayer[] b){
        int count=a?.Length??0;if(count!=(b?.Length??0))return false;
        for(int i=0;i<count;i++){
            var x=a[i];var y=b[i];
            if(x.eyes!=y.eyes||x.head!=y.head||x.body!=y.body||x.weight!=y.weight||x.yaw!=y.yaw||x.pitch!=y.pitch)return false;
            int n=x.point?.Length??0;if(n!=(y.point?.Length??0))return false;
            for(int k=0;k<n;k++)if(x.point[k]!=y.point[k])return false;
        }
        return true;
    }
    public void Sample()=>EyeAngles=Vector2.Scale(Apply(layers,authored),MeshDegreesPerSightDegree);
    public Vector3 Eyes => face.TransformPoint(eyesLocal);
    public void Restore(){
        if(!applied)return;
        if(chest)chest.localRotation=savedChest;
        if(neck)neck.localRotation=savedNeck;
        if(head)head.localRotation=savedHead;
        applied=false;
    }
    static Vector2 Limit(Vector2 v,float x,float y)=>new Vector2(Mathf.Clamp(v.x,-x,x),Mathf.Clamp(v.y,-y,y));
    static Quaternion Turn(Vector2 angles)=>Quaternion.Euler(-angles.y,angles.x,0);
    static Vector2 Angles(Quaternion basis,Vector3 direction){
        var d=Quaternion.Inverse(basis)*direction;
        return new Vector2(Mathf.Atan2(d.x,d.z),Mathf.Atan2(d.y,Mathf.Sqrt(d.x*d.x+d.z*d.z)))*Mathf.Rad2Deg;
    }
    static void Rotate(Transform bone,Quaternion basis,Vector2 angles){
        if(bone)bone.rotation=basis*Turn(angles)*Quaternion.Inverse(basis)*bone.rotation;
    }
    public Vector2 Apply(CreatorGazeLayer[] layers,Vector2 authored){
        if(layers==null||layers.Length==0)return authored;
        var basis=face.rotation;
        var eye=authored;
        var chestTurn=Vector2.zero;
        var headTurn=Vector2.zero;
        var desired=eye;
        foreach(var g in layers){
            if(g.point!=null&&g.point.Length==3){
                var ray=new Vector3(g.point[0],g.point[1],g.point[2])-Eyes;
                if(ray.sqrMagnitude<.000001f)continue;
                desired=Angles(basis,ray);
            }else desired=chestTurn+headTurn+eye+new Vector2(g.yaw,g.pitch);
            var torso=chest?Limit(desired*g.body,28,16):Vector2.zero;
            var nod=Limit((desired-torso)*g.head,65,38);
            var look=Vector2.Lerp(authored,Limit(desired-torso-nod,25,18),g.eyes);
            chestTurn=Vector2.Lerp(chestTurn,torso,g.weight);
            headTurn=Vector2.Lerp(headTurn,nod,g.weight);
            eye=Vector2.Lerp(eye,look,g.weight);
        }
        savedHead=head.localRotation;savedNeck=neck.localRotation;if(chest)savedChest=chest.localRotation;
        applied=true;
        Rotate(chest,basis,chestTurn);
        Rotate(neck,basis,headTurn*.35f);
        Rotate(head,basis,headTurn*.65f);
        return eye;
    }
}
