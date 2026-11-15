"""Read only the prepared local character-motion catalog."""
import hashlib, json, math, re
from pathlib import Path

LEGACY={'mot_all_chr_ttmr_tereru-002_in_b','mot_all_chr_ttmr_idle-001_in_b','mot_all_chr_ttmr_angry-001_in_b','mot_all_chr_cmmn_yes-003_in_b'}

def load(root):
    root=Path(root).resolve(); allowed=(root/'exposed').resolve(); index=root/'bundles.jsonl'; result=[]; seen=set()
    with index.open(encoding='utf-8') as f:
        for line in f:
            row=json.loads(line)
            rel=row.get('exposed')
            if not isinstance(rel,str):continue
            file=(root/rel).resolve()
            if allowed not in file.parents or file.suffix.lower()!='.bundle' or not file.is_file():continue
            for clip in row.get('clips',[]):
                name=clip.get('name');start=clip.get('start');stop=clip.get('stop')
                if clip.get('role')!='body' or not isinstance(name,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,180}_b',name) or '_chr_' not in name or name in LEGACY:continue
                if isinstance(start,bool) or isinstance(stop,bool) or not isinstance(start,(int,float)) or not isinstance(stop,(int,float)) or not math.isfinite(start) or not math.isfinite(stop) or stop<=start:continue
                ident='film-'+hashlib.sha256((rel+'\0'+name).encode('utf-8')).hexdigest()[:24]
                if ident in seen:raise ValueError('Duplicate motion catalog identifier')
                seen.add(ident)
                result.append({'id':ident,'name':name,'length':stop-start,'file':str(file),'clip':name})
    extra=root/'player-view/animation-layers-v1/catalog.json'
    if extra.is_file():
        from animation_layer_cache import load as load_layers
        traits,builtins=load_layers(root)
        for item in result:item.update(traits.get(item['name'],{}))
        result.extend(builtins)
    return sorted(result,key=lambda x:x['name'].casefold())
