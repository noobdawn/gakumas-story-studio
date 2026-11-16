using System;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.SceneManagement;

// New output and assets only. Restores the independent research project's pipeline afterwards.
public static class CreatorBuild {
 public static void Run() {
  string output=Path.GetFullPath(Environment.GetEnvironmentVariable("GSS_PLAYER_OUTPUT") ?? throw new Exception("Set GSS_PLAYER_OUTPUT to a new output directory"));
  string folder="Assets/GSSBuild"+Guid.NewGuid().ToString("N");
  if(Directory.Exists(output)||AssetDatabase.IsValidFolder(folder)) { Debug.LogError("Output or asset folder already exists"); EditorApplication.Exit(2); return; }
  Directory.CreateDirectory(output);
  var originalGraphics=GraphicsSettings.defaultRenderPipeline; var originalQuality=QualitySettings.renderPipeline;
  int exitCode=1;
  try {
   CreatorDedicatedEffectsTests.Run();
   CreatorMotionTransitionTests.Run();
   if(PlayerSettings.colorSpace!=ColorSpace.Linear) throw new Exception("Expected Linear color space; refusing to change project setting");
   PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.StandaloneWindows64,false);
   PlayerSettings.SetGraphicsAPIs(BuildTarget.StandaloneWindows64,new[]{GraphicsDeviceType.Direct3D11});
   AssetDatabase.CreateFolder("Assets",Path.GetFileName(folder));
   var renderer=ScriptableObject.CreateInstance<UniversalRendererData>(); renderer.name="CreatorActorRenderer";
   AssetDatabase.CreateAsset(renderer,folder+"/CreatorActorRenderer.asset");
   renderer.opaqueLayerMask=~((1<<30)|(1<<31));renderer.transparentLayerMask=~(1<<30);
   renderer.postProcessData=AssetDatabase.LoadAssetAtPath<PostProcessData>("Packages/com.unity.render-pipelines.universal/Runtime/Data/PostProcessData.asset");
   if(!renderer.postProcessData)throw new Exception("PostProcessData missing");
   var native=ScriptableObject.CreateInstance<CreatorSceneLightingFeature>();native.name="Creator Scene Linear Lighting";
   native.overlayShader=Shader.Find("Hidden/Research/CampusDeferredOpaqueOverlay");native.normalEncodeShader=Shader.Find("Hidden/Research/CampusNormalsEncode");native.shadowAOCombineShader=Shader.Find("Hidden/Research/CampusShadowAOCombine");native.screenShadowShader=Shader.Find("Hidden/Research/CampusScreenShadow");
   if(!native.overlayShader||!native.normalEncodeShader||!native.shadowAOCombineShader||!native.screenShadowShader)throw new Exception("Lighting bridge shader missing");
   native.ssrShader=Shader.Find("Hidden/Creator/ScreenSpaceReflection");if(!native.ssrShader)throw new Exception("SSR shader missing");
   native.SetActive(false);AssetDatabase.AddObjectToAsset(native,renderer);renderer.rendererFeatures.Add(native);
   var actor=ScriptableObject.CreateInstance<ActorNativeForwardFeature>();actor.name="Creator Native Actor";actor.settings.injectionPoint=(RenderPassEvent)((int)RenderPassEvent.AfterRenderingOpaques+1);
   AssetDatabase.AddObjectToAsset(actor,renderer);renderer.rendererFeatures.Add(actor);
   var outline=ScriptableObject.CreateInstance<ActorOutlineFeature>(); outline.name="CreatorActorOutline";
   outline.settings.layerMask=1<<30;outline.settings.injectionPoint=(RenderPassEvent)((int)RenderPassEvent.AfterRenderingOpaques+2);outline.settings.width=.15f; outline.settings.keepScreenWidth=true;
   AssetDatabase.AddObjectToAsset(outline,renderer); renderer.rendererFeatures.Add(outline); EditorUtility.SetDirty(renderer);
   var pipeline=UniversalRenderPipelineAsset.Create(renderer); pipeline.name="CreatorActorPipeline"; pipeline.supportsHDR=true;pipeline.msaaSampleCount=1;
   AssetDatabase.CreateAsset(pipeline,folder+"/CreatorActorPipeline.asset");
   var settingsType=typeof(UniversalRenderPipeline).Assembly.GetType("UnityEngine.Rendering.Universal.UniversalRenderPipelineGlobalSettings");
   var ensure=settingsType?.GetMethod("Ensure",System.Reflection.BindingFlags.Static|System.Reflection.BindingFlags.NonPublic);
   if(ensure==null||ensure.Invoke(null,new object[]{true})==null)throw new Exception("Cannot initialize URP global settings");
   AssetDatabase.SaveAssets(); GraphicsSettings.defaultRenderPipeline=pipeline; QualitySettings.renderPipeline=pipeline;
   var scene=EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);
   var bootstrap=new GameObject("CreatorPrototype").AddComponent<CreatorPrototypePlayer>(); bootstrap.postEffectShader=Shader.Find("Hidden/Creator/StoryEffects");if(!bootstrap.postEffectShader)throw new Exception("Story effects shader missing");bootstrap.uiGraphShader=Shader.Find("Creator/UIGraph");if(!bootstrap.uiGraphShader)throw new Exception("UI graph shader missing");bootstrap.selectionShellShader=Shader.Find("Creator/SelectionShell");bootstrap.gizmoAxisShader=Shader.Find("Creator/GizmoColor");if(!bootstrap.selectionShellShader||!bootstrap.gizmoAxisShader)throw new Exception("Gizmo shaders missing");
   bootstrap.roundEyeShader=Shader.Find("Creator/RoundEyeAlpha"); if(!bootstrap.roundEyeShader)throw new Exception("Round eye shader missing"); bootstrap.faceDecalShader=Shader.Find("Creator/FaceDecalResearch"); if(!bootstrap.faceDecalShader)throw new Exception("Face decal shader missing"); bootstrap.sceneLighting=native;bootstrap.actorPipeline=pipeline; bootstrap.actorOutline=outline; bootstrap.fallbackShader=Shader.Find("Probe/Unlit");
   if(!EditorSceneManager.SaveScene(scene,folder+"/CreatorRenderScene.unity"))throw new Exception("Cannot save scene");
   var result=BuildPipeline.BuildPlayer(new[]{folder+"/CreatorRenderScene.unity"},Path.Combine(output,"CreatorPlayer.exe"),BuildTarget.StandaloneWindows64,BuildOptions.None);
   File.WriteAllText(Path.Combine(output,"build-report.txt"),"result="+result.summary.result+"\nerrors="+result.summary.totalErrors+"\ngraphicsApi="+string.Join(",",PlayerSettings.GetGraphicsAPIs(BuildTarget.StandaloneWindows64))+"\nautoGraphicsApi="+PlayerSettings.GetUseDefaultGraphicsAPIs(BuildTarget.StandaloneWindows64)+"\ncolorspace="+PlayerSettings.colorSpace+"\nbuild=release\nmsaa=1\nantialiasing=SMAA High\n");
   exitCode=result.summary.result==UnityEditor.Build.Reporting.BuildResult.Succeeded&&result.summary.totalErrors==0?0:1;
   if(exitCode==0)File.WriteAllText(Path.Combine(output,"creator-export-profile-v1"),"cpu-wall-spans-v1\n");
   if(exitCode==0&&Directory.GetFiles(output,"GSSGpuExport.dll",SearchOption.AllDirectories).Length>0)File.WriteAllText(Path.Combine(output,"creator-gpu-export-v1"),"d3d11-nvenc-poc-v1\n");
   if(exitCode==0)File.WriteAllText(Path.Combine(output,"creator-thought-filter-v1"),"grayscale-memory-elliptical-thought-v1\n");
   if(exitCode==0) {File.WriteAllText(Path.Combine(output,"creator-dedicated-effects-v2"),"memory-television-soft-v2\n");File.WriteAllText(Path.Combine(output,"creator-composition-v1"),"ordered-layers-scoped-effects-adjacent-transitions-v1\n");File.WriteAllText(Path.Combine(output,"creator-dialogue-alpha-v1"),"font-alpha-mask-v1\n");File.WriteAllText(Path.Combine(output,"creator-scene-removal-v1"),"empty-scene-unload-v1\n");File.WriteAllText(Path.Combine(output,"creator-post-effects-v1"),"selective-story-effects-native-dialogue-v1\n");File.WriteAllText(Path.Combine(output,"creator-screen-media-v1"),"screen-images-video-exact-frames-layout-v1\n");File.WriteAllText(Path.Combine(output,"creator-render-settings-v1"),"project-settings-baked-probes-optional-ssr-v1\n");File.WriteAllText(Path.Combine(output,"creator-linear-rendering-v1"),"linear-native-actor-scene-neutral-bloom-smaa\n");File.WriteAllText(Path.Combine(output,"creator-ui-transitions-v2"),"sprite-graph-masks-native-export\n");File.WriteAllText(Path.Combine(output,"creator-ui-transitions-v1"),"normalized-rects-scene-ready\n");File.WriteAllText(Path.Combine(output,"creator-animation-layers-v1"),"native-additive-masked-layers\n");File.WriteAllText(Path.Combine(output,"creator-scene-catalog-v1"),"lazy-scenes\n"); File.WriteAllText(Path.Combine(output,"creator-backgrounds-v1"),"fixed-aspect-fill\n"); File.WriteAllText(Path.Combine(output,"creator-gizmo-trs-v1"),"world-translation-rotation-local-scale\n"); File.WriteAllText(Path.Combine(output,"creator-selection-gizmo-v1"),"selection-and-world-translation\n"); File.WriteAllText(Path.Combine(output,"creator-dialogue-colors-v1"),"nine-slice-gradient-experimental\n"); File.WriteAllText(Path.Combine(output,"creator-dialogue-proportional-cap-v1"),"uniform-name-cap-scale\n"); File.WriteAllText(Path.Combine(output,"creator-classroom-props-v1"),"catalog-77\n"); File.WriteAllText(Path.Combine(output,"creator-motion-blend-v1"),"deterministic-return-to-idle\n"); File.WriteAllText(Path.Combine(output,"creator-classroom-chairs-v1"),"verified-six-chairs\n"); File.WriteAllText(Path.Combine(output,"creator-hair-physics-v1"),"experimental-hair-swing\n"); File.WriteAllText(Path.Combine(output,"creator-costume-physics-v1"),"experimental-body-swing\n"); File.WriteAllText(Path.Combine(output,"creator-costume-dependencies-v1"),"local-body-dependencies\n"); File.WriteAllText(Path.Combine(output,"creator-costumes-v1"),"local-costume-bodies\n"); File.WriteAllText(Path.Combine(output,"creator-eye-bones-v1"),"eye-weights-bindposes-experimental\n"); File.WriteAllText(Path.Combine(output,"creator-eye-materials-v1"),"local-animated-atlases\n"); File.WriteAllText(Path.Combine(output,"creator-head-effects-v1"),"local-prefabs\n"); File.WriteAllText(Path.Combine(output,"creator-round-eyes-v1"),"local-original-prefabs\n"); File.WriteAllText(Path.Combine(output,"creator-face-decals-v1"),"experimental-projection\n"); File.WriteAllText(Path.Combine(output,"creator-performance-v1"),"motion,cloth,trainingroom\n"); File.WriteAllText(Path.Combine(output,"creator-global-settings-v1"),"outline-width\n"); File.WriteAllText(Path.Combine(output,"creator-assets-v1"),"actors,scenes,thumbnails\n"); File.WriteAllText(Path.Combine(output,"creator-arrangement-v1"),"independent,visibility,dialogue\n"); File.WriteAllText(Path.Combine(output,"creator-face-v1"),"mouth-shape\n"); File.WriteAllText(Path.Combine(output,"creator-face-v2"),"multiple-shapes\n"); File.WriteAllText(Path.Combine(output,"creator-characters-v1"),"ttmr,fktn\n"); File.WriteAllText(Path.Combine(output,"creator-roster-v1"),"local-roster\n"); File.WriteAllText(Path.Combine(output,"creator-film-motions-v1"),"local-catalog\n"); File.WriteAllText(Path.Combine(output,"creator-idle-oneshot-v1"),"per-actor-idle\n"); File.WriteAllText(Path.Combine(output,"creator-dialogue-v1"),"subtitle,game\n"); File.WriteAllText(Path.Combine(output,"creator-export-v1"),"frames\n"); File.WriteAllText(Path.Combine(output,"creator-motions-v1"),"shy,idle,angry,yes\n"); }
  } catch(Exception e) { File.WriteAllText(Path.Combine(output,"build-error.txt"),e.ToString()); Debug.LogException(e); }
  finally { GraphicsSettings.defaultRenderPipeline=originalGraphics; QualitySettings.renderPipeline=originalQuality; AssetDatabase.SaveAssets(); }
  EditorApplication.Exit(exitCode);
 }
}




