"""Read selected built-in ADV UI data and sprites into a new local research directory."""
import argparse, hashlib, json, sys
from pathlib import Path
pass # dependencies installed in the Python environment
import UnityPy
UnityPy.config.FALLBACK_UNITY_VERSION='6000.0.77f1'

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--game',type=Path,required=True);parser.add_argument('--out',type=Path,required=True);args=parser.parse_args()
    game=args.game.resolve();source=game/'gakumas_Data'/'data.unity3d';out=args.out.resolve()
    if out==game or game in out.parents:parser.error('cannot write to game directory')
    out.mkdir(parents=True,exist_ok=False)
    digest=hashlib.sha256(source.read_bytes()).hexdigest();env=UnityPy.load(str(source))
    objects={o.path_id:o for o in env.objects if o.assets_file.name=='resources.assets'}
    scripts={o.path_id:o.read().m_ClassName for o in env.objects if o.type.name=='MonoScript' and o.assets_file.name=='globalgamemanagers.assets'}
    selected=['message_bg','message_bg_blur','frame_message_bg','name_bg','name_bg_blur']
    sprites=[]
    for o in objects.values():
        if o.type.name!='Sprite':continue
        try:
            data=o.read()
            if data.m_Name not in selected or 'ADVAtlas' not in data.m_AtlasTags:continue
            tree=o.read_typetree();filename=data.m_Name+'.png';data.image.save(out/filename)
            sprites.append({'name':data.m_Name,'id':o.path_id,'file':filename,'rect':tree['m_Rect'],'border':tree['m_Border'],'atlas':tree['m_AtlasTags']})
        except Exception as exc:sprites.append({'id':o.path_id,'error':str(exc)})
    roots=[]
    for o in objects.values():
        if o.type.name!='GameObject':continue
        try:
            tree=o.read_typetree()
            if tree['m_Name']!='Message Area':continue
            comp=objects[tree['m_Component'][0]['component']['m_PathID']].read_typetree();chain=[];p=comp['m_Father']['m_PathID']
            while p and len(chain)<20:
                t=objects[p].read_typetree();chain.append(objects[t['m_GameObject']['m_PathID']].read_typetree()['m_Name']);p=t['m_Father']['m_PathID']
            if 'ADVEngine' in chain:roots.append(comp['m_GameObject']['m_PathID'])
        except Exception:continue
    def walk(transform):
        t=objects[transform].read_typetree();g=objects[t['m_GameObject']['m_PathID']].read_typetree();components=[]
        for c in g['m_Component']:
            item=objects.get(c['component']['m_PathID'])
            if item and item.type.name=='MonoBehaviour':
                try:components.append(scripts.get(item.read_typetree(check_read=False)['m_Script']['m_PathID'],'unknown'))
                except Exception:components.append('unreadable')
        return {'name':g['m_Name'],'id':t['m_GameObject']['m_PathID'],'active':g['m_IsActive'],'anchorMin':t.get('m_AnchorMin'),'anchorMax':t.get('m_AnchorMax'),'position':t.get('m_AnchoredPosition'),'size':t.get('m_SizeDelta'),'pivot':t.get('m_Pivot'),'components':components,'children':[walk(c['m_PathID']) for c in t.get('m_Children',[])]}
    trees=[walk(objects[objects[id].read_typetree()['m_Component'][0]['component']['m_PathID']].path_id) for id in roots]
    report={'source':'gakumas_Data/data.unity3d','sha256':digest,'sprites':sprites,'horizontalMessageTrees':trees,'note':'本地研究提取；不随创作器打包。资源字段和近似重建不等于完整原游戏 UI。'}
    (out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps({'sprites':sprites,'roots':roots},ensure_ascii=False))
if __name__=='__main__':main()
