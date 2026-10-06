import secrets
import string
from django.db import models, transaction
from django.conf import settings
from django.utils import timezone

# Character pool for claim codes (no ambiguous chars: 0/O/1/I/L)
CLAIM_CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

def generate_claim_code(length=4):
    return ''.join(secrets.choice(CLAIM_CODE_CHARS) for _ in range(length))

def generate_token(nbytes=16):
    return secrets.token_urlsafe(nbytes)


# =====================================================================
# CSM Shared Models (Read-only / Unmanaged in production)
# =====================================================================

class CsmDivision(models.Model):
    id = models.BigAutoField(primary_key=True)
    name = models.CharField(max_length=100, unique=True)

    class Meta:
        managed = getattr(settings, 'TESTING', False)
        db_table = 'csm_division'
        verbose_name = 'CSM Division'
        verbose_name_plural = 'CSM Divisions'
        ordering = ['id']

    def __str__(self):
        return self.name


class CsmOffice(models.Model):
    id = models.BigAutoField(primary_key=True)
    name = models.CharField(max_length=200, unique=True)
    code = models.CharField(max_length=10, unique=True, help_text="e.g. CRK (used as transaction prefix)")
    is_active = models.BooleanField(default=True)
    qr_issued_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        managed = getattr(settings, 'TESTING', False)
        db_table = 'csm_office'
        verbose_name = 'CSM Office'
        verbose_name_plural = 'CSM Offices'
        ordering = ['name']

    def __str__(self):
        return f"{self.name} ({self.code})"


class CsmService(models.Model):
    id = models.BigAutoField(primary_key=True)
    name = models.CharField(max_length=200, unique=True)
    is_active = models.BooleanField(default=True)
    sort_order = models.PositiveSmallIntegerField(default=0, help_text="DOLE CSF Form No. 3 order")
    division = models.ForeignKey(
        CsmDivision,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='services',
        db_column='division_id'
    )

    class Meta:
        managed = getattr(settings, 'TESTING', False)
        db_table = 'csm_service'
        verbose_name = 'CSM Service'
        verbose_name_plural = 'CSM Services'
        ordering = ['sort_order', 'name']

    def __str__(self):
        return self.name


class CsmResponse(models.Model):
    """
    Survey responses from CSM. CTMS reads ctms_transaction_id ONLY to know
    if a transaction has completed the CSM survey.
    """
    id = models.BigAutoField(primary_key=True)
    ctms_transaction_id = models.BigIntegerField(null=True, unique=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = getattr(settings, 'TESTING', False)
        db_table = 'csm_csmresponse'
        verbose_name = 'CSM Response'
        verbose_name_plural = 'CSM Responses'

    def __str__(self):
        return f"CSM Response #{self.id} (CTMS Tx: {self.ctms_transaction_id})"


# =====================================================================
# CTMS Core Models
# =====================================================================

class CtmsCounter(models.Model):
    id = models.BigAutoField(primary_key=True)
    office = models.ForeignKey(CsmOffice, on_delete=models.PROTECT, related_name='counters')
    name = models.CharField(max_length=50, help_text="e.g. Window 1, Window 2")
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = 'ctms_counter'
        verbose_name = 'CTMS Counter'
        verbose_name_plural = 'CTMS Counters'
        unique_together = ('office', 'name')
        ordering = ['office', 'name']

    def __str__(self):
        return f"{self.office.code} - {self.name}"


class CtmsStaffOffice(models.Model):
    id = models.BigAutoField(primary_key=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='staff_offices')
    office = models.ForeignKey(CsmOffice, on_delete=models.PROTECT, related_name='staff_assignments')

    class Meta:
        db_table = 'ctms_staff_office'
        verbose_name = 'CTMS Staff Office'
        verbose_name_plural = 'CTMS Staff Offices'
        unique_together = ('user', 'office')

    def __str__(self):
        return f"{self.user.username} -> {self.office.name}"


class CtmsStaffDivision(models.Model):
    id = models.BigAutoField(primary_key=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='staff_divisions')
    division = models.ForeignKey(CsmDivision, on_delete=models.CASCADE, related_name='staff_division_assignments')

    class Meta:
        db_table = 'ctms_staff_division'
        verbose_name = 'CTMS Staff Division'
        verbose_name_plural = 'CTMS Staff Divisions'
        unique_together = ('user', 'division')

    def __str__(self):
        return f"{self.user.username} -> {self.division.name}"


class CtmsEmployee(models.Model):
    id = models.BigAutoField(primary_key=True)
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='employee_profile')
    employee_id = models.CharField(max_length=50, unique=True, db_index=True)
    first_name = models.CharField(max_length=100)
    middle_name = models.CharField(max_length=100, blank=True, default='')
    last_name = models.CharField(max_length=100)
    position = models.CharField(max_length=150, blank=True, default='')
    office = models.ForeignKey(CsmOffice, on_delete=models.PROTECT, related_name='employees')
    divisions = models.ManyToManyField(CsmDivision, blank=True, related_name='employees', db_table='ctms_employee_divisions')
    is_active = models.BooleanField(default=True)
    must_change_password = models.BooleanField(default=True, help_text="Requires password change on first login or after reset")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'ctms_employee'
        verbose_name = 'CTMS Employee'
        verbose_name_plural = 'CTMS Employees'
        ordering = ['last_name', 'first_name']

    def __str__(self):
        return f"{self.employee_id} - {self.last_name}, {self.first_name}"

    @property
    def full_name(self):
        mid = f" {self.middle_name}" if self.middle_name else ""
        return f"{self.first_name}{mid} {self.last_name}"


