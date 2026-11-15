"""Validate the dedicated effect wire contract before sending state to Player."""
import math

SCHEMAS = {
    'memory': {'tone': (0, 1), 'bloom': (0, 1), 'threshold': (0, 2), 'radius': (0, 3)},
    'television': {'lineJitter': (0, 1), 'bandStrength': (0, 1), 'bandWidth': (.02, .5), 'rollSpeed': (0, 2), 'chromaOffset': (0, 1), 'signalNoise': (0, 1)},
    'soft': {'radius': (0, 3), 'edgeProtection': (0, 1)},
}

def number(value, low, high):
    return type(value) in (int, float) and math.isfinite(value) and low <= value <= high

def validate_message(message, capable=True):
    post, composition = message.get('postEffects') or {}, message.get('composition') or {}
    groups = [t.get('layers', []) for t in post.get('targets', [])]
    groups += [n.get(k, []) for n in composition.get('nodes', []) for k in ('effects', 'leftEffects', 'rightEffects')]
    for group in groups:
        if not isinstance(group, list) or len(group) > 32:
            raise ValueError('专用画面效果列表无效')
        for layer in group:
            if 'effectVersion' not in layer and not capable:
                continue  # Retained legacy Player handles its unchanged legacy contract.
            if 'effectVersion' not in layer:
                raise ValueError('旧通用效果需要在属性面板中替换为专用算法；请先另存副本')
            if not capable:
                raise ValueError('请使用 build-dedicated-effects-20261115-v3 或支持专用效果 v2 的 Player')
            schema = SCHEMAS.get(layer.get('effectType'))
            p = layer.get('parameters')
            if layer.get('effectVersion') != 2 or not schema or not isinstance(p, dict) or p.keys() != schema.keys():
                raise ValueError('专用画面算法类型／参数不匹配')
            if not all(number(p[k], *bounds) for k, bounds in schema.items()) or not all(number(layer.get(k), 0, 1) for k in ('weight', 'strength')) or type(layer.get('seed')) is not int or not 0 <= layer['seed'] <= 999999:
                raise ValueError('专用画面算法参数超出范围')
    for state in (post, composition):
        if state and not number(state.get('time'), 0, 3600):
            raise ValueError('演出采样时间无效')
    if post and composition and post['time'] != composition['time']:
        raise ValueError('合成与效果必须使用相同演出时间')
