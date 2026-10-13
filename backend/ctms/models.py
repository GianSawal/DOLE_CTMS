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

def service_requires_concern(name):
    """
    True for a catch-all "Other..." service (e.g. "Other Services", "Other Services
    (IMSD)"), where the client must type what they actually need since the service
    name alone doesn't say.
    """
    return (name or '').strip().lower().startswith('other')

def generate_office_code(length=4):
    """
    Hourly in-room check-in code (digits only, easy to read off a whiteboard or TV
    and type on a phone). See CtmsOfficeQrConfig.office_code.
    """
    return ''.join(secrets.choice('0123456789') for _ in range(length))


# The only service divisions. Divisions classify services for search and reports;
# they never decide who can see or call a client.
CANONICAL_DIVISIONS = ('TSSD 1', 'TSSD 2', 'IMSD')


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

class CtmsOfficeProfile(models.Model):
    """
    CTMS-owned attributes of a CSM office. csm_office belongs to the CSM system,
    so office type lives here instead of as a column on that table.
    """
    TYPE_REGIONAL = 'REGIONAL'
    TYPE_PROVINCIAL = 'PROVINCIAL'
    TYPE_CHOICES = (
        (TYPE_REGIONAL, 'Regional Office'),
        (TYPE_PROVINCIAL, 'Provincial / Field Office'),
    )

    id = models.BigAutoField(primary_key=True)
    office = models.OneToOneField(CsmOffice, on_delete=models.CASCADE, related_name='ctms_profile')
    office_type = models.CharField(max_length=12, choices=TYPE_CHOICES, default=TYPE_PROVINCIAL, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'ctms_office_profile'
        verbose_name = 'CTMS Office Profile'
        verbose_name_plural = 'CTMS Office Profiles'

    def __str__(self):
        return f"{self.office.name} ({self.office_type})"


class CtmsCounter(models.Model):
    id = models.BigAutoField(primary_key=True)
    office = models.ForeignKey(CsmOffice, on_delete=models.PROTECT, related_name='counters')
    name = models.CharField(max_length=50, help_text="e.g. Window 1, Window 2")
    description = models.CharField(
        max_length=120, blank=True, default='',
        help_text="Optional, e.g. 'Labor inspection and SEnA cases'"
    )
    is_active = models.BooleanField(default=True)
    sort_order = models.PositiveSmallIntegerField(default=0)
    # One occupant per window and one window per user, enforced by the unique column.
    assigned_user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='occupied_window',
    )
    assigned_at = models.DateTimeField(null=True, blank=True)
    archived_at = models.DateTimeField(null=True, blank=True, db_index=True, help_text="Soft-deleted windows keep historical references valid")

    class Meta:
        db_table = 'ctms_counter'
        verbose_name = 'CTMS Counter'
        verbose_name_plural = 'CTMS Counters'
        # Names are unique only among an office's current windows (enforced in services):
        # a deleted window keeps its name for history but frees it for reuse.
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


class DolePersonnel(models.Model):
    """
    Canonical personnel profile of a staff login account (one-to-one with User):
    name, personnel ID, office, position, and the account's role.
    """
    ROLE_PERSONNEL = 'PERSONNEL'
    ROLE_ADMIN = 'ADMIN'
    ROLE_CHOICES = (
        (ROLE_PERSONNEL, 'Personnel'),
        (ROLE_ADMIN, 'Administrator'),
    )

    id = models.BigAutoField(primary_key=True)
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='dole_personnel',
        help_text="User login account linked to this personnel record"
    )
    employee_id = models.CharField(max_length=50, unique=True, db_index=True)
    first_name = models.CharField(max_length=100)
    middle_name = models.CharField(max_length=100, blank=True, default='')
    last_name = models.CharField(max_length=100)
    position = models.CharField(max_length=150, blank=True, default='')
    office = models.ForeignKey(CsmOffice, on_delete=models.PROTECT, related_name='dole_personnel')
    is_active = models.BooleanField(default=True)
    must_change_password = models.BooleanField(default=False, help_text="Requires password change on next login")
    role = models.CharField(
        max_length=12, choices=ROLE_CHOICES, default=ROLE_PERSONNEL,
        help_text="Administrator grants User Management, Reports and Services only for regional-office accounts",
    )
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


