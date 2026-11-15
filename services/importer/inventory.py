"""Read-only manifest/cache inventory; never writes inside the game directory."""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys

pass # dependencies installed in the Python environment
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

def varint(data, pos):
    value = shift = 0
    while True:
        if pos >= len(data): raise ValueError('truncated varint')
        b = data[pos]; pos += 1
        value |= (b & 127) << shift
        if b < 128: return value, pos
        shift += 7
        if shift > 70: raise ValueError('invalid varint')

def fields(data):
    pos = 0
    while pos < len(data):
        tag, pos = varint(data, pos); number, wire = tag >> 3, tag & 7
        if not number: raise ValueError('invalid field number')
        if wire == 0: value, pos = varint(data, pos)
        elif wire == 2:
            n, pos = varint(data, pos)
            if pos + n > len(data): raise ValueError('truncated field')
            value = data[pos:pos+n]; pos += n
        elif wire in (1, 5):
            n = 8 if wire == 1 else 4
            if pos+n > len(data): raise ValueError('truncated fixed field')
            value = data[pos:pos+n]; pos += n
        else: raise ValueError(f'unsupported wire type {wire}')
        yield number, wire, value

def parse_record(data):
    result = {'dependencies': []}
    for n, wire, value in fields(data):
        if n == 1 and wire == 0: result['id'] = value
        elif n in (2, 3, 10, 11) and wire == 2:
            result[{2:'filepath',3:'name',10:'md5',11:'objectName'}[n]] = value.decode('utf-8', errors='replace')
        elif n == 8:
            if wire == 0: result['dependencies'].append(value)
            elif wire == 2:
                p = 0
                while p < len(value):
                    v, p = varint(value, p); result['dependencies'].append(v)
    return result

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--game', required=True, type=Path)
    ap.add_argument('--out', required=True, type=Path)
    args = ap.parse_args()
    game = args.game.resolve(); out = args.out.resolve()
    if out == game or game in out.parents: ap.error('output must not be inside game directory')
    if out.exists(): ap.error('output already exists; choose a new filename')
    manifests = list((game / 'octo/pdb').rglob('octocacheevai'))
    if len(manifests) != 1: raise RuntimeError(f'expected exactly one manifest, found {len(manifests)}')
    manifest = manifests[0]; raw = manifest.read_bytes()
    key = hashlib.md5(b'1nuv9td1bw1udefk').digest(); iv = hashlib.md5(b'LvAUtf+tnz').digest()
    dec = Cipher(algorithms.AES(key), modes.CBC(iv)).decryptor()
    plain = dec.update(raw[1:]) + dec.finalize(); pad = plain[-1]
    if not 1 <= pad <= 16 or plain[-pad:] != bytes([pad])*pad: raise ValueError('invalid padding')
    plain = plain[:-pad]
    if plain[:16] != hashlib.md5(plain[16:]).digest(): raise ValueError('manifest checksum mismatch')
    sources = defaultdict(list)
    for base, kind in [(game/'octo/v1','cache'), (game/'gakumas_Data/Octo','builtin')]:
        for p in base.rglob('*'):
            if p.is_file() and p.name != '.meta': sources[(kind,p.name)].append(str(p))
    records = []
    for n, wire, val in fields(plain[16:]):
        if n not in (2,4) or wire != 2: continue
        obj = parse_record(val); obj['kind'] = 'asset' if n == 2 else 'resource'
        paths = sources.get(('cache',obj.get('md5','')), [])
        if not paths and 'id' in obj:
            k = (('A' if n == 2 else 'R') + str(obj['id'])).encode('ascii').hex().upper()
            paths = sources.get(('builtin',k), [])
        obj['local_candidates'] = paths
        records.append(obj)
    counts = defaultdict(Counter)
    for x in records:
        name = x.get('name',''); prefix = name.split('_',1)[0] or '(empty)'
        group = x['kind'] + ':' + prefix
        counts[group]['total'] += 1
        counts[group]['matched'] += bool(x['local_candidates'])
        counts[group]['ambiguous'] += len(x['local_candidates']) > 1
    result = {'scan_utc': datetime.now(timezone.utc).isoformat(), 'game': str(game),
              'manifest': str(manifest), 'manifest_sha256': hashlib.sha256(raw).hexdigest(),
              'manifest_checksum': 'valid', 'records': records, 'counts': dict(counts)}
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open('x', encoding='utf-8') as f: json.dump(result, f, ensure_ascii=False, indent=2)
    print('manifest', manifest, 'records', len(records), 'matched',sum(bool(x['local_candidates']) for x in records))
    for group, c in sorted(counts.items()): print(group, dict(c))
    print('output',out)

if __name__ == '__main__': main()
