import os
import sys

from django.apps import AppConfig


def _is_web_server():
    """Running as the web server (gunicorn, or runserver's serving process), not a command or tests."""
    program = os.path.basename(sys.argv[0] if sys.argv else '')
    if 'gunicorn' in program:
        return True
    if len(sys.argv) > 1 and sys.argv[1] == 'runserver':
        # With auto-reload, only the child process (RUN_MAIN) serves requests
        return '--noreload' in sys.argv or os.environ.get('RUN_MAIN') == 'true'
    return False


class CtmsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'ctms'
    verbose_name = 'Client Transaction Monitoring System'

    def ready(self):
        # Nightly encrypted backups (ctms/backups.py): checked once a minute in each server
        # process; only one makes the day's backup.
        if _is_web_server():
            from .backups import start_scheduler
            start_scheduler()
