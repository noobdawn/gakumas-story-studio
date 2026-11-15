"""Extract original face bone names, bind poses, and per-vertex packed skin weights."""
import argparse,json,sys,warnings
from pathlib import Path
ROOT=Path(__file__).resolve().parent;p=argparse.ArgumentParser();p.add_argument('--output-dir',type=Path,required=True);p.add_argument('--catalog-root',type=Path,required=True);a=p.parse_args();out=a.output_dir.resolve()
from resource_catalog import require_catalog
catalog=require_catalog(a.catalog_root)
if not out.is_relative_to(catalog/'player-view'):raise SystemExit('Output must be under the catalog player view')
out.mkdir(exist_ok=False);pass # dependencies installed in the Python environment
import UnityPy
warnings.filterwarnings('ignore',category=UnityPy.exceptions.UnityVersionFallbackWarning);UnityPy.config.FALLBACK_UNITY_VERSION='6000.0.77f1'
base=catalog/'bundles';report=[]
for code in 'ttmr hski fktn amao kllj kcna ssmk shro hrnm hume jsna hmsz atbm nasr krnh'.split():
    env=UnityPy.load(str(base/f'mdl_chr_{code}-base-0000_face.bundle'));obj=next(o for o in env.objects if o.type.name=='MonoBehaviour' and o.read().m_Script.read().m_ClassName=='VLActorFaceModel');data=obj.read();tree=obj.read_typetree();bones=[x.read().m_GameObject.read().m_Name for x in data.bones];poses=tree['bindposes'];weights=tree['boneWeightAndIndices']
    mesh=data.mesh.read();count=mesh.m_VertexData.m_VertexCount
    if len(weights)!=count*4 or len(bones)!=len(poses) or bones[:3]!=['Head_Face','LeftEye','RightEye']:raise ValueError('unsupported face bone layout '+code)
    eye=[]
    for vertex in range(count):
        for packed in weights[vertex*4:vertex*4+4]:
            bone=packed&65535;weight=packed>>16
            if weight and bone in (1,2):eye.append({'vertex':vertex,'bone':bone,'weight':weight/65535})
            if weight and bone>=len(bones):raise ValueError('invalid face bone index')
    result={'source':f'mdl_chr_{code}-base-0000_face','vertexCount':count,'bones':bones,'bindposes':[{'values':[m[f'e{i}{j}'] for i in range(4) for j in range(4)]} for m in poses],'eyeWeights':eye}
    (out/f'{code}.json').write_text(json.dumps(result,separators=(',',':')),encoding='utf8');report.append({'code':code,'vertices':count,'bones':bones,'eyeInfluences':len(eye)})
(out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps(report,ensure_ascii=False))
