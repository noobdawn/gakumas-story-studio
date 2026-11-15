using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

// Experimental mesh-sample/thigh-capsule correction. The capsules are fitted
// from this actor's locally loaded skinned mesh, not original game colliders.
public sealed class SkirtSurfaceCollision : MonoBehaviour
{
    public struct Metrics { public int samples, overlaps,triangleSamples,triangleOverlaps; public float totalDepth, maxDepth,triangleDepth; }
    sealed class Leg { public Transform upper, lower; public float radius; }
    sealed class Sample { public int vertex; public Transform bone; }
    readonly List<Leg> legs=new List<Leg>();
    readonly List<Sample> samples=new List<Sample>();
    readonly List<int> deformVertices=new List<int>();
    readonly List<int[]> triangles=new List<int[]>();
    int[] triangleClasses=new int[4];int totalIndices;
    SkinnedMeshRenderer skin; Mesh baked;
    Transform hips;
    MeshRenderer display;
    int mode;
    public bool applyCorrection;
    public Metrics before,after;
    public string Description => string.Join(",",legs.Select(x=>$"{x.upper.name}:{x.radius:F4}"))+" samples="+samples.Count+" indices="+totalIndices+" classes="+string.Join("/",triangleClasses)+" triangles="+triangles.Count+" display="+(display?display.enabled.ToString():"none")+" forced="+skin.forceRenderingOff+" bakedIndices="+(baked?baked.triangles.Length:0);

