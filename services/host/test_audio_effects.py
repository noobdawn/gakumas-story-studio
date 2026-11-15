import copy,json,math,struct,tempfile,unittest,wave
from pathlib import Path
import audio_effects as fx
from export_video import audio_filter

class EffectsTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name);(self.root/'shared').mkdir();self.asset={'id':'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','scope':'shared','extension':'.wav','type':'音效'}
  self.source=self.root/'shared'/(self.asset['id']+'.wav')
  with wave.open(str(self.source),'wb') as w:w.setparams((1,2,48000,0,'NONE','not compressed'));w.writeframes(b''.join(struct.pack('<h',int(7000*math.sin(2*math.pi*1000*n/48000)+3000*math.sin(2*math.pi*8000*n/48000))) for n in range(48000)))
  self.phone={'id':'p','version':1,'type':'telephone','enabled':True,'parameters':{'strength':1,'output':0}}
  self.echo={'id':'e','version':1,'type':'echo','enabled':True,'parameters':{'delay':.05,'feedback':.4,'mix':.3}}
  self.item={'asset':self.asset,'length':.5,'offset':.2,'rate':1,'effects':[self.phone]}
 def test_deterministic_pcm_and_cache(self):
  key,file=fx.prepare(self.root,self.item);before=file.read_bytes();self.assertEqual(fx.prepare(self.root,self.item),(key,file));self.assertEqual(before,file.read_bytes());self.assertNotEqual(before,self.source.read_bytes())
  with wave.open(str(file),'rb') as w:self.assertEqual(w.getnframes(),24000);self.assertEqual(w.getframerate(),48000);self.assertEqual(w.getnchannels(),2)
 def test_order_offset_rate_loop_and_effects_change_cache(self):
  key,_=fx.prepare(self.root,self.item)
  for field,value in [('offset',.3),('rate',2),('loop',True),('effects',[self.phone,self.echo])]:
   item=copy.deepcopy(self.item);item[field]=value;self.assertNotEqual(fx.prepare(self.root,item)[0],key)
  item=copy.deepcopy(self.item);item['effects']=[self.echo,self.phone];a,path=fx.prepare(self.root,item);item['effects'].reverse();b,other=fx.prepare(self.root,item);self.assertNotEqual(a,b);self.assertNotEqual(path.read_bytes(),other.read_bytes())
 def test_echo_tail_and_short_source_are_bounded(self):
  item={**self.item,'length':1.2,'offset':.8,'effects':[self.echo]};_,file=fx.prepare(self.root,item)
  with wave.open(str(file),'rb') as w:self.assertEqual(w.getnframes(),57600)
 def test_bypass_and_validation(self):
  self.phone['enabled']=False;self.assertFalse(fx.active([self.phone]));self.phone['version']=2
  with self.assertRaises(ValueError):fx.validate([self.phone])
  with self.assertRaises(ValueError):fx.cached(self.root,'../source')
  with self.assertRaises(ValueError):fx.validate([dict(self.echo,parameters={'delay':float('nan'),'feedback':.3,'mix':.3})])
 def test_source_change_invalidates(self):
  key,_=fx.prepare(self.root,self.item)
  with wave.open(str(self.source),'wb') as w:w.setparams((1,2,48000,0,'NONE','not compressed'));w.writeframes(b'\0\0'*48000)
  self.assertNotEqual(key,fx.prepare(self.root,self.item)[0])
 def test_full_wet_echo_removes_dry_impulse(self):
  with wave.open(str(self.source),'wb') as w:w.setparams((1,2,48000,0,'NONE','not compressed'));w.writeframes(struct.pack('<h',16000)+b'\0\0'*47999)
  effect=copy.deepcopy(self.echo);effect['parameters'].update(mix=1,feedback=0)
  _,file=fx.prepare(self.root,{**self.item,'offset':0,'effects':[effect]})
  with wave.open(str(file),'rb') as w:values=struct.unpack('<'+'h'*w.getnframes()*2,w.readframes(w.getnframes()))
  self.assertEqual(max(abs(x) for x in values[:2000]),0)
  self.assertGreater(max(abs(x) for x in values[4600:5000]),5000)

if __name__=='__main__':unittest.main()
