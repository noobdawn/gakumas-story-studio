"""Prepare per-actor swing inputs from the currently managed extraction batch."""
import hashlib
import json
import re
import shutil
import uuid
from pathlib import Path


def _validate(target, fingerprint, expected=None):
    report = json.loads((target / 'report.json').read_text('utf8'))
    if report.get('version') != 1 or report.get('fingerprint') != fingerprint:
        raise ValueError('物理缓存不匹配，请重新准备资源')
    items = report['items']
    if expected is not None and {i['file'] for i in items} != expected:
        raise ValueError('脸部碰撞缓存与本批次的资源清单不匹配')
    for item in items:
        file = (target / item['file']).resolve()
        if target not in file.parents or not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest() != item['sha256']:
            raise ValueError('物理缓存文件缺失或已变化：' + item['name'])


def _write_group(root, target, fingerprint, sources, folders):
    from prepare_costume_swing import extract

    def bundle(name):
        p = (root / 'bundles' / (name + '.bundle')).resolve(strict=True)
        if p.parent != (root / 'bundles').resolve():
            raise ValueError('物理资源路径越界')
        return p

    staging = target.with_name('.physics-' + uuid.uuid4().hex)
    staging.mkdir()
    try:
        for folder in folders:
            (staging / folder).mkdir()
        items = []
        for folder, name, deps in sources:
            source = bundle(name)
            data = extract(source, name, [bundle(n) for n in deps])
            raw = json.dumps(data, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode('utf8')
            relative = (Path(folder) / (name + '.json')).as_posix()
            (staging / relative).write_bytes(raw)
            items.append(dict(name=name, file=relative, sha256=hashlib.sha256(raw).hexdigest(),
                              sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest()))
        report = dict(version=1, fingerprint=fingerprint, items=items)
        (staging / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), 'utf8')
        try:
            staging.rename(target)
        except OSError:
            if not target.is_dir():
                raise
            _validate(target, fingerprint, {item['file'] for item in items})
    finally:
        if staging.exists():
            shutil.rmtree(staging)


def prepare(root):
    from resource_catalog import require_catalog
    root = require_catalog(root)
    target = root / 'player-view/physics-v1'
    index = (root / 'bundles.jsonl').read_bytes()
    fingerprint = hashlib.sha256(index).hexdigest()
    rows = [json.loads(line) for line in index.splitlines() if line.strip()]
    available = [row['name'] for row in rows if row.get('file') and not row.get('error')]
    if target.exists():
        _validate(target, fingerprint)
    else:
        import costume_catalog
        sources = [('costumes', row['name'], row['dependencyBundles']) for row in costume_catalog.load(root)
                   if row['bodyAvailable'] and row['dependenciesAvailable']]
        sources.extend(('hair', name, []) for name in available if name.startswith('mdl_chr_') and name.endswith('_hair'))
        _write_group(root, target, fingerprint, sources, ['costumes', 'hair'])

    # Faces live in separate bundles. Add them atomically to already initialized batches as well.
    faces = sorted(name for name in available if re.fullmatch(r'mdl_chr_[a-z0-9]+-base-0000_face', name))
    face_target = target / 'faces-v1'
    if face_target.exists():
        _validate(face_target, fingerprint, {name + '.json' for name in faces})
    else:
        _write_group(root, face_target, fingerprint, [('', name, []) for name in faces], [])
    return target


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    print(prepare(parser.parse_args().root))
