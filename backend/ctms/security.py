"""
Small security helpers: per-account sign-in limits, per-office check-in code
limits, and checking that an uploaded "video" really is a video.

Limits are counted per account / per office (not per IP address): the IP the
app sees can be faked through the X-Forwarded-For header, an account name can't.
"""
import os

from django.core.cache import cache

# Sign-in: this many wrong passwords for one account within the window locks that
# account's sign-in for the rest of the window (correct passwords too).
LOGIN_FAIL_LIMIT = 10
LOGIN_FAIL_WINDOW = 15 * 60

# Check-in code: after this many wrong codes for one office within the window, the
# office gets a new code at once (the TV shows it within seconds), so guessing all
# 10,000 codes is pointless. Clients are never blocked.
OFFICE_CODE_FAIL_LIMIT = 30
OFFICE_CODE_FAIL_WINDOW = 10 * 60


def _login_key(username):
    return f"ctms:login_fail:{(username or '').strip().lower()}"


def login_locked(username):
    return bool(username) and cache.get(_login_key(username), 0) >= LOGIN_FAIL_LIMIT


def record_login_failure(username):
    if not username:
        return
    key = _login_key(username)
    cache.add(key, 0, LOGIN_FAIL_WINDOW)
    try:
        cache.incr(key)
    except ValueError:  # expired between add() and incr()
        cache.set(key, 1, LOGIN_FAIL_WINDOW)


def clear_login_failures(username):
    cache.delete(_login_key(username))


def record_office_code_failure(office_id):
    """Counts a wrong check-in code; True when the office's code should be replaced now."""
    key = f"ctms:office_code_fail:{office_id}"
    cache.add(key, 0, OFFICE_CODE_FAIL_WINDOW)
    try:
        count = cache.incr(key)
    except ValueError:
        cache.set(key, 1, OFFICE_CODE_FAIL_WINDOW)
        count = 1
    if count >= OFFICE_CODE_FAIL_LIMIT:
        cache.delete(key)
        return True
    return False


VIDEO_EXTENSIONS = {
    '.mp4', '.m4v', '.mov', '.3gp', '.webm', '.mkv', '.ogg', '.ogv',
    '.avi', '.mpg', '.mpeg', '.ts', '.flv', '.wmv',
}


def _looks_like_video(head, ext=''):
    """Recognises the common video containers from their first bytes."""
    if len(head) >= 12 and head[4:8] in (b'ftyp', b'moov', b'mdat', b'free', b'wide', b'skip', b'pnot'):
        return True                                   # MP4 / MOV / M4V / 3GP
    if head.startswith(b'\x1a\x45\xdf\xa3'):
        return True                                   # WebM / MKV
    if head.startswith(b'OggS'):
        return True                                   # Ogg
    if head.startswith(b'RIFF') and head[8:12] == b'AVI ':
        return True                                   # AVI
    if head.startswith((b'\x00\x00\x01\xba', b'\x00\x00\x01\xb3')):
        return True                                   # MPEG program / elementary stream
    if ext == '.ts' and head[:1] == b'\x47':
        return True                                   # MPEG transport stream
    if head.startswith(b'FLV'):
        return True                                   # FLV
    if head.startswith(b'\x30\x26\xb2\x75\x8e\x66\xcf\x11'):
        return True                                   # WMV / ASF
    return False


def video_upload_error(uploaded):
    """None if `uploaded` is a real video file, else a message for the staff member."""
    ext = os.path.splitext(uploaded.name or '')[1].lower()
    if ext not in VIDEO_EXTENSIONS:
        return "Only video files can be uploaded (for example .mp4, .webm or .mov)."
    head = uploaded.read(16)
    uploaded.seek(0)
    if not _looks_like_video(head, ext):
        return "This file isn't a valid video. Please choose a video file such as .mp4."
    return None


def end_all_sessions(user):
    """
    Signs `user` out everywhere: every refresh token issued to them stops working, so no
    other browser can renew its sign-in (their short-lived access tokens lapse within
    30 minutes). Used when a password is changed or reset and when an account is disabled.
    """
    from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
    from django.utils import timezone
    unexpired = list(OutstandingToken.objects.filter(user=user, expires_at__gt=timezone.now()))
    # Also the ones just replaced by a renewal, so their grace minute can't be used either
    mark_ended_on_purpose(t.jti for t in unexpired)
    BlacklistedToken.objects.bulk_create([BlacklistedToken(token=t) for t in unexpired], ignore_conflicts=True)


# A refresh token replaced by a renewal may renew once more for a minute (two tabs renewing
# together); one revoked on purpose (sign-out, new password, disabled account) never may.
_ENDED_TTL = 5 * 60


def mark_ended_on_purpose(jtis):
    cache.set_many({f"ctms:session_ended:{jti}": True for jti in jtis}, _ENDED_TTL)


def ended_on_purpose(jti):
    return bool(cache.get(f"ctms:session_ended:{jti}"))
