import getpass
import os

from django.core.management.base import BaseCommand, CommandError

from ctms.backup_crypto import BackupDecryptError, decrypt_stream


class Command(BaseCommand):
    help = ("Decrypts a backup made on the Backups page (.ctmsbak) into a zip: manifest.json, "
            "database/<table>.jsonl and, for 'everything' backups, media/. Asks for the passphrase.")

    def add_arguments(self, parser):
        parser.add_argument('backup', help="The .ctmsbak file")
        parser.add_argument('--out', help="Where to write the zip (default: same name with .zip)")

    def handle(self, *args, **options):
        source = options['backup']
        target = options['out'] or os.path.splitext(source)[0] + '.zip'
        if os.path.exists(target):
            raise CommandError(f"{target} already exists; choose another --out.")
        passphrase = getpass.getpass("Backup passphrase: ")
        try:
            with open(source, 'rb') as src, open(target, 'wb') as dst:
                header = decrypt_stream(src, dst, passphrase)
        except BackupDecryptError as e:
            os.remove(target)
            raise CommandError(str(e))
        info = header.get('info', {})
        self.stdout.write(self.style.SUCCESS(
            f"Decrypted {info.get('contents', 'backup')} backup from {info.get('created_at', '?')} to {target}"))
