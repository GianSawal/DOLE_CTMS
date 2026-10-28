"""
Encrypted backup files (.ctmsbak). Deliberately free of Django, so a backup can be
decrypted on any computer with Python and the `cryptography` package
(see tools/decrypt_backup.py).

Format, version 1:
    b"CTMSBAK1" | header length (4 bytes, big-endian) | header (JSON) | chunks...
    each chunk: length (4 bytes) | AES-256-GCM ciphertext of up to CHUNK_SIZE bytes

The key is derived from the admin's passphrase with scrypt (random salt per file). Every
chunk is authenticated, with the header as associated data and a nonce made of a random
per-file prefix, the chunk's number and a "last chunk" flag. So a wrong passphrase, any
changed byte, reordered chunks, or a file cut short are all detected on decryption
instead of producing a damaged restore.
"""
import base64
import json
import os
import struct

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

MAGIC = b'CTMSBAK1'
CHUNK_SIZE = 1024 * 1024
SCRYPT_N, SCRYPT_R, SCRYPT_P = 2 ** 15, 8, 1  # ~32 MB of memory per derivation
MIN_PASSPHRASE = 12


class BackupDecryptError(ValueError):
    """Wrong passphrase, or the file is damaged, changed, or not a CTMS backup."""


def _key(passphrase, salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P):
    return Scrypt(salt=salt, length=32, n=n, r=r, p=p).derive(passphrase.encode('utf-8'))


def _nonce(prefix, index, last):
    return prefix + struct.pack('>I', index) + (b'\x01' if last else b'\x00')


def encrypt_stream(src, dst, passphrase, info=None):
    """Encrypts everything readable from `src` into `dst` (binary file objects)."""
    if len(passphrase or '') < MIN_PASSPHRASE:
        raise ValueError(f"The passphrase must be at least {MIN_PASSPHRASE} characters.")
    salt, prefix = os.urandom(16), os.urandom(7)
    header = json.dumps({
        'version': 1, 'cipher': 'AES-256-GCM', 'kdf': 'scrypt',
        'n': SCRYPT_N, 'r': SCRYPT_R, 'p': SCRYPT_P,
        'salt': base64.b64encode(salt).decode(), 'nonce_prefix': base64.b64encode(prefix).decode(),
        'chunk_size': CHUNK_SIZE, 'info': info or {},
    }, sort_keys=True).encode('utf-8')
    aead = AESGCM(_key(passphrase, salt))
    dst.write(MAGIC + struct.pack('>I', len(header)) + header)

    index, chunk = 0, src.read(CHUNK_SIZE)
    while True:
        following = src.read(CHUNK_SIZE)
        last = not following
        sealed = aead.encrypt(_nonce(prefix, index, last), chunk, header)
        dst.write(struct.pack('>I', len(sealed)) + sealed)
        if last:
            return
        index, chunk = index + 1, following


def read_header(src):
    """The header of a backup file (dict), leaving `src` at the first chunk."""
    if src.read(len(MAGIC)) != MAGIC:
        raise BackupDecryptError("This is not a CTMS backup file.")
    size = struct.unpack('>I', src.read(4))[0]
    raw = src.read(size)
    try:
        return json.loads(raw), raw
    except ValueError:
        raise BackupDecryptError("The backup file is damaged.")


def decrypt_stream(src, dst, passphrase):
    """Decrypts a backup from `src` into `dst`; raises BackupDecryptError if anything is wrong."""
    header, raw = read_header(src)
    if header.get('version') != 1:
        raise BackupDecryptError("This backup was made by a newer CTMS version.")
    salt = base64.b64decode(header['salt'])
    prefix = base64.b64decode(header['nonce_prefix'])
    aead = AESGCM(_key(passphrase, salt, header['n'], header['r'], header['p']))

    index = 0
    while True:
        length = src.read(4)
        if len(length) < 4:
            raise BackupDecryptError("The backup file is incomplete (cut short).")
        sealed = src.read(struct.unpack('>I', length)[0])
        for last in (False, True):
            try:
                plain = aead.decrypt(_nonce(prefix, index, last), sealed, raw)
                break
            except InvalidTag:
                continue
        else:
            if index == 0:
                raise BackupDecryptError("Wrong passphrase, or the backup file was changed.")
            raise BackupDecryptError("The backup file was changed or damaged.")
        dst.write(plain)
        if last:
            if src.read(1):
                raise BackupDecryptError("The backup file has unexpected data at the end.")
            return header
        index += 1
