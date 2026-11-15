using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

// Research approximation, not a reconstruction of the original IK solver.
[DefaultExecutionOrder(-100)]
public sealed class ActorHandIKCorrection : MonoBehaviour
{
    public Transform actorRoot;
    public bool autoSolveInLateUpdate;
    [Range(0f,1f)] public float strength=.75f;
    [Range(0f,.3f)] public float bodyRadius=.17f;
    [Range(0f,.15f)] public float handRadius=.06f;
    [Range(0f,.2f)] public float maxDisplacement=.08f;
    [Range(0f,90f)] public float maxJointAngle=35f;
    Transform hips;
    readonly List<(Transform arm,Transform forearm,Transform hand)> arms=new List<(Transform,Transform,Transform)>();

    public void Configure(Transform root)
    {
        if(!root)throw new ArgumentNullException(nameof(root));
        actorRoot=root;arms.Clear();var byName=root.GetComponentsInChildren<Transform>(true).ToDictionary(t=>t.name);
        hips=byName["Hips"];
        foreach(var side in new[]{"Left","Right"})arms.Add((byName[side+"Arm"],byName[side+"ForeArm"],byName[side+"Hand"]));
    }
    // Call after evaluating an animation pose and before simulating clothing.
    public void Solve()
    {
        if(!hips)return;
        var up=actorRoot.up;
        foreach(var (arm,forearm,hand) in arms)
        {
            var relative=hand.position-hips.position;var height=Vector3.Dot(relative,up);
            // Approximate the saved 0.2-long hip region, expanded by the hand radius.
            float heightWeight=Mathf.InverseLerp(.1f+handRadius,.09f+handRadius,Mathf.Abs(height));
            if(heightWeight<=0)continue;
            var radial=relative-up*height;float distance=radial.magnitude;
            if(distance<1e-5f || distance>=bodyRadius+handRadius)continue;
            var displacement=Mathf.Min((bodyRadius+handRadius-distance)*strength*heightWeight,maxDisplacement);
            var target=hand.position+radial.normalized*displacement;
            var originalHand=hand.rotation;var originalArm=arm.rotation;var originalForearm=forearm.rotation;
            for(int i=0;i<8;i++)
            {
                foreach(var joint in new[]{forearm,arm})
                {
                    var from=hand.position-joint.position;var to=target-joint.position;
                    if(from.sqrMagnitude<1e-10f || to.sqrMagnitude<1e-10f)continue;
                    joint.rotation=Quaternion.FromToRotation(from,to)*joint.rotation;
                    var original=joint==arm?originalArm:originalForearm;
                    joint.rotation=Quaternion.RotateTowards(original,joint.rotation,maxJointAngle);
                }
            }
            hand.rotation=originalHand;
        }
    }
    void OnEnable(){if(actorRoot)Configure(actorRoot);}
    void LateUpdate(){if(autoSolveInLateUpdate)Solve();}
}
