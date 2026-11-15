"""Generate an external rendering shader copy from the selected local game.

Never overwrite the source bundle or package these game shaders with the Player.
The replacement slots and removed dependencies follow the prior isolated study.
"""
import hashlib,json,os,sys,uuid
from pathlib import Path
HERE=Path(__file__).resolve().parent
MAPPING={'UI/UISaturation':'Hidden/Campus/StencilDeferred','UI/UIEmission':'Hidden/VL/ScreenSpaceAmbientOcclusion'}

def digest(path):
    with Path(path).open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()

def prepare(root):
    root=Path(root).resolve(strict=True)
    game=Path(json.loads((root.parent/'inventory.json').read_text('utf8'))['game']).resolve(strict=True)
    installed=game/'gakumas_Data/data.unity3d'
    source=root/'player-view/characters/shader.bundle'
    output=root/'player-view/render-shaders-v1'
    if root==game or game in root.parents:raise ValueError('渲染缓存不能写入游戏目录')
    stat=installed.stat();fingerprint=f'{digest(source)}:{stat.st_size}:{stat.st_mtime_ns}'
    if output.exists():
        report=json.loads((output/'report.json').read_text('utf8'))
        if report.get('version')!=1 or report.get('fingerprint')!=fingerprint or digest(output/'shader.bundle')!=report['sha256']:
            raise ValueError('渲染 Shader 缓存与游戏资源不一致，请重新准备资产')
        return output/'shader.bundle'
    pass # dependencies installed in the Python environment
    import UnityPy
    UnityPy.config.FALLBACK_UNITY_VERSION='6000.0.77f1'
    original=UnityPy.load(str(installed));bundle=UnityPy.load(str(source))
    names={o.read().m_ParsedForm.m_Name:o for o in original.objects if o.type.name=='Shader'}
    slots={o.read().m_ParsedForm.m_Name:o for o in bundle.objects if o.type.name=='Shader'}
    records=[]
    for slot,name in MAPPING.items():
        tree=names[name].read_typetree();removed=tree['m_Dependencies'];tree['m_Dependencies']=[]
        slots[slot].save_typetree(tree)
        records.append(dict(name=name,replaced=slot,removedDependencies=removed,blobSha256=hashlib.sha256(bytes(names[name].read().compressedBlob)).hexdigest()))
    raw=bundle.file.save(packer='lz4');check=UnityPy.load(raw)
    checked={o.read().m_ParsedForm.m_Name:o for o in check.objects if o.type.name=='Shader'}
    if 'Environment/Default' not in checked:raise ValueError('环境 Shader 缺失')
    for item in records:
        if hashlib.sha256(bytes(checked[item['name']].read().compressedBlob)).hexdigest()!=item['blobSha256']:raise ValueError('Shader 字节码校验失败')
    staging=output.with_name(output.name+'.tmp-'+uuid.uuid4().hex);staging.mkdir()
    try:
        (staging/'shader.bundle').write_bytes(raw)
        (staging/'report.json').write_text(json.dumps(dict(version=1,fingerprint=fingerprint,source=str(source),game=str(installed),sha256=hashlib.sha256(raw).hexdigest(),shaders=records),ensure_ascii=False,indent=2),'utf8')
        # Atomic directory publication. A concurrent producer may have won.
        try:staging.rename(output)
        except FileExistsError:
            return prepare(root)
    finally:
        if staging.exists():
            for p in staging.iterdir():p.unlink()
            staging.rmdir()
    return output/'shader.bundle'

def for_player(player,catalog_root=None):
    if not (Path(player).parent/'creator-linear-rendering-v1').is_file():return None
    if not catalog_root:raise ValueError('渲染必须使用解包资源目录')
    return prepare(catalog_root)

if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);a=p.parse_args();print(prepare(a.root))
