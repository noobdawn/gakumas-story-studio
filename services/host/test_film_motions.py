import json, tempfile, unittest
from pathlib import Path
from film_motions import load

class FilmMotionsTest(unittest.TestCase):
 def test_catalog_filters_and_stable_ids(self):
  with tempfile.TemporaryDirectory(prefix='creator-motion-test-') as name:
   root=Path(name).resolve();self.assertEqual(root.parent,Path(tempfile.gettempdir()).resolve())
   (root/'exposed').mkdir();(root/'exposed'/'a.bundle').write_bytes(b'test');(root/'outside.bundle').write_bytes(b'test')
   def clip(name,role='body',end=2):return {'name':name,'role':role,'start':0,'stop':end}
   rows=[{'exposed':'exposed/a.bundle','clips':[clip('mot_all_chr_cmmn_talk-001_in_b',end=2.066666603088379),clip('mot_all_chr_cmmn_yes-003_in_b'),clip('mot_adv_env_gate_open_b'),clip('mot_all_chr_cmmn_talk-002_in_b','face'),clip('mot_all_chr_cmmn_talk-003_in_b',end=0)]},{'exposed':'outside.bundle','clips':[clip('mot_all_chr_cmmn_talk-004_in_b')]},{'exposed':'exposed/missing.bundle','clips':[clip('mot_all_chr_cmmn_talk-005_in_b')]}]
   (root/'bundles.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in rows),encoding='utf-8');a=load(root);b=load(root)
   self.assertEqual(len(a),1);self.assertEqual(a,b);self.assertEqual(a[0]['name'],'mot_all_chr_cmmn_talk-001_in_b');self.assertEqual(a[0]['length'],2.066666603088379);self.assertRegex(a[0]['id'],r'^film-[0-9a-f]{24}$')
if __name__=='__main__':unittest.main()
