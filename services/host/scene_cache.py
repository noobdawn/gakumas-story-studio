"""Prepare scene/background and dialogue data for a single managed batch."""
import argparse,json,subprocess,sys
from pathlib import Path
from prepare_2d_scenes import prepare

def build(root,game):
    root=Path(root).resolve(strict=True); view=root/'player-view'
    for name in ('classroom-props.json','backgrounds','dialogue-ui','scenes-catalog.json','scene-report.json'):
        if (view/name).exists():raise FileExistsError('Scene preparation requires a new batch: '+str(view/name))
    from scene_props_cache import build as build_props
    build_props(root)
    from physics_cache import prepare as prepare_physics
    prepare_physics(root)
    from render_shader_cache import prepare as prepare_render_shaders
    prepare_render_shaders(root)
    from ui_transition_graph_cache import prepare as prepare_ui
    transitions=prepare_ui(root)
    backgrounds=prepare(root,view/'backgrounds')
    script=Path(__file__).resolve().parent.parent/'importer/extract_dialogue_ui.py'
    subprocess.run([sys.executable,'-B',str(script),'--game',str(game),'--out',str(view/'dialogue-ui')],check=True)
    for name in ('message_bg','frame_message_bg','name_bg'):
        if not (view/'dialogue-ui'/(name+'.png')).is_file():raise ValueError('对白图片缺失：'+name)
    rows=[json.loads(x) for x in (root/'bundles.jsonl').read_text(encoding='utf8').splitlines() if x.strip()]
    supported=set(json.loads((view/'manifest.json').read_text(encoding='utf8'))['scenes'].values())
    from scene_catalog import build as build_scenes
    scenes=build_scenes(root)
    supported.update(x['source'] for x in scenes['entries'])
    issues=list(backgrounds['issues'])+scenes['issues']+transitions['issues']
    for row in rows:
        if row['name'].startswith('env_') and not row['name'].startswith('env_2d_') and row['name'] not in supported:
            issues.append({'source':row['name'],'error':row.get('error') or '当前 Player 尚未支持此场景类型或变体'})
    report={'version':1,'backgrounds':len(backgrounds['entries']),'legacy3DScenes':len(json.loads((view/'manifest.json').read_text(encoding='utf8'))['scenes']),'scenes3D':len(scenes['entries']),'issues':issues}
    (view/'scene-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    return report
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',required=True,type=Path);p.add_argument('--game',required=True,type=Path);a=p.parse_args();print(json.dumps(build(a.root,a.game),ensure_ascii=False))
