"""Extract source swing metadata for local costume bodies without opening Unity.

The output is a new research directory; these fields are source data, not a
claim that the existing approximation supports every bone or costume.
"""
import argparse
import collections
import hashlib
import json
import sys
import warnings
from pathlib import Path

import costume_catalog

HERE = Path(__file__).resolve().parent
pass # dependencies installed in the Python environment
import UnityPy
from UnityPy.classes.PPtr import PPtr
warnings.filterwarnings('ignore', category=UnityPy.exceptions.UnityVersionFallbackWarning)
UnityPy.config.FALLBACK_UNITY_VERSION = '6000.0.77f1'

def components(bundle, dependencies):
    env = UnityPy.load(*(str(p) for p in dependencies))
    primary = env.load_file(str(bundle))
    def objects(file):
        if getattr(file, 'objects', None):
            yield from file.objects.values()
        else:
            for child in getattr(file, 'files', {}).values():
                yield from objects(child)
    for obj in objects(primary):
        if obj.type.name != 'MonoBehaviour':
            continue
        item = obj.read()
        if not item.m_Script:
            continue
        kind = item.m_Script.read().m_ClassName
        yield kind, item, obj


def extract(bundle, name, dependencies=()):
    dynamic, static = [], []
    for kind, item, obj in components(bundle, dependencies):
        if kind not in ('ActorSwingDynamicBone', 'ActorSwingStaticBone'):
            continue
        tree = obj.read_typetree(); bone = item.m_GameObject.read().m_Name
        if kind == 'ActorSwingDynamicBone':
            collider = tree['dynamicCollider']; ref = tree['modelingTransform']
            dynamic.append(dict(name=bone, colliderType=collider['type'], collisionMask=collider['collisionMask'],
                                radiusA=collider['float_A'], radiusB=collider['float_B'], damping=tree['damping'],
                                stiffness=tree['stiffness'], spring=tree['spring'], pendulum=tree['pendulum'], mass=tree['mass'],
                                referencePosition=ref['localPosition'], referenceRotation=ref['localRotation']['value']))
        else:
            collider = tree['staticCollider']
            static.append(dict(name=bone, type=collider['type'], collisionMask=collider['collisionMask'],
                               vectorA=collider['vector3_A'], vectorB=collider['vector3_B'],
                               radiusA=collider['float_A'], radiusB=collider['float_B']))
    return {'source': name, 'dynamic': dynamic, 'static': static}


