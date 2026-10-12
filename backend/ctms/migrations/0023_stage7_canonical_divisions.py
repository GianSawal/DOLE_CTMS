# Stage 7 data cleanup (runs before 0024 drops the legacy tables):
#
# - accounts that still only have a legacy CtmsEmployee row (e.g. superusers that
#   set_system_admin will demote) get a DolePersonnel profile, so their office survives
# - divisions are reduced to TSSD 1, TSSD 2 and IMSD: services tagged "ALL" become
#   untagged, and MALSU / Front Desk / Window 1-10 / ALL rows are deleted from
#   csm_division (only csm_service and CTMS link tables reference it)
#
# Forward-only; restore from the pre-stage-7 backup to roll back.

from django.db import migrations

CANONICAL = ('TSSD 1', 'TSSD 2', 'IMSD')


def profiles_from_legacy_employees(apps):
    CtmsEmployee = apps.get_model('ctms', 'CtmsEmployee')
    DolePersonnel = apps.get_model('ctms', 'DolePersonnel')

    for emp in CtmsEmployee.objects.exclude(user_id=None):
        if DolePersonnel.objects.filter(user_id=emp.user_id).exists():
            continue
        employee_id, n = emp.employee_id, 1
        while DolePersonnel.objects.filter(employee_id__iexact=employee_id).exists():
            n += 1
            employee_id = f"{emp.employee_id}-{n}"
        DolePersonnel.objects.create(
            user_id=emp.user_id, employee_id=employee_id, first_name=emp.first_name,
            middle_name=emp.middle_name, last_name=emp.last_name, position=emp.position,
            office_id=emp.office_id, is_active=emp.is_active, must_change_password=emp.must_change_password,
        )


def canonical_divisions(apps, schema_editor):
    CsmDivision = apps.get_model('ctms', 'CsmDivision')
    CsmService = apps.get_model('ctms', 'CsmService')
    CtmsStaffDivision = apps.get_model('ctms', 'CtmsStaffDivision')
    DolePersonnel = apps.get_model('ctms', 'DolePersonnel')
    CtmsEmployee = apps.get_model('ctms', 'CtmsEmployee')

    tables = schema_editor.connection.introspection.table_names()
    if CsmDivision._meta.db_table not in tables or CsmService._meta.db_table not in tables:
        return  # CSM tables are absent while a fresh test database migrates

    obsolete = CsmDivision.objects.exclude(name__in=CANONICAL)
    ids = list(obsolete.values_list('id', flat=True))
    if not ids:
        return
    CsmService.objects.filter(division_id__in=ids).update(division=None)
    CtmsStaffDivision.objects.filter(division_id__in=ids).delete()
    DolePersonnel.divisions.through.objects.filter(csmdivision_id__in=ids).delete()
    CtmsEmployee.divisions.through.objects.filter(csmdivision_id__in=ids).delete()
    CsmDivision.objects.filter(id__in=ids).delete()


def forwards(apps, schema_editor):
    profiles_from_legacy_employees(apps)
    canonical_divisions(apps, schema_editor)


class Migration(migrations.Migration):

    dependencies = [
        ('ctms', '0022_stage6_unify_accounts'),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
