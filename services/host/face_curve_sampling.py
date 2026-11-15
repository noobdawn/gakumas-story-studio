"""Sample Unity streamed scalar curves; no game data is embedded here."""
import bisect
import math
import struct


def decode_stream(words, curve_count):
    curves = [[] for _ in range(curve_count)]
    i = 0
    while i < len(words):
        if i + 2 > len(words): raise ValueError('Truncated stream frame')
        timestamp = struct.unpack('<f', struct.pack('<I', words[i]))[0]
        count = words[i + 1]; i += 2
        if count > curve_count or i + count * 5 > len(words): raise ValueError('Invalid stream frame')
        seen = set()
        for _ in range(count):
            index = words[i]
            coefficients = struct.unpack('<4f', struct.pack('<4I', *words[i+1:i+5])); i += 5
            if index >= curve_count or index in seen: raise ValueError('Invalid stream curve index')
            seen.add(index)
            # Unity writes an extreme negative sentinel before the first actual key.
            if not math.isfinite(timestamp) or abs(timestamp) > 1e6: continue
            if any(not math.isfinite(c) for c in coefficients): raise ValueError('Invalid curve coefficient')
            if curves[index] and timestamp <= curves[index][-1][0]: raise ValueError('Unordered stream keys')
            curves[index].append((timestamp, coefficients))
    return curves


def sample_curve(curve, time):
    if not curve: return 0.0
    index = bisect.bisect_right(curve, (time + 1e-7,)) - 1
    if index < 0: return curve[0][1][3]
    start, (a, b, c, d) = curve[index]
    delta = max(0.0, time - start)
    return ((a * delta + b) * delta + c) * delta + d


def sample_dense(samples, curve_count, frame_count, sample_rate, begin, curve_index, time):
    if curve_count <= 0 or frame_count <= 0 or sample_rate <= 0 or len(samples) != curve_count * frame_count or not 0 <= curve_index < curve_count:
        raise ValueError('Invalid dense curve')
    position = max(0.0, min(frame_count - 1, (time - begin) * sample_rate))
    left = int(position); right = min(frame_count - 1, left + 1); fraction = position - left
    return samples[left * curve_count + curve_index] * (1 - fraction) + samples[right * curve_count + curve_index] * fraction


def simplify_keys(keys, tolerance=.15):
    """Bound the error at each original sample when reducing linear keys."""
    if len(keys) <= 2: return keys[:]
    keep = {0, len(keys)-1}; stack = [(0, len(keys)-1)]
    while stack:
        left, right = stack.pop(); a, b = keys[left], keys[right]
        span = b['time']-a['time']
        if span <= 0: raise ValueError('Unordered sample times')
        worst, index = tolerance, None
        for i in range(left+1,right):
            k=keys[i]; estimate=a['value']+(b['value']-a['value'])*(k['time']-a['time'])/span
            error=abs(k['value']-estimate)
            if error>worst: worst,index=error,i
        if index is not None:
            keep.add(index);stack.append((left,index));stack.append((index,right))
    return [keys[i] for i in sorted(keep)]