class DolePersonnel(models.Model):
    """
    Pure personnel directory for DOLE officers and personnel who assist clients.
    Personnel do NOT have user login accounts or passwords.
    Used strictly for assigning personnel on queue transactions.
    """
    id = models.BigAutoField(primary_key=True)
    employee_id = models.CharField(max_length=50, unique=True, db_index=True)
    first_name = models.CharField(max_length=100)
    middle_name = models.CharField(max_length=100, blank=True, default='')
    last_name = models.CharField(max_length=100)
    position = models.CharField(max_length=150, blank=True, default='')
    office = models.ForeignKey(CsmOffice, on_delete=models.PROTECT, related_name='dole_personnel')
    divisions = models.ManyToManyField(CsmDivision, blank=True, related_name='dole_personnel', db_table='ctms_dole_personnel_divisions')
    services = models.ManyToManyField(CsmService, blank=True, related_name='assigned_personnel', db_table='ctms_dole_personnel_services')
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'ctms_dole_personnel'
        verbose_name = 'DOLE Personnel'
        verbose_name_plural = 'DOLE Personnel'
        ordering = ['last_name', 'first_name']

    def __str__(self):
        return f"{self.employee_id} - {self.last_name}, {self.first_name}"

    @property
    def full_name(self):
        mid = f" {self.middle_name}" if self.middle_name else ""
        return f"{self.first_name}{mid} {self.last_name}"


class CtmsDisplayConfig(models.Model):
    id = models.BigAutoField(primary_key=True)
    office = models.OneToOneField(CsmOffice, on_delete=models.CASCADE, related_name='display_config')
    arta_video_url = models.TextField(blank=True, default='', help_text="YouTube or direct MP4 video URL for TV display")
    video_file = models.FileField(upload_to='arta_videos/', null=True, blank=True, help_text="Uploaded video file for TV display")
    is_active = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'ctms_display_config'
        verbose_name = 'CTMS Display Config'
        verbose_name_plural = 'CTMS Display Configs'

    def __str__(self):
        return f"Display Config for {self.office.name}"


class CtmsServiceDefaultOfficer(models.Model):
    """
    Stores designated default officers per service and office.
    Used to automatically determine the default officer when assigning a client.
    """
    id = models.BigAutoField(primary_key=True)
    office = models.ForeignKey(CsmOffice, on_delete=models.CASCADE, null=True, blank=True, related_name='service_default_officers')
    service = models.ForeignKey(CsmService, on_delete=models.CASCADE, related_name='default_officers')
    officer_name = models.CharField(max_length=200, help_text="Full name of the default officer")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'ctms_service_default_officer'
        verbose_name = 'CTMS Service Default Officer'
        verbose_name_plural = 'CTMS Service Default Officers'
        unique_together = ('office', 'service')

    def __str__(self):
        return f"{self.service.name} -> {self.officer_name}"



