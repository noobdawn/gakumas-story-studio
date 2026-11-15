"""Extract VOICEVOX query timing using the core's frame-rounding rules."""
import math
import struct


def f32(value):return struct.unpack('<f',struct.pack('<f',value))[0]


def extract(query,frame_rate):
    rate=f32(frame_rate);speed=f32(query.speed_scale)
    if not math.isfinite(rate) or rate<=0 or not math.isfinite(speed) or speed<=0:raise ValueError('Invalid timing rate')
    def frames(seconds):
        value=f32(seconds)
        if not math.isfinite(value) or value<0:raise ValueError('Invalid phoneme duration')
        return max(0,round(f32(f32(round(f32(value*rate)))/speed)))
    cursor=frames(query.pre_phoneme_length);items=[]
    def append(symbol,duration):
        nonlocal cursor
        count=frames(duration)
        if count:items.append({'phoneme':str(symbol),'startFrame':cursor,'endFrame':cursor+count})
        cursor+=count
    for phrase in query.accent_phrases:
        for mora in phrase.moras:
            if mora.consonant is not None:append(mora.consonant,mora.consonant_length)
            append(mora.vowel,mora.vowel_length)
        if phrase.is_interrogative and phrase.moras and phrase.moras[-1].pitch!=0:
            append(phrase.moras[-1].vowel,.15)
        if phrase.pause_mora is not None:
            m=phrase.pause_mora
            get=(lambda key: m.get(key)) if isinstance(m,dict) else (lambda key:getattr(m,key))
            if get('consonant') is not None:append(get('consonant'),get('consonant_length'))
            append(get('vowel'),get('vowel_length'))
    cursor+=frames(query.post_phoneme_length)
    if hasattr(query,'frame_length') and cursor!=query.frame_length():raise ValueError('VOICEVOX frame count differs')
    return {'frameRate':float(rate),'frameCount':cursor,'phonemes':items}