def extract_authored(bundle, name, dependencies=()):
    drivers, layers, limits = [], [], []
    prefix = 'ActorAnimationQuartzDriver'
    supported = {'SkirtBone', 'HairBone', 'RotationBone', 'HumanoidUpLegBone', 'HumanoidHandBone', 'HumanoidArmBone'}
    for kind, item, obj in components(bundle, dependencies):
        if kind not in ('ActorSwingChain', 'ActorSwingDynamicBone') and kind.removeprefix(prefix) not in supported:
            continue
        data = obj.read_typetree()
        if not data['m_Enabled']:
            continue
        owner = item.m_GameObject.read().m_Name

        def bone_name(ref):
            if not ref['m_PathID']:
                return ''
            value = PPtr(assetsfile=obj.assets_file, **ref).read()
            return (value.m_GameObject.read() if hasattr(value, 'm_GameObject') else value).m_Name

        if kind == 'ActorSwingChain':
            for layer in data['chains']['layers']:
                if layer['active']:
                    layers.append(dict(bones=[bone_name(ref) for ref in layer['bones']], around=bool(layer['around']),
                                       radius=layer['radius'], smoothing=layer['smoothing']))
        elif kind == 'ActorSwingDynamicBone':
            limit = data['limitInfo']
            if limit['useLimit']:
                limits.append(dict(bone=owner, minimum={c: limit['axis' + c.upper()]['x'] for c in 'xyz'},
                                   maximum={c: limit['axis' + c.upper()]['y'] for c in 'xyz'}))
        else:
            setting = data['setting'].copy()
            for key in ('referenceBone', 'referenceHeadBone', 'referenceNeckBone'):
                if key in setting:
                    setting[key] = bone_name(setting[key])
            if kind.startswith(prefix + 'Humanoid'):
                setting['twistCoefficient'] = setting.pop('coefficient')
            drivers.append(dict(kind=kind[len(prefix):], bone=owner, **setting))
    return dict(source=name, drivers=drivers, layers=layers, limits=limits)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True, type=Path)
    parser.add_argument('--output-dir', required=True, type=Path)
    parser.add_argument('--limit', type=int, default=0)
    args = parser.parse_args()
    root = args.root.resolve(strict=True); out = args.output_dir.resolve()
    if not out.is_relative_to(HERE) or out == HERE or out.is_relative_to(root):
        raise ValueError('output must be a new directory in creator-prototype outside the source')
    if args.limit < 0:
        raise ValueError('invalid limit')
    rows = costume_catalog.load(root)
    out.mkdir(parents=False, exist_ok=False)
    meta = out / 'metadata'; meta.mkdir()
    results, errors, hashes = [], [], {}
    def sha256(path):
        if path not in hashes:
            digest=hashlib.sha256()
            with path.open('rb') as file:
                for block in iter(lambda: file.read(1024 * 1024), b''):
                    digest.update(block)
            hashes[path]=digest.hexdigest()
        return hashes[path]
    for row in rows[:args.limit or None]:
        name = row['name']
        try:
            if not row['bodyAvailable']:
                raise ValueError('body bundle unavailable')
            bundle = (root / 'bundles' / (name + '.bundle')).resolve(strict=True)
            if not bundle.is_relative_to(root / 'bundles'):
                raise ValueError('bundle outside source')
            dependencies = []
            if row['dependenciesAvailable']:
                for dependency in row['dependencyBundles']:
                    resolved = (root / 'bundles' / (dependency + '.bundle')).resolve(strict=True)
                    if not resolved.is_relative_to(root / 'bundles'):
                        raise ValueError('dependency outside source')
                    dependencies.append(resolved)
            data = extract(bundle, name, dependencies)
            target=meta / (name + '.json')
            with target.open('x', encoding='utf-8') as file:
                json.dump(data, file, ensure_ascii=False, allow_nan=False, separators=(',', ':'))
            names = [x['name'] for x in data['dynamic']]
            dynamic_duplicates = sorted(n for n, count in collections.Counter(names).items() if count > 1)
            static_duplicates = sorted(n for n, count in collections.Counter(x['name'] for x in data['static']).items() if count > 1)
            categories = collections.Counter('jacket_skirt' if 'Jacket' in n or 'Skirt' in n else 'other' for n in names)
            results.append({'name': name, 'character': row['character'], 'knownCharacter': row['knownCharacter'],
                            'dynamic': len(data['dynamic']), 'static': len(data['static']),
                            'jacketSkirtBones': categories['jacket_skirt'], 'otherDynamicBones': categories['other'],
                            'duplicateDynamicNames': dynamic_duplicates, 'duplicateStaticNames': static_duplicates,
                            'sourceSha256':sha256(bundle), 'metadataSha256':sha256(target),
                            'dependencies':[{'name':p.stem,'sha256':sha256(p)} for p in dependencies]})
        except Exception as error:
            errors.append({'name': name, 'error': type(error).__name__ + ': ' + str(error)[:300]})
        if (len(results) + len(errors)) % 50 == 0:
            print('processed', len(results) + len(errors), '/', min(len(rows), args.limit or len(rows)), flush=True)
    report = {'catalog': len(rows), 'processed': len(results), 'errors': errors,
              'withDynamic': sum(x['dynamic'] > 0 for x in results),
              'withOtherDynamic': sum(x['otherDynamicBones'] > 0 for x in results),
              'withDuplicateDynamicNames': sum(bool(x['duplicateDynamicNames']) for x in results),
              'withDuplicateStaticNames': sum(bool(x['duplicateStaticNames']) for x in results), 'items': results}
    with (out / 'report.json').open('x', encoding='utf-8') as file:
        json.dump(report, file, ensure_ascii=False, indent=2, allow_nan=False)
    print(json.dumps({k: v for k, v in report.items() if k != 'items'}, ensure_ascii=False), flush=True)
    if errors:
        raise SystemExit(1)

if __name__ == '__main__':
    main()