DEFAULT_DOLE_POSITIONS = [
    'Accountant II',
    'Administrative Aide',
    'Administrative Aide I',
    'Administrative Aide II',
    'Administrative Aide III',
    'Administrative Aide IV',
    'Administrative Aide V',
    'Administrative Aide VI',
    'Administrative Assistant I',
    'Administrative Assistant II',
    'Administrative Assistant III',
    'Administrative Assistant IV',
    'Administrative Officer II',
    'Administrative Officer IV',
    'Attorney III',
    'Attorney IV',
    'Chief Administrative Officer',
    'Department Legislative Liaison Specialist',
    'Director',
    'GIP',
    'Information System Analyst II',
    'Information Technology Officer I',
    'Information Technology Officer II',
    'Job Order',
    'Labor and Employment Officer I',
    'Labor and Employment Officer II',
    'Labor and Employment Officer III',
    'Planning Officer I',
    'Planning Officer II',
    'Planning Officer III',
    'Planning Officer V',
    'Project Evaluation Officer I',
    'Project Evaluation Officer II',
    'Project Evaluation Officer III',
    'Project Evaluation Officer IV',
    'Project Evaluation Officer V',
    'Regional Director',
    'Senior Labor and Employment Officer',
    'Sheriff',
    'Statistician',
    'Supervising Administrative Officer',
    'Supervising Labor Employment Officer',
]


class DolePosition(models.Model):
    """
    Positions directory for DOLE personnel.
    Supports standard pre-configured positions and custom admin-added positions.
    """
    id = models.BigAutoField(primary_key=True)
    title = models.CharField(max_length=150, unique=True)
    is_custom = models.BooleanField(default=True, help_text="True if created dynamically by administrator")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'ctms_dole_position'
        verbose_name = 'DOLE Position'
        verbose_name_plural = 'DOLE Positions'
        ordering = ['title']

    def __str__(self):
        return self.title


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


class CtmsOfficeQrConfig(models.Model):
    """
    Controls whether client QR code registration is enabled or disabled for an office.
    Used by admins to prevent registrations outside office hours.
    """
    id = models.BigAutoField(primary_key=True)
    office = models.OneToOneField(CsmOffice, on_delete=models.CASCADE, related_name='qr_config')
    is_qr_enabled = models.BooleanField(default=True, help_text="Enable or disable client QR check-in / registration")
    disabled_message = models.CharField(
        max_length=255,
        blank=True,
        default="Online registration is currently closed beyond office hours. Please visit us during regular office hours (Monday to Friday, 8:00 AM - 5:00 PM).",
        help_text="Custom notice shown to clients when QR registration is closed"
    )
    disabled_at = models.DateTimeField(null=True, blank=True)
    disabled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='disabled_qr_offices'
    )
    updated_at = models.DateTimeField(auto_now=True)

    # In-room check-in code: the printed QR poster is static and can be photographed and
    # reused off-site, so this proves the client is actually at the office. It is shown
    # on the TV display or written on a whiteboard and typed into the check-in form, never
    # printed or encoded in the QR itself. Rotates on every clock hour (and on demand).
    requires_office_code = models.BooleanField(
        default=False,
        help_text="Require clients to enter the hourly in-office code before they can check in"
    )
    office_code = models.CharField(max_length=4, blank=True, default='')
    office_code_period = models.DateTimeField(
        null=True, blank=True, help_text="Start of the clock hour office_code was generated for"
    )
    # The code from the hour before, still accepted for a few minutes after an hourly change
    # so a client who read the code just before the hour isn't rejected. Never set by a
    # manual "New code" (that's for leaked codes, which must stop working at once).
    previous_office_code = models.CharField(max_length=4, blank=True, default='')
    previous_office_code_valid_until = models.DateTimeField(null=True, blank=True)
    # The TV board API is public, so the code is only included when the TV page is opened
    # with this office's secret display key (the link staff copy from the Check-in QR page).
    display_key = models.CharField(max_length=32, blank=True, default='')

    class Meta:
        db_table = 'ctms_office_qr_config'
        verbose_name = 'CTMS Office QR Config'
        verbose_name_plural = 'CTMS Office QR Configs'

    def __str__(self):
        status = "Enabled" if self.is_qr_enabled else "Disabled"
        return f"{self.office.name} - QR {status}"


