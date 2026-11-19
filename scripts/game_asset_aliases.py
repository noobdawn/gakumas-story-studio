"""Export current game filenames for batch translation and reattach results by stable ID."""
import argparse
import csv
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import unicodedata
from collections import Counter, defaultdict

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'services/host'))
from resource_catalog import require_catalog
import costume_catalog
import film_motions

CHARACTERS = dict(zip('ttmr hski fktn amao kllj kcna ssmk shro hrnm hume jsna hmsz atbm nasr krnh'.split(),
                      '月村手毬 花海咲季 藤田琴音 有村麻央 葛城莉莉娅 仓本千奈 紫云清夏 篠泽广 姬崎莉波 花海佑芽 十王星南 秦谷美铃 雨夜燕 根绪亚纱里 贺阳燐羽'.split()))
SOURCE_NAMES={**CHARACTERS,**dict(fktn='藤田ことね',kllj='葛城リーリヤ',kcna='倉本千奈',ssmk='紫雲清夏',shro='篠澤広',
                                  hrnm='姫崎莉波',hmsz='秦谷美鈴',nasr='根緒亜紗里',krnh='賀陽燐羽')}
SLOT = re.compile(r'(?<![a-zA-Z0-9])(?:'+'|'.join(CHARACTERS)+r'|[0-9]+)(?![a-zA-Z0-9])')
FORMAT = {'.acb':'ACB','.awb':'AWB','.mp3':'MP3','.usm':'USM','.txt':'文本'}
ROLES = {'b':'身体','f':'面部','c':'镜头'}
PREFIX = {'img':'图片','sud':'音频','adv':'剧情','mot':'动画','mov':'视频','mdl':'模型','env':'场景','fbx':'模型部件','tln':'时间轴','eff':'特效','mef':'效果素材','crw':'观众','ttn':'界面','scl':'场景配置','fgd':'前景','sky':'天空','t':'纹理'}
BASE_MOTIONS = dict(shy='mot_all_chr_ttmr_tereru-002_in_b',idle='mot_all_chr_ttmr_idle-001_in_b',
                    angry='mot_all_chr_ttmr_angry-001_in_b',yes='mot_all_chr_cmmn_yes-003_in_b')
NAME_EVIDENCE = {name[-2:]:code for code,name in CHARACTERS.items() if code not in ('kllj','nasr','shro','atbm')}
NAME_EVIDENCE.update({'莉莉娅':'kllj','莉莉亞':'kllj','亚纱里':'nasr','篠泽广':'shro','雨夜燕':'atbm','莉波':'hrnm','美鈴':'hmsz','星南':'jsna'})
GENERIC_AUDIO = set('sud se vo music bgm adv system general part event live chr all normal true special inst chorus game unit cmmn common version ver full acb awb mp mp3 pre cidol csprt cstm hkne studentcouncil char'.split())|set(CHARACTERS)

def read(path):
    return json.loads(path.read_text(encoding='utf-8'))

def lines(path):
    with path.open(encoding='utf-8') as stream:
        for line in stream:
            if line.strip():
                yield json.loads(line)

def write(path, value, exclusive=False):
    path.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.NamedTemporaryFile('w',encoding='utf8',dir=path.parent,delete=False) as tmp:
        try:
            json.dump(value,tmp,ensure_ascii=False,separators=(',',':'))
            tmp.flush()
            os.fsync(tmp.fileno())
        except BaseException:
            tmp.close()
            Path(tmp.name).unlink(missing_ok=True)
            raise
    try:
        if exclusive:
            try:
                os.link(tmp.name,path)
            except FileExistsError:
                if path.is_symlink() or read(path)!=value:
                    raise ValueError('A different alias table already exists in the target batch')
        else:
            os.replace(tmp.name,path)
    finally:
        Path(tmp.name).unlink(missing_ok=True)

