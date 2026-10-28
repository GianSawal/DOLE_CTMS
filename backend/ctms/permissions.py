"""
Role and office-type rules, in one place.

- System admin: the single superuser who maintains the system. Full access.
- Regional admin: an account with role ADMIN whose office is a REGIONAL office
  (DOLE RO3). Manages users, services and reports, and oversees every office.
- Everyone else (all provincial accounts, and regional personnel): operational
  access to their own office only (Queue, Windows, My Clients, TV, QR, Transactions).
- TV Display accounts (created by the system admin only): not staff. Signing in just
  opens their office's TV display; every staff page and action refuses them.
- Registration Desk accounts (created by the system admin only): not staff. They can only
  register walk-in clients for their own office; every other staff page and action refuses them.

Office type and role are separate: an ADMIN role on a provincial account grants nothing extra.
"""
from rest_framework import permissions

from .models import CsmOffice, CtmsOfficeProfile, CtmsStaffOffice, DolePersonnel


def is_system_admin(user):
    return bool(user and user.is_authenticated and user.is_superuser)


def personnel_profile(user):
    if not user or not user.is_authenticated:
        return None
    try:
        return user.dole_personnel
    except DolePersonnel.DoesNotExist:
        return None


def primary_office(user):
    """The office an account belongs to: its personnel office, else its first office assignment."""
    profile = personnel_profile(user)
    if profile and profile.office_id:
        return profile.office
    link = CtmsStaffOffice.objects.filter(user=user).select_related('office').first() if user and user.is_authenticated else None
    return link.office if link else None


def is_display_account(user):
    """A sign-in for an office TV (role DISPLAY): not staff, no access beyond the TV page."""
    if not user or not user.is_authenticated or user.is_superuser:
        return False
    profile = personnel_profile(user)
    return bool(profile and profile.role == DolePersonnel.ROLE_DISPLAY)


def is_registration_account(user):
    """A sign-in for a registration desk (role REGISTRAR): registers walk-ins for its office only."""
    if not user or not user.is_authenticated or user.is_superuser:
        return False
    profile = personnel_profile(user)
    return bool(profile and profile.role == DolePersonnel.ROLE_REGISTRAR)


def registration_office(user):
    """The active office a Registration Desk account registers clients for, or None."""
    if not is_registration_account(user):
        return None
    office = primary_office(user)
    return office if office and office.is_active else None


def display_session(user):
    """Where a TV Display account goes after signing in: its office's TV, with the office's TV key."""
    from .models import CtmsOfficeQrConfig
    from .services import get_display_key

    office = primary_office(user)
    if not office or not office.is_active:
        return None
    config, _ = CtmsOfficeQrConfig.objects.get_or_create(office=office)
    key = get_display_key(config)
    return {
        "office_id": office.id,
        "office_name": office.name,
        "key": key,
        "url": f"/display/office/{office.id}?key={key}",
    }


def office_type(office):
    if not office:
        return None
    profile = CtmsOfficeProfile.objects.filter(office=office).first()
    return profile.office_type if profile else CtmsOfficeProfile.TYPE_PROVINCIAL


def is_regional_admin(user):
    if is_system_admin(user):
        return True
    profile = personnel_profile(user)
    if not profile or profile.role != DolePersonnel.ROLE_ADMIN or not user.is_active:
        return False
    return office_type(profile.office) == CtmsOfficeProfile.TYPE_REGIONAL


def admin_scope_offices(user):
    """Offices visible in oversight screens (Transactions, Reports, Audit Logs)."""
    if is_regional_admin(user):
        return CsmOffice.objects.filter(is_active=True)
    from .views import get_staff_offices
    return get_staff_offices(user)


def user_access(user):
    """Role summary sent to the frontend to shape navigation. The API enforces the same rules."""
    office = primary_office(user)
    regional_admin = is_regional_admin(user)
    profile = personnel_profile(user)
    return {
        "role": 'SYSTEM_ADMIN' if is_system_admin(user) else (profile.role if profile else DolePersonnel.ROLE_PERSONNEL),
        "is_system_admin": is_system_admin(user),
        "is_regional_admin": regional_admin,
        "office_type": office_type(office),
        "primary_office": {"id": office.id, "name": office.name, "code": office.code} if office else None,
        "permissions": {
            "manage_users": regional_admin,
            "manage_services": regional_admin,
            "view_reports": regional_admin,
            "view_audit_logs": regional_admin,
            "manage_backups": is_system_admin(user),
        },
    }


class IsRegionalAdmin(permissions.BasePermission):
    message = "Only regional office administrators can do this."

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_staff
                    and is_regional_admin(request.user))


class IsSystemAdmin(permissions.BasePermission):
    message = "Only the system administrator can do this."

    def has_permission(self, request, view):
        return is_system_admin(request.user)


def password_update_due(user):
    """The account set up 2FA and must now replace its password (see CtmsTwoFactor.password_updated)."""
    from .models import CtmsTwoFactor
    return CtmsTwoFactor.objects.filter(user=user, confirmed_at__isnull=False, password_updated=False).exists()


def staff_session(user):
    """Account summary returned at login and by /auth/me; one shape for both."""
    from .models import CtmsCounter
    from .services import personnel_display_name
    from .views import get_staff_offices

    profile = personnel_profile(user)
    window = CtmsCounter.objects.filter(
        assigned_user=user, is_active=True, archived_at__isnull=True
    ).select_related('office').first()
    data = {
        "id": user.id,
        "username": user.username,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "full_name": personnel_display_name(user),
        "position": profile.position if profile else '',
        "is_superuser": user.is_superuser,
        # A temporary password, or 2FA just set up and the password not yet updated
        "must_change_password": bool(profile and profile.must_change_password) or password_update_due(user),
        "assigned_offices": [
            {"id": o.id, "name": o.name, "code": o.code} for o in get_staff_offices(user)
        ],
        "oversight_offices": [
            {"id": o.id, "name": o.name, "code": o.code} for o in admin_scope_offices(user)
        ],
        "occupied_window": {"id": window.id, "name": window.name, "office": window.office_id,
                            "office_name": window.office.name} if window else None,
    }
    data.update(user_access(user))
    if is_display_account(user):
        data["display"] = display_session(user)
    if is_registration_account(user):
        office = registration_office(user)
        data["registration"] = {"office_id": office.id, "office_name": office.name,
                                "office_code": office.code} if office else None
    return data