class CtmsTransaction(models.Model):
    STATUS_WAITING = 'waiting'
    STATUS_SERVING = 'serving'
    STATUS_TRANSFERRED = 'transferred'
    STATUS_PENDING = 'pending'
    STATUS_DONE = 'done'
    STATUS_NO_SHOW = 'no_show'
    STATUS_CANCELLED = 'cancelled'

    STATUS_CHOICES = (
        (STATUS_WAITING, 'Waiting'),
        (STATUS_SERVING, 'Serving'),
        (STATUS_TRANSFERRED, 'Transferred (not yet started)'),
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
    # What the client typed when they picked a catch-all "Other..." service; see
    # service_requires_concern(). Blank for every other service.
    concern_note = models.CharField(max_length=300, blank=True, default='')
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=STATUS_WAITING, db_index=True)
    counter = models.ForeignKey(CtmsCounter, on_delete=models.SET_NULL, null=True, blank=True, related_name='transactions')
    source = models.CharField(max_length=10, choices=SOURCE_CHOICES, default=SOURCE_QR)
    assigned_personnel = models.CharField(max_length=200, null=True, blank=True, help_text="Legacy free-text handler name (kept for history)")
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='assigned_transactions',
        help_text="Personnel account currently responsible for this transaction",
    )
    
    checked_in_at = models.DateTimeField(db_index=True)
    called_at = models.DateTimeField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True, db_index=True, help_text="Timestamp when transaction began serving")
    done_at = models.DateTimeField(null=True, blank=True, db_index=True, help_text="Timestamp when transaction was completed")
    closed_at = models.DateTimeField(null=True, blank=True)
    served_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='served_transactions')
    served_by_name = models.CharField(max_length=200, blank=True, default='', help_text="Snapshot of the final handler's name for CSM attribution")
    
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
    def effective_started_at(self):
        """Returns started_at if recorded, otherwise falls back to called_at."""
        return self.started_at or self.called_at

    @property
    def service_duration_seconds(self):
        """Duration of transaction in seconds (from start to done)."""
        start = self.effective_started_at
        end = self.done_at
        if start and end and end >= start:
            return int((end - start).total_seconds())
        return None

    @property
    def is_surveyed(self):
        try:
            return CsmResponse.objects.filter(ctms_transaction_id=self.id).exists()
        except Exception:
            return False

    @property
    def survey_url(self):
        if self.status == self.STATUS_DONE and not self.is_surveyed:
            base = settings.CSM_SURVEY_PUBLIC_URL.rstrip('/')
            return f"{base}/survey/t/{self.survey_token}"
        return None


class CtmsAssignmentHistory(models.Model):
    """
    Immutable record of every ownership, window, or status change on a transaction.
    Name snapshots keep the history readable after accounts or windows change.
    """
    EVENT_CALLED = 'CALLED'
    EVENT_TRANSFERRED = 'TRANSFERRED'
    EVENT_PENDING = 'PENDING'
    EVENT_RESUMED = 'RESUMED'
    EVENT_COMPLETED = 'COMPLETED'
    EVENT_REOPENED = 'REOPENED'
    EVENT_REQUEUED = 'REQUEUED'
    EVENT_NO_SHOW = 'NO_SHOW'
    EVENT_CANCELLED = 'CANCELLED'

    EVENT_CHOICES = (
        (EVENT_CALLED, 'Called'),
        (EVENT_TRANSFERRED, 'Transferred'),
        (EVENT_PENDING, 'Moved to Pending'),
        (EVENT_RESUMED, 'Resumed'),
        (EVENT_COMPLETED, 'Completed'),
        (EVENT_REOPENED, 'Reopened (Undo Done)'),
        (EVENT_REQUEUED, 'Returned to Queue'),
        (EVENT_NO_SHOW, 'No-show'),
        (EVENT_CANCELLED, 'Cancelled'),
    )

    id = models.BigAutoField(primary_key=True)
    transaction = models.ForeignKey(CtmsTransaction, on_delete=models.CASCADE, related_name='assignment_history')
    event = models.CharField(max_length=20, choices=EVENT_CHOICES, db_index=True)
    from_status = models.CharField(max_length=12, blank=True, default='')
    to_status = models.CharField(max_length=12, blank=True, default='')
    from_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    from_user_name = models.CharField(max_length=200, blank=True, default='')
    to_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    to_user_name = models.CharField(max_length=200, blank=True, default='')
    from_counter = models.ForeignKey(CtmsCounter, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    from_counter_name = models.CharField(max_length=50, blank=True, default='')
    to_counter = models.ForeignKey(CtmsCounter, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    to_counter_name = models.CharField(max_length=50, blank=True, default='')
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    actor_name = models.CharField(max_length=200, blank=True, default='')
    reason = models.CharField(max_length=255, blank=True, default='')
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        db_table = 'ctms_assignment_history'
        verbose_name = 'CTMS Assignment History'
        verbose_name_plural = 'CTMS Assignment History'
        ordering = ['created_at', 'id']
        indexes = [
            models.Index(fields=['transaction', 'created_at']),
        ]

    def __str__(self):
        return f"{self.transaction_id} {self.event} {self.from_user_name} -> {self.to_user_name}"


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


class CtmsNotification(models.Model):
    """
    Real-time notification model for staff user accounts.
    Alerts personnel whenever a new client ticket is assigned or reassigned to them.
    """
    id = models.BigAutoField(primary_key=True)
    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='ctms_notifications'
    )
    transaction = models.ForeignKey(
        'CtmsTransaction',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='notifications'
    )
    notification_type = models.CharField(max_length=50, default='ASSIGNMENT')
    title = models.CharField(max_length=200)
    message = models.TextField()
    queue_no = models.CharField(max_length=50, blank=True, default='')
    service_name = models.CharField(max_length=200, blank=True, default='')
    assigned_at = models.DateTimeField(default=timezone.now)
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'ctms_notification'
        verbose_name = 'CTMS Notification'
        verbose_name_plural = 'CTMS Notifications'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['recipient', 'is_read', '-created_at']),
        ]

    def __str__(self):
        return f"Notification for {self.recipient.username}: {self.title}"


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
