import sys
from pathlib import Path
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))
import runtime_paths
import dedicated_effects
"""Local research host: browser UI -> authenticated loopback TCP -> Unity Player."""
import argparse
import base64
import http.server
import hashlib
import json
import os
import re
import secrets
import socket
import subprocess
import sys
import tempfile
import threading
import time
import webbrowser
import audio_effects
import visual_media
from urllib.parse import quote
from pathlib import Path

HERE = Path(__file__).resolve().parent
REQUIRED = ('shader', 'actor-shader', 'm_fdc', 'mdl_chr_ttmr-casl-0002_body',
            'mdl_chr_ttmr-base-0000_hair', 'ttmr-face-exposed')

FACE_NAME = re.compile(r'b_(?:brow|eye|iris|mouth)\.[a-z]+_\d{3}')


class PreviewRequestHandler(http.server.BaseHTTPRequestHandler):
    # Preview sends a state every frame. HTTP/1.0 creates a fresh TCP socket
    # each time and can exhaust Windows ephemeral ports during playback.
    protocol_version = 'HTTP/1.1'
    timeout = 30
    disable_nagle_algorithm = True

    def read_json(self, limit):
        # Reject framing we cannot consume before allowing connection reuse.
        try:
            lengths = self.headers.get_all('Content-Length', [])
            if self.headers.get('Transfer-Encoding') is not None or len(lengths) != 1 or not re.fullmatch(r'[0-9]+', lengths[0]):
                raise ValueError('invalid length')
            size = int(lengths[0])
            if not 0 < size <= limit:
                raise ValueError('invalid length')
            data = self.rfile.read(size)
            if len(data) != size:
                raise ValueError('incomplete request body')
            self._request_bytes = size
        except Exception:
            self.close_connection = True
            raise
        return json.loads(data)

    def send_json(self, reply, status=200):
        data = json.dumps(reply, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        if self.close_connection:
            self.send_header('Connection', 'close')
        self.end_headers()
        self.wfile.write(data)


def media_request_parts(request_path, prefix):
    """Validate a media URL while ignoring its cache-busting query string."""
    if not isinstance(request_path, str) or not request_path.startswith(prefix): return None
    parts=request_path[len(prefix):].split('?',1)[0].split('/')
    uuid=r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
    if len(parts)!=3 or parts[0] not in ('project','shared') or not re.fullmatch(uuid+r'\.(wav|mp3|ogg|m4a|mp4|mov|webm|mkv)',parts[2],re.I): return None
    if parts[0]=='project' and not re.fullmatch(uuid,parts[1],re.I): return None
    if parts[0]=='shared' and parts[1]!='shared': return None
    return parts


def face_catalog(shapes_by_actor):
    """Expose named facial controls from all available actors, retaining availability."""
    supported = {code: {name for name in names if isinstance(name, str) and FACE_NAME.fullmatch(name)}
                 for code, names in shapes_by_actor.items()}
    names = sorted(set().union(*supported.values()))
    missing = [code + ':' + name for code, available in supported.items()
               for name in names if name not in available]
    return names, missing


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--player', type=Path, default=runtime_paths.PLAYER)
    parser.add_argument('--catalog-root', required=True, type=Path, help='Managed extraction catalog')
    parser.add_argument('--parent-hwnd', type=int, help='Embed into this Electron window (Windows only)')
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--no-cloth', action='store_true')
    parser.add_argument('--legacy-listen', action='store_true')
    args = parser.parse_args()
    from resource_catalog import require_catalog
    import base_motions
    try:
        args.catalog_root = require_catalog(args.catalog_root)
        cache_motions = base_motions.resolve(args.catalog_root)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        parser.error('解包资源不可用：' + str(exc))
    view = args.catalog_root / 'player-view'
    bundles = view / 'characters'
    args.motion = cache_motions['shy']
    args.cloth = view / 'baseline-cloth.json'
    args.scene = view / 'scenes'
    args.face_shapes = args.catalog_root / 'face/mdl_chr_ttmr-base-0000_face.json'
    args.dialogue_assets = view / 'dialogue-ui'
    missing = [name for name in REQUIRED if not (bundles / (name + '.bundle')).is_file()]
    if missing:
        parser.error('Missing prepared bundles: ' + ', '.join(missing))
    player = args.player.resolve()
    if not player.is_file():
        parser.error('Player build missing: ' + str(player))
    from render_shader_cache import for_player as rendering_shaders_for_player
    try:
        rendering_shaders = rendering_shaders_for_player(player, args.catalog_root)
    except (OSError, ValueError, KeyError) as exc:
        parser.error('渲染 Shader 准备失败：' + str(exc))
    cloth_available = args.cloth.is_file()
    if not cloth_available and not args.no_cloth: parser.error('基础衣物元数据不可用；可通过 --no-cloth 显式禁用')
    resources_ok = args.motion.is_file() and (args.scene / 'env_3d_adv_trainingroom-00-00-noon.bundle').is_file()
    capable = (player.parent / 'creator-performance-v1').is_file()
    if not resources_ok:
        parser.error('Motion, cloth metadata, or training-room bundle is missing')
    if not capable:
        parser.error('The selected Player does not advertise performance support')
    performance = resources_ok and capable
    global_settings = (player.parent / 'creator-global-settings-v1').is_file()
    asset_features = (player.parent / 'creator-assets-v1').is_file()
    export_capable = (player.parent / 'creator-export-v1').is_file()
    idle_capable = (player.parent / 'creator-idle-oneshot-v1').is_file()
    ui_graph_capable=(player.parent/'creator-ui-transitions-v2').is_file()
    ui_capable=(player.parent/'creator-ui-transitions-v1').is_file()
    ui_catalog={'entries':[], 'issues':[]}
    if ui_capable and args.catalog_root:
        try:
            if ui_graph_capable:
                from ui_transition_graph_cache import prepare as prepare_ui
            else:
                from ui_transition_cache import prepare as prepare_ui
            ui_catalog=prepare_ui(args.catalog_root)
        except Exception as e:
            ui_catalog['issues'].append({'error':str(e)})
    layers_capable = (player.parent / 'creator-animation-layers-v1').is_file()
    blend_capable = (player.parent / 'creator-motion-blend-v1').is_file()
    prop_capable = (player.parent / 'creator-classroom-chairs-v1').is_file()
    catalog_file = view/'classroom-props.json'
    generic_props = False
    if (player.parent / 'creator-classroom-props-v1').is_file() and catalog_file.is_file():
        try:
            expected = json.loads(catalog_file.read_text(encoding='utf-8'))['sha256']
            source = args.scene / 'env_3d_adv_classroom-00-00-noon.bundle'
            with source.open('rb') as f:
                digest = hashlib.file_digest(f, 'sha256').hexdigest()
            generic_props = digest == expected
        except (OSError, ValueError, KeyError):
            generic_props = False
    multi_motion = (player.parent / 'creator-motions-v1').is_file()
    motion_paths = {name:cache_motions[name] for name in ('idle','angry','yes')}
    available_motions = ['shy'] + [name for name, file in motion_paths.items() if multi_motion and file.is_file()] if performance else []
    arrangement = (player.parent / 'creator-arrangement-v1').is_file()
    editor_gizmo = (player.parent / 'creator-selection-gizmo-v1').is_file()
    gizmo_trs = editor_gizmo and (player.parent / 'creator-gizmo-trs-v1').is_file()
    dialogue_styles = (player.parent / 'creator-dialogue-v1').is_file()
    game_dialogue = dialogue_styles and 'game' in (player.parent / 'creator-dialogue-v1').read_text(encoding='utf-8') and all((args.dialogue_assets/name).is_file() for name in ('message_bg.png','frame_message_bg.png','name_bg.png'))
    faces = (player.parent / 'creator-face-v1').is_file() and args.face_shapes.is_file()
    multi_faces = faces and (player.parent / 'creator-face-v2').is_file()
    effect_root = view / 'face-effects'
    decal_dir = effect_root / 'face-decals'
    face_decals = (player.parent / 'creator-face-decals-v1').is_file() and (decal_dir / 'ttmr.json').is_file()
    round_eye_dir = effect_root / 'round-eyes'
    round_eyes = (player.parent / 'creator-round-eyes-v1').is_file() and (round_eye_dir / 'ttmr-l.bundle').is_file() and (round_eye_dir / 'ttmr-r.bundle').is_file()
    face_bone_dir = effect_root / 'face-bones'
    eye_bones = (player.parent / 'creator-eye-bones-v1').is_file() and (face_bone_dir/'ttmr.json').is_file()
    head_effect_dir = effect_root / 'head-effects'
    head_effects = (player.parent / 'creator-head-effects-v1').is_file() and (head_effect_dir/'report.json').is_file()
    eye_material_dir = effect_root / 'eye-materials'
    eye_materials = (player.parent / 'creator-eye-materials-v1').is_file() and (eye_material_dir/'report.json').is_file()
    face_names = []
    actor_face_names = {}
    if multi_faces:
        data = json.loads(args.face_shapes.read_text(encoding='utf-8'))
        actor_face_names['ttmr'] = {shape['name'] for shape in data.get('shapes', []) if isinstance(shape, dict) and isinstance(shape.get('name'), str)}

    film_root = args.catalog_root
    face_dir = film_root / 'face'
    roster_capable = (player.parent / 'creator-roster-v1').is_file()
    roster_codes = 'hski fktn amao kllj kcna ssmk shro hrnm hume jsna hmsz atbm nasr krnh'.split()
    actor_codes, missing_shapes = [], []
    if faces and performance and arrangement:
        for code in (roster_codes if roster_capable else ['fktn'] if (player.parent / 'creator-characters-v1').is_file() else []):
            outfit = '0000' if code in ('nasr','krnh') else '0002'
            data_path = face_dir / f'mdl_chr_{code}-base-0000_face.json'
            names = (f'mdl_chr_{code}-casl-{outfit}_body',f'mdl_chr_{code}-base-0000_hair',f'{code}-face-exposed')
            if not data_path.is_file() or not all((bundles / (name + '.bundle')).is_file() for name in names): continue
            try:
                data=json.loads(data_path.read_text(encoding='utf-8'))
                if data.get('source') != f'mdl_chr_{code}-base-0000_face' or not isinstance(data.get('vertexCount'),int) or not isinstance(data.get('shapes'),list): continue
                names_found={shape['name'] for shape in data['shapes'] if isinstance(shape,dict) and isinstance(shape.get('name'),str)}
                if 'b_mouth.mouth_001' not in names_found: continue
                actor_codes.append(code)
                if multi_faces: actor_face_names[code] = names_found
            except (OSError,ValueError,KeyError,TypeError): continue
    if multi_faces:
        face_names, missing_shapes = face_catalog(actor_face_names)
    face_decals = face_decals and all((decal_dir/(code+'.json')).is_file() for code in ['ttmr']+actor_codes)
    eye_bones = eye_bones and all((face_bone_dir/(code+'.json')).is_file() for code in ['ttmr']+actor_codes)
    if round_eyes:
        missing_shapes += [code+':effect.RoundEyes' for code in ['ttmr']+actor_codes if not all((round_eye_dir/(code+'-'+side+'.bundle')).is_file() for side in 'lr')]
    if head_effects:
        missing_shapes += [code+':effect.'+effect for code in ['ttmr']+actor_codes for effect in ('Gloom','Drool') if not (head_effect_dir/(code+'-'+effect+'.bundle')).is_file()]
    if eye_materials:
        missing_shapes += [code+':eyeMaterial.'+effect for code in ['ttmr']+actor_codes for effect in ('NoHighlight','Sparkle','SparkleSmall','Kiran','Move','Heart') if not (eye_material_dir/(code+'-'+effect+'.bundle')).is_file() or not (eye_material_dir/(code+'-'+effect+'.json')).is_file()]
    fktn_available='fktn' in actor_codes
    available_scenes = [s for s in ('trainingroom','classroom','courtyard','dormitory','rooftop') if (args.scene / ('env_3d_adv_'+s+'-00-00-noon.bundle')).is_file()] if performance else []
    background_entries = []
    if args.catalog_root and (player.parent/'creator-backgrounds-v1').is_file():
        background_dir=args.catalog_root/'player-view'/'backgrounds'
        if (background_dir/'report.json').is_file():
            for item in json.loads((background_dir/'report.json').read_text(encoding='utf8')).get('entries',[]):
                if re.fullmatch(r'2d-env_2d_[A-Za-z0-9_-]+',item.get('sceneId','')) and item.get('file')==item['sceneId'][3:]+'.png' and (background_dir/item['file']).is_file():
                    background_entries.append(dict(id=item['id'],sceneId=item['sceneId'],type='场景',alias='2D · '+item['source'],source=item['source']))
    scene_catalog_file=view/'scenes-catalog.json'
    if scene_catalog_file and scene_catalog_file.is_file() and (player.parent/'creator-scene-catalog-v1').is_file():
        for item in json.loads(scene_catalog_file.read_text(encoding='utf8'))['entries']:
            if item['sceneId'] not in available_scenes:
                background_entries.append(dict(id=item['id'],sceneId=item['sceneId'],type='场景',alias='3D · '+item['source'],source=item['source']))
    film_motions = []
    costume_capable = (player.parent / 'creator-costumes-v1').is_file()
    costume_dependencies = (player.parent / 'creator-costume-dependencies-v1').is_file()
    costume_items, costume_all = [], None
    if costume_capable and (film_root/'bundles.jsonl').is_file():
        import costume_catalog
        try:
            costume_all = costume_catalog.load(film_root)
            costume_items = [item for item in costume_all if item['playerAvailable'] and (costume_dependencies or not item['dependencyBundles']) and item['character'] in ['ttmr']+actor_codes]
        except (OSError,ValueError,TypeError):
            costume_all = None
    if performance and (player.parent / 'creator-film-motions-v1').is_file() and (film_root / 'bundles.jsonl').is_file():
        from film_motions import load as load_film_motions
        if layers_capable and args.catalog_root:
            from animation_layer_cache import prepare as prepare_layers
            try:
                prepare_layers(film_root)
            except (OSError, ValueError, KeyError) as exc:
                parser.error('缓存叠加动作准备失败：' + str(exc))
        film_motions = load_film_motions(film_root)
    full_face_root=effect_root/'face-animation'
    face_motion_catalog=full_face_root/'catalog.json'
    decal_curve_root=full_face_root/'decal-curves'
    face_motions, face_motion_files = [], {}
    if multi_faces and face_motion_catalog.is_file() and face_motion_catalog.stat().st_size <= 2*1024*1024:
        data = json.loads(face_motion_catalog.read_text(encoding='utf-8'))
        if data.get('version') == 1 and isinstance(data.get('motions'),list): face_motions = data['motions']
        elif data.get('version') == 2 and isinstance(data.get('motions'),list):
            for row in data['motions']:
                if not isinstance(row,dict): continue
                ident, filename = row.get('id'), row.get('file')
                if not isinstance(ident,str) or not re.fullmatch(r'asset-face-motion-[A-Za-z0-9_-]+_f',ident) or not isinstance(filename,str) or not re.fullmatch(r'[0-9a-f]{64}\.json',filename): continue
                file = (full_face_root/'clips'/filename).resolve()
                if (full_face_root/'clips').resolve() not in file.parents or not file.is_file() or file.stat().st_size>4*1024*1024: continue
                if ident in face_motion_files: raise ValueError('Duplicate face motion ID')
                face_motion_files[ident]=file
                entry={'id':ident,'name':row.get('name'),'length':row.get('length')}
                if isinstance(row.get('originalName'),str) and isinstance(row.get('sourceOffset'),(int,float)) and isinstance(row.get('sourceLength'),(int,float)):
                    entry.update(originalName=row['originalName'],sourceOffset=row['sourceOffset'],sourceLength=row['sourceLength'])
                face_motions.append(entry)
    library_root = Path(os.environ.get('CREATOR_LIBRARY_DIR', runtime_paths.DATA)).resolve()
    from physics_cache import prepare as prepare_physics
    physics_root = prepare_physics(args.catalog_root)
    token = secrets.token_urlsafe(32)
    listener = socket.socket()
    listener.bind(('127.0.0.1', 0))
    port = listener.getsockname()[1]
    if args.legacy_listen:
        listener.close()
    else:
        listener.listen(8)
        listener.settimeout(.5)
    with tempfile.TemporaryDirectory(prefix='creator-session-') as output:
        command = [str(player), '-force-d3d11', '-creator-bundles', str(bundles), '-creator-output', output,
                                 '-creator-port', str(port), '-creator-token', token,
                                 '-screen-fullscreen', '0', '-screen-width', '800', '-screen-height', '720',
                                 '-logFile', str(Path(output) / 'player.log')]
        command += ['-creator-media-root',str(library_root)]
        if rendering_shaders: command += ['-creator-render-shaders',str(rendering_shaders)]
        if ui_graph_capable and args.catalog_root: command += ['-creator-ui-data',str((args.catalog_root/'player-view/ui-transitions-v2').resolve())]
        if background_entries and args.catalog_root: command += ['-creator-backgrounds',str((args.catalog_root/'player-view/backgrounds').resolve())]
        if scene_catalog_file and scene_catalog_file.is_file() and (player.parent/'creator-scene-catalog-v1').is_file(): command += ['-creator-scene-catalog',str(scene_catalog_file.resolve())]
        if performance:
            command += ['-creator-motion', str(args.motion.resolve()), '-creator-scene', str(args.scene.resolve())]
            if not args.no_cloth and cloth_available: command += ['-creator-cloth', str(args.cloth.resolve())]
            elif not args.no_cloth and not cloth_available: print('基础衣物元数据不可用，本次不加载该物理配置',file=sys.stderr,flush=True)
            for name in available_motions:
                if name != 'shy': command += ['-creator-motion-'+name,str(motion_paths[name].resolve())]
        if film_motions:
            manifest=Path(output)/'motion-manifest.json'
            manifest.write_text(json.dumps({'motions':film_motions},ensure_ascii=False),encoding='utf-8')
            command += ['-creator-film-motions',str(manifest)]
        if costume_capable:
            manifest=Path(output)/'costume-manifest.json'
            manifest.write_text(json.dumps({'costumes':[{'id':'asset-'+x['id'],'name':x['name'],'character':x['character'],'dependencies':x['dependencyBundles']} for x in costume_items]},ensure_ascii=False),encoding='utf-8')
            command += ['-creator-costume-manifest',str(manifest),'-creator-costume-root',str((film_root/'bundles').resolve())]
        if (player.parent/'creator-costume-physics-v1').is_file():
            swing=physics_root/'costumes'
            if not swing.is_dir(): raise RuntimeError('服装实验物理数据不可用')
            command += ['-creator-swing-dir',str(swing.resolve())]
        if (player.parent/'creator-hair-physics-v1').is_file():
            hair_swing=physics_root/'hair'
            if not hair_swing.is_dir(): raise RuntimeError('头发实验物理数据不可用')
            command += ['-creator-hair-swing-dir',str(hair_swing.resolve())]
            command += ['-creator-face-swing-dir',str((physics_root/'faces-v1').resolve())]
        if faces:
            command += ['-creator-face-shapes', str(args.face_shapes.resolve())]
        if face_decals:
            command += ['-creator-face-decal-dir', str(decal_dir.resolve())]
        if round_eyes:
            command += ['-creator-round-eye-dir', str(round_eye_dir.resolve())]
        if eye_bones:
            command += ['-creator-face-bone-dir', str(face_bone_dir.resolve())]
        if head_effects:
            command += ['-creator-head-effect-dir', str(head_effect_dir.resolve())]
        if eye_materials:
            command += ['-creator-eye-material-dir', str(eye_material_dir.resolve())]
        if roster_capable and actor_codes:
            command += ['-creator-roster-face-dir',str(face_dir.resolve()),'-creator-roster-codes',','.join(actor_codes)]
        elif fktn_available:
            command += ['-creator-fktn-face-shapes',str((face_dir / 'mdl_chr_fktn-base-0000_face.json').resolve())]
        if game_dialogue:
            command += ['-creator-dialogue-assets',str(args.dialogue_assets.resolve())]
        if editor_gizmo and os.environ.get('CREATOR_TEST_INSTANCE')=='1' and os.environ.get('CREATOR_GIZMO_TEST')=='1':
            command += ['-creator-gizmo-test']
        if args.parent_hwnd:
            command += ['-parentHWND', str(args.parent_hwnd), 'delayed']
        if not args.legacy_listen:
            command += ['-creator-connect']
        proc = subprocess.Popen(command, cwd=str(player.parent))
        try:
            deadline = time.monotonic() + 90
            while not (Path(output) / 'ready.txt').exists():
                if proc.poll() is not None or time.monotonic() >= deadline:
                    error = Path(output) / 'error.txt'
                    log = Path(output) / 'player.log'
                    raise RuntimeError(error.read_text(encoding='utf-8') if error.exists() else
                                       log.read_text(encoding='utf-8', errors='replace')[-4000:] if log.exists() else 'Player did not start')
                time.sleep(.1)
            embedded = None
            if args.parent_hwnd:
                from embed_win import EmbeddedPlayer
                embedded = EmbeddedPlayer(args.parent_hwnd, proc.pid)
                embedded.discover()
            if args.legacy_listen:
                conn = socket.create_connection(('127.0.0.1', port), timeout=6)
                stream = conn.makefile('rb')
            else:
                conn = stream = None
                while time.monotonic() < deadline:
                    if proc.poll() is not None: raise RuntimeError('Player exited before TCP handshake')
                    error = Path(output) / 'server-error.txt'
                    if error.exists(): raise RuntimeError(error.read_text(encoding='utf-8'))
                    try:
                        candidate, _ = listener.accept()
                    except socket.timeout:
                        continue
                    candidate.settimeout(65)
                    incoming = candidate.makefile('rb')
                    try:
                        hello = incoming.readline(256).rstrip(b'\r\n')
                        if secrets.compare_digest(hello, ('creator-session '+token).encode('utf8')):
                            conn, stream = candidate, incoming
                            break
                    except (OSError, ValueError):
                        pass
                    incoming.close(); candidate.close()
                if conn is None: raise TimeoutError('Player TCP session handshake timed out')
                listener.close()
            lock = threading.RLock()
            stopping = threading.Event()
            export_job = None
            export_dir = None
            def gpu_export_command(kind, **values):
                request=dict(token=token,id=0,kind=kind,**values)
                if export_job is not None and getattr(export_job,'queue_capacity',0):request['queueSession']=export_job.queue_session
                with lock:
                    conn.sendall((json.dumps(request,separators=(',', ':'))+'\n').encode())
                    reply=json.loads(stream.readline(262145 if kind in ('gpu-export-enqueue','gpu-export-status') else 4097))
                if reply.get('ok') is not True:raise RuntimeError('GPU 导出失败：'+str(reply.get('error','Player 回复无效')))
                return reply
            def cancel_export(expected_session=None):
                nonlocal export_job, export_dir
                with lock:
                    job=export_job
                    if expected_session is not None and job is not None and getattr(job,'queue_session',None)!=expected_session:raise ValueError('导出队列会话已失效')
                    try:
                        if job is not None and job.gpu_video:gpu_export_command('gpu-export-cancel')
                    finally:
                        try:
                            if job is not None:job.cancel()
                        finally:
                            export_job=None
                            if export_dir is not None:export_dir.cleanup();export_dir=None
            class Handler(PreviewRequestHandler):
                def log_message(self, *unused): pass
                def do_GET(self):
                    if self.path == '/' + token + '/costumes':
                        try:
                            import costume_catalog
                            items=[dict(item) for item in costume_all] if costume_all is not None else costume_catalog.load(film_root)
                            supported={x['id'] for x in costume_items}
                            for item in items:
                                item['playerAvailable']=costume_capable and item['id'] in supported
                                item['thumbnailAvailable']=item['thumbnailAvailable'] and (costume_dependencies or not item['dependencyBundles'])
                            data=json.dumps(items,ensure_ascii=False,separators=(',',':')).encode('utf-8')
                        except (OSError,ValueError,TypeError) as e:
                            return self.send_error(500,'Costume catalog unavailable',explain=str(e))
                        self.send_response(200);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
                    if self.path == '/' + token + '/face-motions':
                        data=json.dumps(face_motions,ensure_ascii=False).encode('utf-8')
                        self.send_response(200);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
                    face_prefix = '/' + token + '/face-motion/'
                    if self.path.startswith(face_prefix):
                        file = face_motion_files.get(self.path[len(face_prefix):])
                        if not file: return self.send_error(404)
                        try:
                            if (full_face_root/'clips').resolve() not in file.resolve().parents or not file.is_file() or file.stat().st_size>4*1024*1024: return self.send_error(404)
                            data=file.read_bytes()
                            if face_decals:
                                overlay=decal_curve_root/file.name
                                if not overlay.is_file() or overlay.stat().st_size>512*1024: raise ValueError('Missing or oversized decal curve overlay')
                                clip=json.loads(data);extra=json.loads(overlay.read_text(encoding='utf-8'))
                                if extra.get('id')!=clip.get('id') or not isinstance(extra.get('channels'),list): raise ValueError('Invalid decal curve overlay')
                                clip['channels'].extend(extra['channels']);data=json.dumps(clip,ensure_ascii=False,separators=(',',':')).encode('utf-8')
                        except (OSError,ValueError,TypeError,KeyError): return self.send_error(404)
                        self.send_response(200);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
                    if self.path == '/' + token + '/ui-transitions':
                        data=json.dumps(ui_catalog,ensure_ascii=False).encode('utf8')
                        self.send_response(200);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
                    if self.path == '/' + token + '/film-motions':
                        data=json.dumps([{k:v for k,v in m.items() if k not in ('file','clip')} for m in film_motions],ensure_ascii=False).encode('utf-8')
                        self.send_response(200);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
                    media_prefix = '/' + token + '/media/'
                    effect_prefix='/'+token+'/effect-audio/'
                    if self.path.startswith(media_prefix) or self.path.startswith(effect_prefix):
                        if self.path.startswith(effect_prefix):
                            try:file=audio_effects.cached(library_root,self.path[len(effect_prefix):].removesuffix('.wav'))
                            except ValueError:return self.send_error(404)
                        else:
                            parts=media_request_parts(self.path,media_prefix)
                            if not parts: return self.send_error(404)
                            if parts[0]=='project':
                                base=library_root/'projects'/parts[1]
                            else:
                                base=library_root/'shared'
                            file=(base/parts[2]).resolve()
                            if library_root not in file.parents or not file.is_file(): return self.send_error(404)
                            if file.suffix in visual_media.VIDEOS:
                                try: file,_=visual_media.resolve(library_root,{'id':file.stem,'extension':file.suffix,'scope':parts[0],'projectId':parts[1]},audio=True)
                                except (ValueError,OSError): return self.send_error(404)
                        length=file.stat().st_size; start=0; end=length-1; header=self.headers.get('Range')
                        if header:
                            match=re.fullmatch(r'bytes=(\d+)-(\d*)',header)
                            if not match:return self.send_error(416)
                            start=int(match.group(1));end=min(end,int(match.group(2))) if match.group(2) else end
                            if start>end:return self.send_error(416)
                        self.send_response(206 if header else 200)
                        self.send_header('Content-Type',{'.wav':'audio/wav','.mp3':'audio/mpeg','.ogg':'audio/ogg','.m4a':'audio/mp4'}[file.suffix.lower()])
                        self.send_header('Accept-Ranges','bytes');self.send_header('Cache-Control','no-store')
                        self.send_header('Content-Length',str(end-start+1))
                        if header:self.send_header('Content-Range',f'bytes {start}-{end}/{length}')
                        self.end_headers()
                        with file.open('rb') as f:
                            f.seek(start);remaining=end-start+1
                            while remaining:
                                chunk=f.read(min(65536,remaining))
                                if not chunk:break
                                self.wfile.write(chunk);remaining-=len(chunk)
                        return
                    prefix = '/' + token + '/ui/'
                    if not self.path.startswith(prefix): return self.send_error(404)
                    name = self.path[len(prefix):].split('?', 1)[0] or 'index.html'
                    if name not in ('story-timeline.js', 'story-editor.js', 'story-voice.js', 'notifications.js', 'export-queue.js', 'post-effects.js', 'post-effects-editor.js', 'settings-file-links.js','color-inputs.js','character-colors.js','character-color-editor.js','code-ui.js', 'composition.js', 'composition-editor.js', 'audio-effects-preview.js', 'panel-selection.js', 'project-removal.js', 'timeline-edit.js', 'timeline-groups.js', 'screen-media.js', 'screen-media-editor.js', 'render-settings.js', 'ui-transition-graph.js', 'ui-transition-engine.js', 'ui-transitions.js', 'ui-transition-editor.js', 'animation-layers.js', 'animation-layer-ui.js', 'asset-settings.js', 'scene-catalog.js', 'index.html', 'styles.css', 'desktop.css', 'controls.css', 'asset-settings.css', 'layout-responsive.css', 'task-progress.js', 'lipsync.js', 'fades.js', 'classroom-props.js', 'app.js', 'motion-names.js', 'pronunciation.js', 'layout-schema.js', 'layout.js', 'embed.js'):
                        return self.send_error(404)
                    if name=='scene-catalog.js':
                        data=('globalThis.CreatorSceneCatalog='+json.dumps(background_entries,ensure_ascii=False)+';').encode('utf8')
                    elif name=='classroom-props.js':
                        data=('globalThis.CreatorClassroomProps='+json.dumps(json.loads(catalog_file.read_text(encoding='utf8'))['items'] if generic_props else [],ensure_ascii=False)+';').encode('utf8')
                    else:
                        data=(runtime_paths.UI / name).read_bytes()
                    self.send_response(200)
                    self.send_header('Content-Type', {'html':'text/html', 'css':'text/css', 'js':'text/javascript'}[name.rsplit('.',1)[1]] + '; charset=utf-8')
                    self.send_header('Cache-Control', 'no-store')
                    self.send_header('Content-Length', str(len(data)))
                    self.end_headers(); self.wfile.write(data)
                def do_POST(self):
                    nonlocal export_job, export_dir
                    request_start = time.perf_counter()
                    message = {}
                    endpoint = self.path.removeprefix('/' + token + '/')
                    if self.path != '/' + token + '/' + endpoint or endpoint not in ('state', 'thumbnail', 'capture', 'bounds', 'shutdown', 'export-start', 'export-frame', 'export-enqueue', 'export-status', 'export-finish', 'export-cancel', 'audio-effects') or self.headers.get('Origin') != origin:
                        return self.send_error(403)
                    try:
                        message = self.read_json(2*1024*1024 if endpoint=='export-start' else 1024*1024 if endpoint in ('state','export-frame','export-enqueue') else 20000)
                        parsed_at = time.perf_counter()
                        if endpoint == 'state':
                            if export_job is not None and getattr(export_job,'queue_capacity',0):raise ValueError('状态队列导出正在使用场景')
                            # GPU lifecycle and frame mode are selected by the active job,
                            # never by a caller-supplied state packet.
                            if str(message.get('kind','')).startswith('gpu-export-') or message.get('kind')=='state-frame':raise ValueError('GPU 命令需要诊断导出入口')
                            for key in ('gpuVideo','gpuVideoFps','exportIndex','queueFrames','queueCapacity','queueSession','frameSupersampling'):message.pop(key,None)
                            profiling = message.get('profileExport') is True
                            if profiling and not (player.parent/'creator-export-profile-v1').is_file():raise ValueError('Player 不支持导出计时')
                            dedicated_effects.validate_message(message,(player.parent/'creator-dedicated-effects-v2').is_file(),(player.parent/'creator-thought-filter-v1').is_file())
                            message['token'] = token
                            message['mediaDraws'] = visual_media.resolve_draws(library_root,message.get('mediaDraws',[]))
                            data = (json.dumps(message, allow_nan=False, separators=(',', ':')) + '\n').encode()
                            prepared_at = time.perf_counter()
                            with lock:
                                locked_at = time.perf_counter()
                                conn.sendall(data)
                                reply = json.loads(stream.readline(4097))
                            if profiling:
                                reply['hostTiming'] = dict(requestBytes=getattr(self,'_request_bytes',0),parseMs=(parsed_at-request_start)*1000,prepareMs=(prepared_at-parsed_at)*1000,lockMs=(locked_at-prepared_at)*1000,unityRoundtripMs=(time.perf_counter()-locked_at)*1000)
                        elif endpoint == 'audio-effects':
                            key,_=audio_effects.prepare(library_root,message)
                            reply={'ok':True,'key':key}
                        elif endpoint == 'thumbnail':
                            if not asset_features or message.get('target') not in ('actor','scene'): raise ValueError('Thumbnail unavailable')
                            target=message['target']
                            request={'token':token,'id':message.get('id',0),'kind':'thumbnail','thumbnailTarget':target}
                            with lock:
                                conn.sendall((json.dumps(request,separators=(',', ':'))+'\n').encode())
                                reply=json.loads(stream.readline(4097))
                            if reply.get('ok'):
                                content=(Path(output)/('thumbnail-'+target+'.png')).read_bytes()
                                if len(content)>2*1024*1024: raise ValueError('Thumbnail too large')
                                reply['dataUrl']='data:image/png;base64,'+base64.b64encode(content).decode('ascii')
                        elif endpoint == 'capture':
                            width,height=message.get('width'),message.get('height')
                            if export_job is not None or type(width) is not int or type(height) is not int or not 64<=width<=1024 or not 64<=height<=1024:raise ValueError('截图尺寸无效或正在导出')
                            request={'token':token,'id':message.get('id',0),'kind':'frame','frameWidth':width,'frameHeight':height,'includeEditorGizmo':editor_gizmo,'includeUiOverlay':ui_capable}
                            with lock:
                                conn.sendall((json.dumps(request,separators=(',', ':'))+'\n').encode())
                                reply=json.loads(stream.readline(4097))
                                if reply.get('ok'):
                                    content=(Path(output)/'export-frame.png').read_bytes()
                                    if len(content)>2*1024*1024:raise ValueError('截图过大')
                                    reply['dataUrl']='data:image/png;base64,'+base64.b64encode(content).decode('ascii')
                        elif endpoint == 'export-start':
                            with lock:
                                if not export_capable or export_job is not None: raise ValueError('导出不可用或已在进行')
                                if message.get('exportMode')=='gpu' and not (player.parent/'creator-production-gpu-v1').is_file():raise ValueError('当前 Player 不支持 GPU 加速导出，请更新程序或选择兼容模式')
                                if message.get('exportSupersampling',1)!=1 and not (player.parent/'creator-antialiasing-v1').is_file():raise ValueError('当前 Player 不支持导出超采样，请更新程序')
                                if message.get('profileExport') is True and not (player.parent/'creator-export-profile-v1').is_file():raise ValueError('Player 不支持导出计时')
                                if message.get('gpuVideo') is True and not (player.parent/'creator-gpu-export-v1').is_file():raise ValueError('Player 不支持 GPU 视频诊断')
                                if message.get('mergedFrame') is True and not (player.parent/'creator-merged-export-v1').is_file():raise ValueError('Player 不支持合并帧诊断')
                                if message.get('queueCapacity',0) and not (player.parent/'creator-queued-export-v1').is_file():raise ValueError('Player 不支持状态队列诊断')
                                if message.get('fullProject') is True and not (player.parent/'creator-full-export-v1').is_file():raise ValueError('Player 不支持完整工程诊断')
                                from export_video import VideoExport
                                message['nativePostEffects'] = message.get('nativePostEffects') is True
                                if message['nativePostEffects'] and not (player.parent/'creator-post-effects-v1').is_file():raise ValueError('当前 Player 不支持画面效果')
                                message['nativeUI'] = bool(ui_graph_capable and message.get('uiTransitions') and not message['nativePostEffects'])
                                message['dialogueNameRoundCaps'] = (player.parent / 'creator-dialogue-proportional-cap-v1').is_file()
                                export_dir=tempfile.TemporaryDirectory(prefix='export-',dir=output)
                                try:
                                    export_job=VideoExport(message,library_root,export_dir.name,args.dialogue_assets if game_dialogue else None,gpu_input=Path(output)/'export-gpu.h264')
                                    if export_job.gpu_video:
                                        from export_diagnostics import validate_gpu_reply
                                        gpu_reply=gpu_export_command('gpu-export-start',frameWidth=export_job.width,frameHeight=export_job.height,gpuVideoFps=export_job.fps,queueCapacity=export_job.queue_capacity)
                                        validate_gpu_reply(gpu_reply,0,final=True)
                                except Exception as start_error:
                                    try:cancel_export()
                                    except Exception as cleanup_error:raise RuntimeError(str(start_error)+'；GPU 清理失败：'+str(cleanup_error)) from start_error
                                    raise
                                reply={'ok':True,'frames':export_job.frames,'startFrame':export_job.start_frame,'runId':export_job.run_id,'profile':export_job.profile,'gpuVideo':export_job.gpu_video,'mergedFrame':export_job.merged_frame,'queueCapacity':export_job.queue_capacity,'queueSession':export_job.queue_session}
                        elif endpoint in ('export-enqueue','export-status'):
                            with lock:
                                from export_queue import require_session,frames as queue_frames,consume
                                require_session(export_job,message)
                                def prepare_queue_frame(packet):
                                    dedicated_effects.validate_message(packet,(player.parent/'creator-dedicated-effects-v2').is_file(),(player.parent/'creator-thought-filter-v1').is_file())
                                    packet['mediaDraws']=visual_media.resolve_draws(library_root,packet.get('mediaDraws',[]))
                                packets=queue_frames(export_job,message,token,prepare_queue_frame) if endpoint=='export-enqueue' else []
                                reply=gpu_export_command('gpu-export-enqueue' if packets else 'gpu-export-status',**({'queueFrames':packets} if packets else {}))
                                consume(export_job,reply,len(packets))
                        elif endpoint == 'export-frame':
                            if export_job is not None and getattr(export_job,'queue_capacity',0):raise ValueError('请使用队列帧入口')
                            if export_job is None or message.get('index')!=export_job.count: raise ValueError('帧顺序无效')
                            request={'token':token,'id':message.get('id',0),'kind':'frame','frameWidth':export_job.width,'frameHeight':export_job.height,'captureUiLayer':export_job.native_ui,'includeUiOverlay':export_job.native_post}
                            request.update(frameSupersampling=export_job.supersampling,profileExport=export_job.profile,frameIndex=export_job.start_frame+export_job.count,runId=export_job.run_id,skipPreRender=message.get('skipPreRender') is True,gpuColor=message.get('gpuColor') is True,gpuVideo=export_job.gpu_video,exportIndex=export_job.count)
                            from export_diagnostics import merged_frame_request
                            request=merged_frame_request(message.get('state'),request,export_job.merged_frame)
                            if export_job.merged_frame:
                                dedicated_effects.validate_message(request,(player.parent/'creator-dedicated-effects-v2').is_file(),(player.parent/'creator-thought-filter-v1').is_file())
                                request['mediaDraws']=visual_media.resolve_draws(library_root,request.get('mediaDraws',[]))
                            prepared_at = time.perf_counter()
                            with lock:
                                locked_at = time.perf_counter()
                                conn.sendall((json.dumps(request,allow_nan=False,separators=(',', ':'))+'\n').encode())
                                reply=json.loads(stream.readline(4097))
                                captured_at = time.perf_counter()
                                if export_job.gpu_video:
                                    export_job.write_gpu(reply)
                                    if export_job.profile:reply['hostTiming']=dict(lockMs=(locked_at-prepared_at)*1000,unityRoundtripMs=(captured_at-locked_at)*1000,fileReadMs=0,pipeWriteMs=0,frameBytes=0,uiBytes=0)
                                elif reply.get('ok'):
                                    image=(Path(output)/'export-frame.png').read_bytes()
                                    ui_image=(Path(output)/'export-ui.png').read_bytes() if export_job.native_ui else None
                                    read_at=time.perf_counter()
                                    export_job.write(image,ui_image)
                                    if export_job.profile:
                                        reply['hostTiming']=dict(lockMs=(locked_at-prepared_at)*1000,unityRoundtripMs=(captured_at-locked_at)*1000,fileReadMs=(read_at-captured_at)*1000,pipeWriteMs=export_job.last_write_ms,frameBytes=len(image),uiBytes=len(ui_image) if ui_image is not None else 0)
                                    # Diagnostic samples retain only three lossless references, never all frames.
                                    if message.get('referenceFrame') is True and export_job.new_only and export_job.frames<=300:
                                        reference=export_job.output.with_suffix('.frame-'+str(request['frameIndex'])+'.png')
                                        with reference.open('xb') as reference_file:reference_file.write(image)
                                        reply['referenceFrame']=str(reference)
                                    if message.get('frameDigest') is True and export_job.frames<=300:
                                        reply['pngSha256']=hashlib.sha256(image).hexdigest()
                        elif endpoint == 'export-finish':
                            with lock:
                                if export_job is None: raise ValueError('没有进行中的导出')
                                if export_job.queue_capacity:
                                    from export_queue import require_session
                                    require_session(export_job,message)
                                    if export_job.count!=export_job.frames:raise ValueError('导出队列尚未完成')
                                reply={'ok':True}
                                if export_job.gpu_video:
                                    reply=gpu_export_command('gpu-export-finish',exportIndex=export_job.frames)
                                    export_job.complete_gpu(reply)
                                export_job.finish();export_job=None;export_dir.cleanup();export_dir=None
                        elif endpoint == 'export-cancel':
                            with lock:
                                if export_job is not None and getattr(export_job,'queue_capacity',0):
                                    from export_queue import require_session
                                    require_session(export_job,message)
                                cancel_export(message.get('queueSession') or None)
                                reply={'ok':True}
                        elif endpoint == 'bounds':
                            if embedded is None: raise ValueError('No embedded Player')
                            if not isinstance(message.get('visible'), bool) or any(type(message.get(k)) is not int or abs(message[k]) > 16384 for k in ('x', 'y', 'width', 'height')) or message['width'] < 1 or message['height'] < 1:
                                raise ValueError('Invalid preview bounds')
                            if any(k in message and (type(message[k]) is not int or abs(message[k])>512) for k in ('insetX','insetY')): raise ValueError('Invalid content inset')
                            embedded.position(message)
                            reply = {'ok': True}
                        else:
                            reply = {'ok': True}
                            stopping.set()
                            threading.Thread(target=server.shutdown, daemon=True).start()
                        self.send_json(reply)
                    except Exception as e:
                        # All POST endpoints are JSON APIs. Preserve the actual
                        # failure instead of hiding it behind an HTML parse error.
                        error=str(e)
                        if export_job is not None and export_job.gpu_video and endpoint in ('state','export-frame','export-enqueue','export-status','export-finish') and (not getattr(export_job,'queue_capacity',0) or message.get('queueSession')==export_job.queue_session):
                            try:cancel_export(message.get('queueSession') or None)
                            except Exception as cleanup_error:error+='；GPU 清理失败：'+str(cleanup_error)
                        self.send_json({'ok':False,'error':error},502)
            server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
            origin = 'http://127.0.0.1:' + str(server.server_port)
            url = origin + '/' + token + '/ui/?' + ('embedded=1&' if embedded else '') + ('performance=1' if performance else 'performance=0') + ('&settings=1' if global_settings else '&settings=0') + ('&assets=1' if asset_features else '&assets=0') + ('&costumes=1' if costume_capable else '&costumes=0') + ('&costumePhysics=1' if (player.parent/'creator-costume-physics-v1').is_file() else '&costumePhysics=0') + ('&hairPhysics=1' if (player.parent/'creator-hair-physics-v1').is_file() else '&hairPhysics=0') + ('&arrangement=1' if arrangement else '&arrangement=0') + ('&editorGizmo=1' if editor_gizmo else '&editorGizmo=0') + ('&gizmoTrs=1' if gizmo_trs else '&gizmoTrs=0') + ('&editorGizmoTest=1' if editor_gizmo and os.environ.get('CREATOR_TEST_INSTANCE')=='1' and os.environ.get('CREATOR_GIZMO_TEST')=='1' else '&editorGizmoTest=0') + ('&dialogueStyles=1' if dialogue_styles else '&dialogueStyles=0') + ('&gameDialogue=1' if game_dialogue else '&gameDialogue=0') + ('&dialogueColors=1' if (player.parent/'creator-dialogue-colors-v1').is_file() else '&dialogueColors=0') + ('&faces=1' if faces else '&faces=0') + ('&faceDecals=1' if face_decals else '&faceDecals=0') + ('&roundEyes=1' if round_eyes else '&roundEyes=0') + ('&headEffects=1' if head_effects else '&headEffects=0') + ('&eyeMaterials=1' if eye_materials else '&eyeMaterials=0') + ('&eyeBones=1' if eye_bones else '&eyeBones=0') + ('&export=1' if export_capable else '&export=0') + ('&idle=1' if idle_capable else '&idle=0') + ('&motionBlend=1' if blend_capable else '&motionBlend=0') + ('&uiTransitions=2' if ui_graph_capable else '&uiTransitions=1' if ui_capable else '&uiTransitions=0') + ('&animationLayers=1' if layers_capable else '&animationLayers=0') + ('&classroomChairs=1' if prop_capable else '&classroomChairs=0') + ('&classroomProps=1' if generic_props else '&classroomProps=0') + ('&renderSettings=1' if (player.parent/'creator-render-settings-v1').is_file() else '&renderSettings=0') + ('&screenMedia=1' if (player.parent/'creator-screen-media-v1').is_file() else '&screenMedia=0') + ('&postEffects=1' if (player.parent/'creator-post-effects-v1').is_file() else '&postEffects=0') + ('&composition=1' if (player.parent/'creator-composition-v1').is_file() else '&composition=0') + ('&codeUI=1' if (player.parent/'creator-code-ui-v1').is_file() else '&codeUI=0') + '&actors=' + ','.join(actor_codes) + '&missingShapes=' + quote(','.join(missing_shapes),safe=',:') + '&faceNames=' + quote(','.join(face_names), safe=',') + '&scenes=' + ','.join(available_scenes) + '&motions=' + ','.join(available_motions)
            print('Editor:', url, flush=True)
            print('Embedded Player ready.' if embedded else 'Player preview opens in a separate window. Close this host to stop the session.', flush=True)
            if not args.no_browser: webbrowser.open(url)
            def monitor_player():
                code = proc.wait()
                if not stopping.is_set():
                    print(f'Unity Player exited unexpectedly ({code})', file=sys.stderr, flush=True)
                    server.shutdown()
            threading.Thread(target=monitor_player, daemon=True).start()
            try: server.serve_forever()
            except KeyboardInterrupt: pass
            finally:
                try:cancel_export()
                finally:server.server_close(); stream.close(); conn.close()
        finally:
            listener.close()
            if proc.poll() is None:
                proc.terminate()
                try: proc.wait(timeout=10)
                except subprocess.TimeoutExpired: proc.kill(); proc.wait()

if __name__ == '__main__':
    main()




