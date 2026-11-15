"""Rebuild selected transition fields from MD5-verified local game packages.

No historical research outputs are inputs. Unknown packages remain in the report.
"""
import argparse, collections, json, sys, uuid
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'importer'))
from prepare_film_assets import UnityPy, select_source, transform

REVISION = 1
NAME = 'ttn_adv_transition_change_l'

def objects(raw):
    result = []
    for o in UnityPy.load(raw).objects:
        if o.type.name not in ('MonoBehaviour', 'GameObject', 'RectTransform', 'PlayableDirector', 'CanvasGroup'):
            continue
        t = o.read_typetree()
        script = o.read().m_Script.read().m_ClassName if o.type.name == 'MonoBehaviour' else ''
        result.append(dict(id=o.path_id, type=o.type.name, script=script, data=t))
    return result

def strips(data):
    by = {o['id']: o for o in data}
    director = next(o['data'] for o in data if o['type'] == 'PlayableDirector' and o['data']['m_PlayableAsset']['m_PathID'])
    bindings = {b['key']['m_PathID']: b['value']['m_PathID'] for b in director['m_SceneBindings']}
    found = {}; colors = []
    for o in data:
        t = o['data']
        if o['script'] != 'LocalPositionTrack' or not t['m_Clips']: continue
        rect = by.get(bindings.get(o['id']), {}).get('data', {})
        if rect.get('m_SizeDelta', {}).get('x') != 5000: continue
        phase = by.get(t['m_Parent']['m_PathID'], {}).get('data', {}).get('m_Name')
        if phase not in ('In', 'Out'): continue
        if len(t['m_Clips']) != 1: raise ValueError('Unexpected strip clip count')
        c = t['m_Clips'][0]; clip = by[c['m_Asset']['m_PathID']]['data']
        entry = found.setdefault(bindings[o['id']], dict(anchorMin=rect['m_AnchorMin']['y'], anchorMax=rect['m_AnchorMax']['y'], width=rect['m_SizeDelta']['x']))
        initial = t['_initialParameter']; end = clip['_endParameter']
        ease = clip['_easeInfo']['_easeId']
        if ease not in ('OutCubic', 'InOutCubic') or not end['_isRelative'] or c['m_Duration'] <= 0:
            raise ValueError('Unsupported strip parameter')
        entry[phase.lower()+'Track'] = dict(start=c['m_Start'], duration=c['m_Duration'], ease=ease, initial=initial['_value']['x'], delta=end['_value']['x'])
        go = by[rect['m_GameObject']['m_PathID']]['data']
        images = [by.get(x['component']['m_PathID'], {}) for x in go['m_Component']]
        col = next(x['data']['m_Color'] for x in images if x.get('script') == 'Image')
        colors.append([col[k] for k in 'rgba'])
    ordered = sorted(found.values(), key=lambda x: x['anchorMin'], reverse=True)
    if len(ordered) != 6 or any('inTrack' not in x or 'outTrack' not in x for x in ordered) or any(c != colors[0] for c in colors):
        raise ValueError('Unexpected six-strip layout')
    return dict(id='ui-transition-change-l-v1', type='UI', alias='六条带场景切换', source=NAME, kind='transition', renderer='six-strips-v1', referenceWidth=1920, strips=ordered, color=colors[0], inDuration=max(x['inTrack']['start']+x['inTrack']['duration'] for x in ordered), outDuration=max(x['outTrack']['start']+x['outTrack']['duration'] for x in ordered), hold=.3, soundSource='sud_se_adv_transition-change-01', reconstruction=True)

def prepare(root):
    root = Path(root).resolve(strict=True)
    scan = json.loads((root.parent/'inventory.json').read_text(encoding='utf8'))
    game = Path(scan['game']).resolve()
    if root == game or game in root.parents: raise ValueError('Game directory is read-only')
    dest = root/'player-view'/'ui-transitions-v1'
    if (dest/'catalog.json').is_file():
        existing = json.loads((dest/'catalog.json').read_text(encoding='utf8'))
        if existing.get('revision') == REVISION and existing.get('manifest') == scan['manifest_sha256']: return existing
        raise ValueError('Transition cache version mismatch; prepare a new batch')
    rows = [r for r in scan['records'] if r['kind']=='asset' and r['name'].startswith('ttn_adv_transition_')]
    report = dict(revision=REVISION, manifest=scan['manifest_sha256'], entries=[], packages=[], issues=[])
    for row in rows:
        item = dict(source=row['name'], md5=row['md5'], supported=False)
        try:
            raw, _ = select_source(row)
            if not raw.startswith(b'UnityFS\0'): raw = transform(raw, row['name'])
            if not raw.startswith(b'UnityFS\0'): raise ValueError('Not a Unity bundle')
            data = objects(bytes(raw))
            item['scripts'] = dict(collections.Counter(o['script'] for o in data if o['script']))
            if row['name'] == NAME:
                report['entries'].append(strips(data)); item['supported'] = True
            else: item['reason'] = '图集（共用素材）' if row['name'].endswith('_atlas') else '已读取；此类 Titan 轨道尚未重建'
        except Exception as e:
            item['error'] = str(e); report['issues'].append(dict(source=row['name'], error=str(e)))
        report['packages'].append(item)
    if not any(r['name']==NAME for r in rows): report['issues'].append(dict(source=NAME,error='本地清单缺失'))
    # Inherit the user's cache ACL instead of publishing tempfile's private ACL.
    temp = dest.with_name(dest.name+'.preparing-'+uuid.uuid4().hex); temp.mkdir(parents=True)
    (temp/'catalog.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    temp.rename(dest)
    return report

if __name__ == '__main__':
    p=argparse.ArgumentParser(); p.add_argument('--root',type=Path,required=True)
    result=prepare(p.parse_args().root)
    print(json.dumps(dict(packages=len(result['packages']), supported=len(result['entries']), issues=result['issues']),ensure_ascii=False))
