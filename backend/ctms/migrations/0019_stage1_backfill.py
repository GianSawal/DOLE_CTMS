# Stage 1 data backfill: office types, transaction owners, CSM attribution names,
# and must_change_password on the canonical personnel profile.
# Every step only fills new columns/tables, so reversing just clears them.

from django.db import migrations

REGIONAL_OFFICE_CODES = {'RO3'}


def _full_name(p):
    mid = f" {p.middle_name}" if p.middle_name else ""
    return f"{p.first_name}{mid} {p.last_name}".strip()


def _user_display_name(user, personnel_by_user):
    p = personnel_by_user.get(user.id)
    if p:
        return _full_name(p)
    return f"{user.first_name} {user.last_name}".strip() or user.username


def backfill_office_profiles(apps, schema_editor):
    CsmOffice = apps.get_model('ctms', 'CsmOffice')
    CtmsOfficeProfile = apps.get_model('ctms', 'CtmsOfficeProfile')
    # csm_office is owned by the CSM; it is absent while a fresh test database migrates.
    if CsmOffice._meta.db_table not in schema_editor.connection.introspection.table_names():
        return
    for office in CsmOffice.objects.all():
        office_type = 'REGIONAL' if (office.code or '').strip().upper() in REGIONAL_OFFICE_CODES else 'PROVINCIAL'
        CtmsOfficeProfile.objects.get_or_create(office_id=office.id, defaults={'office_type': office_type})


def backfill_must_change_password(apps, schema_editor):
    DolePersonnel = apps.get_model('ctms', 'DolePersonnel')
    CtmsEmployee = apps.get_model('ctms', 'CtmsEmployee')
    flags = dict(CtmsEmployee.objects.exclude(user_id=None).values_list('user_id', 'must_change_password'))
    for p in DolePersonnel.objects.exclude(user_id=None):
        if flags.get(p.user_id):
            p.must_change_password = True
            p.save(update_fields=['must_change_password'])


def _resolve_user(name, office_id, personnel, users_by_username):
    """Exact (case-insensitive) match of a legacy handler name to a user account. Ambiguous -> None."""
    clean = (name or '').strip().lower()
    if not clean:
        return None

    def matches(p):
        return clean in (
            p.employee_id.strip().lower(),
            _full_name(p).lower(),
            f"{p.first_name} {p.last_name}".strip().lower(),
        )

    for scope in ([p for p in personnel if p.office_id == office_id], personnel):
        hits = {p.user_id for p in scope if p.user_id and matches(p)}
        if len(hits) == 1:
            return hits.pop()
        if len(hits) > 1:
            return None
    return users_by_username.get(clean)


def backfill_transactions(apps, schema_editor):
    CtmsTransaction = apps.get_model('ctms', 'CtmsTransaction')
    DolePersonnel = apps.get_model('ctms', 'DolePersonnel')
    User = apps.get_model('auth', 'User')

    personnel = list(DolePersonnel.objects.all())
    personnel_by_user = {p.user_id: p for p in personnel if p.user_id}
    users = {u.id: u for u in User.objects.all()}
    users_by_username = {u.username.strip().lower(): u.id for u in users.values()}

    for tx in CtmsTransaction.objects.all().iterator():
        fields = []
        if tx.assigned_to_id is None and tx.assigned_personnel:
            user_id = _resolve_user(tx.assigned_personnel, tx.office_id, personnel, users_by_username)
            if user_id:
                tx.assigned_to_id = user_id
                fields.append('assigned_to')

        if tx.status == 'done' and not tx.served_by_name:
            # The officer who handled the client, falling back to whoever pressed Done.
            if tx.assigned_to_id and tx.assigned_to_id in users:
                name = _user_display_name(users[tx.assigned_to_id], personnel_by_user)
            elif tx.assigned_personnel:
                name = tx.assigned_personnel.strip()
            elif tx.served_by_id and tx.served_by_id in users:
                name = _user_display_name(users[tx.served_by_id], personnel_by_user)
            else:
                name = ''
            if name:
                tx.served_by_name = name[:200]
                fields.append('served_by_name')

        if fields:
            tx.save(update_fields=fields)


def forwards(apps, schema_editor):
    backfill_office_profiles(apps, schema_editor)
    backfill_must_change_password(apps, schema_editor)
    backfill_transactions(apps, schema_editor)


def backwards(apps, schema_editor):
    apps.get_model('ctms', 'CtmsOfficeProfile').objects.all().delete()
    apps.get_model('ctms', 'DolePersonnel').objects.update(must_change_password=False)
    apps.get_model('ctms', 'CtmsTransaction').objects.update(assigned_to=None, served_by_name='')


class Migration(migrations.Migration):

    dependencies = [
        ('ctms', '0018_stage1_windows_ownership_history'),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