class CtmsTransaction(models.Model):
    STATUS_WAITING = 'waiting'
    STATUS_SERVING = 'serving'
    STATUS_PENDING = 'pending'
    STATUS_DONE = 'done'
    STATUS_NO_SHOW = 'no_show'
    STATUS_CANCELLED = 'cancelled'

    STATUS_CHOICES = (
        (STATUS_WAITING, 'Waiting'),
        (STATUS_SERVING, 'Serving'),
        (STATUS_PENDING, 'Pending'),
        (STATUS_DONE, 'Done'),
        (STATUS_NO_SHOW, 'No-show'),
        (STATUS_CANCELLED, 'Cancelled'),
    )

    SOURCE_QR = 'qr'
    SOURCE_KIOSK = 'kiosk'
    SOURCE_STAFF = 'staff'

    SOURCE_CHOICES = (
        (SOURCE_QR, 'QR Check-in'),
        (SOURCE_KIOSK, 'Kiosk'),
        (SOURCE_STAFF, 'Staff Walk-in'),
    )

    id = models.BigAutoField(primary_key=True)
    transaction_no = models.CharField(max_length=24, unique=True, db_index=True)
    office = models.ForeignKey(CsmOffice, on_delete=models.PROTECT, related_name='transactions')
    service = models.ForeignKey(CsmService, on_delete=models.PROTECT, related_name='transactions')
    queue_date = models.DateField(db_index=True, help_text="Local Manila date")
    queue_seq = models.PositiveIntegerField()
    queue_no = models.CharField(max_length=8, help_text="e.g. 042 or P-007")
    is_priority = models.BooleanField(default=False, help_text="Senior / PWD / Pregnant")
    client_name = models.CharField(max_length=200, null=True, blank=True)
    group_member_names = models.JSONField(
        null=True, blank=True, default=None,
        help_text="List of individual member names for group registrations, e.g. ['Juan', 'Maria', ...]"
    )
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=STATUS_WAITING, db_index=True)
    counter = models.ForeignKey(CtmsCounter, on_delete=models.SET_NULL, null=True, blank=True, related_name='transactions')
    source = models.CharField(max_length=10, choices=SOURCE_CHOICES, default=SOURCE_QR)
    assigned_personnel = models.CharField(max_length=200, null=True, blank=True, help_text="Designated personnel / officer")
    
    checked_in_at = models.DateTimeField(db_index=True)
    called_at = models.DateTimeField(null=True, blank=True)
    done_at = models.DateTimeField(null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    served_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='served_transactions')
    
    ticket_token = models.CharField(max_length=32, unique=True, db_index=True)
    survey_token = models.CharField(max_length=32, unique=True, db_index=True)
    claim_code = models.CharField(max_length=4)

    class Meta:
        db_table = 'ctms_transaction'
        verbose_name = 'CTMS Transaction'
        verbose_name_plural = 'CTMS Transactions'
        unique_together = ('office', 'queue_date', 'queue_seq')
        indexes = [
            models.Index(fields=['office', 'status', 'queue_date']),
            models.Index(fields=['checked_in_at']),
        ]
        ordering = ['-checked_in_at']

    def __str__(self):
        return f"{self.queue_no} ({self.transaction_no}) - {self.status}"

    @property
    def is_surveyed(self):
        try:
            return CsmResponse.objects.filter(ctms_transaction_id=self.id).exists()
        except Exception:
            return False

    @property
    def survey_url(self):
        if self.status == self.STATUS_DONE and not self.is_surveyed:
            base = settings.CSM_SURVEY_BASE_URL.rstrip('/')
            return f"{base}/survey/t/{self.survey_token}"
        return None


# =====================================================================
# Audit Log Model
# =====================================================================

