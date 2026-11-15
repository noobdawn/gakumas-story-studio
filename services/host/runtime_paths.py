"""Paths shared by source checkouts and the portable Windows distribution."""
import os
from pathlib import Path
ROOT=Path(os.environ.get('CREATOR_APP_ROOT',Path(__file__).resolve().parents[2]))
UI=ROOT/'apps/desktop/ui'
PLAYER=ROOT/'runtime/player/CreatorPlayer.exe'
DATA=Path(os.environ.get('CREATOR_LIBRARY_DIR',Path(os.environ.get('LOCALAPPDATA',Path.home()/'AppData/Local'))/'GakumasStoryStudio'))
VOICE=DATA/'voice-engines'