    public void Configure(SkinnedMeshRenderer renderer,int selectedMode,int[] sourceIndices)
    {
        if(!renderer||!renderer.sharedMesh)throw new InvalidOperationException("Missing skinned mesh");
        skin=renderer;mode=selectedMode;applyCorrection=mode!=0;baked=new Mesh();skin.BakeMesh(baked);
        var vertices=baked.vertices;var weights=skin.sharedMesh.boneWeights;var bones=skin.bones;
        if(weights.Length!=vertices.Length||bones==null)throw new InvalidOperationException("Unsupported mesh weights");
        for(int side=0;side<2;side++){
            string prefix=side==0?"Left":"Right";var upper=bones.FirstOrDefault(x=>x&&x.name==prefix+"UpLeg");var lower=bones.FirstOrDefault(x=>x&&x.name==prefix+"Leg");
            if(!upper||!lower)throw new InvalidOperationException("Missing leg bones: "+prefix);
            var axis=lower.position-upper.position;float len2=axis.sqrMagnitude;if(len2<.001f)throw new InvalidOperationException("Invalid leg bones");
            var radii=new List<float>();
            for(int i=0;i<vertices.Length;i++){
                var w=weights[i];var ids=new[]{w.boneIndex0,w.boneIndex1,w.boneIndex2,w.boneIndex3};var values=new[]{w.weight0,w.weight1,w.weight2,w.weight3};float legWeight=0,skirtWeight=0;
                for(int k=0;k<4;k++){if(ids[k]<0||ids[k]>=bones.Length||!bones[ids[k]])continue;if(bones[ids[k]]==upper)legWeight+=values[k];if(bones[ids[k]].name.Contains("Skirt"))skirtWeight+=values[k];}
                if(legWeight<.75f||skirtWeight>.01f)continue;var world=skin.transform.TransformPoint(vertices[i]);float t=Vector3.Dot(world-upper.position,axis)/len2;if(t<.15f||t>.8f)continue;radii.Add(Vector3.Distance(world,upper.position+axis*t));
            }
            if(radii.Count<16)throw new InvalidOperationException("Insufficient leg mesh samples: "+prefix+" "+radii.Count);
            radii.Sort();float radius=Mathf.Clamp(radii[Mathf.FloorToInt((radii.Count-1)*.85f)]+.004f,.035f,.12f);legs.Add(new Leg{upper=upper,lower=lower,radius=radius});
        }
        var all=new List<Sample>();var deformMask=new bool[weights.Length];hips=bones.FirstOrDefault(x=>x&&x.name=="Hips");
        for(int i=0;i<weights.Length;i++){
            var w=weights[i];var ids=new[]{w.boneIndex0,w.boneIndex1,w.boneIndex2,w.boneIndex3};var values=new[]{w.weight0,w.weight1,w.weight2,w.weight3};float skirt=0,best=0;Transform bone=null;
            for(int k=0;k<4;k++){if(ids[k]<0||ids[k]>=bones.Length||!bones[ids[k]])continue;var b=bones[ids[k]];if(!b.name.Contains("Skirt"))continue;skirt+=values[k];if(values[k]>best){best=values[k];bone=b;}}
            if(skirt>.1f){deformVertices.Add(i);deformMask[i]=true;}
            if(skirt<.5f||!bone)continue;if(bone.childCount==0&&bone.parent&&bone.parent.name.Contains("Skirt"))bone=bone.parent;all.Add(new Sample{vertex=i,bone=bone});
        }
        if(all.Count==0)throw new InvalidOperationException("No skirt mesh samples");
        int count=Math.Min(512,all.Count);for(int i=0;i<count;i++)samples.Add(all[(int)((long)i*all.Count/count)]);
        var indices=skin.sharedMesh.triangles;if(indices.Length==0)indices=baked.triangles;if(indices.Length==0&&sourceIndices!=null)indices=sourceIndices;if(indices.Length%3!=0||indices.Any(i=>i<0||i>=weights.Length))throw new InvalidOperationException("Invalid collision topology");totalIndices=indices.Length;for(int i=0;i+2<indices.Length;i+=3){int a=indices[i],b=indices[i+1],c=indices[i+2];int matched=(deformMask[a]?1:0)+(deformMask[b]?1:0)+(deformMask[c]?1:0);triangleClasses[matched]++;if(matched>=2)triangles.Add(new[]{a,b,c});}
        if(triangles.Count>1200){var allTriangles=triangles.ToArray();triangles.Clear();for(int i=0;i<1200;i++)triangles.Add(allTriangles[(int)((long)i*allTriangles.Length/1200)]);}
        if(mode>=2){var go=new GameObject("Experimental skirt collision display");go.layer=skin.gameObject.layer;go.transform.SetParent(skin.transform,false);go.AddComponent<MeshFilter>().sharedMesh=baked;display=go.AddComponent<MeshRenderer>();display.sharedMaterials=skin.sharedMaterials;display.shadowCastingMode=skin.shadowCastingMode;display.receiveShadows=skin.receiveShadows;display.lightProbeUsage=skin.lightProbeUsage;display.reflectionProbeUsage=skin.reflectionProbeUsage;display.enabled=false;}
        before=after=Measure();
    }
    Vector3 Push(Vector3 point,Leg leg,out float depth)
    {
        var axis=leg.lower.position-leg.upper.position;float len2=axis.sqrMagnitude;if(len2<1e-8f){depth=0;return Vector3.zero;}
        float t=Mathf.Clamp01(Vector3.Dot(point-leg.upper.position,axis)/len2);var delta=point-(leg.upper.position+axis*t);float distance=delta.magnitude;depth=leg.radius-distance;
        if(depth<=0)return Vector3.zero;var normal=distance>1e-6f?delta/distance:leg.upper.TransformDirection(Vector3.forward);return normal*depth;
    }
    Metrics Evaluate(Vector3[] vertices,Dictionary<Transform,Vector3> torque=null,Dictionary<Transform,int> counts=null)
    {
        var result=new Metrics{samples=samples.Count};
        foreach(var sample in samples){var point=skin.transform.TransformPoint(vertices[sample.vertex]);Vector3 correction=Vector3.zero;float deepest=0;
            foreach(var leg in legs){var push=Push(point,leg,out var depth);if(depth>deepest){deepest=depth;correction=push;}}
            if(deepest<=0)continue;result.overlaps++;result.totalDepth+=deepest;result.maxDepth=Mathf.Max(result.maxDepth,deepest);
            if(torque!=null){var lever=point-sample.bone.position;float denom=lever.sqrMagnitude;if(denom>1e-6f){var value=Vector3.Cross(lever,correction)/denom;if(!torque.ContainsKey(sample.bone)){torque[sample.bone]=Vector3.zero;counts[sample.bone]=0;}torque[sample.bone]+=value;counts[sample.bone]++;}}
        }
        foreach(var tri in triangles){var a=skin.transform.TransformPoint(vertices[tri[0]]);var b=skin.transform.TransformPoint(vertices[tri[1]]);var c=skin.transform.TransformPoint(vertices[tri[2]]);foreach(var point in new[]{(a+b+c)/3f,(a+b)*.5f,(b+c)*.5f,(c+a)*.5f}){result.triangleSamples++;float deepest=0;foreach(var leg in legs){Push(point,leg,out var depth);deepest=Mathf.Max(deepest,depth);}if(deepest>1e-5f){result.triangleOverlaps++;result.triangleDepth+=deepest;}}}return result;
    }
    public Metrics Measure(){skin.BakeMesh(baked);return Evaluate(baked.vertices);}
    public void Step(){
        skin.BakeMesh(baked);before=Evaluate(baked.vertices);after=before;if(!applyCorrection||(before.overlaps==0&&(mode!=3||before.triangleOverlaps==0)))return;
        if(mode==2||mode==3){
            var vertices=baked.vertices;
            foreach(int i in deformVertices){var point=skin.transform.TransformPoint(vertices[i]);
                foreach(var leg in legs){var push=Push(point,leg,out var depth);if(depth>0)point+=push;}
                vertices[i]=skin.transform.InverseTransformPoint(point);
            }
            if(mode==3){
                for(int iteration=0;iteration<3;iteration++){
                    var sums=new Vector3[vertices.Length];var counts=new int[vertices.Length];
                    foreach(var tri in triangles){var a=skin.transform.TransformPoint(vertices[tri[0]]);var b=skin.transform.TransformPoint(vertices[tri[1]]);var c=skin.transform.TransformPoint(vertices[tri[2]]);
                        foreach(var point in new[]{(a+b+c)/3f,(a+b)*.5f,(b+c)*.5f,(c+a)*.5f}){
                            Vector3 correction=Vector3.zero;float deepest=0;foreach(var leg in legs){var push=Push(point,leg,out var depth);if(depth>deepest){deepest=depth;correction=push;}}
                            if(deepest<=1e-5f)continue;foreach(var index in tri){sums[index]+=correction;counts[index]++;}
                        }
                    }
                    foreach(int index in deformVertices)if(counts[index]>0){var correction=Vector3.ClampMagnitude(sums[index]/counts[index],.025f);vertices[index]=skin.transform.InverseTransformPoint(skin.transform.TransformPoint(vertices[index])+correction);}
                }
            }
            baked.vertices=vertices;baked.RecalculateBounds();after=Evaluate(vertices);return;
        }
        // Small bounded updates prevent one sample from whipping the whole chain.
        for(int iteration=0;iteration<3;iteration++){
            var torque=new Dictionary<Transform,Vector3>();var counts=new Dictionary<Transform,int>();Evaluate(baked.vertices,torque,counts);
            foreach(var entry in torque){var delta=entry.Value/counts[entry.Key];float magnitude=delta.magnitude;if(magnitude<1e-7f)continue;float degrees=Mathf.Min(6f,magnitude*Mathf.Rad2Deg);entry.Key.rotation=Quaternion.AngleAxis(degrees,delta/magnitude)*entry.Key.rotation;}
            skin.BakeMesh(baked);after=Evaluate(baked.vertices);if(after.overlaps==0)break;
        }
    }
    public void SetDisplay(bool active){if(mode<2||!display)return;display.enabled=active;if(active)skin.forceRenderingOff=true;}
    void OnDestroy(){if(baked)Destroy(baked);}
}
