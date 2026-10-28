"""
On-demand backups for the system administrator (Backups page). A backup is a zip,
encrypted with the admin's passphrase (backup_crypto.py) and downloaded at once; nothing
is kept on the server.

  - "database": every table of the database the system uses, row by row. The database is
    shared with the CSM system, so its tables are included too: the backup is complete.
  - "everything": the database plus uploaded files (MEDIA_ROOT: the offices' TV videos).

Inside the zip: manifest.json, database/<table>.jsonl (first line: the column names,
then one JSON array per row) and, for "everything", media/<path>.
"""
import base64
import datetime
import decimal
import json
import os
import tempfile
import uuid
import zipfile

from django.conf import settings
from django.db import connection
from django.db.migrations.recorder import MigrationRecorder
from django.utils import timezone

from .backup_crypto import encrypt_stream

CONTENTS = {
    'database': 'Database only',
    'everything': 'Database and uploaded files (TV videos)',
}
FETCH_ROWS = 1000


def _json_value(value):
    if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
        return value.isoformat()
    if isinstance(value, decimal.Decimal):
        return str(value)
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, (bytes, bytearray, memoryview)):
        return {'$base64': base64.b64encode(bytes(value)).decode()}
    raise TypeError(f"Can't store {type(value).__name__} in a backup")


def _dump_tables(archive):
    counts = {}
    quote = connection.ops.quote_name
    with connection.cursor() as cursor:
        for table in sorted(connection.introspection.table_names()):
            cursor.execute(f"SELECT * FROM {quote(table)}")
            columns = [col[0] for col in cursor.description]
            rows = 0
            with archive.open(f"database/{table}.jsonl", 'w') as out:
                out.write((json.dumps(columns) + '\n').encode('utf-8'))
                while True:
                    batch = cursor.fetchmany(FETCH_ROWS)
                    if not batch:
                        break
                    for row in batch:
                        out.write((json.dumps(list(row), default=_json_value, ensure_ascii=False) + '\n').encode('utf-8'))
                    rows += len(batch)
            counts[table] = rows
    return counts


def _add_media(archive):
    root = str(settings.MEDIA_ROOT)
    files, size = 0, 0
    if not os.path.isdir(root):
        return files, size
    for folder, _, names in os.walk(root):
        for name in names:
            path = os.path.join(folder, name)
            relative = os.path.relpath(path, root).replace(os.sep, '/')
            # Videos are already compressed: store them as they are
            archive.write(path, f"media/{relative}", compress_type=zipfile.ZIP_STORED)
            files += 1
            size += os.path.getsize(path)
    return files, size


