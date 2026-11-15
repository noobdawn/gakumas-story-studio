"""Prepare facial and effect artifacts from a single already-decoded catalog."""
import argparse,json,subprocess,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
TASKS=[('face-decals','prepare_face_decal_data.py'),('face-bones','prepare_face_bones.py'),('round-eyes','prepare_round_eyes.py'),('head-effects','prepare_head_effects.py'),('eye-materials','prepare_eye_material_effects.py'),('face-animation','prepare_face_animation_cache.py')]
def build(root):
 root=Path(root).resolve(strict=True);view=(root/'player-view').resolve(strict=True);out=view/'face-effects';out.mkdir(exist_ok=False);results={}
 for folder,script in TASKS:
  print('准备 '+folder,flush=True)
  cmd=[sys.executable,'-B',str(HERE/script),'--catalog-root',str(root),'--output-dir',str(out/folder)]
  result=subprocess.run(cmd,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0));results[folder]={'exitCode':result.returncode}
  if result.returncode:raise RuntimeError('面部资源准备失败：'+folder)
 animation=json.loads((out/'face-animation/report.json').read_text(encoding='utf8'));results['face-animation'].update(prepared=animation['prepared'],failures=len(animation['errors']),duplicates=len(animation['duplicates']))
 # Keep unsupported or missing candidates visible; supported entries are independent.
 (out/'report.json').write_text(json.dumps({'version':1,'categories':results},ensure_ascii=False,indent=2),encoding='utf8');return results
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);a=p.parse_args();print(json.dumps(build(a.root),ensure_ascii=False),flush=True)
