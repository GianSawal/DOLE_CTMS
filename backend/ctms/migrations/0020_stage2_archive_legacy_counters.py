# Stage 2: windows become office-managed resources. The legacy counters were
# auto-generated from division names (TSSD 1, IMSD, ALL, Window 1-10, ...), so
# every one is archived and each office creates its own windows. Archiving keeps
# the rows, so existing transactions still show the counter they were served at.

from django.db import migrations
from django.utils import timezone


def archive_legacy_counters(apps, schema_editor):
    CtmsCounter = apps.get_model('ctms', 'CtmsCounter')
    CtmsCounter.objects.filter(archived_at__isnull=True).update(
        archived_at=timezone.now(),
        is_active=False,
        assigned_user=None,
        assigned_at=None,
    )


def restore_legacy_counters(apps, schema_editor):
    # The pre-stage-2 queue screen re-activates its division counters on load,
    # so clearing the archive flag is enough to return to the old behaviour.
    apps.get_model('ctms', 'CtmsCounter').objects.update(archived_at=None)


class Migration(migrations.Migration):

    dependencies = [
        ('ctms', '0019_stage1_backfill'),
    ]

    operations = [
        migrations.RunPython(archive_legacy_counters, restore_legacy_counters),
    ]
