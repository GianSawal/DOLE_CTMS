"""
Two-factor sign-in for staff: after the password, a 6-digit code from Google or Microsoft
Authenticator (see totp.py), or one of the account's one-time backup codes.

Every staff account must use it; TV Display and Registration Desk accounts don't (shared
screens, no person to carry the phone). Between the password and the code, the browser
holds a short-lived signed "challenge" instead of a sign-in.
"""
import base64
import hashlib
import hmac
import io
import secrets

from django.conf import settings
from django.core import signing
from django.core.cache import cache
from django.db import transaction
from django.utils import timezone

from . import totp
from .models import CLAIM_CODE_CHARS, CtmsBackupCode, CtmsTwoFactor

CHALLENGE_SALT = 'ctms.two-factor.challenge'
# Seconds from a correct password to entering the code: room to install the app at first setup
CHALLENGE_MAX_AGE = 10 * 60
BACKUP_CODE_COUNT = 10

# Wrong codes: counted per account and NOT reset by a correct password, so knowing the
# password doesn't allow unlimited guesses at the code.
CODE_FAIL_LIMIT = 5
CODE_FAIL_WINDOW = 15 * 60


def requires_two_factor(user):
    from .permissions import is_display_account, is_registration_account
    return not (is_display_account(user) or is_registration_account(user))


def is_enabled(user):
    return CtmsTwoFactor.objects.filter(user=user, confirmed_at__isnull=False).exists()


# ---- The step between password and code ------------------------------------------------

def make_challenge(user, remember):
    return signing.dumps({'u': user.pk, 'r': bool(remember)}, salt=CHALLENGE_SALT)


def read_challenge(token):
    """(user, remember) of a valid, unexpired challenge; ValueError otherwise."""
    from django.contrib.auth import get_user_model
    try:
        data = signing.loads(str(token or ''), salt=CHALLENGE_SALT, max_age=CHALLENGE_MAX_AGE)
    except signing.BadSignature:
        raise ValueError("Your sign-in expired. Enter your username and password again.")
    user = get_user_model().objects.filter(pk=data.get('u'), is_active=True).first()
    if not user:
        raise ValueError("Your sign-in expired. Enter your username and password again.")
    return user, bool(data.get('r'))


# ---- Setup ------------------------------------------------------------------------------

def start_setup(user):
    """
    The secret for the account's authenticator app, new or from an unfinished setup (so a QR
    code already scanned keeps working if the sign-in had to be started again). Returns what
    the setup screen shows: the QR code, and the key to type in by hand.
    """
    pending = CtmsTwoFactor.objects.filter(user=user, confirmed_at__isnull=True).first()
    if pending:
        secret = pending.secret
    else:
        secret = totp.generate_secret()
        CtmsTwoFactor.objects.update_or_create(user=user, defaults={'secret': secret, 'confirmed_at': None, 'last_step': 0})
    uri = totp.provisioning_uri(secret, user.username)
    import qrcode
    image = qrcode.make(uri, box_size=6, border=2)
    buffer = io.BytesIO()
    image.save(buffer, format='PNG')
    return {
        'secret': ' '.join(secret[i:i + 4] for i in range(0, len(secret), 4)),
        'otpauth_uri': uri,
        'qr_image': 'data:image/png;base64,' + base64.b64encode(buffer.getvalue()).decode('ascii'),
    }


# ---- Codes ------------------------------------------------------------------------------

def _fail_key(user):
    return f"ctms:2fa_fail:{user.pk}"


def code_locked(user):
    return cache.get(_fail_key(user), 0) >= CODE_FAIL_LIMIT


def _record_failure(user):
    key = _fail_key(user)
    cache.add(key, 0, CODE_FAIL_WINDOW)
    try:
        cache.incr(key)
    except ValueError:
        cache.set(key, 1, CODE_FAIL_WINDOW)


def _hash_backup_code(code):
    normalized = ''.join(code.split()).replace('-', '').upper()
    return hmac.new(settings.SECRET_KEY.encode(), normalized.encode(), hashlib.sha256).hexdigest()


def new_backup_codes(user):
    """Replaces the account's backup codes. The plain codes are returned once, never stored."""
    codes = [''.join(secrets.choice(CLAIM_CODE_CHARS) for _ in range(8)) for _ in range(BACKUP_CODE_COUNT)]
    with transaction.atomic():
        CtmsBackupCode.objects.filter(user=user).delete()
        CtmsBackupCode.objects.bulk_create([CtmsBackupCode(user=user, code_hash=_hash_backup_code(c)) for c in codes])
    return [f"{c[:4]}-{c[4:]}" for c in codes]


def backup_codes_left(user):
    return CtmsBackupCode.objects.filter(user=user, used_at__isnull=True).count()


def verify(user, code):
    """
    Checks a code typed at sign-in. Returns a dict:
      {'method': 'app'|'backup', 'backup_codes': [...] or None (new codes, first setup only)}
    Raises ValueError with a message for the staff member when it's wrong or locked.
    """
    if code_locked(user):
        raise ValueError("Too many wrong codes. Wait 15 minutes, or ask your administrator to reset your two-factor sign-in.")
    typed = ''.join((code or '').split())
    with transaction.atomic():
        device = CtmsTwoFactor.objects.select_for_update().filter(user=user).first()
        if not device:
            raise ValueError("Set up your authenticator app first.")

        step = totp.matching_step(device.secret, typed, after_step=device.last_step)
        if step is not None:
            first_setup = device.confirmed_at is None
            device.last_step = step
            if first_setup:
                device.confirmed_at = timezone.now()
            device.save(update_fields=['last_step', 'confirmed_at'])
            cache.delete(_fail_key(user))
            return {'method': 'app', 'backup_codes': new_backup_codes(user) if first_setup else None}

        if device.confirmed_at and len(typed.replace('-', '')) == 8:
            backup = (CtmsBackupCode.objects.select_for_update()
                      .filter(user=user, used_at__isnull=True, code_hash=_hash_backup_code(typed)).first())
            if backup:
                backup.used_at = timezone.now()
                backup.save(update_fields=['used_at'])
                cache.delete(_fail_key(user))
                return {'method': 'backup', 'backup_codes': None}

    _record_failure(user)
    raise ValueError("That code is not correct. Enter the 6-digit code shown in your authenticator app now.")


def reset(user):
    """Turns 2FA off for the account (lost phone): it sets it up again at its next sign-in."""
    CtmsTwoFactor.objects.filter(user=user).delete()
    CtmsBackupCode.objects.filter(user=user).delete()
    cache.delete(_fail_key(user))
