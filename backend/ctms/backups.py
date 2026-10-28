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
