"""Resolve the four legacy motion IDs against a prepared local catalog."""
import json,math
from pathlib import Path
BUNDLES={'shy':'mot_all_chr_ttmr_tereru-002_in','idle':'mot_all_chr_ttmr_idle-001_in','angry':'mot_all_chr_ttmr_angry-001_in','yes':'mot_all_chr_cmmn_yes-003_in'}
DURATIONS={'shy':3.5333335399627686,'idle':1.0,'angry':1.933333396911621,'yes':1.5666667222976685}
def resolve(root):
 root=Path(root).resolve(strict=True);exposed=(root/'exposed').resolve(strict=True);wanted=set(BUNDLES.values());rows={}
 for line in (root/'bundles.jsonl').read_text(encoding='utf8').splitlines():
  row=json.loads(line);name=row.get('name')
  if name in wanted:
   if name in rows:raise ValueError('重复的基础动作：'+name)
   rows[name]=row
 result={}
 for ident,name in BUNDLES.items():
  row=rows.get(name)
  if not row or row.get('error') or row.get('inspectionError'):raise ValueError('基础动作缺失或检查失败：'+name)
  rel=row.get('exposed');expected='exposed/'+name+'.bundle'
  if rel!=expected:raise ValueError('基础动作资源路径无效：'+name)
  raw=root/rel
  if raw.is_symlink():raise ValueError('基础动作不能是符号链接：'+name)
  try:file=raw.resolve(strict=True)
  except FileNotFoundError:raise ValueError('基础动作文件不存在：'+name) from None
  if file.parent!=exposed or not file.is_file():raise ValueError('基础动作超出缓存目录：'+name)
  with file.open('rb') as f:
   if f.read(8)!=b'UnityFS\0':raise ValueError('基础动作包格式无效：'+name)
  clips=[c for c in row.get('clips',[]) if c.get('role')=='body']
  if len(clips)!=1 or clips[0].get('name')!=name+'_b':raise ValueError('基础动作片段不匹配：'+name)
  a,b=clips[0].get('start'),clips[0].get('stop')
  if isinstance(a,bool) or isinstance(b,bool) or not isinstance(a,(int,float)) or not isinstance(b,(int,float)) or not math.isfinite(a) or not math.isfinite(b) or abs(a)>0.001 or abs((b-a)-DURATIONS[ident])>0.001:raise ValueError('基础动作时长与旧工程不匹配：'+name)
  result[ident]=file
 return result
