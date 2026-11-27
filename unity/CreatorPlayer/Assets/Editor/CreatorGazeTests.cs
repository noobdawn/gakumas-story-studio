using System;
using UnityEngine;

public static class CreatorGazeTests {
    public static void Run(){
        var root=new GameObject("Gaze pose regression");
        Transform Child(string name,Transform parent){
            var child=new GameObject(name).transform;child.SetParent(parent,false);return child;
        }
        try {
            var chest=Child("Spine2",root.transform);
            var neck=Child("Neck",chest);
            var head=Child("Head",neck);
            var face=Child("face",head);
            root.transform.rotation=Quaternion.Euler(0,50,0);
            var initial=head.rotation;
            var rig=new CreatorGazePose(root.transform,face,Vector3.zero);
            var target=root.transform.TransformPoint(new Vector3(1,0,2));
            var layer=new CreatorGazeLayer{point=new[]{target.x,target.y,target.z},head=.6f,eyes=1,weight=1};
            for(int i=0;i<2;i++){
                var result=rig.Apply(new[]{layer},Vector2.zero);
                var sight=face.rotation*Quaternion.Euler(-result.y,result.x,0)*Vector3.forward;
                if(Vector3.Angle(sight,target.normalized)>.05f||Quaternion.Angle(head.rotation,initial)<10)
                    throw new Exception("Gaze did not reach rotated actor target");
                rig.Restore();
                if(Quaternion.Angle(initial,head.rotation)>.05f)throw new Exception("Gaze accumulated across samples");
            }
            layer.point=null;layer.head=0;layer.pitch=-40;
            var eyes=rig.Apply(new[]{layer},Vector2.zero);
            if(eyes.y!=-18||Quaternion.Angle(initial,head.rotation)>.05f)throw new Exception("Eyes-only gaze moved the head or exceeded limit");
            rig.Restore();
        }finally{UnityEngine.Object.DestroyImmediate(root);}
    }
}
