"""
Decrypts a CTMS backup (.ctmsbak) on any computer with Python 3 and the `cryptography`
package (pip install cryptography); Django and the CTMS server are not needed.

    python decrypt_backup.py ctms-backup-20261029-1030-database.ctmsbak

It asks for the passphrase and writes the zip next to the backup.
"""
import getpass
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from ctms.backup_crypto import BackupDecryptError, decrypt_stream  # noqa: E402


def main():
    if len(sys.argv) not in (2, 3):
        print(__doc__)
        return 2
    source = sys.argv[1]
    target = sys.argv[2] if len(sys.argv) == 3 else os.path.splitext(source)[0] + '.zip'
    if os.path.exists(target):
        print(f"{target} already exists; give another output name as the second argument.")
        return 1
    passphrase = getpass.getpass("Backup passphrase: ")
    try:
        with open(source, 'rb') as src, open(target, 'wb') as dst:
            header = decrypt_stream(src, dst, passphrase)
    except BackupDecryptError as e:
        os.remove(target)
        print(e)
        return 1
    info = header.get('info', {})
    print(f"Decrypted {info.get('contents', 'backup')} backup from {info.get('created_at', '?')} to {target}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
