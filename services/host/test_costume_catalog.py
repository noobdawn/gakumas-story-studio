import json,tempfile,unittest
from pathlib import Path
from costume_catalog import load

class CostumeCatalogTest(unittest.TestCase):
 def test_catalog_limits_paths_and_reports_missing_resources(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);(root/'bundles').mkdir()
   body='mdl_chr_ttmr-cstm-0035_body';face='mdl_chr_ttmr-base-0000_face';hair='mdl_chr_ttmr-base-0000_hair'
   rows=[{'id':1,'name':'shader','file':'bundles/shader.bundle','dependencies':[]},{'id':2,'name':body,'file':'bundles/'+body+'.bundle','dependencies':[1]},{'id':3,'name':face,'file':'bundles/'+face+'.bundle','dependencies':[]},{'id':4,'name':hair,'file':'bundles/'+hair+'.bundle','dependencies':[]}]
   for row in rows:(root/row['file']).write_bytes(b'UnityFS\0test')
   (root/'bundles.jsonl').write_text('\n'.join(json.dumps(x) for x in rows),encoding='utf8')
   result=load(root);self.assertEqual(len(result),1);a=result[0];self.assertEqual((a['character'],a['kind'],a['number']),('ttmr','cstm','0035'));self.assertTrue(a['bodyAvailable'] and a['dependenciesAvailable'] and a['baseFaceAvailable'] and a['baseHairAvailable']);self.assertFalse(a['currentDefault']);self.assertNotIn('file',a)
   (root/'bundles/shader.bundle').unlink();self.assertEqual(load(root)[0]['missingDependencies'],['1'])
   rows[1]['file']='bundles/../outside.bundle';(root/'bundles.jsonl').write_text('\n'.join(json.dumps(x) for x in rows),encoding='utf8');self.assertFalse(load(root)[0]['bodyAvailable'])
 def test_rejects_duplicate_names(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);(root/'bundles').mkdir();row={'id':1,'name':'shader','file':'bundles/shader.bundle','dependencies':[]};(root/'bundles.jsonl').write_text(json.dumps(row)+'\n'+json.dumps(row),encoding='utf8')
   with self.assertRaises(ValueError):load(root)
 def test_player_eligibility_requires_available_supported_dependencies(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);(root/'bundles').mkdir();body='mdl_chr_ttmr-cstm-0000_body';dep='mdl_chr_kcna-cstm-0090_body'
   rows=[{'id':1,'name':'actor-shader'},{'id':2,'name':body,'dependencies':[1]},{'id':3,'name':dep,'dependencies':[1]}]
   for row in rows:
    row['file']='bundles/'+row['name']+'.bundle';(root/row['file']).write_bytes(b'UnityFS\0test')
   index=root/'bundles.jsonl'
   def save():index.write_text('\n'.join(json.dumps(x) for x in rows),encoding='utf8')
   save();self.assertTrue(next(x for x in load(root) if x['name']==body)['playerAvailable'])
   rows[1]['dependencies']=[1,3];save();item=next(x for x in load(root) if x['name']==body);self.assertTrue(item['playerAvailable']);self.assertEqual(item['dependencyBundles'],[dep])
   nested='mdl_chr_hski-cstm-0001_body';extra={'id':4,'name':nested,'dependencies':[1],'file':'bundles/'+nested+'.bundle'};rows.append(extra);(root/extra['file']).write_bytes(b'UnityFS\0test');rows[2]['dependencies']=[1,4];save()
   self.assertEqual(next(x for x in load(root) if x['name']==body)['dependencyBundles'],[nested,dep])
   rows[2]['dependencies']=[2];save();self.assertFalse(next(x for x in load(root) if x['name']==body)['playerAvailable'])
   rows[2]['dependencies']=[1];save();(root/rows[0]['file']).unlink();self.assertFalse(next(x for x in load(root) if x['name']==body)['playerAvailable'])
if __name__=='__main__':unittest.main()
