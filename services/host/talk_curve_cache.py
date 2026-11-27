"""Extract dialogue mouth curves from the game installation recorded by this batch."""
import json
import math
import re
import struct
import uuid
from pathlib import Path


def decode(raw):
    offset = 28  # Unity MonoBehaviour header before m_Name.

    def read(fmt):
        nonlocal offset
        values = struct.unpack_from('<' + fmt, raw, offset)
        offset += struct.calcsize('<' + fmt)
        return values[0] if len(values) == 1 else values

    def count(limit):
        n = read('i')
        if not 0 <= n <= limit:
            raise ValueError('说话曲线数组长度无效')
        return n

    def string():
        nonlocal offset
        n = count(1024)
        value = raw[offset:offset+n].decode('utf8')
        offset = (offset + n + 3) & ~3
        return value

    if string() != 'VLActorTalkData':
        raise ValueError('说话曲线对象名称不匹配')
    profiles = []
    curve_count = key_count = 0
    for _ in range(count(256)):
        curves = []
        for _ in range(count(64)):
            index = read('i')
            keys = []
            for _ in range(count(1024)):
                t, value, incoming, outgoing, weighted, _, _ = read('4fi2f')
                if (weighted or not all(map(math.isfinite, (t, value, incoming, outgoing)))
                        or t < 0 or (keys and t <= keys[-1][0])):
                    raise ValueError('未知的说话曲线关键帧格式')
                keys.append([t, value, incoming, outgoing])
            read('3i')  # Pre/post infinity and rotation order of AnimationCurve.
            if len(keys) < 2 or keys[0][0] != 0:
                raise ValueError('说话曲线缺少首尾关键帧')
            curve_count += 1
            key_count += len(keys)
            curves.append(dict(index=index, keys=keys))
        string()  # Editor preview label.
        ignore_voice = read('I')
        blends = [(string(), read('f')) for _ in range(count(64))]
        if ignore_voice not in (0, 1) or len(blends) != 1 or not curves:
            raise ValueError('未知的说话嘴形绑定格式')
        trigger, weight = blends[0]
        if not ignore_voice:
            profiles.append(dict(trigger=trigger, weight=weight, curves=curves))
    targets = [string() for _ in range(count(256))]
    if read('2i') != (curve_count, key_count) or not profiles:
        raise ValueError('说话曲线总数校验失败')
    for p in profiles:
        if p['trigger'] not in targets or not 0 < p['weight'] <= 1:
            raise ValueError('说话曲线绑定的嘴形无效')
        for curve in p['curves']:
            idx = curve.pop('index')
            if not 0 <= idx < len(targets) or not re.fullmatch(r'b_mouth\.mouth_\d{3}', targets[idx]):
                raise ValueError('说话曲线目标无效')
            curve['shape'] = targets[idx]
    return profiles


def extract(source):
    import UnityPy
    env = UnityPy.load(str(source))
    for obj in env.objects:
        if obj.assets_file.name == 'resources.assets' and obj.type.name == 'MonoBehaviour':
            if obj.peek_name() == 'VLActorTalkData':
                return decode(obj.get_raw_data())
    raise ValueError('本机游戏中找不到 VLActorTalkData')


def prepare(root):
    root = Path(root).resolve(strict=True)
    inventory = json.loads((root.parent / 'inventory.json').read_bytes())
    game = Path(inventory['game']).resolve(strict=True)
    folder = (root / 'player-view').resolve(strict=True)
    if folder.parent != root or game in folder.parents or folder == game:
        raise ValueError('口型缓存必须位于当前资源批次')
    source = game / 'gakumas_Data/data.unity3d'
    stat = source.stat()
    fingerprint = [inventory['manifest_sha256'], stat.st_size, stat.st_mtime_ns]
    target = folder / 'talk-curves-v1.json'
    if target.exists():
        data = json.loads(target.read_bytes())
        if data['fingerprint'] != fingerprint:
            raise ValueError('原版口型缓存与本机游戏版本不一致，请重新准备资产')
        return data['profiles']
    profiles = extract(source)
    temp = folder / ('.talk-curves-' + uuid.uuid4().hex + '.tmp')
    try:
        temp.write_text(json.dumps(dict(fingerprint=fingerprint, profiles=profiles), separators=(',', ':'), allow_nan=False), 'utf8')
        temp.replace(target)
    finally:
        temp.unlink(missing_ok=True)
    return profiles
