"""Extract original projector settings from local character bundles into a new research directory."""
import argparse,json,sys,warnings
from pathlib import Path
ROOT=Path(__file__).resolve().parent
p=argparse.ArgumentParser();p.add_argument('--output-dir',type=Path,required=True);p.add_argument('--catalog-root',type=Path,required=True);args=p.parse_args()
out=args.output_dir.resolve()
from resource_catalog import require_catalog
catalog=require_catalog(args.catalog_root)
if not out.is_relative_to(catalog/'player-view'):raise SystemExit('Output must be under the catalog player view')
out.mkdir(exist_ok=False)
pass # dependencies installed in the Python environment
import UnityPy
warnings.filterwarnings('ignore',category=UnityPy.exceptions.UnityVersionFallbackWarning)
UnityPy.config.FALLBACK_UNITY_VERSION='6000.0.77f1'
base=catalog/'bundles'
codes='ttmr hski fktn amao kllj kcna ssmk shro hrnm hume jsna hmsz atbm nasr krnh'.split()
expected={'Shadow','Pale','CheekWhole','LeftCheek','RightCheek','LeftCheekLine','RightCheekLine','CheekLineWhole'}
for code in codes:
    bundle=UnityPy.load(str(base/f'mdl_chr_{code}-base-0000_face.bundle'));items=[]
    for obj in bundle.objects:
        if obj.type.name!='MonoBehaviour':continue
        data=obj.read()
        try: name=data.m_Script.read().m_ClassName
        except (AttributeError,ValueError):continue
        if name!='DecalProjector':continue
        tree=obj.read_typetree();go=data.m_GameObject.read();name=go.m_Name
        if name not in expected:raise ValueError(f'{code}: unknown projector {name}')
        items.append({'name':name,'uvScale':tree['m_UVScale'],'uvBias':tree['m_UVBias'],'pivot':tree['m_Offset'],'size':tree['m_Size'],'scaleMode':tree['m_ScaleMode'],'layerMask':tree['m_DecalLayerMask']})
    if len(items)!=8 or {x['name'] for x in items}!=expected:raise ValueError(f'{code}: expected eight projectors')
    (out/f'{code}.json').write_text(json.dumps({'source':f'mdl_chr_{code}-base-0000_face','projectors':items},separators=(',',':')),encoding='utf8')
print(json.dumps({'characters':codes,'projectors':len(codes)*8}))
