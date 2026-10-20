"""
Server-side announcement voice (Piper, an offline neural text-to-speech engine).

The TV plays the audio this makes after the chime, instead of the browser's own voice, so
every TV sounds the same and clear. Turned on by CTMS_TTS_VOICE (path to a Piper .onnx
voice); when it is unset or Piper is missing, the TV keeps using the browser voice.
"""
import io
import logging
import os
import re
import threading
import wave
from collections import OrderedDict

logger = logging.getLogger(__name__)

DIGITS = 'zero one two three four five six seven eight nine'.split()
LENGTH_SCALE = float(os.getenv('CTMS_TTS_LENGTH_SCALE', '1.12'))  # >1 is slower, like a PA announcement

_lock = threading.Lock()
_voice = None
_voice_failed = False
_cache = OrderedDict()  # text -> wav bytes (a recall repeats the same text)
_CACHE_SIZE = 200


def spoken_queue(queue_no):
    q = str(queue_no or '').strip().upper()
    prefix = ''
    if q.startswith('P-'):
        prefix, q = 'Priority, P, ', q[2:]
    return prefix + ' '.join(DIGITS[int(c)] if c.isdigit() else c for c in q)


def spoken_window(name):
    # Abbreviations like TSSD or IMSD are spelled out letter by letter
    return re.sub(r'\b([A-Z]{2,5})\b', lambda m: ' '.join(m.group(1)), str(name or 'the designated window'))


# What the TV says when its sound is switched on (fixed text: the endpoint can't be made to say anything else)
SOUND_CHECK_TEXT = "Sound check. Announcements on this display are now on."


def announcement_text(queue_no, window, personnel=''):
    text = f"Queue number, {spoken_queue(queue_no)}. Please proceed to, {spoken_window(window)}."
    if personnel and personnel.strip():
        text += f" Please look for {personnel.strip()}."
    return text


def _load_voice():
    global _voice, _voice_failed
    if _voice is not None or _voice_failed:
        return _voice
    path = os.getenv('CTMS_TTS_VOICE', '').strip()
    if not path:
        _voice_failed = True
        return None
    try:
        from piper import PiperVoice
        _voice = PiperVoice.load(path)
    except Exception:
        logger.exception("Announcement voice could not be loaded from %s", path)
        _voice_failed = True
    return _voice


def is_enabled():
    with _lock:
        return _load_voice() is not None


def synthesize(text):
    """WAV bytes for `text`, or None when the server voice is not available."""
    with _lock:
        if text in _cache:
            _cache.move_to_end(text)
            return _cache[text]
        voice = _load_voice()
        if voice is None:
            return None
        from piper import SynthesisConfig
        buf = io.BytesIO()
        with wave.open(buf, 'wb') as wav:
            voice.synthesize_wav(text, wav, syn_config=SynthesisConfig(length_scale=LENGTH_SCALE))
        data = buf.getvalue()
        _cache[text] = data
        if len(_cache) > _CACHE_SIZE:
            _cache.popitem(last=False)
        return data
