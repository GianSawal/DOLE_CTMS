# Stage 6: every staff login account has exactly one personnel profile, and every
# personnel record has a login account.
#
# - users without a DolePersonnel are linked to the unlinked personnel record with the
#   same name, or get a new one (from their legacy CtmsEmployee row, else the account)
# - personnel without an account get one: username = personnel ID, temporary
#   password = personnel ID, forced change at first login (skipped when that
#   username is already taken)
# - legacy free-text handler names are re-linked now that more accounts exist
#
# Forward-only: created accounts/profiles are not removed on reverse. Restore
# from the pre-stage-6 backup if a rollback is ever needed.

from django.contrib.auth.hashers import make_password
from django.db import migrations


def _full_name(p):
    mid = f" {p.middle_name}" if p.middle_name else ""
    return f"{p.first_name}{mid} {p.last_name}".strip()


def _unique_employee_id(DolePersonnel, wanted):
    base = (wanted or 'STAFF').strip()[:45] or 'STAFF'
    candidate, n = base, 1
    while DolePersonnel.objects.filter(employee_id__iexact=candidate).exists():
        n += 1
        candidate = f"{base}-{n}"
    return candidate


def profiles_for_accounts(apps):
    User = apps.get_model('auth', 'User')
    DolePersonnel = apps.get_model('ctms', 'DolePersonnel')
    CtmsEmployee = apps.get_model('ctms', 'CtmsEmployee')
    CtmsStaffOffice = apps.get_model('ctms', 'CtmsStaffOffice')

    linked = set(DolePersonnel.objects.exclude(user_id=None).values_list('user_id', flat=True))
    # Superusers are handled by the set_system_admin command (only the system admin keeps the flag).
    for user in User.objects.filter(is_staff=True, is_superuser=False).exclude(pk__in=linked):
        emp = CtmsEmployee.objects.filter(user_id=user.pk).first()
        office_id = emp.office_id if emp else (
            CtmsStaffOffice.objects.filter(user_id=user.pk).values_list('office_id', flat=True).first()
        )
        if not office_id:
            continue

        # Link an existing unlinked personnel record of the same person instead of duplicating it.
        # Matched by name, or by the FIRST_LAST username convention (covers typos in the account name).
        first = ((emp.first_name if emp else user.first_name) or '').strip().lower()
        last = ((emp.last_name if emp else user.last_name) or '').strip().lower()
        username_key = user.username.strip().upper().replace('-', '_')
        unlinked = list(DolePersonnel.objects.filter(user_id=None))
        matches = [p for p in unlinked
                   if (first and last and p.first_name.strip().lower() == first and p.last_name.strip().lower() == last)
                   or f"{p.first_name.strip()}_{p.last_name.strip()}".upper().replace(' ', '_') == username_key]
        if matches:
            same_office = [p for p in matches if p.office_id == office_id]
            match = same_office[0] if len(same_office) == 1 else (matches[0] if len(matches) == 1 else None)
            if match:
                match.user_id = user.pk
                match.must_change_password = bool(emp and emp.must_change_password)
                match.save(update_fields=['user', 'must_change_password'])
                CtmsStaffOffice.objects.get_or_create(user_id=user.pk, office_id=match.office_id)
                continue

        DolePersonnel.objects.create(
            user_id=user.pk,
            employee_id=_unique_employee_id(DolePersonnel, emp.employee_id if emp else user.username),
            first_name=(emp.first_name if emp else user.first_name) or user.username,
            middle_name=emp.middle_name if emp else '',
            last_name=(emp.last_name if emp else user.last_name) or '',
            position=emp.position if emp else '',
            office_id=office_id,
            is_active=user.is_active,
            must_change_password=bool(emp and emp.must_change_password),
        )


def accounts_for_personnel(apps):
    User = apps.get_model('auth', 'User')
    DolePersonnel = apps.get_model('ctms', 'DolePersonnel')
    CtmsStaffOffice = apps.get_model('ctms', 'CtmsStaffOffice')

    for p in DolePersonnel.objects.filter(user_id=None):
        username = p.employee_id.strip()
        if not username or User.objects.filter(username__iexact=username).exists():
            continue
        user = User.objects.create(
            username=username,
            password=make_password(username),
            first_name=p.first_name[:150],
            last_name=p.last_name[:150],
            is_staff=True,
            is_active=p.is_active,
        )
        CtmsStaffOffice.objects.get_or_create(user_id=user.pk, office_id=p.office_id)
        p.user_id = user.pk
        p.must_change_password = True
        p.save(update_fields=['user', 'must_change_password'])


def relink_legacy_handlers(apps):
    CtmsTransaction = apps.get_model('ctms', 'CtmsTransaction')
    DolePersonnel = apps.get_model('ctms', 'DolePersonnel')
    personnel = [p for p in DolePersonnel.objects.exclude(user_id=None)]

    for tx in CtmsTransaction.objects.filter(assigned_to_id=None).exclude(assigned_personnel=None).exclude(assigned_personnel=''):
        clean = tx.assigned_personnel.strip().lower()
        for scope in ([p for p in personnel if p.office_id == tx.office_id], personnel):
            hits = {p.user_id for p in scope if clean in (
                p.employee_id.strip().lower(), _full_name(p).lower(), f"{p.first_name} {p.last_name}".strip().lower()
            )}
            if len(hits) == 1:
                tx.assigned_to_id = hits.pop()
                tx.save(update_fields=['assigned_to'])
                break
            if hits:
                break


def forwards(apps, schema_editor):
    profiles_for_accounts(apps)
    accounts_for_personnel(apps)
    relink_legacy_handlers(apps)


class Migration(migrations.Migration):

    dependencies = [
        ('ctms', '0021_stage6_personnel_role'),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