def batch(library):
    root=library.resolve(strict=True)
    config=root/'asset-cache-config.json'
    parent=root/'asset-cache'
    if config.exists():
        location=read(config)
        parent=Path(location['root'])
        if location.get('version')!=1 or not parent.is_absolute():raise ValueError('Invalid managed cache location')
    cache=parent/'gakumas-creator-cache'
    run=read(cache/'visual-current.json')['runId']
    if not re.fullmatch(r'[a-f0-9-]{36}',run):
        raise ValueError('Invalid active resource batch')
    return require_catalog(cache/'runs'/run/'catalog')

def template(source):
    base=source; suffix=[]
    if base.endswith(' [pre]'):
        base=base[:-6];suffix.append('预加载')
    ext=Path(base).suffix.lower()
    if ext in FORMAT:
        base=base[:-len(ext)]
    if base.startswith('mot_') and base[-2:-1]=='_' and base[-1:] in ROLES:
        suffix.append(ROLES[base[-1]]);base=base[:-2]
    values={}
    numbers=actors=0
    def replace(match):
        nonlocal numbers,actors
        word=match[0]
        if word in CHARACTERS:
            tag='{'+chr(ord('A')+actors)+'}';actors+=1;values[tag]=CHARACTERS[word]
        else:
            numbers+=1;tag='{'+str(numbers)+'}';values[tag]=word
        return tag
    return SLOT.sub(replace,base),values,suffix

def inventory(cat):
    inv=read(cat.parent/'inventory.json')
    records=[]
    def add(scope,ident,kind,source,*,filename=None,known=None,variant='',local=True):
        records.append(dict(scope=scope,id=ident,type=kind,source=source,filename=filename or source,
                            known=known,variant=variant,local=local))
    for row in inv['records']:
        name=row['name']
        add('resources',f"{row['kind']}:{row['id']}",PREFIX.get(name.split('_')[0],'其他'),name,
            variant=FORMAT.get(Path(name).suffix.lower(),''),local=bool(row.get('local_candidates')))
    for row in lines(cat/'bundles.jsonl'):
        for clip in row.get('clips',[]):
            add('resources',f"clip:{row['id']}:{clip['pathId']}",'动画片段',clip['name'])
    for item in film_motions.load(cat):
        add('editor','asset-'+item['id'],'动作',item['name'])
    for key,name in BASE_MOTIONS.items():
        add('editor','asset-local-'+key,'动作',name)
    for c in costume_catalog.load(cat):
        types={'casl':'日常','cstm':'服装','trng':'训练','schl':'校服','spcs':'特殊','othr':'其他'}
        established=(CHARACTERS[c['character']]+' · '+types[c['kind']]+' '+c['number']) if c['character'] in CHARACTERS and c['kind'] in types else None
        add('editor','asset-'+c['id'],'服装',c['name'],known=established)
    for code,person in CHARACTERS.items():
        add('editor','asset-actor-1' if code=='ttmr' else 'asset-actor-'+code,'角色',SOURCE_NAMES[code],known=person)
    view=cat/'player-view'
    for f in ['backgrounds/report.json','scenes-catalog.json']:
        for scene in read(view/f)['entries']:
            established={'classroom':'教室','trainingroom':'练习室','courtyard':'中庭','dormitory':'宿舍','rooftop':'屋顶'}.get(scene['sceneId'])
            add('editor',scene['id'],'场景',scene['source'],known=established)
    for ui in read(view/'ui-transitions-v2/catalog.json')['entries']:
        add('editor',ui['id'],'UI',ui['source'],known=ui.get('alias'))
    for p in read(view/'classroom-props.json')['items']:
        add('editor',p['id'],'道具',p['source'],known=p['name'] if re.search(r'[\u3400-\u9fff]',p['name']) else None)
    for face in read(view/'face-effects/face-animation/catalog.json')['motions']:
        add('editor',face['id'],'表情',face['name'])
    shape_files=sorted((cat/'face').glob('*.json'))
    shapes=set()
    for f in shape_files:
        for shape in read(f).get('shapes',[]):
            shapes.add(shape['name'])
    for name in sorted(shapes):
        if re.fullmatch(r'b_(brow|eye|iris|mouth)\.[a-z]+_\d{3}',name):
            add('editor','asset-local-mouth' if name=='b_mouth.mouth_001' else 'asset-face-'+name,'表情',name)
        else:
            add('resources','shape:'+name,'脸部形变',name)
    for prefix,f in [('bank','audio-wav.jsonl'),('unity','audio-unity.jsonl')]:
        for row in lines(cat/f):
            if row.get('category') not in ('音乐','音效'):continue
            label=f"{row['bank']} #{row['index']}" if prefix=='bank' else row['bundle']
            wire=json.dumps([row['file'],row['category'],label],ensure_ascii=False,separators=(',',':'))
            ident=hashlib.sha256(wire.encode()).hexdigest()
            stream=row.get('metadata',{}).get('streamInfo',{}).get('name')
            filename=stream or (row.get('bank') or label)
            extra=(FORMAT.get(Path(row['bank']).suffix.lower(),'')+' #'+str(row['index'])) if prefix=='bank' else 'Unity'
            add('editor',f'asset-audio-catalog-{prefix}-{ident}',row['category'],label,filename=filename,variant=extra)
    ids={(r['scope'],r['id']) for r in records}
    if len(records)!=len(ids):raise ValueError('Duplicate catalog identifier')
    return inv['manifest_sha256'],records