def create_backup(contents, passphrase, created_by):
    """
    Builds and encrypts a backup. Returns (encrypted temporary file positioned at its start,
    file name, summary dict). The caller streams the file and closes it, which deletes it.
    """
    if contents not in CONTENTS:
        raise ValueError("Choose what to back up.")
    now = timezone.localtime()
    summary = {'contents': contents, 'created_at': now.isoformat(), 'created_by': created_by,
               'database_engine': connection.vendor}

    with tempfile.TemporaryFile() as plain:
        with zipfile.ZipFile(plain, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            counts = _dump_tables(archive)
            summary['tables'] = len(counts)
            summary['rows'] = sum(counts.values())
            if contents == 'everything':
                summary['media_files'], summary['media_bytes'] = _add_media(archive)
            latest = (MigrationRecorder.Migration.objects.filter(app='ctms').order_by('-id')
                      .values_list('name', flat=True).first())
            archive.writestr('manifest.json', json.dumps({
                **summary, 'format': 'ctms-backup-1', 'ctms_migration': latest, 'row_counts': counts,
            }, indent=2))
        plain.seek(0)
        encrypted = tempfile.TemporaryFile()
        try:
            encrypt_stream(plain, encrypted, passphrase, info={
                'contents': contents, 'created_at': summary['created_at'], 'system': 'DOLE CTMS'})
        except Exception:
            encrypted.close()
            raise
    summary['bytes'] = encrypted.tell()
    encrypted.seek(0)
    name = f"ctms-backup-{now:%Y%m%d-%H%M}-{contents}.ctmsbak"
    return encrypted, name, summary


# ---- Scheduled backups (every day at BACKUP_TIME, kept on the server) ----------------------

import logging
import re
import threading
import time as _time

logger = logging.getLogger(__name__)

# Only these names are listed or downloaded: nothing else in the folder is ever served
STORED_NAME = re.compile(r'^ctms-backup-\d{8}-\d{4}-(database|everything)(-scheduled)?\.ctmsbak$')
CHECK_EVERY = 60  # seconds between "is a backup due?" checks


def server_passphrase():
    """The .env passphrase (BACKUP_PASSPHRASE), or '' when missing or too short to use."""
    from .backup_crypto import MIN_PASSPHRASE
    value = settings.BACKUP_PASSPHRASE or ''
    return value if len(value) >= MIN_PASSPHRASE else ''


def _schedule_time():
    hour, minute = (int(x) for x in settings.BACKUP_TIME.split(':'))
    return hour, minute


def schedule_status(now=None):
    """What the Backups page shows about the nightly backup."""
    from .backup_crypto import MIN_PASSPHRASE
    now = timezone.localtime(now)
    problem = None
    if not settings.BACKUP_SCHEDULE_ENABLED:
        problem = "Turned off (BACKUP_SCHEDULE_ENABLED=False)."
    elif not settings.BACKUP_PASSPHRASE:
        problem = "Set BACKUP_PASSPHRASE in the server's .env to turn on nightly backups."
    elif not server_passphrase():
        problem = f"BACKUP_PASSPHRASE in .env is shorter than {MIN_PASSPHRASE} characters."
    hour, minute = _schedule_time()
    next_run = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if next_run <= now or _claimed(now.date()):
        next_run += datetime.timedelta(days=1)
    return {
        'enabled': problem is None,
        'problem': problem,
        'time': settings.BACKUP_TIME,
        'timezone': settings.TIME_ZONE,
        'next_run': next_run.isoformat() if problem is None else None,
        'keep': settings.BACKUP_KEEP,
        'contents': settings.BACKUP_SCHEDULE_CONTENTS,
    }


def stored_backups():
    folder = settings.BACKUP_DIR
    if not os.path.isdir(folder):
        return []
    items = []
    for name in os.listdir(folder):
        if STORED_NAME.match(name):
            path = os.path.join(folder, name)
            items.append({'name': name, 'bytes': os.path.getsize(path),
                          'created_at': datetime.datetime.fromtimestamp(os.path.getmtime(path), tz=datetime.timezone.utc).isoformat(),
                          'scheduled': '-scheduled' in name})
    return sorted(items, key=lambda i: i['name'], reverse=True)


def stored_backup_path(name):
    """The full path of a stored backup, or None (unknown name, or not a backup file)."""
    if not STORED_NAME.match(name or ''):
        return None
    path = os.path.join(settings.BACKUP_DIR, name)
    return path if os.path.isfile(path) else None


def save_scheduled_backup():
    """Makes the nightly backup into BACKUP_DIR and removes the oldest beyond BACKUP_KEEP."""
    contents = settings.BACKUP_SCHEDULE_CONTENTS if settings.BACKUP_SCHEDULE_CONTENTS in CONTENTS else 'database'
    os.makedirs(settings.BACKUP_DIR, exist_ok=True)
    encrypted, name, summary = create_backup(contents, server_passphrase(), 'System (scheduled)')
    name = name.replace('.ctmsbak', '-scheduled.ctmsbak')
    final = os.path.join(settings.BACKUP_DIR, name)
    partial = final + '.part'  # a half-written file is never listed as a backup
    with encrypted, open(partial, 'wb') as out:
        while True:
            block = encrypted.read(1024 * 1024)
            if not block:
                break
            out.write(block)
    os.replace(partial, final)
    for old in [b for b in stored_backups() if b['scheduled']][settings.BACKUP_KEEP:]:
        os.remove(os.path.join(settings.BACKUP_DIR, old['name']))
    return name, summary


def _marker(day):
    return os.path.join(settings.BACKUP_DIR, f".scheduled-{day:%Y%m%d}")


def _claimed(day):
    return os.path.exists(_marker(day))


def _claim(day):
    """True for the one process that gets to make `day`'s backup (gunicorn runs several)."""
    os.makedirs(settings.BACKUP_DIR, exist_ok=True)
    try:
        os.close(os.open(_marker(day), os.O_CREAT | os.O_EXCL | os.O_WRONLY))
    except FileExistsError:
        return False
    for name in os.listdir(settings.BACKUP_DIR):  # markers older than a week are no longer needed
        if name.startswith('.scheduled-') and name < os.path.basename(_marker(day - datetime.timedelta(days=7))):
            try:
                os.remove(os.path.join(settings.BACKUP_DIR, name))
            except OSError:
                pass
    return True


def run_if_due(now=None):
    """Makes today's backup if it's past BACKUP_TIME and nobody has yet. Returns the name, or None."""
    from .models import CtmsAuditLog, log_audit_event
    status = schedule_status(now)
    if not status['enabled']:
        return None
    now = timezone.localtime(now)
    hour, minute = _schedule_time()
    if (now.hour, now.minute) < (hour, minute) or not _claim(now.date()):
        return None
    try:
        name, summary = save_scheduled_backup()
    except Exception:
        logger.exception("Scheduled backup failed")
        log_audit_event(action='BACKUP_FAILED', category=CtmsAuditLog.CATEGORY_CONFIG,
                        actor_username='System', actor_role='Scheduled backup',
                        target_type='Backup', description="The nightly backup failed. See the server log.")
        return None
    log_audit_event(action='BACKUP_CREATED', category=CtmsAuditLog.CATEGORY_CONFIG,
                    actor_username='System', actor_role='Scheduled backup', target_type='Backup', target_repr=name,
                    description=f"Nightly encrypted backup ({CONTENTS[summary['contents']]}) saved on the server.",
                    details={k: v for k, v in summary.items() if k != 'created_by'})
    return name


_scheduler_started = False


def start_scheduler():
    """Checks every minute in a background thread, in each server process (see run_if_due)."""
    global _scheduler_started
    if _scheduler_started:
        return
    _scheduler_started = True

    def loop():
        from django.db import close_old_connections
        while True:
            _time.sleep(CHECK_EVERY)
            try:
                close_old_connections()
                run_if_due()
            except Exception:
                logger.exception("Backup scheduler check failed")
            finally:
                close_old_connections()

    threading.Thread(target=loop, name='ctms-backup-scheduler', daemon=True).start()
