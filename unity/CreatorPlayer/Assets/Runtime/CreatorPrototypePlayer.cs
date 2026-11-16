using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.Animations;
using UnityEngine.Playables;
using UnityEngine.SceneManagement;

// Research prototype: loads prepared local characters, without bundling game assets.
public class CreatorPrototypePlayer : MonoBehaviour {
 public Shader uiGraphShader; CreatorUIGraph uiGraph;
 [Serializable] class CachedScene {public string sceneId,source;public string[] files;}
 [Serializable] class CachedScenes {public CachedScene[] entries;}
 CachedScenes cachedScenes;string cachedBundleRoot;HashSet<string> loadedSceneFiles=new HashSet<string>{"shader","actor-shader","m_fdc"};
 void EnsureCachedScene(string id){
  if(scenePaths.ContainsKey(id))return;var item=cachedScenes?.entries?.FirstOrDefault(x=>x.sceneId==id);if(item==null)throw new Exception("Scene not available: "+id);
  AssetBundle sceneBundle=null;
  foreach(var name in item.files){if(!System.Text.RegularExpressions.Regex.IsMatch(name,@"^[A-Za-z0-9_-]+$"))throw new Exception("Invalid scene dependency");if(loadedSceneFiles.Contains(name))continue;var file=Path.Combine(cachedBundleRoot,name+".bundle");var b=AssetBundle.LoadFromFile(file);if(!b)throw new Exception("Scene dependency unavailable: "+name);bundles.Add(b);loadedSceneFiles.Add(name);if(name==item.source)sceneBundle=b;}
  if(!sceneBundle)throw new Exception("Scene bundle unavailable: "+id);var paths=sceneBundle.GetAllScenePaths();if(paths.Length!=1)throw new Exception("Ambiguous scene paths: "+id);scenePaths[id]=paths[0];
 }
 string backgroundRoot; GameObject backgroundPlane; Texture2D backgroundTexture; string backgroundId="";
 void SetBackground(string id) {
  if(id==backgroundId)return;
  if(string.IsNullOrEmpty(id)){backgroundId="";if(backgroundPlane){backgroundPlane.SetActive(false);backgroundPlane.GetComponent<Renderer>().sharedMaterial.mainTexture=null;}if(backgroundTexture)Destroy(backgroundTexture);backgroundTexture=null;ApplySceneVisibility();return;}
  if(!System.Text.RegularExpressions.Regex.IsMatch(id,@"^2d-env_2d_[A-Za-z0-9_-]+$"))throw new Exception("Invalid background ID");
  string path=Path.Combine(backgroundRoot??"",id.Substring(3)+".png");if(string.IsNullOrEmpty(backgroundRoot)||!File.Exists(path))throw new Exception("2D background missing: "+id);
  var tex=new Texture2D(2,2);if(!tex.LoadImage(File.ReadAllBytes(path))){Destroy(tex);throw new Exception("Invalid background image");}
  if(!backgroundPlane){backgroundPlane=GameObject.CreatePrimitive(PrimitiveType.Quad);Destroy(backgroundPlane.GetComponent<Collider>());backgroundPlane.name="CreatorFixedBackground";backgroundPlane.transform.SetParent(cameraObject.transform,false);backgroundPlane.GetComponent<Renderer>().sharedMaterial=new Material(fallbackShader);}
  if(backgroundTexture)Destroy(backgroundTexture);backgroundTexture=tex;backgroundPlane.GetComponent<Renderer>().sharedMaterial.mainTexture=tex;backgroundId=id;ApplySceneVisibility();FitBackground();
 }
 void FitBackground(){if(!backgroundPlane||string.IsNullOrEmpty(backgroundId))return;backgroundPlane.SetActive(arrangementSceneVisible);float d=cameraObject.farClipPlane*.9f;float h=2*d*Mathf.Tan(cameraObject.fieldOfView*Mathf.Deg2Rad*.5f),w=h*cameraObject.aspect,a=(float)backgroundTexture.width/backgroundTexture.height;if(w/h>a)h=w/a;else w=h*a;backgroundPlane.transform.localPosition=new Vector3(0,0,d);backgroundPlane.transform.localRotation=Quaternion.identity;backgroundPlane.transform.localScale=new Vector3(w,h,1);}
 void LateUpdate(){FitBackground();}
 [Serializable] class ActorState { public CreatorMotionLayer[] motionLayers; public string id, motionId, characterId, idleMotionId, costumeId, blendMotionId; public float[] position, rotation, scale; public bool visible, motionActive, motionLoop, blendActive; public float motionTime, idleMotionTime, faceWeight, blendMotionTime, blendWeight; public FaceWeight[] faceShapes; }
 [Serializable] class SceneProp { public string id; public float[] position,rotation,scale; public bool visible; }
 [Serializable] class CostumeEntry { public string id,name,character; public string[] dependencies; }
 [Serializable] class CostumeCatalog { public CostumeEntry[] costumes; }
 [Serializable] class FaceWeight { public string name; public float weight,time; }
 [Serializable] class FaceShape { public string name; public int[] indices; public float[] offsets; }
 [Serializable] class FilmMotion { public bool isAdditive; public string id, file, clip; }
 [Serializable] class FilmMotionCatalog { public FilmMotion[] motions; }
 [Serializable] class FaceData { public string source; public int vertexCount; public FaceShape[] shapes; }
 [Serializable] class DecalDefinition { public string name; public Vector2 uvScale,uvBias; public Vector3 pivot,size; public int scaleMode,layerMask; }
 [Serializable] class DecalData { public string source; public DecalDefinition[] projectors; }
 [Serializable] class FaceBoneMatrix { public float[] values; }
 [Serializable] class FaceBoneWeight { public int vertex,bone; public float weight; }
 [Serializable] class FaceBoneData { public string source; public int vertexCount; public string[] bones; public FaceBoneMatrix[] bindposes; public FaceBoneWeight[] eyeWeights; }
 [Serializable] class EyeMaterialData { public string code,effect; public int tileX,tileY,fps; }
 class EyeMaterialResource { public EyeMaterialData data; public Texture2D[] textures; }
 class FaceInstance { public Mesh mesh, decalMesh; public Vector3[] original; public string last=null; public GameObject[] roundEyes; public FaceBoneData boneData; public Matrix4x4[] eyeBinds; public MeshRenderer faceRenderer; public int eyeMaterialIndex=-1; public Material originalEye,eyeMaterial; public Dictionary<string,CreatorFaceDecal> decals=new Dictionary<string,CreatorFaceDecal>(); public Dictionary<string,GameObject> headEffects=new Dictionary<string,GameObject>(); }
 [Serializable] class Command { public bool profileExport; public bool skipPreRender,gpuColor; public int frameIndex; public string runId; public CreatorCompositionState composition; public CreatorEffectState postEffects; public CreatorMediaDraw[] mediaDraws;public string mediaSelectedId;public bool mediaEditable,mediaSnap; public CreatorRenderSettings renderSettings; public CreatorUIDraw[] uiDraws; public bool captureUiLayer; public CreatorUIRect[] uiRects; public bool includeUiOverlay; public CreatorMotionLayer[] motionLayers; public string token, kind, thumbnailTarget, sceneId, subtitleText, subtitleSpeaker, subtitleStyle, subtitleColor, subtitleColorEnd, motionId, idleMotionId, blendMotionId, editorSelectedId, editorSelectedKind, editorPropId, gizmoTestPhase, editorToolMode; public ActorState[] actorInstances; public SceneProp[] sceneProps; public int id, frameWidth, frameHeight, gizmoTestAxis; public float[] actorPosition, actorRotation, actorScale, editorSelectedScale, cameraPosition, cameraRotation; public float fov; public float motionTime, idleMotionTime, outlineWidth, blendMotionTime, blendWeight, gizmoTestDelta; public bool motionActive, motionLoop, physicsEnabled, hasOutlineSettings, hasArrangement, sceneVisible, cameraEnabled, blendActive, editorCanMove, includeEditorGizmo; }
 [Serializable] class SkirtTopology { public string source; public int vertexCount; public int[] indices; }
 [Serializable] class PhysicsMetric { public string actor,surfaceDescription; public int overlaps,pairs,surfaceSamples,surfaceBefore,surfaceAfter,triangleSamples,triangleBefore,triangleAfter; public float maxDepth,totalDepth,surfaceDepthBefore,surfaceDepthAfter,triangleDepthBefore,triangleDepthAfter; }
 [Serializable] class Reply { public CreatorExportTiming exportTiming; public CreatorScreenMedia.EditEvent mediaEvent; public bool sceneReady; public string sceneId; public int id; public bool ok; public string error; public PhysicsMetric[] physicsMetrics; public CreatorSceneGizmo.EditEvent gizmoEvent; public string gizmoToolMode; }
 class Work { public long queued,started; public CreatorExportTiming timing; public Command command; public string result; public ManualResetEventSlim done = new ManualResetEventSlim(); }
 CreatorCompositionState composition;
 string storyError;public Shader postEffectShader;CreatorPostEffects storyEffects;CreatorDialogueLayer storyDialogue;
 public Shader selectionShellShader, gizmoAxisShader; CreatorSceneGizmo editorGizmo;CreatorScreenMedia screenMedia;
 public Shader fallbackShader;
 public Shader faceDecalShader;
 public Shader roundEyeShader;
 public UniversalRenderPipelineAsset actorPipeline;
 public ActorOutlineFeature actorOutline;
 public CreatorSceneLightingFeature sceneLighting; CreatorLinearRendering linearRendering; Light previewLight;
 readonly ConcurrentQueue<Work> pending = new ConcurrentQueue<Work>();
 readonly List<AssetBundle> bundles = new List<AssetBundle>();
 readonly Dictionary<string,AssetBundle> namedBundles = new Dictionary<string,AssetBundle>();
 readonly Dictionary<string,EyeMaterialResource> eyeMaterialResources = new Dictionary<string,EyeMaterialResource>();
 class CharacterResources { public AssetBundle body,hair,face; public Vector3[] original; public int vertexCount; public Dictionary<string,FaceShape> shapes=new Dictionary<string,FaceShape>(); }
 readonly Dictionary<string,CharacterResources> roster = new Dictionary<string,CharacterResources>();
 readonly HashSet<string> rosterCodes = new HashSet<string>(); string bundleRoot, rosterFaceDir, decalDataDir, roundEyesDir, faceBoneDir, headEffectDir, eyeMaterialDir; Material mainOriginalEye;
 static readonly HashSet<string> allowedCharacters = new HashSet<string>("hski fktn amao kllj kcna ssmk shro hrnm hume jsna hmsz atbm nasr krnh".Split(' '));
 readonly Dictionary<string,GameObject> copies = new Dictionary<string,GameObject>();
 readonly Dictionary<string,Vector3> copyBaseScales = new Dictionary<string,Vector3>(); Vector3 mainBaseScale=Vector3.one;
 readonly Dictionary<string,string> copyCharacters = new Dictionary<string,string>();
 readonly Dictionary<string,string> copyCostumes = new Dictionary<string,string>();
 readonly Dictionary<string,CostumeEntry> costumes = new Dictionary<string,CostumeEntry>(); string costumeRoot;
 readonly Dictionary<string,Avatar> copyAvatars = new Dictionary<string,Avatar>();
 readonly Dictionary<string,PlayableGraph> copyGraphs = new Dictionary<string,PlayableGraph>();
 readonly Dictionary<string,Dictionary<string,AnimationClipPlayable>> copyMotions = new Dictionary<string,Dictionary<string,AnimationClipPlayable>>();
 readonly Dictionary<string,AnimationPlayableOutput> copyOutputs = new Dictionary<string,AnimationPlayableOutput>();
 readonly Dictionary<string,AnimationMixerPlayable> copyMixers = new Dictionary<string,AnimationMixerPlayable>();
 readonly Dictionary<string,CreatorAnimationLayers> copyLayers=new Dictionary<string,CreatorAnimationLayers>(); CreatorAnimationLayers mainLayers; CreatorMotionLayer[] mainLayerState;
 AnimationMixerPlayable mainMixer; string mainBlendId=""; float mainBlendTime,mainBlendWeight; bool mainBlendActive;
 class CopyPhysics { public ActorClothPhysics[] solvers; public float time=-1; public string motionId=""; public bool enabled; }
 readonly Dictionary<string,CopyPhysics> copyPhysics = new Dictionary<string,CopyPhysics>();
 string swingDir,hairSwingDir; ActorClothPhysics mainHairCloth; float testSkirtAngle=-1f;
 const string QuietIdle="mot_photo_chr_cmmn_stand-idle-001_lp_b";
 readonly Dictionary<string,AnimationClip> motionClips = new Dictionary<string,AnimationClip>();
 readonly Dictionary<string,FilmMotion> filmMotions = new Dictionary<string,FilmMotion>();
 readonly Dictionary<string,AssetBundle> filmMotionBundles = new Dictionary<string,AssetBundle>();
 readonly Dictionary<string,AnimationClipPlayable> mainMotions = new Dictionary<string,AnimationClipPlayable>();
 AnimationPlayableOutput mainOutput; string selectedMotion="shy";
 readonly Dictionary<string,FaceInstance> faceInstances = new Dictionary<string,FaceInstance>(); FaceShape mouthShape; readonly Dictionary<string,FaceShape> faceShapes = new Dictionary<string,FaceShape>(); int faceVertexCount; Vector3[] faceOriginal;
 readonly Dictionary<Renderer,bool> sceneOriginalVisibility = new Dictionary<Renderer,bool>();
 class ChairState { public Transform transform; public Vector3 position,scale; public Quaternion rotation; }
 readonly Dictionary<string,ChairState> classroomChairs=new Dictionary<string,ChairState>(); SceneProp[] requestedSceneProps=Array.Empty<SceneProp>();
 bool arrangementSceneVisible=true; string subtitleText="", subtitleSpeaker="", subtitleStyle="box", subtitleColor="#57576D", subtitleColorEnd="#57576D"; Texture2D coloredName; string coloredNameKey=""; Font subtitleFont;
 Texture2D dialogueBackground,dialogueFrame,dialogueName;
 readonly Dictionary<string,string> scenePaths = new Dictionary<string,string>();
 CreatorUIRect[] uiRects=Array.Empty<CreatorUIRect>(); string lastStateSceneId; string currentSceneId, requestedSceneId, sceneError; bool sceneBusy;
 GameObject body; Camera cameraObject; PlayableGraph graph; AnimationClipPlayable motion; AnimationClip clip; ActorClothPhysics cloth; float simulatedTime=-1; bool lastPhysics; TcpListener listener; Thread thread; volatile bool running; string token, output; bool connectToHost; int sessionPort;
 string OptionalArg(string name) { var args=Environment.GetCommandLineArgs(); int i=Array.IndexOf(args,name); return i>=0 && i+1<args.Length ? args[i+1] : null; }
 string Arg(string name) { var args=Environment.GetCommandLineArgs(); int i=Array.IndexOf(args,name); if(i<0||i+1>=args.Length) throw new Exception("Missing "+name); return args[i+1]; }
 AssetBundle Load(string root,string name) { if(namedBundles.TryGetValue(name,out var cached))return cached;var bundle=AssetBundle.LoadFromFile(name=="shader"&&!string.IsNullOrEmpty(OptionalArg("-creator-render-shaders"))?OptionalArg("-creator-render-shaders"):Path.Combine(root,name+".bundle")); if(!bundle) throw new Exception("Cannot load "+name); bundles.Add(bundle);namedBundles.Add(name,bundle); return bundle; }
 GameObject Instance(AssetBundle bundle) { foreach(var name in bundle.GetAllAssetNames()) { var prefab=bundle.LoadAsset<GameObject>(name); if(prefab) return Instantiate(prefab); } throw new Exception("Prefab missing"); }
 void Restore(SkinnedMeshRenderer skin) { var bones=skin.bones; var binds=skin.sharedMesh.bindposes; int Depth(Transform t) { int n=0; while(t&&t.parent) { n++; t=t.parent; } return n; } foreach(int i in Enumerable.Range(0,Math.Min(bones.Length,binds.Length)).Where(i=>bones[i]).OrderBy(i=>Depth(bones[i]))) { var b=bones[i]; var local=b.parent.worldToLocalMatrix*(skin.transform.localToWorldMatrix*binds[i].inverse); b.localPosition=local.GetColumn(3); b.localRotation=local.rotation; b.localScale=local.lossyScale; } }
 void Start() {
  try {
   storyEffects=new CreatorPostEffects(postEffectShader);storyDialogue=new CreatorDialogueLayer(uiGraphShader);uiGraph=new CreatorUIGraph(uiGraphShader,OptionalArg("-creator-ui-data"));screenMedia=new CreatorScreenMedia(uiGraphShader,OptionalArg("-creator-media-root"),transform);
   output=Path.GetFullPath(Arg("-creator-output")); string root=Path.GetFullPath(Arg("-creator-bundles"));bundleRoot=root; token=Arg("-creator-token");swingDir=OptionalArg("-creator-swing-dir");hairSwingDir=OptionalArg("-creator-hair-swing-dir");
   if(SystemInfo.graphicsDeviceType!=GraphicsDeviceType.Direct3D11)throw new Exception("当前原始资源渲染只支持 Direct3D 11，请通过新版创作器启动。实际图形后端："+SystemInfo.graphicsDeviceType);
   string dialogueDir=OptionalArg("-creator-dialogue-assets");if(!string.IsNullOrEmpty(dialogueDir)){dialogueBackground=LoadTexture(Path.Combine(dialogueDir,"message_bg.png"));dialogueFrame=LoadTexture(Path.Combine(dialogueDir,"frame_message_bg.png"));dialogueName=LoadTexture(Path.Combine(dialogueDir,"name_bg.png"));}
   Application.runInBackground=true; Application.targetFrameRate=60; QualitySettings.vSyncCount=0;
   if(actorPipeline) {
    GraphicsSettings.defaultRenderPipeline=actorPipeline; QualitySettings.renderPipeline=actorPipeline;
    RenderSettings.ambientMode=AmbientMode.Flat; RenderSettings.ambientLight=Color.black;
    Shader.SetGlobalVector("_MatCapMainLight",new Vector4(.2f,.8f,.5f,1)); Shader.SetGlobalVector("_MatCapRimLight",new Vector4(.1f,.8f,.5f,1));
    Shader.SetGlobalColor("_MatCapLightColor",Color.white); Shader.SetGlobalColor("_MatCapRimColor",new Color(.08f,.08f,.08f,1));
    Shader.SetGlobalFloat("_SkinSaturation",1); Shader.SetGlobalColor("_ShadeMultiplyColor",Color.white); Shader.SetGlobalColor("_ShadeAdditiveColor",Color.black); Shader.SetGlobalVector("_MatCapParam",new Vector4(0,0,1,0));
    var light=new GameObject("ExperimentalPreviewLight").AddComponent<Light>();previewLight=light; light.type=LightType.Directional; light.transform.rotation=Quaternion.Euler(35,-30,0); light.intensity=1f;
    if(Array.IndexOf(Environment.GetCommandLineArgs(),"-creator-outline-off")>=0 && actorOutline) actorOutline.settings.width=0;
   }
   Load(root,"shader"); Load(root,"actor-shader"); Load(root,"m_fdc");
   var preload=OptionalArg("-creator-preload-costumes");if(!string.IsNullOrEmpty(preload)){var names=preload.Split(',');if(names.Length>32||names.Distinct().Count()!=names.Length||names.Any(n=>!ValidBodyName(n)))throw new Exception("Invalid preload dependencies");foreach(var name in names)Load(root,name);}
   decalDataDir=OptionalArg("-creator-face-decal-dir");roundEyesDir=OptionalArg("-creator-round-eye-dir");faceBoneDir=OptionalArg("-creator-face-bone-dir");headEffectDir=OptionalArg("-creator-head-effect-dir");eyeMaterialDir=OptionalArg("-creator-eye-material-dir");
   body=Instance(Load(root,"mdl_chr_ttmr-casl-0002_body")); mainBaseScale=body.transform.localScale; var skin=body.GetComponentsInChildren<SkinnedMeshRenderer>(true).First(x=>x.name=="Geo_Body"); Restore(skin);
   var head=body.GetComponentsInChildren<Transform>(true).First(x=>x.name=="Head"); var hair=Instance(Load(root,"mdl_chr_ttmr-base-0000_hair")); hair.transform.SetParent(head,false);if(hairSwingDir!=null)mainHairCloth=AttachCopyPhysics(hair,"mdl_chr_ttmr-base-0000_hair",hairSwingDir);
   var fb=Load(root,"ttmr-face-exposed"); var face=Instance(fb); face.transform.SetParent(head,false); var fr=face.GetComponentInChildren<MeshRenderer>(true); var mesh=fb.LoadAsset<Mesh>("_CombinedFaceMesh"); if(!fr||!mesh) throw new Exception("Face mesh missing"); faceOriginal=mesh.vertices;
   var faceGo=new GameObject("face"); faceGo.transform.SetParent(body.transform,false); faceGo.AddComponent<MeshFilter>().sharedMesh=mesh; faceGo.AddComponent<MeshRenderer>().sharedMaterials=fr.sharedMaterials; mainOriginalEye=fr.sharedMaterials.FirstOrDefault(m=>m&&m.name=="m_eye");faceGo.transform.SetParent(head,true); fr.enabled=false;
   foreach(var renderer in body.GetComponentsInChildren<Renderer>(true)) if(renderer.enabled) {
    if(renderer is SkinnedMeshRenderer sm) sm.updateWhenOffscreen=true;
    if(actorPipeline) {
     foreach(var mat in renderer.sharedMaterials) if(mat) {
      if(!mat.shader || !mat.shader.isSupported) throw new Exception("Unsupported material shader: "+mat.name);
      
      
     }
    } else {
     var mats=new List<Material>(); foreach(var src in renderer.sharedMaterials) { if(!src) { mats.Add(null); continue; } var dst=new Material(fallbackShader); var props=src.GetTexturePropertyNames(); var p=new[]{"_BaseMap","_MainTex","_BaseColorMap","_ColorTex"}.FirstOrDefault(x=>props.Contains(x)&&src.GetTexture(x)); if(p!=null) dst.mainTexture=src.GetTexture(p); mats.Add(dst); } renderer.sharedMaterials=mats.ToArray();
    }
   }
   var facePath=OptionalArg("-creator-face-shapes");
   if(!string.IsNullOrEmpty(facePath)){var data=JsonUtility.FromJson<FaceData>(File.ReadAllText(facePath));faceVertexCount=data?.vertexCount??0;if(faceVertexCount!=mesh.vertexCount||data.shapes==null)throw new Exception("Invalid face shape metadata");foreach(var shape in data.shapes){if(shape==null||string.IsNullOrEmpty(shape.name)||shape.indices==null||shape.offsets==null||shape.offsets.Length!=shape.indices.Length*3||shape.indices.Any(i=>i<0||i>=faceVertexCount)||shape.offsets.Any(v=>float.IsNaN(v)||float.IsInfinity(v))||faceShapes.ContainsKey(shape.name))throw new Exception("Invalid face shape metadata");faceShapes.Add(shape.name,shape);}if(!faceShapes.TryGetValue("b_mouth.mouth_001",out mouthShape))throw new Exception("Mouth shape missing");}
   rosterFaceDir=OptionalArg("-creator-roster-face-dir");var codes=OptionalArg("-creator-roster-codes");
   if(!string.IsNullOrEmpty(rosterFaceDir)&&!string.IsNullOrEmpty(codes))foreach(var code in codes.Split(',')){if(!allowedCharacters.Contains(code))throw new Exception("Invalid character code");rosterCodes.Add(code);}
   var motionPath=OptionalArg("-creator-motion"); var clothPath=OptionalArg("-creator-cloth");
   if(!string.IsNullOrEmpty(motionPath)) {
    SetupMotion(motionPath);
    foreach(var name in new[]{"idle","angry","yes"}) { var extra=OptionalArg("-creator-motion-"+name); if(!string.IsNullOrEmpty(extra))LoadMotion(name,extra); }
   }
   var filmPath=OptionalArg("-creator-film-motions");
   if(!string.IsNullOrEmpty(filmPath)) { var catalog=JsonUtility.FromJson<FilmMotionCatalog>(File.ReadAllText(filmPath));if(catalog?.motions==null||catalog.motions.Length>5000)throw new Exception("Invalid motion catalog");foreach(var item in catalog.motions){if(item==null||string.IsNullOrEmpty(item.id)||!System.Text.RegularExpressions.Regex.IsMatch(item.id,"^film-[0-9a-f]{24}$")||string.IsNullOrEmpty(item.file)||!Path.IsPathRooted(item.file)||string.IsNullOrEmpty(item.clip)||item.clip.Length>180||filmMotions.ContainsKey(item.id))throw new Exception("Invalid motion catalog entry");filmMotions.Add(item.id,item);} }
   var costumePath=OptionalArg("-creator-costume-manifest");costumeRoot=OptionalArg("-creator-costume-root");
   if(!string.IsNullOrEmpty(costumePath)){if(string.IsNullOrEmpty(costumeRoot)||!Path.IsPathRooted(costumeRoot))throw new Exception("Invalid costume root");var catalog=JsonUtility.FromJson<CostumeCatalog>(File.ReadAllText(costumePath));if(catalog?.costumes==null||catalog.costumes.Length>5000)throw new Exception("Invalid costume catalog");foreach(var item in catalog.costumes){if(item==null||string.IsNullOrEmpty(item.id)||!System.Text.RegularExpressions.Regex.IsMatch(item.id,"^asset-costume-[0-9a-f]{24}$")||string.IsNullOrEmpty(item.character)||(item.character!="ttmr"&&!allowedCharacters.Contains(item.character))||string.IsNullOrEmpty(item.name)||!System.Text.RegularExpressions.Regex.IsMatch(item.name,"^mdl_chr_"+item.character+"-[a-z0-9]+-[a-z0-9]+_body$")||item.dependencies==null||item.dependencies.Length>32||item.dependencies.Any(n=>!ValidBodyName(n)||n==item.name)||item.dependencies.Distinct().Count()!=item.dependencies.Length||costumes.ContainsKey(item.id))throw new Exception("Invalid costume entry");costumes.Add(item.id,item);}}
   if(!string.IsNullOrEmpty(clothPath)) { var data=JsonUtility.FromJson<ActorClothPhysics.Data>(File.ReadAllText(clothPath)); if(data==null||data.source!="mdl_chr_ttmr-casl-0002_body") throw new Exception("Cloth metadata does not match outfit"); cloth=body.AddComponent<ActorClothPhysics>(); cloth.simulateInLateUpdate=false; cloth.maxAngle=20f;var angleOverride=OptionalArg("-creator-skirt-angle");if(angleOverride!=null){if(!float.TryParse(angleOverride,System.Globalization.NumberStyles.Float,System.Globalization.CultureInfo.InvariantCulture,out var angle)||angle<0||angle>30)throw new Exception("Invalid test skirt angle");testSkirtAngle=angle;}cloth.refineContacts=Array.IndexOf(Environment.GetCommandLineArgs(),"-creator-refine-contacts")>=0;cloth.collisionRadiusScale=.8f;cloth.separateClothingLayers=true;cloth.layerSeparation=.02f;cloth.Configure(body.transform,data);SetupSkirtSurface(cloth,skin,"mdl_chr_ttmr-casl-0002_body");if(mainHairCloth)mainHairCloth.AddExternalColliders(cloth); }
   CreatorLinearRendering.PrepareActor(body);
   cameraObject=new GameObject("Camera").AddComponent<Camera>(); cameraObject.clearFlags=CameraClearFlags.SolidColor; cameraObject.backgroundColor=Color.white; cameraObject.transform.position=new Vector3(0,1,3); cameraObject.transform.rotation=Quaternion.Euler(0,180,0); cameraObject.fieldOfView=35; if(!selectionShellShader||!gizmoAxisShader)throw new Exception("Editor gizmo shaders missing"); editorGizmo=gameObject.AddComponent<CreatorSceneGizmo>();editorGizmo.Configure(cameraObject,selectionShellShader,gizmoAxisShader);linearRendering=new CreatorLinearRendering(cameraObject,sceneLighting,previewLight,namedBundles["shader"]);
   File.WriteAllText(Path.Combine(output,"renderer.txt"),"mode="+(actorPipeline?"experimental-urp-original-shader":"unlit-fallback")+"\ncolorSpace="+QualitySettings.activeColorSpace+"\nmaterials=\n"+string.Join("\n",body.GetComponentsInChildren<Renderer>(true).Where(r=>r.enabled).SelectMany(r=>r.sharedMaterials).Where(m=>m).Distinct().Select(m=>m.name+" | "+(m.shader?m.shader.name:"missing")+" | supported="+(m.shader&&m.shader.isSupported))));
   var manifest=OptionalArg("-creator-scene-catalog");if(!string.IsNullOrEmpty(manifest)){cachedScenes=JsonUtility.FromJson<CachedScenes>(File.ReadAllText(manifest));cachedBundleRoot=Path.GetFullPath(Path.Combine(Path.GetDirectoryName(manifest),"../bundles"));} backgroundRoot=OptionalArg("-creator-backgrounds"); var sceneRoot=OptionalArg("-creator-scene");
   if(!string.IsNullOrEmpty(sceneRoot)) { StartCoroutine(LoadEnvironment(sceneRoot)); return; }
   StartServer();
  } catch(Exception e) { Fail(e); }
 }
 void Fail(Exception e) { if(output!=null) File.WriteAllText(Path.Combine(output,"error.txt"),e.ToString()); Debug.LogException(e); Application.Quit(1); }
 IEnumerator LoadEnvironment(string root) {
  string scenePath=null;
  try {
   foreach(var file in Directory.GetFiles(root,"*.bundle")) { if(Path.GetFileName(file).Equals("shader.bundle",StringComparison.OrdinalIgnoreCase)) continue; var b=AssetBundle.LoadFromFile(file); if(!b) throw new Exception("Cannot load scene dependency: "+file); bundles.Add(b); var filename=Path.GetFileNameWithoutExtension(file);loadedSceneFiles.Add(filename); if(filename.StartsWith("env_3d_adv_") && filename.EndsWith("-00-00-noon")) { string key=filename.Substring("env_3d_adv_".Length).Replace("-00-00-noon",""); var paths=b.GetAllScenePaths(); if(paths.Length==1)scenePaths[key]=paths[0]; } if(filename=="env_3d_adv_trainingroom-00-00-noon") scenePath=b.GetAllScenePaths().Single(); }
   if(scenePath==null) throw new Exception("Training room bundle missing");
  } catch(Exception e) { Fail(e); yield break; }
  var op=SceneManager.LoadSceneAsync(scenePath,LoadSceneMode.Additive); if(op==null) { Fail(new Exception("Scene load failed")); yield break; } yield return op;
  try { var scene=SceneManager.GetSceneByPath(scenePath); if(!scene.isLoaded)throw new Exception("Scene unavailable"); SceneManager.SetActiveScene(scene); currentSceneId="trainingroom"; foreach(var rootObject in scene.GetRootGameObjects()) foreach(var cam in rootObject.GetComponentsInChildren<Camera>(true)) cam.enabled=false; linearRendering.SetScene(scene); StartServer(); } catch(Exception e) { Fail(e); }
 }
 void StartServer() {
   sessionPort=int.Parse(Arg("-creator-port")); connectToHost=Array.IndexOf(Environment.GetCommandLineArgs(),"-creator-connect")>=0;
   if(!connectToHost) { listener=new TcpListener(IPAddress.Loopback,sessionPort); listener.Start(); }
   running=true; thread=new Thread(Server){IsBackground=true}; thread.Start(); File.WriteAllText(Path.Combine(output,"ready.txt"),"ready");
   if(Array.IndexOf(Environment.GetCommandLineArgs(),"-creator-capture")>=0) StartCoroutine(CaptureAfterFrames());
 }
 static bool Valid(float[] a) => a!=null && a.Length==3 && a.All(x=>!float.IsNaN(x)&&!float.IsInfinity(x));
 static bool ValidScale(float[] a)=>a==null||a.Length==0||(a.Length==3&&a.All(x=>!float.IsNaN(x)&&!float.IsInfinity(x)&&x>=.01f&&x<=100f));
 static Vector3 ScaleOrOne(float[] a)=>a==null||a.Length==0?Vector3.one:new Vector3(a[0],a[1],a[2]);
 static bool ValidBodyName(string n)=>!string.IsNullOrEmpty(n)&&System.Text.RegularExpressions.Regex.IsMatch(n,"^mdl_chr_[a-z0-9]+-[a-z0-9]+-[a-z0-9]+_body$");
 IEnumerator CaptureAfterFrames() { yield return new WaitForSecondsRealtime(1.5f); yield return new WaitForEndOfFrame(); ScreenCapture.CaptureScreenshot(Path.Combine(output,"render.png")); }
 void Server() { try { using(var client=connectToHost?new TcpClient():listener.AcceptTcpClient()) { if(connectToHost) client.Connect(IPAddress.Loopback,sessionPort); client.NoDelay=true; using(var stream=client.GetStream()) using(var reader=new StreamReader(stream)) using(var writer=new StreamWriter(stream){AutoFlush=true}) { if(connectToHost) writer.WriteLine("creator-session "+token); while(running) { var line=reader.ReadLine(); if(line==null) break; Command cmd=null; try { if(line.Length>1048576) throw new Exception("Message too large"); cmd=JsonUtility.FromJson<Command>(line); if(cmd==null||cmd.token!=token) throw new Exception("Invalid session"); if(cmd.renderSettings!=null)cmd.renderSettings.Validate(); if(cmd.kind=="gizmo-test") { if(Array.IndexOf(Environment.GetCommandLineArgs(),"-creator-gizmo-test")<0||cmd.gizmoTestAxis<0||cmd.gizmoTestAxis>2||!new[]{"begin","move","end","key"}.Contains(cmd.gizmoTestPhase)||float.IsNaN(cmd.gizmoTestDelta)||float.IsInfinity(cmd.gizmoTestDelta))throw new Exception("Gizmo test unavailable"); } else if(cmd.kind=="thumbnail") { if(cmd.thumbnailTarget!="actor" && cmd.thumbnailTarget!="scene")throw new Exception("Unknown thumbnail target"); } else if(cmd.kind=="frame") { if(cmd.frameWidth<16||cmd.frameHeight<16||cmd.frameWidth>1920||cmd.frameHeight>1920)throw new Exception("Invalid frame size"); } else if(!ValidScale(cmd.actorScale)||!ValidScale(cmd.editorSelectedScale)||(cmd.editorToolMode!=null&&cmd.editorToolMode!=""&&!new[]{"move","rotate","scale"}.Contains(cmd.editorToolMode))||!Valid(cmd.actorPosition)||!Valid(cmd.actorRotation)||!Valid(cmd.cameraPosition)||!Valid(cmd.cameraRotation)||float.IsNaN(cmd.fov)||float.IsInfinity(cmd.fov)||cmd.fov<15||cmd.fov>90||float.IsNaN(cmd.motionTime)||float.IsInfinity(cmd.motionTime)||cmd.motionTime<0||cmd.motionTime>3600||float.IsNaN(cmd.idleMotionTime)||float.IsInfinity(cmd.idleMotionTime)||cmd.idleMotionTime<0||cmd.idleMotionTime>3600||(cmd.hasOutlineSettings&&(float.IsNaN(cmd.outlineWidth)||float.IsInfinity(cmd.outlineWidth)||cmd.outlineWidth<0||cmd.outlineWidth>.3f))||(cmd.actorInstances!=null&&(cmd.actorInstances.Length>20||cmd.actorInstances.Any(a=>a==null||string.IsNullOrEmpty(a.id)||a.id.Length>100||!Valid(a.position)||!Valid(a.rotation)||!ValidScale(a.scale)||(cmd.hasArrangement&&(float.IsNaN(a.motionTime)||float.IsInfinity(a.motionTime)||a.motionTime<0||a.motionTime>3600||float.IsNaN(a.idleMotionTime)||float.IsInfinity(a.idleMotionTime)||a.idleMotionTime<0||a.idleMotionTime>3600||float.IsNaN(a.faceWeight)||float.IsInfinity(a.faceWeight)||a.faceWeight<0||a.faceWeight>1||(a.faceShapes!=null&&(a.faceShapes.Length>96||a.faceShapes.Any(f=>f==null||string.IsNullOrEmpty(f.name)||f.name.Length>100||float.IsNaN(f.weight)||float.IsInfinity(f.weight)||f.weight<0||f.weight>1||float.IsNaN(f.time)||float.IsInfinity(f.time)||f.time<0||f.time>3600)||a.faceShapes.Select(f=>f.name).Distinct().Count()!=a.faceShapes.Length)))))))||((cmd.subtitleText?.Length??0)>500)||((cmd.subtitleSpeaker?.Length??0)>100)) throw new Exception("Invalid state"); var work=new Work{command=cmd,queued=cmd.profileExport?CreatorExportProfiler.Stamp():0,timing=cmd.profileExport?new CreatorExportTiming{frameIndex=cmd.frameIndex,runId=cmd.runId}:null}; pending.Enqueue(work); if(!work.done.Wait(cmd.kind=="frame"||cmd.mediaDraws!=null&&cmd.mediaDraws.Length>0?60000:5000)) throw new Exception("Main thread timeout"); writer.WriteLine(work.result); } catch(Exception ex) { writer.WriteLine(JsonUtility.ToJson(new Reply{id=cmd?.id??0,ok=false,error=ex.Message})); } } } } } catch(Exception e) { if(running) { try{File.WriteAllText(Path.Combine(output,"server-error.txt"),e.ToString());}catch{} Debug.LogException(e); } } }
 static Vector3 Vec(float[] a)=>new Vector3(a[0],a[1],a[2]);
 void Update() { while(pending.TryDequeue(out var w)) { w.started=w.timing==null?0:CreatorExportProfiler.Stamp();if(w.timing!=null)w.timing.queueMs=CreatorExportProfiler.Elapsed(w.queued);CreatorExportProfiler.PreviewEnabled=w.command.profileExport;try { var c=w.command; if(c.kind=="gizmo-test") {editorGizmo.TestInput(c.gizmoTestPhase,c.gizmoTestAxis,c.gizmoTestDelta);w.result=JsonUtility.ToJson(new Reply{id=c.id,ok=true});w.done.Set();continue;} if(c.kind=="frame") { StartCoroutine(CaptureExportFrame(w)); continue; } if(c.kind=="thumbnail") { CaptureThumbnail(c.thumbnailTarget); w.result=JsonUtility.ToJson(new Reply{id=c.id,ok=true}); w.done.Set(); continue; } CreatorCompositionState.Validate(c.composition,c.mediaDraws,uiGraph);composition=c.composition;storyEffects.Set(c.postEffects);cameraObject.enabled=composition==null&&!storyEffects.Enabled;if(c.renderSettings!=null)linearRendering.Apply(c.renderSettings); uiGraph.Set(c.uiDraws);CreatorUIOverlay.Validate(c.uiRects);uiRects=c.uiRects??Array.Empty<CreatorUIRect>();if(c.sceneId!=lastStateSceneId){sceneError=null;lastStateSceneId=c.sceneId;} if(!ValidBlend(c.blendActive,c.blendMotionId,c.blendMotionTime,c.blendWeight)||(c.actorInstances!=null&&c.actorInstances.Any(a=>a==null||!ValidBlend(a.blendActive,a.blendMotionId,a.blendMotionTime,a.blendWeight))))throw new Exception("Invalid motion blend");if(c.sceneProps!=null&&(c.sceneProps.Length>77||c.sceneProps.Any(p=>p==null||ClassroomPropCatalog.Find(p.id)==null||!Valid(p.position)||!Valid(p.rotation)||!ValidScale(p.scale))||c.sceneProps.Select(p=>p.id).Distinct().Count()!=c.sceneProps.Length))throw new Exception("Invalid scene props");requestedSceneProps=c.sceneProps??Array.Empty<SceneProp>();body.transform.SetPositionAndRotation(Vec(c.actorPosition),Quaternion.Euler(Vec(c.actorRotation)));body.transform.localScale=Vector3.Scale(mainBaseScale,ScaleOrOne(c.actorScale)); cameraObject.transform.SetPositionAndRotation(Vec(c.cameraPosition),Quaternion.Euler(Vec(c.cameraRotation))); cameraObject.fieldOfView=c.fov; if(c.hasArrangement){cameraObject.cullingMask=c.cameraEnabled?~0:0;cameraObject.backgroundColor=c.cameraEnabled?Color.white:Color.black;arrangementSceneVisible=c.sceneVisible;ApplySceneVisibility();ApplyClassroomChairs();subtitleText=c.subtitleText??"";subtitleSpeaker=c.subtitleSpeaker??"";subtitleColor=c.subtitleColor??"#57576D";subtitleColorEnd=c.subtitleColorEnd??subtitleColor;subtitleStyle=c.subtitleStyle=="game"?"game":c.subtitleStyle=="subtitle"?"subtitle":"box";} if(c.hasOutlineSettings && actorOutline)actorOutline.settings.width=c.outlineWidth; ApplyMotion(c); ApplyActors(c.actorInstances,c.hasArrangement,c.physicsEnabled); Transform chosen=null;if(c.editorSelectedKind=="actor"&&!string.IsNullOrEmpty(c.editorSelectedId)){if(copies.TryGetValue(c.editorSelectedId,out var selectedCopy)&&selectedCopy)chosen=selectedCopy.transform;else if(c.editorSelectedId=="ttmr")chosen=body.transform;}else if(c.editorSelectedKind=="prop"&&!string.IsNullOrEmpty(c.editorPropId)&&classroomChairs.TryGetValue(c.editorPropId,out var selectedProp))chosen=selectedProp.transform;editorGizmo.Select(c.editorSelectedId,chosen,c.editorCanMove,c.editorSelectedScale);editorGizmo.SetMode(c.editorToolMode);if(cloth&&cloth.surfaceCollision)cloth.surfaceCollision.SetDisplay(c.physicsEnabled);foreach(var entry in copyPhysics)foreach(var solver in entry.Value.solvers)if(solver.surfaceCollision)solver.surfaceCollision.SetDisplay(c.physicsEnabled); if(!string.IsNullOrEmpty(c.sceneId)&&c.sceneId.StartsWith("2d-")){SetBackground(c.sceneId);requestedSceneId="";}else{SetBackground("");if(!string.IsNullOrEmpty(c.sceneId))EnsureCachedScene(c.sceneId);requestedSceneId=c.sceneId??"";}if(!sceneBusy&&requestedSceneId!=currentSceneId)StartCoroutine(SwitchScene()); if(!string.IsNullOrEmpty(sceneError))throw new Exception(sceneError);var metrics=new List<PhysicsMetric>();if(Array.IndexOf(Environment.GetCommandLineArgs(),"-creator-proxy-diagnostics")>=0&&c.physicsEnabled){if(cloth)metrics.Add(GetPhysicsMetric("ttmr#base",cloth));foreach(var entry in copyPhysics)foreach(var solver in entry.Value.solvers)metrics.Add(GetPhysicsMetric(entry.Key+":"+solver.gameObject.name,solver));}var reply=new Reply{id=c.id,ok=true,sceneReady=!sceneBusy&&(string.IsNullOrEmpty(c.sceneId)||(c.sceneId.StartsWith("2d-")?backgroundId==c.sceneId:currentSceneId==c.sceneId)),sceneId=c.sceneId,physicsMetrics=metrics.ToArray(),gizmoEvent=editorGizmo.TakeEvent(),gizmoToolMode=editorGizmo.TakeMode()};screenMedia.Select(c.mediaSelectedId,c.mediaEditable,c.mediaSnap);if(w.timing!=null)w.timing.Add("stateApplyMs",CreatorExportProfiler.Elapsed(w.started));StartCoroutine(CompleteMediaState(w,reply));continue; } catch(Exception e) { w.result=JsonUtility.ToJson(new Reply{id=w.command.id,ok=false,error=e.Message}); } w.done.Set(); } }
 IEnumerator CompleteMediaState(Work work,Reply reply){var started=work.timing==null?0:CreatorExportProfiler.Stamp();yield return screenMedia.Apply(work.command.mediaDraws);if(work.timing!=null){work.timing.Add("mediaWaitMs",CreatorExportProfiler.Elapsed(started));work.timing.totalMs=CreatorExportProfiler.Elapsed(work.started);work.timing.Snapshot();reply.exportTiming=work.timing;}reply.mediaEvent=screenMedia.TakeEvent();if(screenMedia.Error!=null){reply.ok=false;reply.error=screenMedia.Error;}work.result=JsonUtility.ToJson(reply);work.done.Set();}
 IEnumerator SwitchScene() {
  sceneBusy=true;
  while(requestedSceneId!=currentSceneId) {
   string next=requestedSceneId; var old=!string.IsNullOrEmpty(currentSceneId)&&scenePaths.ContainsKey(currentSceneId)?SceneManager.GetSceneByPath(scenePaths[currentSceneId]):default(Scene);
   if(string.IsNullOrEmpty(next)){
    SceneManager.SetActiveScene(gameObject.scene);linearRendering.ClearScene();currentSceneId="";sceneOriginalVisibility.Clear();classroomChairs.Clear();ApplySceneVisibility();
    if(old.IsValid()&&old.isLoaded)yield return SceneManager.UnloadSceneAsync(old);
    sceneError=null;continue;
   }
   AsyncOperation op=null;try{op=SceneManager.LoadSceneAsync(scenePaths[next],LoadSceneMode.Additive);}catch(Exception e){sceneError=e.Message;}if(op==null){sceneError=sceneError??"Scene load failed";requestedSceneId=currentSceneId;break;} yield return op;
   var scene=SceneManager.GetSceneByPath(scenePaths[next]); if(!scene.isLoaded){sceneError="Scene load failed";requestedSceneId=currentSceneId;break;}
   if(requestedSceneId!=next){yield return SceneManager.UnloadSceneAsync(scene);continue;}
   foreach(var rootObject in scene.GetRootGameObjects()) foreach(var cam in rootObject.GetComponentsInChildren<Camera>(true))cam.enabled=false;
   SceneManager.SetActiveScene(scene); linearRendering.SetScene(scene); currentSceneId=next;sceneOriginalVisibility.Clear();classroomChairs.Clear();ApplySceneVisibility();try{ApplyClassroomChairs();sceneError=null;}catch(Exception ex){sceneError=ex.Message;}if(sceneError!=null){if(old.IsValid()&&old.isLoaded)yield return SceneManager.UnloadSceneAsync(old);sceneBusy=false;yield break;}
   if(old.IsValid()&&old.isLoaded)yield return SceneManager.UnloadSceneAsync(old);
  }
  sceneBusy=false;
 }
 void ApplySceneVisibility() {
  linearRendering?.UpdateBackground(!string.IsNullOrEmpty(backgroundId),arrangementSceneVisible);
  if(string.IsNullOrEmpty(currentSceneId)||!scenePaths.ContainsKey(currentSceneId))return;
  var scene=SceneManager.GetSceneByPath(scenePaths[currentSceneId]);if(!scene.IsValid()||!scene.isLoaded)return;
  foreach(var r in scene.GetRootGameObjects().SelectMany(x=>x.GetComponentsInChildren<Renderer>(true))) { if(!sceneOriginalVisibility.ContainsKey(r))sceneOriginalVisibility[r]=r.forceRenderingOff; r.forceRenderingOff=!arrangementSceneVisible||!string.IsNullOrEmpty(backgroundId)||sceneOriginalVisibility[r]; }
 }
 void ApplyClassroomChairs(){
  if(currentSceneId!="classroom"||(requestedSceneProps.Length==0&&classroomChairs.Count==0))return;
  var scene=SceneManager.GetSceneByPath(scenePaths[currentSceneId]);if(!scene.IsValid()||!scene.isLoaded)return;
  var root=scene.GetRootGameObjects().FirstOrDefault(x=>x.name=="cmn-parts");var parent=root?root.transform.Find("env_group_adv_classroom-00/movable"):null;if(!parent||parent.childCount!=13)throw new Exception("Classroom prop hierarchy mismatch");
  foreach(var change in requestedSceneProps){if(classroomChairs.ContainsKey(change.id))continue;var spec=ClassroomPropCatalog.Find(change.id);if(spec==null||spec.groupIndex>=parent.childCount)throw new Exception("Unknown classroom prop: "+change.id);var group=parent.GetChild(spec.groupIndex);if(group.name!=spec.group||spec.index>=group.childCount)throw new Exception("Classroom prop group mismatch: "+change.id);var t=group.GetChild(spec.index);var rs=t.GetComponentsInChildren<Renderer>(true);if(t.name!=spec.name||rs.Length==0||rs.Any(r=>r.isPartOfStaticBatch)||Vector3.Distance(t.position,spec.position)>.01f||Quaternion.Angle(t.rotation,Quaternion.Euler(spec.rotation))>.1f)throw new Exception("Classroom prop identity mismatch: "+change.id);classroomChairs.Add(change.id,new ChairState{transform=t,position=t.position,rotation=t.rotation,scale=t.localScale});}
  foreach(var pair in classroomChairs){var item=pair.Value;var change=requestedSceneProps.FirstOrDefault(x=>x.id==pair.Key);item.transform.SetPositionAndRotation(change==null?item.position:Vec(change.position),change==null?item.rotation:Quaternion.Euler(Vec(change.rotation)));item.transform.localScale=Vector3.Scale(item.scale,change==null?Vector3.one:ScaleOrOne(change.scale));foreach(var r in item.transform.GetComponentsInChildren<Renderer>(true))r.forceRenderingOff=!arrangementSceneVisible||!string.IsNullOrEmpty(backgroundId)||(change!=null&&!change.visible)||(sceneOriginalVisibility.TryGetValue(r,out var original)&&original);}
 }
 void SetActorVisible(GameObject actor,bool visible) { foreach(var r in actor.GetComponentsInChildren<Renderer>(true))r.forceRenderingOff=!visible; }
 CharacterResources GetCharacter(string code) {
  if(roster.TryGetValue(code,out var found))return found;
  if(!allowedCharacters.Contains(code)||!rosterCodes.Contains(code)||string.IsNullOrEmpty(rosterFaceDir))throw new Exception("Local character unavailable: "+code);
  var r=new CharacterResources();var outfit=(code=="nasr"||code=="krnh")?"0000":"0002";
  r.body=Load(bundleRoot,$"mdl_chr_{code}-casl-{outfit}_body");r.hair=Load(bundleRoot,$"mdl_chr_{code}-base-0000_hair");r.face=Load(bundleRoot,code+"-face-exposed");
  var mesh=r.face.LoadAsset<Mesh>("_CombinedFaceMesh");if(!mesh)throw new Exception("Face mesh missing: "+code);r.original=mesh.vertices;
  var data=JsonUtility.FromJson<FaceData>(File.ReadAllText(Path.Combine(rosterFaceDir,$"mdl_chr_{code}-base-0000_face.json")));r.vertexCount=data?.vertexCount??0;
  if(data==null||data.source!=$"mdl_chr_{code}-base-0000_face"||r.vertexCount!=mesh.vertexCount||data.shapes==null)throw new Exception("Face metadata mismatch: "+code);
  foreach(var shape in data.shapes){if(shape==null||string.IsNullOrEmpty(shape.name)||shape.indices==null||shape.offsets==null||shape.offsets.Length!=shape.indices.Length*3||shape.indices.Any(i=>i<0||i>=r.vertexCount)||shape.offsets.Any(v=>float.IsNaN(v)||float.IsInfinity(v))||r.shapes.ContainsKey(shape.name))throw new Exception("Invalid face metadata: "+code);r.shapes.Add(shape.name,shape);}
  if(!r.shapes.ContainsKey("b_mouth.mouth_001"))throw new Exception("Mouth shape missing: "+code);roster.Add(code,r);return r;
 }
 GameObject CreateCharacter(string code,CostumeEntry costume=null) {
  var r=code=="ttmr"?null:GetCharacter(code);GameObject actor=null;
  try {
   if(costume!=null)foreach(var dependency in costume.dependencies)Load(costumeRoot,dependency);
   var sourceBody=costume!=null?Load(costumeRoot,costume.name):r.body;var sourceHair=code=="ttmr"?Load(bundleRoot,"mdl_chr_ttmr-base-0000_hair"):r.hair;var sourceFace=code=="ttmr"?Load(bundleRoot,"ttmr-face-exposed"):r.face;
   actor=Instance(sourceBody);var skin=actor.GetComponentsInChildren<SkinnedMeshRenderer>(true).First(x=>x.name=="Geo_Body");Restore(skin);if(swingDir!=null)AttachCopyPhysics(actor,costume!=null?costume.name:$"mdl_chr_{code}-casl-{((code=="nasr"||code=="krnh")?"0000":"0002")}_body");var head=actor.GetComponentsInChildren<Transform>(true).First(x=>x.name=="Head");var hair=Instance(sourceHair);hair.transform.SetParent(head,false);if(hairSwingDir!=null)AttachCopyPhysics(hair,$"mdl_chr_{code}-base-0000_hair",hairSwingDir);var face=Instance(sourceFace);face.transform.SetParent(head,false);var renderer=face.GetComponentInChildren<MeshRenderer>(true);var mesh=sourceFace.LoadAsset<Mesh>("_CombinedFaceMesh");if(!renderer||!mesh)throw new Exception("Face missing: "+code);var go=new GameObject("face");go.transform.SetParent(actor.transform,false);go.AddComponent<MeshFilter>().sharedMesh=mesh;go.AddComponent<MeshRenderer>().sharedMaterials=renderer.sharedMaterials;go.transform.SetParent(head,true);renderer.enabled=false;
   foreach(var part in actor.GetComponentsInChildren<Renderer>(true))if(part.enabled){if(part is SkinnedMeshRenderer sm)sm.updateWhenOffscreen=true;foreach(var mat in part.sharedMaterials)if(mat){if(!mat.shader||!mat.shader.isSupported)throw new Exception("Unsupported material shader: "+mat.name);}}
   var animator=actor.GetComponent<Animator>()??actor.AddComponent<Animator>();animator.avatar=BuildAvatar(actor);if(!animator.avatar||!animator.avatar.isValid||!animator.avatar.isHuman)throw new Exception("Invalid avatar: "+code);CreatorLinearRendering.PrepareActor(actor);return actor;
  } catch {if(actor)Destroy(actor);throw;}
 }
 void SetupSkirtSurface(ActorClothPhysics solver,SkinnedMeshRenderer skin,string source) {
  var mode=OptionalArg("-creator-skirt-surface");if(mode==null||source!="mdl_chr_ttmr-casl-0002_body")return;if(mode!="0"&&mode!="1"&&mode!="2"&&mode!="3")throw new Exception("Invalid surface test mode");var file=OptionalArg("-creator-skirt-topology");int[] indices=null;if(file!=null){var topology=JsonUtility.FromJson<SkirtTopology>(File.ReadAllText(file));if(topology==null||topology.source!=source||topology.vertexCount!=skin.sharedMesh.vertexCount||topology.indices==null||topology.indices.Length>1000000)throw new Exception("Skirt topology mismatch");indices=topology.indices;}var surface=solver.gameObject.AddComponent<SkirtSurfaceCollision>();surface.Configure(skin,int.Parse(mode),indices);solver.surfaceCollision=surface;
 }
 PhysicsMetric GetPhysicsMetric(string actor,ActorClothPhysics solver) {var m=solver.MeasureContacts();var p=new PhysicsMetric{actor=actor,pairs=m.pairs,overlaps=m.overlaps,maxDepth=m.maxDepth,totalDepth=m.totalDepth};if(solver.surfaceCollision){var surface=solver.surfaceCollision;p.surfaceDescription=surface.Description;p.surfaceSamples=surface.after.samples;p.surfaceBefore=surface.before.overlaps;p.surfaceAfter=surface.after.overlaps;p.surfaceDepthBefore=surface.before.totalDepth;p.surfaceDepthAfter=surface.after.totalDepth;p.triangleSamples=surface.after.triangleSamples;p.triangleBefore=surface.before.triangleOverlaps;p.triangleAfter=surface.after.triangleOverlaps;p.triangleDepthBefore=surface.before.triangleDepth;p.triangleDepthAfter=surface.after.triangleDepth;}return p;}
 ActorClothPhysics AttachCopyPhysics(GameObject actor,string source,string directory=null) {
  directory=directory??swingDir;if(string.IsNullOrEmpty(directory))return null;var file=Path.Combine(directory,source+".json");if(!File.Exists(file))throw new Exception("Physics metadata missing: "+source);var data=JsonUtility.FromJson<ActorClothPhysics.Data>(File.ReadAllText(file));if(data==null||data.source!=source)throw new Exception("Physics metadata mismatch: "+source);var solver=actor.AddComponent<ActorClothPhysics>();solver.simulateInLateUpdate=false;solver.includeOtherDynamic=true;bool isHair=source.EndsWith("_hair",StringComparison.Ordinal);solver.maxAngle=isHair?12f:20f;solver.refineContacts=Array.IndexOf(Environment.GetCommandLineArgs(),"-creator-refine-contacts")>=0;solver.gravityScale=isHair?.15f:.35f;solver.collisionRadiusScale=.8f;solver.separateClothingLayers=!isHair;solver.layerSeparation=.02f;solver.Configure(actor.transform,data);if(!isHair)SetupSkirtSurface(solver,actor.GetComponentsInChildren<SkinnedMeshRenderer>(true).First(x=>x.name=="Geo_Body"),source);return solver;
 }
 void RemoveCopy(string key) {
  copyPhysics.Remove(key);copyBaseScales.Remove(key);if(copyLayers.TryGetValue(key,out var layers)){layers.Dispose();copyLayers.Remove(key);}
  if(copyGraphs.TryGetValue(key,out var g)){if(g.IsValid())g.Destroy();copyGraphs.Remove(key);copyMotions.Remove(key);copyOutputs.Remove(key);copyMixers.Remove(key);}
  string faceKey=key=="ttmr"?"ttmr#costume":key;if(faceInstances.TryGetValue(faceKey,out var oldFace)){if(oldFace.mesh)Destroy(oldFace.mesh);if(oldFace.decalMesh)Destroy(oldFace.decalMesh);if(oldFace.eyeMaterial)Destroy(oldFace.eyeMaterial);faceInstances.Remove(faceKey);}
  if(copies.TryGetValue(key,out var old)){old.SetActive(false);Destroy(old);copies.Remove(key);}copyCharacters.Remove(key);copyCostumes.Remove(key);
  if(copyAvatars.TryGetValue(key,out var oldAvatar)){if(oldAvatar)Destroy(oldAvatar);copyAvatars.Remove(key);}
 }
 void ApplyActors(ActorState[] actors,bool independent,bool physicsEnabled) {
  if(actors==null)return;
  var wanted=new HashSet<string>(actors.Select(a=>a.id));
  foreach(var key in copies.Keys.Where(k=>!wanted.Contains(k)).ToArray()) RemoveCopy(key);
  foreach(var a in actors) {
   var code=string.IsNullOrEmpty(a.characterId)?"ttmr":a.characterId;if(code!="ttmr"&&!allowedCharacters.Contains(code))throw new Exception("Unknown character: "+code);if(a.id=="ttmr"&&code!="ttmr")throw new Exception("Invalid main character");
   string costumeId=a.costumeId??"";CostumeEntry costume=null;if(costumeId!=""&&(!costumes.TryGetValue(costumeId,out costume)||costume.character!=code))throw new Exception("Costume unavailable or character mismatch: "+costumeId);
   if(a.id=="ttmr"&&costume==null){if(copies.ContainsKey(a.id))RemoveCopy(a.id);if(independent){ApplyFace(a.id,body,a.faceWeight,a.faceShapes,"ttmr");SetActorVisible(body,a.visible);}continue;}
   if(copies.ContainsKey(a.id)&&copyCharacters[a.id]!=code)throw new Exception("Character identity changed for actor: "+a.id);
   if(copies.ContainsKey(a.id)&&copyCostumes[a.id]!=costumeId)RemoveCopy(a.id);
   if(!copies.TryGetValue(a.id,out var clone)) { clone=costume!=null?CreateCharacter(code,costume):code=="ttmr"?Instantiate(body):CreateCharacter(code);if(code=="ttmr"&&costume==null){foreach(var d in clone.GetComponentsInChildren<CreatorFaceDecal>(true)){d.material=null;d.gameObject.SetActive(false);Destroy(d.gameObject);}foreach(var e in clone.GetComponentsInChildren<CreatorRoundEyeMarker>(true)){e.materials=null;e.gameObject.SetActive(false);Destroy(e.gameObject);}}copyCharacters[a.id]=code;copyCostumes[a.id]=costumeId;if(code!="ttmr"||costume!=null)copyAvatars[a.id]=clone.GetComponent<Animator>().avatar; SceneManager.MoveGameObjectToScene(clone,body.scene); clone.name="Creator actor "+a.id; if(code=="ttmr"&&costume==null){GameObject hairRoot=null;foreach(var solver in clone.GetComponentsInChildren<ActorClothPhysics>(true)){if(solver.gameObject!=clone)hairRoot=solver.gameObject;solver.enabled=false;Destroy(solver);}if(swingDir!=null)AttachCopyPhysics(clone,"mdl_chr_ttmr-casl-0002_body");if(hairRoot&&hairSwingDir!=null)AttachCopyPhysics(hairRoot,"mdl_chr_ttmr-base-0000_hair",hairSwingDir);}var physical=clone.GetComponentsInChildren<ActorClothPhysics>(true).Where(x=>x.enabled).ToArray();var bodySolver=physical.FirstOrDefault(x=>x.gameObject==clone);if(bodySolver)foreach(var hairSolver in physical.Where(x=>x.gameObject!=clone))hairSolver.AddExternalColliders(bodySolver);if(physical.Length>0)copyPhysics[a.id]=new CopyPhysics{solvers=physical}; var animator=clone.GetComponent<Animator>(); if(animator&&clip) { animator.enabled=true;animator.cullingMode=AnimatorCullingMode.AlwaysAnimate;var cg=PlayableGraph.Create("Creator actor "+a.id);cg.SetTimeUpdateMode(DirectorUpdateMode.Manual);var map=motionClips.ToDictionary(k=>k.Key,k=>CreateMotionPlayable(cg,k.Value));var co=AnimationPlayableOutput.Create(cg,"motion",animator);co.SetSourcePlayable(map["shy"]);cg.Play();copyGraphs[a.id]=cg;copyMotions[a.id]=map;copyOutputs[a.id]=co;copyMixers[a.id]=AnimationMixerPlayable.Create(cg,2);copyLayers[a.id]=new CreatorAnimationLayers(cg); } copyBaseScales[a.id]=code=="ttmr"&&costume==null?mainBaseScale:clone.transform.localScale;copies[a.id]=clone; }
   if(a.id=="ttmr")SetActorVisible(body,false);
   clone.transform.SetPositionAndRotation(Vec(a.position),Quaternion.Euler(Vec(a.rotation)));clone.transform.localScale=Vector3.Scale(copyBaseScales[a.id],ScaleOrOne(a.scale));
   if(independent && copyGraphs.TryGetValue(a.id,out var actorGraph)) { var motionId=MotionChoice(a.motionActive,a.motionId,a.idleMotionId);EnsureMotion(motionId);if(!copyMotions[a.id].TryGetValue(motionId,out var actorMotion)){actorMotion=CreateMotionPlayable(actorGraph,motionClips[motionId]);copyMotions[a.id].Add(motionId,actorMotion);}var actorClip=motionClips[motionId];copyOutputs[a.id].SetSourcePlayable(actorMotion);float target=MotionPosition(a.motionActive,a.motionTime,a.idleMotionTime,actorClip);
    AnimationClipPlayable prior=default;bool blend=!physicsEnabled&&a.blendActive&&!a.motionActive&&a.blendMotionId!=motionId;
    if(blend){EnsureMotion(a.blendMotionId);if(!copyMotions[a.id].TryGetValue(a.blendMotionId,out prior)){prior=CreateMotionPlayable(actorGraph,motionClips[a.blendMotionId]);copyMotions[a.id].Add(a.blendMotionId,prior);}}
    void Evaluate(float t){copyLayers[a.id].DetachBase();if(blend)SampleBlended(actorGraph,copyOutputs[a.id],copyMixers[a.id],actorMotion,t,prior,a.blendMotionTime,a.blendWeight);else{ClearBlend(actorGraph,copyMixers[a.id]);copyOutputs[a.id].SetSourcePlayable(actorMotion);actorMotion.SetTime(t);}copyLayers[a.id].Evaluate(copyOutputs[a.id],blend?(Playable)copyMixers[a.id]:(Playable)actorMotion,a.motionLayers,ResolveLayerClip,IsNativeAdditive);}
    if(copyPhysics.TryGetValue(a.id,out var cp)){
     bool quiet=code=="ttmr"&&(costume==null||costume.name=="mdl_chr_ttmr-casl-0002_body")&&!a.motionActive&&actorClip.name==QuietIdle;float skirtLimit=quiet?2f:-1f;foreach(var solver in cp.solvers.Where(x=>x.gameObject==clone)){if(solver.skirtMaxAngle!=skirtLimit){solver.skirtMaxAngle=skirtLimit;cp.time=-1;}}
     if(physicsEnabled){if(!cp.enabled||cp.motionId!=motionId||cp.time<0||target<cp.time||target-cp.time>.25f){foreach(var solver in cp.solvers)solver.ResetSimulation();cp.time=Mathf.Max(0,target-.5f);Evaluate(cp.time);for(int i=0;i<30;i++)foreach(var solver in cp.solvers)solver.Step(1f/60f);}while(cp.time+1f/60f<=target+.00001f){cp.time+=1f/60f;Evaluate(cp.time);foreach(var solver in cp.solvers)solver.Step(1f/60f);}}
     else {if(cp.enabled)foreach(var solver in cp.solvers)solver.ResetSimulation();Evaluate(target);cp.time=-1;}cp.motionId=motionId;cp.enabled=physicsEnabled;
    }else Evaluate(target);
   }
   else { var from=body.GetComponentsInChildren<Transform>(true);var to=clone.GetComponentsInChildren<Transform>(true);if(from.Length==to.Length)for(int i=1;i<from.Length;i++){to[i].localPosition=from[i].localPosition;to[i].localRotation=from[i].localRotation;to[i].localScale=from[i].localScale;} }
   if(independent){ApplyFace(a.id=="ttmr"?"ttmr#costume":a.id,clone,a.faceWeight,a.faceShapes,code);SetActorVisible(clone,a.visible);}
   clone.transform.SetPositionAndRotation(Vec(a.position),Quaternion.Euler(Vec(a.rotation)));clone.transform.localScale=Vector3.Scale(copyBaseScales[a.id],ScaleOrOne(a.scale));
  }
 }
 void ApplyFace(string id,GameObject actor,float weight,FaceWeight[] requested,string code) {
  var resource=code=="ttmr"?null:GetCharacter(code);var shapes=resource==null?faceShapes:resource.shapes;var original=resource==null?faceOriginal:resource.original;int vertexCount=resource==null?faceVertexCount:resource.vertexCount;
  if(mouthShape==null)return;
  var active=requested??new[]{new FaceWeight{name="b_mouth.mouth_001",weight=weight}};
  foreach(var item in active)if(!shapes.ContainsKey(item.name)&&!(decalDataDir!=null&&item.name.StartsWith("decal."))&&!(roundEyesDir!=null&&item.name=="effect.RoundEyes")&&!(headEffectDir!=null&&new[]{"effect.Gloom","effect.Drool"}.Contains(item.name))&&!(eyeMaterialDir!=null&&new[]{"eyeMaterial.NoHighlight","eyeMaterial.Sparkle","eyeMaterial.SparkleSmall","eyeMaterial.Kiran","eyeMaterial.Move","eyeMaterial.Heart"}.Contains(item.name))&&!(faceBoneDir!=null&&new[]{"bone.EyesLeft","bone.EyesRight","bone.EyesUp","bone.EyesDown"}.Contains(item.name)))throw new Exception("Face shape unavailable: "+item.name);
  if(!faceInstances.TryGetValue(id,out var instance)) {
   var filter=actor.GetComponentsInChildren<MeshFilter>(true).FirstOrDefault(x=>x.name=="face");if(!filter||!filter.sharedMesh||filter.sharedMesh.vertexCount!=vertexCount)throw new Exception("Face mesh mismatch");
   var copy=Instantiate(filter.sharedMesh);filter.sharedMesh=copy;var renderer=filter.GetComponent<MeshRenderer>();var mats=renderer.sharedMaterials;int eye=Array.FindIndex(mats,m=>m&&(m.name=="m_eye"||m.name.StartsWith("m_eye (Instance)")));if(eyeMaterialDir!=null&&eye<0)throw new Exception("Eye material missing: "+code);var originalEye=code=="ttmr"?mainOriginalEye:eye>=0?mats[eye]:null;if(eye>=0&&originalEye){mats[eye]=originalEye;renderer.sharedMaterials=mats;}instance=new FaceInstance{mesh=copy,original=(Vector3[])original.Clone(),faceRenderer=renderer,eyeMaterialIndex=eye,originalEye=originalEye};faceInstances.Add(id,instance);
   if(decalDataDir!=null)SetupFaceDecals(actor,filter,instance,code);
   if(roundEyesDir!=null&&File.Exists(Path.Combine(roundEyesDir,code+"-l.bundle"))&&File.Exists(Path.Combine(roundEyesDir,code+"-r.bundle")))SetupRoundEyes(actor,instance,code);
   if(faceBoneDir!=null)SetupFaceBones(instance,code,vertexCount);
  }
  var key=string.Join("|",active.Select(x=>x.name+":"+x.weight.ToString("R",System.Globalization.CultureInfo.InvariantCulture)+(x.name.StartsWith("eyeMaterial.")?":"+x.time.ToString("R",System.Globalization.CultureInfo.InvariantCulture):"")));if(instance.last==key)return;
  var vertices=(Vector3[])instance.original.Clone();
  bool roundEyeActive=instance.roundEyes!=null&&active.Any(x=>x.name=="effect.RoundEyes"&&x.weight>=.5f);
  void ApplyShape(FaceShape shape,float amount){for(int i=0;i<shape.indices.Length;i++){int j=shape.indices[i];vertices[j]+=new Vector3(shape.offsets[i*3],shape.offsets[i*3+1],shape.offsets[i*3+2])*amount;}}
  foreach(var item in active){if(item.name.StartsWith("decal.")||item.name.StartsWith("bone.")||item.name.StartsWith("effect.")||item.name.StartsWith("eyeMaterial.")||(roundEyeActive&&(item.name.StartsWith("b_eye.")||item.name.StartsWith("b_iris."))))continue;ApplyShape(shapes[item.name],item.weight);}
  if(roundEyeActive){if(!shapes.TryGetValue("b_eye.eye_014",out var hideEyes))throw new Exception("Original eye hiding shape unavailable");ApplyShape(hideEyes,1);}
  if(!roundEyeActive&&instance.boneData!=null){float Weight(string n)=>active.FirstOrDefault(x=>x.name==n)?.weight??0;float yaw=6*(Weight("bone.EyesRight")-Weight("bone.EyesLeft")),pitch=5*(Weight("bone.EyesDown")-Weight("bone.EyesUp"));if(Mathf.Abs(yaw)+Mathf.Abs(pitch)>.0001f){var rotate=Matrix4x4.Rotate(Quaternion.Euler(pitch,yaw,0));var matrices=new[]{Matrix4x4.identity,instance.eyeBinds[1].inverse*rotate*instance.eyeBinds[1],instance.eyeBinds[2].inverse*rotate*instance.eyeBinds[2]};foreach(var w in instance.boneData.eyeWeights){var p=vertices[w.vertex];vertices[w.vertex]+=(matrices[w.bone].MultiplyPoint3x4(p)-p)*w.weight;}}}
  foreach(var d in instance.decals){var item=active.FirstOrDefault(x=>x.name=="decal."+d.Key);d.Value.weight=item==null?0:item.weight;}
  if(instance.roundEyes!=null)foreach(var go in instance.roundEyes)go.SetActive(roundEyeActive);
  foreach(var item in active.Where(x=>x.name=="effect.Gloom"||x.name=="effect.Drool")){var effect=item.name.Substring(7);if(!instance.headEffects.ContainsKey(effect))instance.headEffects.Add(effect,CreateFaceEffect(actor,headEffectDir,code+"-"+effect,"effectprefab"));}
  foreach(var effect in instance.headEffects){var item=active.FirstOrDefault(x=>x.name=="effect."+effect.Key);effect.Value.SetActive(item!=null&&item.weight>=.5f);}
  if(eyeMaterialDir!=null)ApplyEyeMaterial(instance,code,active.LastOrDefault(x=>x.name.StartsWith("eyeMaterial.")&&x.weight>=.5f));
  instance.mesh.vertices=vertices;instance.mesh.RecalculateBounds();if(instance.decalMesh){instance.decalMesh.vertices=vertices;instance.decalMesh.RecalculateBounds();}instance.last=key;
 }
 void ApplyEyeMaterial(FaceInstance instance,string code,FaceWeight effect) {
  var renderer=instance.faceRenderer;var mats=renderer.sharedMaterials;int index=instance.eyeMaterialIndex;if(index<0||!instance.originalEye)throw new Exception("Eye material missing: "+code);
  if(effect==null){if(mats[index]!=instance.originalEye){mats[index]=instance.originalEye;renderer.sharedMaterials=mats;}return;}
  if(float.IsNaN(effect.time)||float.IsInfinity(effect.time)||effect.time<0||effect.time>3600)throw new Exception("Invalid eye material time");
  string name=effect.name.Substring("eyeMaterial.".Length),file=code+"-"+name;if(!eyeMaterialResources.TryGetValue(file,out var resource)){var metadata=JsonUtility.FromJson<EyeMaterialData>(File.ReadAllText(Path.Combine(eyeMaterialDir,file+".json")));if(metadata==null||metadata.code!=code||metadata.effect!=name||metadata.tileX<1||metadata.tileX>8||metadata.tileY<1||metadata.tileY>8||metadata.fps<1||metadata.fps>60)throw new Exception("Invalid eye effect metadata");var bundle=Load(eyeMaterialDir,file);var textures=new[]{"col","sdw","def"}.Select(asset=>bundle.LoadAsset<Texture2D>(asset)).ToArray();if(textures.Any(t=>!t))throw new Exception("Eye effect texture missing: "+file);resource=new EyeMaterialResource{data=metadata,textures=textures};eyeMaterialResources.Add(file,resource);}
  var data=resource.data;if(!instance.eyeMaterial)instance.eyeMaterial=new Material(instance.originalEye);var mat=instance.eyeMaterial;
  var texNames=new[]{"_BaseMap","_ShadeMap","_DefMap"};int frame=(int)Math.Floor(effect.time*data.fps+0.0001)%(data.tileX*data.tileY);var scale=new Vector2(1f/data.tileX,1f/data.tileY);var offset=new Vector2((frame%data.tileX)*scale.x,(data.tileY-1-frame/data.tileX)*scale.y);
  for(int i=0;i<texNames.Length;i++){mat.SetTexture(texNames[i],resource.textures[i]);mat.SetTextureScale(texNames[i],scale);mat.SetTextureOffset(texNames[i],offset);}
  if(mats[index]!=mat){mats[index]=mat;renderer.sharedMaterials=mats;}
 }
 void SetupRoundEyes(GameObject actor,FaceInstance instance,string code) {
  instance.roundEyes=new GameObject[2];int i=0;
  foreach(var side in new[]{"l","r"})instance.roundEyes[i++]=CreateFaceEffect(actor,roundEyesDir,code+"-"+side,"roundeye");
 }
 GameObject CreateFaceEffect(GameObject actor,string directory,string file,string asset) {
  var head=actor.GetComponentsInChildren<Transform>(true).FirstOrDefault(t=>t.name=="Head_Face");if(!head)throw new Exception("Face root missing");
  if(!roundEyeShader)throw new Exception("Round eye alpha shader missing");
  var prefab=Load(directory,file).LoadAsset<GameObject>(asset);if(!prefab)throw new Exception("Face effect prefab missing: "+file);var go=Instantiate(prefab);go.transform.SetParent(head,false);var materials=new List<Material>();foreach(var renderer in go.GetComponentsInChildren<Renderer>(true)){renderer.sharedMaterials=renderer.sharedMaterials.Select(source=>{var tex=source?source.GetTexture("_BaseMap"):null;if(!tex)throw new Exception("Face effect texture missing: "+file);var mat=new Material(roundEyeShader);mat.SetTexture("_BaseMap",tex);materials.Add(mat);return mat;}).ToArray();}go.AddComponent<CreatorRoundEyeMarker>().materials=materials.ToArray();go.SetActive(false);return go;
 }
 void SetupFaceBones(FaceInstance instance,string code,int vertexCount) {
  var data=JsonUtility.FromJson<FaceBoneData>(File.ReadAllText(Path.Combine(faceBoneDir,code+".json")));
  if(data==null||data.source!=$"mdl_chr_{code}-base-0000_face"||data.vertexCount!=vertexCount||data.bindposes==null||data.bindposes.Length<3||data.eyeWeights==null||data.eyeWeights.Any(w=>w.vertex<0||w.vertex>=vertexCount||w.bone<1||w.bone>2||w.weight<0||w.weight>1))throw new Exception("Invalid face bone metadata: "+code);
  instance.eyeBinds=new Matrix4x4[3];for(int b=1;b<=2;b++){var src=data.bindposes[b].values;if(src==null||src.Length!=16||src.Any(v=>float.IsNaN(v)||float.IsInfinity(v)))throw new Exception("Invalid face bone bind pose");var m=new Matrix4x4();for(int r=0;r<4;r++)for(int c=0;c<4;c++)m[r,c]=src[r*4+c];instance.eyeBinds[b]=m;}instance.boneData=data;
 }
 void SetupFaceDecals(GameObject actor,MeshFilter filter,FaceInstance instance,string code) {
  var path=Path.Combine(decalDataDir,code+".json");var data=JsonUtility.FromJson<DecalData>(File.ReadAllText(path));
  if(data==null||data.source!=$"mdl_chr_{code}-base-0000_face"||data.projectors==null||data.projectors.Length!=8)throw new Exception("Invalid face decal metadata: "+code);
  var source=Load(bundleRoot,"m_fdc").LoadAsset<Material>("m_fdc");var atlas=source?source.GetTexture("_BaseMap"):null;if(!atlas||!faceDecalShader)throw new Exception("Face decal atlas or shader unavailable");
  var originalMaterials=filter.GetComponent<MeshRenderer>().sharedMaterials;
  instance.decalMesh=Instantiate(filter.sharedMesh);for(int i=0;i<instance.decalMesh.subMeshCount;i++)if(i>=originalMaterials.Length||!originalMaterials[i]||!originalMaterials[i].name.StartsWith("m_fce"))instance.decalMesh.SetIndices(Array.Empty<int>(),MeshTopology.Triangles,i);
  foreach(var def in data.projectors){var node=actor.GetComponentsInChildren<Transform>(true).FirstOrDefault(t=>t.name==def.name&&t.parent&&t.parent.name=="FacialDecal");if(!node||instance.decals.ContainsKey(def.name))throw new Exception("Face decal node missing: "+def.name);var go=new GameObject("FaceDecal-"+def.name);go.transform.SetParent(filter.transform,false);go.AddComponent<MeshFilter>().sharedMesh=instance.decalMesh;var renderer=go.AddComponent<MeshRenderer>();var mat=new Material(faceDecalShader);mat.SetTexture("_BaseMap",atlas);renderer.sharedMaterials=originalMaterials.Select(m=>mat).ToArray();renderer.enabled=false;var decal=go.AddComponent<CreatorFaceDecal>();decal.projector=node;decal.uvScale=def.uvScale;decal.uvBias=def.uvBias;decal.pivot=def.pivot;decal.size=def.size;decal.inheritScale=def.scaleMode==1;decal.material=mat;decal.Configure();instance.decals.Add(def.name,decal);}
 }
 IEnumerator CaptureExportFrame(Work work) {
  var waitStart=work.timing==null?0:CreatorExportProfiler.Stamp();
  while(sceneBusy || (!string.IsNullOrEmpty(requestedSceneId) && requestedSceneId!=currentSceneId)){if(!string.IsNullOrEmpty(sceneError)){work.result=JsonUtility.ToJson(new Reply{id=work.command.id,ok=false,error=sceneError});work.done.Set();yield break;}yield return null;}
  if(!string.IsNullOrEmpty(sceneError)){work.result=JsonUtility.ToJson(new Reply{id=work.command.id,ok=false,error=sceneError});work.done.Set();yield break;}
  if(work.timing!=null)work.timing.Add("sceneWaitMs",CreatorExportProfiler.Elapsed(waitStart));waitStart=work.timing==null?0:CreatorExportProfiler.Stamp();
  yield return null;
  if(work.timing!=null)work.timing.Add("settleWaitMs",CreatorExportProfiler.Elapsed(waitStart));
  CreatorExportProfiler.Current=work.timing;
  var previous=RenderTexture.active; RenderTexture rt=null; Texture2D image=null; var oldTarget=cameraObject.targetTexture;
  try {
   int width=work.command.frameWidth,height=work.command.frameHeight;if(!work.command.includeEditorGizmo)editorGizmo.SetVisible(false);
   rt=new RenderTexture(width,height,24,RenderTextureFormat.ARGBHalf,RenderTextureReadWrite.Linear);rt.antiAliasing=1;cameraObject.targetTexture=rt;FitBackground();if(!work.command.skipPreRender||(composition==null&&!storyEffects.Enabled)){using(CreatorExportProfiler.Measure("preRenderMs"))cameraObject.Render();}else if(work.timing!=null)work.timing.Count("preRenderSkipped");RenderTexture.active=rt;
   if(composition!=null||storyEffects.Enabled){using(CreatorExportProfiler.Measure("effectsClearMs"))storyEffects.Clear();RenderTexture story;using(CreatorExportProfiler.Measure("storyMs"))story=RenderStory(width,height);using(CreatorExportProfiler.Measure("readDisplayMs")){image=CreatorLinearRendering.ReadDisplay(story,work.command.gpuColor);}}else{using(CreatorExportProfiler.Measure("readDisplayMs")){image=CreatorLinearRendering.ReadDisplay(rt,work.command.gpuColor);}using(CreatorExportProfiler.Measure("mediaCompositeMs"))screenMedia.Composite(image);}
   if(work.command.includeUiOverlay&&composition==null&&!storyEffects.Enabled){using(CreatorExportProfiler.Measure("uiOverlayMs")){CreatorUIOverlay.Composite(image,uiRects);uiGraph.Composite(image);}}if(work.command.captureUiLayer){using(CreatorExportProfiler.Measure("uiCaptureMs"))uiGraph.Capture(Path.Combine(output,"export-ui.png"),width,height);}byte[] png;using(CreatorExportProfiler.Measure("pngMs"))png=image.EncodeToPNG();using(CreatorExportProfiler.Measure("fileWriteMs"))File.WriteAllBytes(Path.Combine(output,"export-frame.png"),png);if(work.timing!=null){work.timing.totalMs=CreatorExportProfiler.Elapsed(work.started);work.timing.Snapshot();}work.result=JsonUtility.ToJson(new Reply{id=work.command.id,ok=true,exportTiming=work.timing});
  } catch(Exception e) { work.result=JsonUtility.ToJson(new Reply{id=work.command.id,ok=false,error=e.Message}); }
  finally { CreatorExportProfiler.Current=null;editorGizmo.SetVisible(true);cameraObject.targetTexture=oldTarget;RenderTexture.active=previous;if(image)Destroy(image);if(rt){rt.Release();Destroy(rt);}work.done.Set(); }
 }
 void CaptureThumbnail(string target) {
  if(sceneBusy)throw new Exception("Scene is loading");
  editorGizmo.SetVisible(false);var hidden=new List<Renderer>();
  var scene=!string.IsNullOrEmpty(currentSceneId)?SceneManager.GetSceneByPath(scenePaths[currentSceneId]):default;
  if(target=="actor"&&scene.IsValid()&&scene.isLoaded)hidden.AddRange(scene.GetRootGameObjects().SelectMany(x=>x.GetComponentsInChildren<Renderer>(true)));
  if(target=="scene")hidden.AddRange(body.GetComponentsInChildren<Renderer>(true));
  if(target=="actor"&&backgroundPlane)hidden.Add(backgroundPlane.GetComponent<Renderer>());
  foreach(var clone in copies.Values.Where(x=>x))hidden.AddRange(clone.GetComponentsInChildren<Renderer>(true));
  var previousFlags=hidden.Distinct().ToDictionary(r=>r,r=>r.forceRenderingOff);
  var go=new GameObject("Thumbnail Camera"); var cam=go.AddComponent<Camera>(); cam.CopyFrom(cameraObject); CreatorLinearRendering.ConfigureCamera(cam,linearRendering.Settings);cam.enabled=false; cam.targetTexture=null;
  RenderTexture rt=null; Texture2D image=null; var previous=RenderTexture.active;
  try {
   foreach(var r in previousFlags.Keys)r.forceRenderingOff=true;
   if(target=="actor") { cam.clearFlags=CameraClearFlags.SolidColor; cam.backgroundColor=new Color(.18f,.2f,.23f,1); cam.fieldOfView=35; cam.transform.position=body.transform.position+new Vector3(0,1,3); cam.transform.LookAt(body.transform.position+new Vector3(0,1,0)); }
   else cam.transform.SetPositionAndRotation(cameraObject.transform.position,cameraObject.transform.rotation);
   rt=new RenderTexture(256,256,24,RenderTextureFormat.ARGBHalf,RenderTextureReadWrite.Linear);cam.targetTexture=rt;cam.Render();RenderTexture.active=rt;image=CreatorLinearRendering.ReadDisplay(rt);File.WriteAllBytes(Path.Combine(output,"thumbnail-"+target+".png"),image.EncodeToPNG());
  } finally { RenderTexture.active=previous; cam.targetTexture=null; if(image)Destroy(image); if(rt){rt.Release();Destroy(rt);} Destroy(go); foreach(var item in previousFlags)if(item.Key)item.Key.forceRenderingOff=item.Value; editorGizmo.SetVisible(true); }
 }
 Avatar BuildAvatar(GameObject target) {
  var map=new Dictionary<string,string>{{"Hips","Hips"},{"Spine","Spine"},{"Chest","Spine1"},{"UpperChest","Spine2"},{"Neck","Neck"},{"Head","Head"},{"LeftShoulder","LeftShoulder"},{"LeftUpperArm","LeftArm"},{"LeftLowerArm","LeftForeArm"},{"LeftHand","LeftHand"},{"RightShoulder","RightShoulder"},{"RightUpperArm","RightArm"},{"RightLowerArm","RightForeArm"},{"RightHand","RightHand"},{"LeftUpperLeg","LeftUpLeg"},{"LeftLowerLeg","LeftLeg"},{"LeftFoot","LeftFoot"},{"LeftToes","LeftToeBase"},{"RightUpperLeg","RightUpLeg"},{"RightLowerLeg","RightLeg"},{"RightFoot","RightFoot"},{"RightToes","RightToeBase"}};
  foreach(var side in new[]{"Left","Right"})foreach(var finger in new[]{"Thumb","Index","Middle","Ring","Little"})for(int i=1;i<=3;i++)map[$"{side} {finger} {(i==1?"Proximal":i==2?"Intermediate":"Distal")}"]=$"{side}Hand{(finger=="Little"?"Pinky":finger)}{i}";
  var bones=target.GetComponentsInChildren<Transform>(true); return AvatarBuilder.BuildHumanAvatar(target,new HumanDescription {human=map.Where(p=>bones.Any(x=>x.name==p.Value)).Select(p=>new HumanBone{humanName=p.Key,boneName=p.Value,limit=new HumanLimit{useDefaultValues=true}}).ToArray(),skeleton=bones.Select(x=>new SkeletonBone{name=x.name,position=x.localPosition,rotation=x.localRotation,scale=x.localScale}).ToArray(),armStretch=.05f,legStretch=.05f,upperArmTwist=.5f,lowerArmTwist=.5f,upperLegTwist=.5f,lowerLegTwist=.5f});
 }
 AnimationClipPlayable CreateMotionPlayable(PlayableGraph targetGraph,AnimationClip targetClip) {
  return AnimationClipPlayable.Create(targetGraph,targetClip);
 }
 string MotionChoice(bool active,string action,string idle) {
  if(active&&!string.IsNullOrEmpty(action))return action;
  if(!string.IsNullOrEmpty(idle))return idle;
  return motionClips.ContainsKey("idle")?"idle":"shy";
 }
 float MotionPosition(bool active,float actionTime,float idleTime,AnimationClip targetClip) {
  if(active)return Mathf.Clamp(actionTime,0,Mathf.Max(0,targetClip.length-.0001f));
  return targetClip.length>0?Mathf.Repeat(idleTime,targetClip.length):0;
 }
 void SetupMotion(string path) {
  var b=AssetBundle.LoadFromFile(path); if(!b)throw new Exception("Cannot load motion bundle"); bundles.Add(b); clip=b.GetAllAssetNames().Select(n=>b.LoadAsset<AnimationClip>(n)).FirstOrDefault(c=>c&&c.name.EndsWith("_b")); if(!clip)throw new Exception("Body motion missing");motionClips["shy"]=clip;
  var animator=body.GetComponent<Animator>()??body.AddComponent<Animator>(); animator.avatar=BuildAvatar(body); animator.cullingMode=AnimatorCullingMode.AlwaysAnimate; if(!animator.avatar||!animator.avatar.isValid||!animator.avatar.isHuman)throw new Exception("Invalid motion avatar");
  graph=PlayableGraph.Create("Creator motion"); graph.SetTimeUpdateMode(DirectorUpdateMode.Manual); motion=CreateMotionPlayable(graph,clip);mainMotions["shy"]=motion;mainOutput=AnimationPlayableOutput.Create(graph,"motion",animator);mainOutput.SetSourcePlayable(motion);mainMixer=AnimationMixerPlayable.Create(graph,2);mainLayers=new CreatorAnimationLayers(graph); graph.Play();
 }
 void LoadMotion(string id,string path) {
  var b=AssetBundle.LoadFromFile(path);if(!b)throw new Exception("Cannot load motion "+id);bundles.Add(b);
  var c=b.GetAllAssetNames().Select(n=>b.LoadAsset<AnimationClip>(n)).FirstOrDefault(x=>x&&x.name.EndsWith("_b"));if(!c)throw new Exception("Body motion missing: "+id);
  motionClips[id]=c;mainMotions[id]=CreateMotionPlayable(graph,c);
 }
 void EnsureMotion(string id) {
  if(motionClips.ContainsKey(id))return;
  if(!filmMotions.TryGetValue(id,out var entry))throw new Exception("Motion unavailable: "+id);
  if(!filmMotionBundles.TryGetValue(entry.file,out var bundle)){bundle=AssetBundle.LoadFromFile(entry.file);if(!bundle)throw new Exception("Cannot load motion bundle: "+id);bundles.Add(bundle);filmMotionBundles.Add(entry.file,bundle);}
  var found=bundle.GetAllAssetNames().Select(n=>bundle.LoadAsset<AnimationClip>(n)).Where(c=>c&&c.name==entry.clip).ToArray();
  if(found.Length!=1)throw new Exception("Motion clip unavailable or ambiguous: "+id);
  motionClips.Add(id,found[0]);mainMotions.Add(id,CreateMotionPlayable(graph,found[0]));
 }
 void SampleBlended(PlayableGraph g,AnimationPlayableOutput output,AnimationMixerPlayable mixer,AnimationClipPlayable current,float currentTime,AnimationClipPlayable previous,float previousTime,float previousWeight){
  if(mixer.GetInput(0).IsValid())g.Disconnect(mixer,0);if(mixer.GetInput(1).IsValid())g.Disconnect(mixer,1);
  g.Connect(current,0,mixer,0);g.Connect(previous,0,mixer,1);mixer.SetInputWeight(0,1-previousWeight);mixer.SetInputWeight(1,previousWeight);current.SetTime(currentTime);previous.SetTime(previousTime);output.SetSourcePlayable(mixer);
 }
 // An inactive mixer must release its inputs. Reusing a humanoid playable while
 // it is still connected makes the next graph connection fail, leaving the
 // Humanoid pose without its body translation despite a fixed outer Transform.
 static void ClearBlend(PlayableGraph g,AnimationMixerPlayable mixer){for(int i=0;i<mixer.GetInputCount();i++)if(mixer.GetInput(i).IsValid())g.Disconnect(mixer,i);}
 static bool ValidBlend(bool active,string id,float t,float weight)=>!active||(!string.IsNullOrEmpty(id)&&id.Length<=180&&!float.IsNaN(t)&&!float.IsInfinity(t)&&t>=0&&t<=3600&&!float.IsNaN(weight)&&!float.IsInfinity(weight)&&weight>=0&&weight<=1);
 AnimationClip ResolveLayerClip(string id){EnsureMotion(id);return motionClips[id];}
 bool IsNativeAdditive(string id)=>filmMotions.TryGetValue(id,out var entry)&&entry.isAdditive;
 void Sample(float t) {t=Mathf.Clamp(t,0,clip.length);mainLayers.DetachBase();if(mainBlendActive)SampleBlended(graph,mainOutput,mainMixer,motion,t,mainMotions[mainBlendId],mainBlendTime,mainBlendWeight);else{ClearBlend(graph,mainMixer);mainOutput.SetSourcePlayable(motion);motion.SetTime(t);}mainLayers.Evaluate(mainOutput,mainBlendActive?(Playable)mainMixer:(Playable)motion,mainLayerState,ResolveLayerClip,IsNativeAdditive); }
 void ApplyMotion(Command c) {
  CreatorAnimationLayers.Validate(c.motionLayers);mainLayerState=c.motionLayers;
  if(!graph.IsValid()) { if(c.motionActive||c.physicsEnabled) throw new Exception("Local motion or physics resources unavailable"); return; }
  var motionId=MotionChoice(c.motionActive,c.motionId,c.idleMotionId);
  EnsureMotion(motionId);
  if(selectedMotion!=motionId) { selectedMotion=motionId;clip=motionClips[motionId];motion=mainMotions[motionId];mainOutput.SetSourcePlayable(motion);simulatedTime=-1;lastPhysics=false; }
  mainBlendActive=!c.physicsEnabled&&c.blendActive&&!c.motionActive&&c.blendMotionId!=motionId;if(mainBlendActive){EnsureMotion(c.blendMotionId);mainBlendId=c.blendMotionId;mainBlendTime=c.blendMotionTime;mainBlendWeight=c.blendWeight;}
  float target=MotionPosition(c.motionActive,c.motionTime,c.idleMotionTime,clip);
  if(cloth){float skirtLimit=testSkirtAngle>=0?testSkirtAngle:(!c.motionActive&&clip.name==QuietIdle?2f:-1f);if(cloth.skirtMaxAngle!=skirtLimit){cloth.skirtMaxAngle=skirtLimit;simulatedTime=-1;}}
  if(c.physicsEnabled && !cloth)throw new Exception("Local cloth metadata unavailable");
  if(c.physicsEnabled) {
   if(!lastPhysics || simulatedTime<0 || target<simulatedTime || target-simulatedTime>.25f) { cloth.ResetSimulation();if(mainHairCloth)mainHairCloth.ResetSimulation(); simulatedTime=Mathf.Max(0,target-.5f); Sample(simulatedTime); for(int i=0;i<30;i++){cloth.Step(1f/60f);if(mainHairCloth)mainHairCloth.Step(1f/60f);} }
   while(simulatedTime+1f/60f<=target+.00001f) { simulatedTime+=1f/60f; Sample(simulatedTime); cloth.Step(1f/60f);if(mainHairCloth)mainHairCloth.Step(1f/60f); }
  } else { if(cloth && lastPhysics){cloth.ResetSimulation();if(mainHairCloth)mainHairCloth.ResetSimulation();} Sample(target); simulatedTime=-1; }
  lastPhysics=c.physicsEnabled;
 }
 Texture2D LoadTexture(string file) { var t=new Texture2D(2,2,TextureFormat.RGBA32,false);if(!t.LoadImage(File.ReadAllBytes(file)))throw new Exception("Cannot load dialogue texture");return t; }
 Texture2D composedDialogue; string composedDialogueKey;
 Texture2D DialoguePanel(int width,int height,float scale) {
  string key=width+":"+height+":"+Mathf.RoundToInt(40*scale);
  if(composedDialogue&&composedDialogueKey==key)return composedDialogue;
  if(composedDialogue)Destroy(composedDialogue);
  composedDialogue=CreatorDialoguePanel.Compose(dialogueBackground,dialogueFrame,width,height,scale);composedDialogueKey=key;return composedDialogue;
 }
 Texture2D NameGradient(int width,int height,float scale) {
  width=Mathf.Clamp(width,1,1920);height=Mathf.Clamp(height,1,1920);string key=width+":"+height+":"+scale+":"+subtitleColor+":"+subtitleColorEnd;
  if(coloredName&&coloredNameKey==key)return coloredName; if(coloredName)Destroy(coloredName);
  Color a,b;if(!ColorUtility.TryParseHtmlString(subtitleColor,out a))a=new Color(.34f,.34f,.42f);if(!ColorUtility.TryParseHtmlString(subtitleColorEnd,out b))b=a;
  Color32[] src=dialogueName.GetPixels32(),pixels=new Color32[width*height];int left=Mathf.Min(Mathf.RoundToInt(33*scale),width/2),right=Mathf.Min(Mathf.RoundToInt(33*scale),width/2);
  for(int y=0;y<height;y++)for(int x=0;x<width;x++){int sx=x<left&&left>0?x*33/left:x>=width-right&&right>0?33+(x-(width-right))*33/right:32;int sy=Mathf.Min(dialogueName.height-1,y*dialogueName.height/height);Color32 p=src[sy*dialogueName.width+Mathf.Clamp(sx,0,dialogueName.width-1)];Color tint=Color.Lerp(a,b,width>1?(float)x/(width-1):0);pixels[y*width+x]=new Color32((byte)(p.r*tint.r),(byte)(p.g*tint.g),(byte)(p.b*tint.b),p.a);}
  coloredName=new Texture2D(width,height,TextureFormat.RGBA32,false);coloredName.SetPixels32(pixels);coloredName.Apply();coloredNameKey=key;return coloredName;
 }
 Texture CompositionMedia(string id,CreatorEffectLayer[] effects,int w,int h){var image=screenMedia.RenderItem(id,w,h);return storyEffects.ApplyLayers(storyEffects.Apply(image,"media",w,h),effects,w,h);}
 RenderTexture RenderComposition(int w,int h){
  using(CreatorExportProfiler.Measure("compositionMs")){
   var output=storyEffects.Blank(w,h);
   var actors=body.GetComponentsInChildren<Renderer>(true).Concat(copies.Values.Where(x=>x).SelectMany(x=>x.GetComponentsInChildren<Renderer>(true))).ToArray();
   foreach(var n in composition.nodes){Texture layer=null;
    if(n.kind=="world"){using(CreatorExportProfiler.Measure("compositionWorldMs"))layer=storyEffects.World(cameraObject,w,h,actors,FitBackground);}
    else if(n.kind=="media"){using(CreatorExportProfiler.Measure("compositionMediaMs"))layer=CompositionMedia(n.id,n.effects,w,h);}
    else if(n.kind=="effect"){using(CreatorExportProfiler.Measure("compositionEffectMs")){output=storyEffects.Copy(storyEffects.ApplyLayers(output,n.effects,w,h),w,h);}continue;}
    else if(n.kind=="transition"){using(CreatorExportProfiler.Measure("compositionTransitionMs")){var left=storyEffects.Copy(CompositionMedia(n.leftId,n.leftEffects,w,h),w,h);var right=CompositionMedia(n.rightId,n.rightEffects,w,h);layer=storyEffects.Transition(left,right,n.transition,n.progress,w,h);}}
    else if(n.kind=="ui"){using(CreatorExportProfiler.Measure("compositionUiMs")){uiGraph.Set(n.draws);layer=storyEffects.ApplyLayers(storyEffects.Apply(uiGraph.Render(w,h),"transition",w,h),n.effects,w,h);}}
    else if(n.kind=="dialogue"){
     using(CreatorExportProfiler.Measure("compositionDialogueMs")){
      Texture panel=null,name=null;var oldColor=subtitleColor;var oldEnd=subtitleColorEnd;
      try{subtitleColor=n.color;subtitleColorEnd=n.colorEnd;if(n.style=="game"&&dialogueBackground&&dialogueFrame&&dialogueName){float scale=h*.25f/dialogueBackground.height;panel=DialoguePanel(Mathf.RoundToInt(w*.84f),Mathf.RoundToInt(h*.25f),scale);name=NameGradient(Mathf.RoundToInt(w*.84f*.44f),Mathf.RoundToInt(h*.07f),Mathf.RoundToInt(h*.07f)/(float)dialogueName.height);}
       layer=storyEffects.ApplyLayers(storyEffects.Apply(storyDialogue.Render(w,h,n.speaker,n.text,n.style,panel,name,n.x,n.y,n.scale,n.opacity),"dialogue",w,h),n.effects,w,h);
      }finally{subtitleColor=oldColor;subtitleColorEnd=oldEnd;}
     }
    }
    using(CreatorExportProfiler.Measure("compositionCompositeMs"))storyEffects.Composite(output,layer);
   }
   return output;
  }
 }
 RenderTexture RenderStory(int width,int height){
  // Blit changes the active target. Restore the caller's target before IMGUI
  // presents the returned texture (or draws an error), including early returns.
  var previous=RenderTexture.active;var previousSrgb=GL.sRGBWrite;
  try{return RenderStoryContents(width,height);}
  finally{RenderTexture.active=previous;GL.sRGBWrite=previousSrgb;}
 }
 RenderTexture RenderStoryContents(int width,int height){
  if(composition!=null)return RenderComposition(width,height);
  var actors=body.GetComponentsInChildren<Renderer>(true).Concat(copies.Values.Where(x=>x).SelectMany(x=>x.GetComponentsInChildren<Renderer>(true))).Distinct().ToArray();
  var output=storyEffects.World(cameraObject,width,height,actors,FitBackground);
  using(CreatorExportProfiler.Measure("storyMediaMs"))storyEffects.Overlay(output,screenMedia.Render(width,height),"media");
  float scale=Mathf.Min(width/960f,height/540f);Texture panel=null,name=null;
  if(subtitleStyle=="game"&&dialogueBackground&&dialogueFrame&&dialogueName){panel=DialoguePanel(Mathf.RoundToInt(width*.84f),Mathf.RoundToInt(height*.25f),scale);name=NameGradient(Mathf.RoundToInt(width*.84f*.44f),Mathf.RoundToInt(height*.07f),Mathf.RoundToInt(height*.07f)/(float)dialogueName.height);}
  using(CreatorExportProfiler.Measure("storyDialogueMs"))storyEffects.Overlay(output,storyDialogue.Render(width,height,subtitleSpeaker,subtitleText,subtitleStyle,panel,name),"dialogue");
  using(CreatorExportProfiler.Measure("storyUiMs"))storyEffects.Overlay(output,uiGraph.Render(width,height),"transition");return output;
 }
 void OnGUI(){bool measure=CreatorExportProfiler.PreviewEnabled&&Event.current.type==EventType.Repaint;long start=measure?CreatorExportProfiler.Stamp():0;try{DrawPreviewGUI();}finally{if(measure){CreatorExportProfiler.PreviewCount++;CreatorExportProfiler.PreviewMs+=CreatorExportProfiler.Elapsed(start);}}}
 void DrawPreviewGUI() {if(storyEffects!=null&&(composition!=null||storyEffects.Enabled)&&cameraObject&&body){if(Event.current.type==EventType.Repaint){try{storyEffects.Clear();var storyFrame=RenderStory(Screen.width,Screen.height);storyError=null;GUI.DrawTexture(new Rect(0,0,Screen.width,Screen.height),storyFrame,ScaleMode.StretchToFill,false);}catch(Exception e){if(storyError!=e.Message)Debug.LogException(e);storyError=e.Message;GUI.Label(new Rect(12,12,Screen.width-24,80),"画面效果预览失败："+e.Message);}}}else{screenMedia?.Draw();DrawDialogue();CreatorUIOverlay.Draw(uiRects);uiGraph?.Draw();}screenMedia?.Handles(); }
 void DrawDialogue() {
  if(string.IsNullOrEmpty(subtitleText))return;
  if(!subtitleFont)subtitleFont=Font.CreateDynamicFontFromOSFont("Microsoft YaHei",24);
  if(subtitleStyle=="game"&&dialogueBackground&&dialogueFrame&&dialogueName) {
   float scale=Mathf.Min(Screen.width/960f,Screen.height/540f),x=Screen.width*.08f,w=Screen.width*.84f,y=Screen.height*.70f,h=Screen.height*.25f;
   var gameBox=new Rect(x,y,w,h);var nameBox=new Rect(x,y-Screen.height*.065f,w*.44f,Screen.height*.07f);GUI.DrawTexture(gameBox,DialoguePanel(Mathf.RoundToInt(w),Mathf.RoundToInt(h),scale),ScaleMode.StretchToFill,true);GUI.DrawTexture(nameBox,NameGradient(Mathf.RoundToInt(nameBox.width),Mathf.RoundToInt(nameBox.height),Mathf.RoundToInt(nameBox.height)/(float)dialogueName.height));
   var label=new GUIStyle(GUI.skin.label){font=subtitleFont,fontSize=Mathf.Clamp((int)(Screen.height*.045f),14,56),wordWrap=true};label.normal.textColor=new Color(.2f,.2f,.2f);var nameLabel=new GUIStyle(label){fontStyle=FontStyle.Bold};nameLabel.normal.textColor=Color.white;
   GUI.Label(new Rect(nameBox.x+Screen.width*.025f,nameBox.y,nameBox.width-Screen.width*.05f,nameBox.height),subtitleSpeaker,nameLabel);GUI.Label(new Rect(gameBox.x+Screen.width*.04f,gameBox.y+Screen.height*.025f,gameBox.width-Screen.width*.08f,gameBox.height-Screen.height*.04f),subtitleText,label);return;
  }
  float margin=Screen.width*.09f, height=Mathf.Clamp(Screen.height*.22f,70,200);var box=new Rect(margin,Screen.height-height-Screen.height*.06f,Screen.width-margin*2,height);
  if(subtitleStyle!="subtitle")GUI.Box(box,GUIContent.none);var title=new GUIStyle(GUI.skin.label){font=subtitleFont,fontSize=Mathf.Clamp((int)(Screen.height*.032f),14,30),fontStyle=FontStyle.Bold,wordWrap=true};
  var text=new GUIStyle(title){fontStyle=FontStyle.Normal,fontSize=Mathf.Clamp((int)(Screen.height*.033f),14,30)};
  var titleRect=new Rect(box.x+12,box.y+6,box.width-24,box.height*.3f);var textRect=new Rect(box.x+12,box.y+box.height*.3f,box.width-24,box.height*.65f);
  if(subtitleStyle=="subtitle") { var shadowTitle=new GUIStyle(title);shadowTitle.normal.textColor=Color.black;var shadowText=new GUIStyle(text);shadowText.normal.textColor=Color.black;foreach(var offset in new[]{new Vector2(-1,0),new Vector2(1,0),new Vector2(0,-1),new Vector2(0,1)}) { GUI.Label(new Rect(titleRect.position+offset,titleRect.size),subtitleSpeaker,shadowTitle);GUI.Label(new Rect(textRect.position+offset,textRect.size),subtitleText,shadowText); } }
  GUI.Label(titleRect,subtitleSpeaker,title);GUI.Label(textRect,subtitleText,text);
 }
 void OnDestroy() {storyEffects?.Dispose();storyDialogue?.Dispose();screenMedia?.Dispose();linearRendering?.Dispose();uiGraph?.Dispose();mainLayers?.Dispose();foreach(var layers in copyLayers.Values)layers.Dispose(); if(composedDialogue)Destroy(composedDialogue);if(coloredName)Destroy(coloredName); foreach(var a in copyAvatars.Values)if(a)Destroy(a);foreach(var f in faceInstances.Values){if(f.mesh)Destroy(f.mesh);if(f.decalMesh)Destroy(f.decalMesh);if(f.eyeMaterial)Destroy(f.eyeMaterial);}foreach(var g in copyGraphs.Values)if(g.IsValid())g.Destroy();if(graph.IsValid())graph.Destroy(); running=false; listener?.Stop(); foreach(var bundle in bundles) if(bundle) bundle.Unload(true); }
}

