"""Isolated adaptation of 视频制作/speech-generator/bootstrap.py."""
import os
from pathlib import Path
import sys

DATA=Path(os.environ.get('CREATOR_LIBRARY_DIR',Path.home()/'AppData/Local/GakumasStoryStudio'))
ROOT = DATA/'voice-engines'
SOURCE = Path(os.environ.get('CREATOR_SOVITS_ROOT',ROOT/'sovits'))
ENGINE=SOURCE/'engine'
CACHE = ROOT / 'cache'
CACHE.mkdir(parents=True, exist_ok=True)
os.environ.update({
    'HF_HOME': str(CACHE / 'huggingface'),
    'TORCH_HOME': str(CACHE / 'torch'),
    'NUMBA_CACHE_DIR': str(CACHE / 'numba'),
    'NLTK_DATA': str(SOURCE / 'models/nltk_data'),
    'HF_HUB_OFFLINE': '1', 'TRANSFORMERS_OFFLINE': '1',
    'HF_HUB_DISABLE_TELEMETRY': '1', 'PYTHONNOUSERSITE': '1',
    'bert_path': str(SOURCE / 'models/chinese-roberta'),
    'language': 'zh_CN', 'version': 'v2',
})
sys.path[:0] = [str(ROOT), str(ENGINE), str(ENGINE / 'GPT_SoVITS')]

def prepare_engine():
    import jieba
    import jieba.posseg
    jieba.dt.tmp_dir = str(CACHE)
    sys.modules['jieba_fast'] = jieba
    sys.modules['jieba_fast.posseg'] = jieba.posseg
    import torch
    from utils import HParams
    torch.serialization.add_safe_globals([HParams])
    original_load = torch.load
    def safe_load(*args, **kwargs):
        kwargs['weights_only'] = True
        return original_load(*args, **kwargs)
    torch.load = safe_load
