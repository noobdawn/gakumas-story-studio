"""Expose original white-circle eye prefabs in fresh local-only bundle copies."""
import argparse,json,sys,warnings
from pathlib import Path
ROOT=Path(__file__).resolve().parent
p=argparse.ArgumentParser();p.add_argument('--output-dir',required=True,type=Path);p.add_argument('--catalog-root',type=Path,required=True);args=p.parse_args();out=args.output_dir.resolve()
from resource_catalog import require_catalog
catalog=require_catalog(args.catalog_root)
if not out.is_relative_to(catalog/'player-view'):raise SystemExit('Output must be under the catalog player view')
out.mkdir(exist_ok=False)
pass # dependencies installed in the Python environment
import UnityPy
warnings.filterwarnings('ignore',category=UnityPy.exceptions.UnityVersionFallbackWarning);UnityPy.config.FALLBACK_UNITY_VERSION='6000.0.77f1'
source=catalog/'bundles';codes='ttmr hski fktn amao kllj kcna ssmk shro hrnm hume jsna hmsz atbm nasr krnh'.split();available=[];missing=[]
for code in codes:
    files=[source/f'mef_pfb_chr_{code}_eye-shiromaru-001_{side}.bundle' for side in 'lr']
    if not all(p.is_file() for p in files):missing.append(code);continue
    for side,file in zip('lr',files):
        env=UnityPy.load(str(file));entry=next(o for o in env.objects if o.type.name=='MonoBehaviour' and o.read().m_Script.read().m_ClassName=='MotionPrefabEffect')
        tree=entry.read_typetree();pid=tree['_prefabAsset']['m_PathID']
        if not pid or tree['_parentTransformPath']!='Root_Body/Reference/Hips/Spine/Spine1/Spine2/Neck/Head/Head_Face':raise ValueError('unexpected prefab reference '+str(file))
        container=next(o for o in env.objects if o.type.name=='AssetBundle');tree=container.read_typetree();tree['m_Container'].append(('roundeye',{'preloadIndex':0,'preloadSize':len(tree['m_PreloadTable']),'asset':{'m_FileID':0,'m_PathID':pid}}));container.save_typetree(tree)
        (out/f'{code}-{side}.bundle').write_bytes(next(iter(env.files.values())).save(packer='none'))
    available.append(code)
(out/'report.json').write_text(json.dumps({'available':available,'missing':missing},ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps({'available':available,'missing':missing}))