def export(library,out):
    cat=batch(library)
    manifest,records=inventory(cat)
    groups={}
    for r in records:
        if r['known']:continue
        pattern,_,_=template(r['filename'])
        groups.setdefault(pattern,r['filename'])
    plan={'version':1,'runId':cat.parent.name,'manifest':manifest,'groups':[list(item) for item in sorted(groups.items())]}
    if (out/'plan.json').exists() and read(out/'plan.json')!=plan:
        raise ValueError('Different filename catalog; select a new work directory')
    write(out/'plan.json',plan)
    write(out/'inventory.json',records)
    print(json.dumps({'batch':cat.parent.name,'records':len(records),'editor':sum(r['scope']=='editor' for r in records),'templates':len(groups)}))

def generate_name(row,translations):
    if row['known']:return row['known']
    filename=row['filename']
    pattern,values,suffix=template(filename)
    # Numeric sound/voice/song IDs identify recordings, but cannot name their content.
    words=set(re.findall(r'[a-z]+',filename.lower()))
    if filename.startswith(('sud_','se_')) and not words-GENERIC_AUDIO:return ''
    if re.match(r'^sud_music_(?:general|live)_(?:all|unit|[a-z]{4})-\d+(?:-[a-z]+)?_(?:true|normal|game)(?:[-_. ]|$)',filename):return ''
    if re.match(r'^mot_adv_(?:chr_[a-z]+_)?\d+(?:-\d+)+(?:-cam)?_in(?:_[bcf]|_cam)?$',filename):return ''
    if 'picohan' in pattern or 'sikyu' in pattern:return ''
    room=re.fullmatch(r'env_([23]d)_adv_dormitory-([a-z]+)room-([\d-]+)-(noon|night)',filename)
    if room and room[2] in CHARACTERS:
        period='白天' if room[4]=='noon' else '夜晚'
        return f'{room[1].upper()} · 宿舍 · {CHARACTERS[room[2]]}的房间 {room[3]}（{period}）'
    alias=translations[pattern]
    if not alias:return ''
    if any(name in alias and code not in pattern for name,code in NAME_EVIDENCE.items()):return ''
    if '花海' in alias and not any(s in pattern for s in ('hski','hume','hanami')):return ''
    if 'hkne' in pattern and 'hkne' not in alias.lower():return ''
    if '大声' in alias and not any(s in pattern for s in ('loud','shout','yell','takawarai')):return ''
    if 'skillcard_men-' in pattern and 'MEN' not in alias.upper():return ''
    if 'skillcard_act-' in pattern and 'ACT' not in alias.upper():return ''
    tags=re.findall(r'\{[^{}]*\}',alias)
    if any(t not in values for t in tags) or '{' in re.sub(r'\{[^{}]*\}','',alias) or '}' in re.sub(r'\{[^{}]*\}','',alias):return ''
    for tag,value in values.items():
        if tag in alias:alias=alias.replace(tag,value)
        elif tag[1].isalpha():alias=value+' · '+alias
        else:alias+=' '+value
    if not re.search(r'[\u3400-\u9fff]',alias) or re.search(r'不确定|无法判断|未翻译|未知含义|待翻译',alias):return ''
    dimension=re.match(r'env_([23]d)_',filename)
    if dimension and dimension[1] not in alias.lower():alias=dimension[1].upper()+' · '+alias
    name=' · '.join([alias,*suffix])
    return name if len(name)<=100 else ''

