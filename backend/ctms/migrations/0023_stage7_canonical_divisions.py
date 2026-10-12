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
    # csm_division / csm_service belong to the CSM and their migration state is not the
    # real schema (csm_service.division_id is missing from it), so they are changed with SQL.
    CtmsStaffDivision = apps.get_model('ctms', 'CtmsStaffDivision')
    DolePersonnel = apps.get_model('ctms', 'DolePersonnel')
    CtmsEmployee = apps.get_model('ctms', 'CtmsEmployee')

    connection = schema_editor.connection
    tables = connection.introspection.table_names()
    if 'csm_division' not in tables or 'csm_service' not in tables:
        return  # CSM tables are absent while a fresh test database migrates

    with connection.cursor() as cursor:
        placeholders = ', '.join(['%s'] * len(CANONICAL))
        cursor.execute(f"SELECT id FROM csm_division WHERE name NOT IN ({placeholders})", list(CANONICAL))
        ids = [row[0] for row in cursor.fetchall()]
        if not ids:
            return

        CtmsStaffDivision.objects.filter(division_id__in=ids).delete()
        DolePersonnel.divisions.through.objects.filter(csmdivision_id__in=ids).delete()
        CtmsEmployee.divisions.through.objects.filter(csmdivision_id__in=ids).delete()

        id_list = ', '.join(['%s'] * len(ids))
        cursor.execute(f"UPDATE csm_service SET division_id = NULL WHERE division_id IN ({id_list})", ids)
        cursor.execute(f"DELETE FROM csm_division WHERE id IN ({id_list})", ids)


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
