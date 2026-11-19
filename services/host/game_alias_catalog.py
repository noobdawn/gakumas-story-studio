"""Serve only editor entries bound to this validated local extraction."""
import json

def editor_rows(catalog):
    file=catalog/'resource-aliases.zh-CN.json'
    if not file.exists():
        return {}
    if file.is_symlink() or file.stat().st_size>48*1024*1024:
        raise ValueError('Invalid resource alias table')
    data=json.loads(file.read_text('utf8'))
    manifest=json.loads((catalog/'summary.json').read_text('utf8'))['manifest_sha256']
    if data['version']!=1 or data['runId']!=catalog.parent.name or data['manifest']!=manifest:
        raise ValueError('Resource aliases belong to a different game batch')
    rows=data['editor']
    if not isinstance(rows,dict) or len(rows)>60000:
        raise ValueError('Invalid editor alias table')
    for key,row in rows.items():
        if not key.startswith(('asset-','scene-','ui-','classroom-prop-','classroom-chair-')) or len(key)>220 or not isinstance(row,list) or len(row)!=2:
            raise ValueError('Invalid resource alias entry')
        source,alias=row
        if not isinstance(source,str) or not source or len(source)>550 or not isinstance(alias,str) or len(alias)>100:
            raise ValueError('Invalid resource alias name')
    return rows
