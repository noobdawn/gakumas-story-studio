"""One-shot local synthesis; reads JSON from stdin, writes a WAV to stdout."""
import contextlib
import io
import json
import os
from pathlib import Path
import sys
import struct

HERE=Path(__file__).resolve().parent
from runtime_paths import VOICE
AUDIO=VOICE

def voicevox(request):
    sys.path.insert(0,str(AUDIO/'voicevox/engine/python'))
    from voicevox_core.blocking import Onnxruntime, OpenJtalk, Synthesizer, VoiceModelFile
    runtime=Path(request['runtime'])
    dictionary=Path(request['dictionary'])
    model_path=Path(request['model'])
    synth=Synthesizer(Onnxruntime.load_once(filename=str(runtime)),OpenJtalk(str(dictionary)))
    with VoiceModelFile.open(str(model_path)) as model:
        if str(model.id)!=request['modelId'] or not any(str(s.speaker_uuid).lower()==request['speaker'].lower() and any(t.id==request['style'] and t.type in ('talk','streaming_talk') for t in s.styles) for s in model.metas):
            raise ValueError('音源模型或语气已经变化，请刷新并确认')
        synth.load_voice_model(model)
    query=synth.create_audio_query(request['text'],request['style'])
    data=synth.synthesis(query,request['style'])
    if request.get('timing'):
        sys.path.insert(0,str(HERE))
        from voicevox_core import FRAME_RATE
        from voicevox_timing import extract
        metadata=json.dumps(extract(query,FRAME_RATE),separators=(',',':')).encode('utf8')
        return b'VVT1'+struct.pack('<I',len(metadata))+metadata+data
    return data

def sovits(request):
    sys.path.insert(0,str(HERE.parent/'voice'))
    from audio_probe_bootstrap import ENGINE, SOURCE, prepare_engine
    if str(Path(request['sovits']).resolve()).lower()!=str(SOURCE.resolve()).lower():
        raise ValueError('该 GPT-SoVITS 配置暂不支持生成')
    folder=SOURCE/'voices/manbo'
    profile=json.loads((folder/'voice.json').read_text(encoding='utf-8'))
    if str(profile.get('version',''))!=request['version']:raise ValueError('音源配置版本已变化，请刷新并确认')
    def profile_file(key):
        value=profile.get(key)
        if not isinstance(value,str) or Path(value).is_absolute():raise ValueError('音源配置路径无效')
        result=(folder/value).resolve()
        if folder.resolve() not in result.parents or not result.is_file():raise ValueError('音源文件缺失或路径超出音源目录')
        return str(result)
    gpt=profile_file('gpt');vits=profile_file('sovits');reference=profile_file('reference')
    os.chdir(ENGINE);prepare_engine()
    import torch
    import numpy as np
    import soundfile as sf
    if not torch.cuda.is_available():raise ValueError('GPT-SoVITS 研究配置需要 CUDA')
    from TTS_infer_pack.TTS import TTS
    settings={'version':profile['version'],'custom':{'device':'cuda','is_half':True,'t2s_weights_path':gpt,'vits_weights_path':vits,'bert_base_path':str(SOURCE/'models/chinese-roberta'),'cnhuhbert_base_path':str(SOURCE/'models/chinese-hubert')}}
    engine=TTS(settings);samples=[];rate=None
    with torch.inference_mode():
        for rate,audio in engine.run({'text':request['text'],'text_lang':request['language'],'ref_audio_path':reference,'prompt_text':profile['reference_text'],'prompt_lang':profile['reference_language'],'text_split_method':'cut5','batch_size':1,'speed_factor':1.0,'seed':42,'return_fragment':False,'parallel_infer':False}):samples.append(np.asarray(audio))
    if not samples or not any(x.size for x in samples):raise ValueError('没有生成音频')
    audio=np.concatenate(samples)
    if not np.isfinite(audio).all() or not np.any(audio):raise ValueError('生成结果无效或静音')
    out=io.BytesIO();sf.write(out,audio,rate,format='WAV',subtype='PCM_16');return out.getvalue()

def main():
    request=json.load(sys.stdin)
    if not isinstance(request.get('text'),str) or not request['text'].strip() or len(request['text'])>1000:raise ValueError('对白文本应为 1–1000 字符')
    with contextlib.redirect_stdout(sys.stderr):
        data=voicevox(request) if request['provider']=='voicevox' else sovits(request)
    sys.stdout.buffer.write(data)

if __name__=='__main__':main()
