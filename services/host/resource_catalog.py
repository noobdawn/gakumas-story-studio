"""Require a creator-managed, current local-game extraction batch."""
import hashlib
import json
from pathlib import Path


def require_catalog(root):
    if not root:
        raise ValueError('必须指定解包资源目录；请先在资产设置准备资源')
    root = Path(root).resolve(strict=True)
    run = root.parent
    marker = json.loads((run / '.creator-run.json').read_text('utf8'))
    owner = json.loads((run.parent.parent / '.creator-asset-cache.json').read_text('utf8'))
    if root.name != 'catalog' or run.parent.name != 'runs' or marker.get('version') != 1 or marker.get('runId') != run.name or not marker.get('cacheId') or marker.get('cacheId') != owner.get('id'):
        raise ValueError('不是受管理的解包资源批次')
    inventory = json.loads((run / 'inventory.json').read_text('utf8'))
    game = Path(inventory['game']).resolve(strict=True)
    if root == game or game in root.parents:
        raise ValueError('创作器缓存不能位于游戏目录')
    manifests = list((game / 'octo/pdb').rglob('octocacheevai'))
    if len(manifests) != 1 or hashlib.sha256(manifests[0].read_bytes()).hexdigest() != inventory['manifest_sha256']:
        raise ValueError('游戏清单已变化，请在资产设置重新准备资源')
    return root


def require_characters(root, bundles):
    expected = root / 'player-view/characters'
    if Path(bundles).resolve(strict=True) != expected.resolve(strict=True):
        raise ValueError('角色资源必须来自同一解包批次')
    return expected
