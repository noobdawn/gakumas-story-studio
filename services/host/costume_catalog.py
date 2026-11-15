"""Read-only catalog of locally prepared body bundles; no runtime compatibility implied."""
import hashlib,json,re
from pathlib import Path

BODY=re.compile(r'mdl_chr_([a-z0-9]+)-([a-z0-9]+)-([a-z0-9]+)_body')
SAFE=re.compile(r'[A-Za-z0-9_.-]+')
KNOWN=set('ttmr hski fktn amao kllj kcna ssmk shro hrnm hume jsna hmsz atbm nasr krnh'.split())
DEFAULT={code:('casl','0000' if code in ('nasr','krnh') else '0002') for code in KNOWN}

def load(root):
    root=Path(root).resolve();index=root/'bundles.jsonl';base=(root/'bundles').resolve();rows=[]
    with index.open(encoding='utf8') as f:
        for line in f:
            row=json.loads(line)
            if isinstance(row,dict):rows.append(row)
    byname={};byid={}
    for row in rows:
        name=row.get('name');ident=row.get('id')
        if isinstance(name,str) and SAFE.fullmatch(name):
            if name in byname:raise ValueError('Duplicate bundle name')
            byname[name]=row
        if isinstance(ident,int) and not isinstance(ident,bool):byid.setdefault(ident,[]).append(row)
    usable_cache={}
    def usable(row):
        if not isinstance(row,dict) or row.get('error'):return False
        name=row.get('name');rel=row.get('file')
        if not isinstance(name,str) or not SAFE.fullmatch(name) or rel!='bundles/'+name+'.bundle':return False
        if name in usable_cache:return usable_cache[name]
        file=(root/rel).resolve()
        if base not in file.parents or not file.is_file():return False
        try:
            with file.open('rb') as f:result=f.read(8)==b'UnityFS\0'
            usable_cache[name]=result;return result
        except OSError:return False
    def body_dependencies(row):
        """Return verified body dependencies in load order; reject cycles and unknown bundle types."""
        visiting=set();visited=set();ordered=[]
        def walk(item):
            name=item.get('name')
            if name in visiting:raise ValueError('Cyclic costume dependency')
            if name in visited:return
            if len(visiting)>32 or len(visited)>64:raise ValueError('Too many costume dependencies')
            if not usable(item):raise ValueError('Missing costume dependency')
            if name!='actor-shader' and not BODY.fullmatch(name):raise ValueError('Unsupported costume dependency')
            visiting.add(name);deps=item.get('dependencies',[])
            if not isinstance(deps,list) or any(not isinstance(i,int) or isinstance(i,bool) for i in deps):raise ValueError('Invalid costume dependency')
            for dep in deps:
                candidates=byid.get(dep,[])
                if len(candidates)!=1:raise ValueError('Ambiguous costume dependency')
                walk(candidates[0])
            visiting.remove(name);visited.add(name)
            if name!='actor-shader':ordered.append(name)
        try:
            walk(row)
            return ordered[:-1] if len(ordered)<=33 else None
        except (ValueError,TypeError,RecursionError):return None
    result=[]
    for row in rows:
        name=row.get('name');match=BODY.fullmatch(name) if isinstance(name,str) else None
        if not match:continue
        code,kind,number=match.groups();deps=row.get('dependencies',[])
        if not isinstance(deps,list) or any(not isinstance(i,int) or isinstance(i,bool) for i in deps):continue
        missing=[]
        for dep in deps:
            candidates=byid.get(dep,[])
            if len(candidates)!=1 or not usable(candidates[0]):missing.append(str(dep))
        exactFace=f'mdl_chr_{code}-{kind}-{number}_face';exactHair=f'mdl_chr_{code}-{kind}-{number}_hair'
        baseFace=f'mdl_chr_{code}-base-0000_face';baseHair=f'mdl_chr_{code}-base-0000_hair'
        ident='costume-'+hashlib.sha256(name.encode('ascii')).hexdigest()[:24]
        bodies=body_dependencies(row);eligible=code in KNOWN and bodies is not None
        result.append({'id':ident,'name':name,'character':code,'kind':kind,'number':number,'bodyAvailable':usable(row),'dependenciesAvailable':not missing,'missingDependencies':missing,'baseFaceAvailable':usable(byname.get(baseFace)),'baseHairAvailable':usable(byname.get(baseHair)),'specificFaceAvailable':usable(byname.get(exactFace)),'specificHairAvailable':usable(byname.get(exactHair)),'knownCharacter':code in KNOWN,'currentDefault':DEFAULT.get(code)==(kind,number),'playerAvailable':eligible,'thumbnailAvailable':eligible,'dependencyBundles':bodies if bodies is not None else []})
    return sorted(result,key=lambda x:x['name'].casefold())