class CtmsAuditLog(models.Model):
    CATEGORY_AUTH = 'auth'
    CATEGORY_QUEUE = 'queue'
    CATEGORY_USER = 'user'
    CATEGORY_PERSONNEL = 'personnel'
    CATEGORY_CONFIG = 'config'

    CATEGORY_CHOICES = [
        (CATEGORY_AUTH, 'Authentication'),
        (CATEGORY_QUEUE, 'Queue & Dispatch'),
        (CATEGORY_USER, 'User Management'),
        (CATEGORY_PERSONNEL, 'Personnel Directory'),
        (CATEGORY_CONFIG, 'Configuration'),
    ]

    id = models.BigAutoField(primary_key=True)
    timestamp = models.DateTimeField(default=timezone.now, db_index=True)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='audit_logs')
    actor_username = models.CharField(max_length=150, db_index=True)
    actor_role = models.CharField(max_length=50, blank=True, default='')
    action = models.CharField(max_length=50, db_index=True, help_text="e.g. LOGIN, CALL_CLIENT, MARK_DONE, CREATE_USER, etc.")
    category = models.CharField(max_length=50, choices=CATEGORY_CHOICES, default=CATEGORY_QUEUE, db_index=True)
    target_type = models.CharField(max_length=50, blank=True, default='')
    target_id = models.CharField(max_length=100, blank=True, default='')
    target_repr = models.CharField(max_length=255, blank=True, default='')
    office = models.ForeignKey(CsmOffice, on_delete=models.SET_NULL, null=True, blank=True, related_name='audit_logs')
    office_name = models.CharField(max_length=200, blank=True, default='')
    division_name = models.CharField(max_length=100, blank=True, default='')
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    description = models.TextField(blank=True, default='')
    details = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = 'ctms_audit_log'
        verbose_name = 'CTMS Audit Log'
        verbose_name_plural = 'CTMS Audit Logs'
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['-timestamp']),
            models.Index(fields=['category', '-timestamp']),
            models.Index(fields=['actor_username', '-timestamp']),
            models.Index(fields=['office', '-timestamp']),
        ]

    def __str__(self):
        return f"[{self.timestamp.strftime('%Y-%m-%d %H:%M:%S')}] {self.actor_username} - {self.action} ({self.target_repr})"


def log_audit_event(
    action,
    category=CtmsAuditLog.CATEGORY_QUEUE,
    actor=None,
    actor_username='',
    actor_role='',
    request=None,
    target_type='',
    target_id='',
    target_repr='',
    office=None,
    division_name='',
    description='',
    details=None
):
    """Utility to record an audit log entry safely without interrupting primary flows."""
    try:
        actor_user = actor
        resolved_username = actor_username or 'System'
        resolved_role = actor_role or 'System'
        ip_addr = None

        if request:
            if not actor_user and hasattr(request, 'user') and request.user.is_authenticated:
                actor_user = request.user
            x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
            if x_forwarded_for:
                ip_addr = x_forwarded_for.split(',')[0].strip()
            else:
                ip_addr = request.META.get('REMOTE_ADDR')

        if actor_user and actor_user.is_authenticated:
            resolved_username = actor_user.username
            resolved_role = 'Administrator' if actor_user.is_superuser else 'Staff'

        resolved_office = office
        if not resolved_office and actor_user and hasattr(actor_user, 'staff_offices'):
            staff_off = actor_user.staff_offices.select_related('office').first()
            if staff_off:
                resolved_office = staff_off.office

        office_name = resolved_office.name if resolved_office else ''

        return CtmsAuditLog.objects.create(
            actor=actor_user if actor_user and actor_user.is_authenticated else None,
            actor_username=resolved_username,
            actor_role=resolved_role,
            action=action,
            category=category,
            target_type=target_type,
            target_id=str(target_id) if target_id else '',
            target_repr=target_repr,
            office=resolved_office,
            office_name=office_name,
            division_name=division_name,
            ip_address=ip_addr,
            description=description,
            details=details or {}
        )
    except Exception as e:
        print(f"Warning: Failed to create audit log entry: {e}")
        return None
