"""Extract candidate 2D scene textures from an already prepared local catalog.

This produces research data, not a Player-compatible scene. A scene is only
classified as a candidate when its bundle contains exactly one texture.
"""
import argparse
import json
import re
import shutil
import sys
import warnings
from pathlib import Path

pass # dependencies installed in the Python environment
import UnityPy

UnityPy.config.FALLBACK_UNITY_VERSION = '6000.0.77f1'
warnings.filterwarnings('ignore', category=UnityPy.exceptions.UnityVersionFallbackWarning)
SAFE = re.compile(r'env_2d_[A-Za-z0-9_-]+\Z')


def prepare(root, output, names=None, reserve_gib=40):
    root = Path(root).resolve(strict=True)
    output = Path(output).resolve()
    if output == root or output in root.parents or (root in output.parents and output != root / 'player-view' / 'backgrounds'):
        raise ValueError('output must be separate from the source catalog')
    rows = [json.loads(line) for line in (root / 'bundles.jsonl').read_text(encoding='utf8').splitlines() if line.strip()]
    selected = [r for r in rows if SAFE.fullmatch(r.get('name', '')) and (names is None or r['name'] in names)]
    if names is not None and set(names) != {r['name'] for r in selected}:
        raise ValueError('requested 2D scene not present in catalog')
    if len({r['name'] for r in selected}) != len(selected):
        raise ValueError('duplicate 2D scene name')
    output.mkdir(parents=True, exist_ok=False)
    entries, issues = [], []
    for row in selected:
        name = row['name']
        try:
            if row.get('error') or row.get('inspectionError'):
                raise ValueError('source bundle failed extraction or inspection')
            if row.get('file') != 'bundles/' + name + '.bundle':
                raise ValueError('unexpected bundle path')
            raw = root / row['file']
            if raw.is_symlink() or raw.resolve(strict=True).parent != (root / 'bundles').resolve(strict=True):
                raise ValueError('invalid source path')
            env = UnityPy.load(str(raw))
            raw_images = []
            for obj in env.objects:
                if obj.type.name == 'MonoBehaviour':
                    data = obj.read_typetree()
                    if 'm_Texture' in data and 'm_UVRect' in data and data.get('m_Enabled'):
                        raw_images.append(data)
            if len(raw_images) != 1:
                raise ValueError(f'unsupported RawImage count: {len(raw_images)}')
            raw_image = raw_images[0]
            pointer = raw_image['m_Texture']
            if pointer['m_FileID'] != 0 or not pointer['m_PathID']:
                raise ValueError('background texture missing or external')
            if raw_image['m_UVRect'] != dict(x=0.0, y=0.0, width=1.0, height=1.0):
                raise ValueError('unsupported texture UV crop')
            if any(raw_image['m_Color'][x] != 1 for x in 'rgba'):
                raise ValueError('unsupported background tint')
            texture = next(o.read() for o in env.objects if o.path_id == pointer['m_PathID'] and o.type.name == 'Texture2D')
            if shutil.disk_usage(output).free - texture.m_Width * texture.m_Height * 4 < reserve_gib * 1024**3:
                raise ValueError('insufficient disk space after reserve')
            filename = name + '.png'
            texture.image.save(output / filename)
            entries.append({'id': 'scene-2d-' + name, 'sceneId': '2d-' + name, 'source': name, 'texture': texture.m_Name,
                            'file': filename, 'width': texture.m_Width, 'height': texture.m_Height})
        except Exception as exc:
            issues.append({'source': name, 'error': str(exc)[:300]})
    report = {'version': 1, 'note': 'Original RawImage texture; creator uses fixed background with aspect-fill cropping, not original scene layout.',
              'requested': len(selected), 'entries': entries, 'issues': issues}
    (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--catalog-root', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--name', action='append')
    args = parser.parse_args()
    result = prepare(args.catalog_root, args.output_dir, args.name)
    print(json.dumps({'requested': result['requested'], 'prepared': len(result['entries']),
                      'issues': result['issues']}, ensure_ascii=False))
