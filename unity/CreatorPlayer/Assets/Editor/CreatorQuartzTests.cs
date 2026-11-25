using System;
using System.Collections.Generic;
using UnityEngine;

public static class CreatorQuartzTests
{
    public static void Run()
    {
        var root=new GameObject("Quartz test").transform;
        var nodes=new Dictionary<string,Transform>();
        Transform Bone(string name,Transform parent)
        {
            var t=new GameObject(name).transform;
            t.SetParent(parent,false);nodes.Add(name,t);return t;
        }
        void Check(Quaternion actual,Quaternion expected)
        {
            if(Quaternion.Angle(actual,expected)>.06f)throw new Exception("Quartz parity mismatch: "+actual.ToString("F6")+" expected "+expected.ToString("F6"));
        }
        try
        {
            var rest=Quaternion.Euler(8,-6,12);
            var live=Quaternion.Euler(40,19,-24);
            foreach(string side in new[]{"Left","Right"})
            {
                var thigh=Bone(side+"UpLeg",root);
                var panel=Bone(side+"Panel",root);
                var bind=Quaternion.Euler(-5,18,34);
                thigh.localRotation=rest;panel.localRotation=bind;
                var d=new ActorQuartzPose.Driver{kind="SkirtBone",bone=panel.name,referenceBone=thigh.name,
                    innerCoefficient=new Vector3(0,.1f,.05f),outerCoefficient=Vector3.one,
                    limitMin=new Vector3(-180,-180,-25),limitMax=new Vector3(180,180,180)};
                var solver=new ActorQuartzPose(root,nodes,new[]{d});
                // Pinned Gakumas-Player outputs converted back to Unity local coordinates.
                var expected=bind*new Quaternion(0,side=="Left"?-.03814354f:.03814354f,.00574203f,.99925577f);
                thigh.localRotation=live;solver.Apply();Check(panel.localRotation,expected);
                solver.Apply();Check(panel.localRotation,expected);solver.Reset();Check(panel.localRotation,bind);
            }
            var neck=Bone("Neck",root);var head=Bone("Head",neck);head.localRotation=rest;
            var hair=Bone("Hair",head);var strand=Bone("Strand",hair);
            var driver=new ActorQuartzPose.Driver{kind="HairBone",bone=strand.name,
                headRotateCoefficient=new Vector3(-.4f,-.2f,-.3f),headRotateLimitMin=new Vector3(-33,-17,-180),headRotateLimitMax=new Vector3(0,180,180),
                neckRotateCoefficient=new Vector3(-.4f,-.2f,-.3f),neckRotateLimitMin=new Vector3(-40,-42,-20),neckRotateLimitMax=new Vector3(3,42,20)};
            var pose=new ActorQuartzPose(hair,new Dictionary<string,Transform>{{strand.name,strand}},new[]{driver});
            head.localRotation=live;neck.localRotation=Quaternion.Euler(-14,20,9);
            pose.Apply();Check(strand.localRotation,new Quaternion(.09938285f,.03459241f,.06457788f,.99234879f));
            CheckHairLinkClearance(Bone("Linked hair",root));
        }
        finally{UnityEngine.Object.DestroyImmediate(root.gameObject);}
    }

    static void CheckHairLinkClearance(Transform root)
    {
        Transform Node(string name,Transform parent,Vector3 offset)
        {
            var bone=new GameObject(name).transform;
            bone.SetParent(parent,false);bone.localPosition=offset;
            return bone;
        }
        var a=Node("LeftHair",root,new Vector3(-.01f,.1f,0));
        var b=Node("RightHair",root,new Vector3(.01f,.1f,0));
        var left=Node("LeftTip",a,Vector3.down*.1f);
        var right=Node("RightTip",b,Vector3.down*.1f);
        var obstacle=Node("Obstacle",root,Vector3.forward*.023f);
        var bones=new List<ActorClothPhysics.BoneData>();
        foreach(var bone in new[]{a,b,left,right})bones.Add(new ActorClothPhysics.BoneData{name=bone.name,radiusA=.004f,collisionMask=1});
        var solver=root.gameObject.AddComponent<ActorClothPhysics>();
        solver.includeOtherDynamic=true;solver.simulateInLateUpdate=false;
        solver.Configure(root,new ActorClothPhysics.Data{
            source="fixture_hair",dynamic=bones.ToArray(),
            @static=new[]{new ActorClothPhysics.ColliderData{name=obstacle.name,radiusA=.003f,radiusB=.003f,collisionMask=1}}
        },new ActorQuartzPose.Profile{drivers=Array.Empty<ActorQuartzPose.Driver>(),limits=Array.Empty<ActorQuartzPose.Limit>(),
            layers=new[]{new ActorQuartzPose.Layer{bones=new[]{left.name,right.name},radius=.03f}}});
        var restLeft=left.position;var restRight=right.position;
        solver.ApplyCurrentPose();
        if(solver.ChainLinks!=1 || Vector3.Distance(left.position,restLeft)>.0001f || Vector3.Distance(right.position,restRight)>.0001f)
            throw new Exception("A narrow hair link distorted an unobstructed rest pose");
        obstacle.localPosition=Vector3.forward*.004f;
        solver.ApplyCurrentPose();
        if(root.InverseTransformPoint(left.position).z>-.001f || root.InverseTransformPoint(right.position).z>-.001f)
            throw new Exception("Hair link missed an obstacle between its two strands");
    }
}
