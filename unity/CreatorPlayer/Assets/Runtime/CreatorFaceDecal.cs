using UnityEngine;

// Experimental face-only projection using original local atlas and projector parameters.
public class CreatorFaceDecal : MonoBehaviour {
 public Transform projector;
 public Vector3 pivot,size;
 public Vector2 uvScale,uvBias;
 public float weight;
 public Material material;
 public bool inheritScale;
 Renderer target;
 MaterialPropertyBlock block;
 public void Configure() { target=GetComponent<Renderer>(); block=new MaterialPropertyBlock(); }
 void OnDestroy() { if(material)Destroy(material); }
 void LateUpdate() {
  if(!target||!projector)return;
  target.enabled=weight>0.00001f;if(!target.enabled)return;
  Matrix4x4 transformMatrix=inheritScale?projector.localToWorldMatrix:Matrix4x4.TRS(projector.position,projector.rotation,Vector3.one);
  var offset=new Vector3(pivot.x,-pivot.z,pivot.y);
  var dimensions=new Vector3(size.x,size.z,size.y);
  var decalToWorld=transformMatrix*Matrix4x4.Rotate(Quaternion.Euler(-90,0,0))*Matrix4x4.Translate(offset)*Matrix4x4.Scale(dimensions);
  block.SetMatrix("_ProjectorFromObject",decalToWorld.inverse*transform.localToWorldMatrix);
  block.SetVector("_AtlasScaleBias",new Vector4(uvScale.x,uvScale.y,uvBias.x,uvBias.y));
  block.SetFloat("_Weight",weight);target.SetPropertyBlock(block);
 }
}
public class CreatorRoundEyeMarker : MonoBehaviour {
 public Material[] materials;
 void OnDestroy() { if(materials!=null)foreach(var material in materials)if(material)Destroy(material); }
}