def merge(library,out,install):
    plan=read(out/'plan.json')
    cat=batch(library)
    if cat.parent.name!=plan['runId'] or read(cat/'summary.json')['manifest_sha256']!=plan['manifest']:
        raise ValueError('Active game resource batch changed')
    translations={}
    for chunk in sorted((out/'reviewed').glob('*.json')):
        draft=dict(read(out/'translated'/chunk.name)['items'])
        for pattern,alias in read(chunk)['items']:
            if pattern in translations:raise ValueError('Duplicate translated template')
            translations[pattern]=alias if draft[pattern] else ''
    if set(translations)!={k for k,_ in plan['groups']}:raise ValueError('Incomplete translation batches')
    records=read(out/'inventory.json')
    if install and inventory(cat)!=(plan['manifest'],records):
        raise ValueError('Source catalog IDs changed during translation; export again')
    stats=defaultdict(Counter)
    result={'version':1,'runId':plan['runId'],'manifest':plan['manifest'],'editor':{},'resources':{}}
    for scope in ('editor','resources'):
        occupied=defaultdict(set)
        sequence=Counter()
        for row in sorted((r for r in records if r['scope']==scope),key=lambda r:(not bool(r['known']),r['id'])):
            alias=generate_name(row,translations)
            key=lambda s:unicodedata.normalize('NFKC',s).strip().casefold()
            used=occupied[row['type']]
            if alias and key(alias) in used:
                qualifier=row['variant'] or ''
                base=(alias+' · '+qualifier) if qualifier and len(alias)+len(qualifier)<96 else alias
                candidate=base
                while key(candidate) in used:
                    seq=(row['type'],key(base))
                    sequence[seq]+=1
                    candidate=base[:90]+'（'+str(sequence[seq]+1)+'）'
                alias=candidate
            if alias:
                if len(alias)>100 or key(alias) in used:raise ValueError('Alias conflict: '+row['id'])
                used.add(key(alias))
            result[scope][row['id']]=[row['source'],alias]
            stats[scope+' '+row['type']]['named' if alias else 'empty']+=1
    write(out/'resource-aliases.zh-CN.json',result)
    write(out/'counts.json',stats)
    with (out/'资源别名索引.tsv').open('w',encoding='utf-8-sig',newline='') as file:
        writer=csv.writer(file,delimiter='\t')
        writer.writerow(['范围','类型','资源 ID','原始名称','中文别名'])
        for row in records:
            writer.writerow(['编辑器' if row['scope']=='editor' else '游戏索引',row['type'],row['id'],
                             row['source'],result[row['scope']][row['id']][1]])
    if install:
        target=cat/'resource-aliases.zh-CN.json'
        if target.is_symlink():raise ValueError('Linked alias table')
        if batch(library)!=cat:raise ValueError('Active batch changed before installation')
        write(target,result,exclusive=True)
    print(json.dumps({k:len(result[k]) for k in ('editor','resources')}))

if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('action',choices=['export','merge','install'])
    p.add_argument('library',type=Path)
    p.add_argument('work',type=Path)
    args=p.parse_args()
    if args.action=='export':export(args.library,args.work)
    else:merge(args.library,args.work,args.action=='install')
