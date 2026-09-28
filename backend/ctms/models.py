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


class CtmsDisplayConfig(models.Model):
    id = models.BigAutoField(primary_key=True)
    office = models.OneToOneField(CsmOffice, on_delete=models.CASCADE, related_name='display_config')
    arta_video_url = models.TextField(blank=True, default='', help_text="YouTube or direct MP4 video URL for TV display")
    is_active = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'ctms_display_config'
        verbose_name = 'CTMS Display Config'
        verbose_name_plural = 'CTMS Display Configs'

    def __str__(self):
        return f"Display Config for {self.office.name}"



class CtmsTransaction(models.Model):
    STATUS_WAITING = 'waiting'
    STATUS_SERVING = 'serving'
    STATUS_DONE = 'done'
    STATUS_NO_SHOW = 'no_show'
    STATUS_CANCELLED = 'cancelled'

    STATUS_CHOICES = (
        (STATUS_WAITING, 'Waiting'),
        (STATUS_SERVING, 'Serving'),
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
