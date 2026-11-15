"""Extract costume and hair solver inputs from this batch, never research samples."""
import hashlib
import json
import shutil
import uuid
from pathlib import Path


def prepare(root):
    from resource_catalog import require_catalog
    root = require_catalog(root)
    target = root / 'player-view/physics-v1'
    fingerprint = hashlib.sha256((root / 'bundles.jsonl').read_bytes()).hexdigest()
    if target.exists():
        report = json.loads((target / 'report.json').read_text('utf8'))
        if report.get('version') != 1 or report.get('fingerprint') != fingerprint:
            raise ValueError('物理缓存不匹配，请重新准备资源')
        for item in report['items']:
            file = (target / item['file']).resolve()
            if target not in file.parents or not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest() != item['sha256']:
                raise ValueError('物理缓存文件缺失或已变化：' + item['name'])
        return target
    import costume_catalog
    from prepare_costume_swing import extract
    rows = [json.loads(s) for s in (root / 'bundles.jsonl').read_text('utf8').splitlines() if s.strip()]
    sources = []
    for row in costume_catalog.load(root):
        if row['bodyAvailable'] and row['dependenciesAvailable']:
            sources.append(('costumes', row['name'], row['dependencyBundles']))
    for row in rows:
        if row['name'].startswith('mdl_chr_') and row['name'].endswith('_hair') and row.get('file') and not row.get('error'):
            sources.append(('hair', row['name'], []))
    staging = target.with_name('.physics-' + uuid.uuid4().hex)
    staging.mkdir()
    items = []
    try:
        for folder in ('costumes', 'hair'):
            (staging / folder).mkdir()
        for folder, name, deps in sources:
            def bundle(n):
                p = (root / 'bundles' / (n + '.bundle')).resolve(strict=True)
                if p.parent != (root / 'bundles').resolve():
                    raise ValueError('物理资源路径越界')
                return p
            source = bundle(name)
            data = extract(source, name, [bundle(n) for n in deps])
            raw = json.dumps(data, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode('utf8')
            relative = folder + '/' + name + '.json'
            (staging / relative).write_bytes(raw)
            items.append(dict(name=name, file=relative, sha256=hashlib.sha256(raw).hexdigest(), sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest()))
        report = dict(version=1, fingerprint=fingerprint, items=items)
        (staging / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), 'utf8')
        staging.rename(target)
    finally:
        if staging.exists() and staging.parent == target.parent and staging.name.startswith('.physics-'):
            shutil.rmtree(staging)
    return target


if __name__ == '__main__':
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument('--root', type=Path, required=True)
    print(prepare(p.parse_args().root))
