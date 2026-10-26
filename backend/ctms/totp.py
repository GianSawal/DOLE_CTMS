"""
Time-based one-time codes (TOTP, RFC 6238): the 6-digit codes of Google Authenticator,
Microsoft Authenticator and similar apps. SHA-1, 30-second steps, 6 digits: the defaults
every authenticator app supports.
"""
import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote, urlencode

STEP_SECONDS = 30
DIGITS = 6
# Codes from one step before or after are accepted too, for phone clocks a little off
DRIFT_STEPS = 1
ISSUER = 'DOLE CTMS'


def generate_secret():
    """A new random secret, base32 as authenticator apps expect (160 bits, per RFC 4226)."""
    return base64.b32encode(secrets.token_bytes(20)).decode('ascii')


def current_step(now=None):
    return int((time.time() if now is None else now) // STEP_SECONDS)


def code_at(secret, step):
    key = base64.b32decode(secret, casefold=True)
    digest = hmac.new(key, struct.pack('>Q', step), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    number = struct.unpack('>I', digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(number % (10 ** DIGITS)).zfill(DIGITS)


def matching_step(secret, code, after_step=0, now=None):
    """
    The time step `code` belongs to, or None if it is wrong. Only steps after `after_step`
    count, so a code that was already used can't be used again (replay).
    """
    code = ''.join((code or '').split())
    if len(code) != DIGITS or not code.isdigit():
        return None
    step = current_step(now)
    for candidate in range(step - DRIFT_STEPS, step + DRIFT_STEPS + 1):
        if candidate > after_step and hmac.compare_digest(code_at(secret, candidate), code):
            return candidate
    return None


def provisioning_uri(secret, account_name):
    """The otpauth:// link an authenticator app reads from the setup QR code."""
    label = quote(f"{ISSUER}:{account_name}")
    params = urlencode({'secret': secret, 'issuer': ISSUER, 'algorithm': 'SHA1',
                        'digits': DIGITS, 'period': STEP_SECONDS})
    return f"otpauth://totp/{label}?{params}"
