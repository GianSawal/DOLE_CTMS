from django.core.management.base import BaseCommand, CommandError

from ctms import backups


class Command(BaseCommand):
    help = ("Makes an encrypted backup into BACKUP_DIR now, with the .env passphrase (BACKUP_PASSPHRASE), "
            "like the nightly one. The nightly backup runs by itself; use this for an extra copy or from cron.")

    def handle(self, *args, **options):
        if not backups.server_passphrase():
            raise CommandError("Set BACKUP_PASSPHRASE (at least 12 characters) in the server's .env first.")
        name, summary = backups.save_scheduled_backup()
        self.stdout.write(self.style.SUCCESS(
            f"Saved {name} ({summary['tables']} tables, {summary['rows']} rows, {summary['bytes']} bytes)"))
