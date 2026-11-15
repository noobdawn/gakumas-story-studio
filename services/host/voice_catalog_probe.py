"""Read metadata from local VOICEVOX VVM files without loading synthesis models."""
import argparse
import json
import sys
from pathlib import Path

from runtime_paths import VOICE
AUDIO_ROOT=VOICE/'voicevox'
sys.path.insert(0,str(AUDIO_ROOT/'engine/python'))

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--models',required=True,type=Path);args=parser.parse_args()
    from voicevox_core.blocking import VoiceModelFile
    voices={};errors=[]
    if not args.models.is_dir():raise ValueError('VOICEVOX model directory not found')
    files=sorted(args.models.glob('*.vvm'))
    if not files:errors.append({'model':'目录','error':'未发现 VVM 模型文件'})
    for path in files:
        try:
            with VoiceModelFile.open(str(path)) as model:
                model_id=str(model.id)
                for speaker in model.metas:
                    uid=str(speaker.speaker_uuid);voice=voices.setdefault(uid,{'id':'voicevox:'+uid,'type':'音源','alias':'','source':speaker.name,'voiceProvider':'voicevox','styles':[]})
                    for style in speaker.styles:
                        if style.type not in ('talk','streaming_talk'):continue
                        voice['styles'].append({'id':int(style.id),'name':style.name,'type':style.type,'model':path.name,'modelId':model_id,'version':speaker.version})
        except Exception as error:errors.append({'model':path.name,'error':str(error)[:300]})
    voices=[v for v in voices.values() if v['styles']]
    if files and not voices and not errors:errors.append({'model':'目录','error':'模型中没有可用的朗读风格'})
    for voice in voices:voice['styles'].sort(key=lambda s:(s['id'],s['model']))
    sys.stdout.buffer.write(json.dumps({'voices':voices,'errors':errors},ensure_ascii=False).encode('utf-8'))

if __name__=='__main__':main()
