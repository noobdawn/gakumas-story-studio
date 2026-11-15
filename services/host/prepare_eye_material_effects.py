"""Expose local original eye-effect textures and preserve animation metadata."""
import argparse,json,sys,warnings
from pathlib import Path
ROOT=Path(__file__).resolve().parent;p=argparse.ArgumentParser();p.add_argument('--output-dir',type=Path,required=True);p.add_argument('--catalog-root',type=Path,required=True);args=p.parse_args();out=args.output_dir.resolve()
from resource_catalog import require_catalog
catalog=require_catalog(args.catalog_root)
if not out.is_relative_to(catalog/'player-view'):raise SystemExit('Output must be under the catalog player view')
out.mkdir(exist_ok=False);pass # dependencies installed in the Python environment
import UnityPy
warnings.filterwarnings('ignore',category=UnityPy.exceptions.UnityVersionFallbackWarning);UnityPy.config.FALLBACK_UNITY_VERSION='6000.0.77f1'
source=catalog/'bundles';codes='ttmr hski fktn amao kllj kcna ssmk shro hrnm hume jsna hmsz atbm nasr krnh'.split();effects={'NoHighlight':'nohighlight','Sparkle':'kirakira','SparkleSmall':'kirakirasmall','Kiran':'kiran','Move':'move','Heart':'heart'};report={}
for effect,suffix in effects.items():
 available=[]
 for code in codes:
  path=source/f'mef_mat_chr_{code}_eye-{suffix}-001.bundle'
  if not path.is_file():continue
  env=UnityPy.load(str(path));obj=next(o for o in env.objects if o.type.name=='MonoBehaviour' and o.read().m_Script.read().m_ClassName=='CampusActorMaterialEffect');data=obj.read_typetree()['overrideProperty']
  if data['materialName']!='m_eye' or not 1<=data['tileX']<=8 or not 1<=data['tileY']<=8 or not 1<=data['tileFPS']<=60:raise ValueError('Unexpected material effect '+str(path))
  container=next(o for o in env.objects if o.type.name=='AssetBundle');tree=container.read_typetree()
  for prop in ('col','sdw','def'):
   ptr=data[prop]
   if ptr['m_FileID']!=0 or not ptr['m_PathID']:raise ValueError('Missing texture '+str(path))
   tree['m_Container'].append((prop,{'preloadIndex':0,'preloadSize':len(tree['m_PreloadTable']),'asset':ptr}))
  container.save_typetree(tree);(out/f'{code}-{effect}.bundle').write_bytes(next(iter(env.files.values())).save(packer='none'))
  (out/f'{code}-{effect}.json').write_text(json.dumps({'code':code,'effect':effect,'tileX':data['tileX'],'tileY':data['tileY'],'fps':data['tileFPS']},separators=(',',':')),encoding='utf8');available.append(code)
 report[effect]=available
(out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps(report,ensure_ascii=False))
