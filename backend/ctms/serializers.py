from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from django.contrib.auth import get_user_model
from .models import (
    CsmDivision,
    CsmOffice,
    CsmService,
    CtmsCounter,
    CtmsStaffOffice,
    DolePersonnel,
    DolePosition,
    CtmsTransaction,
    CtmsAuditLog,
    CtmsNotification,
)
from .services import personnel_display_name

User = get_user_model()


class CsmDivisionSerializer(serializers.ModelSerializer):
    class Meta:
        model = CsmDivision
        fields = ['id', 'name']


class CsmOfficeSerializer(serializers.ModelSerializer):
    class Meta:
        model = CsmOffice
        fields = ['id', 'name', 'code', 'is_active']


class CsmServiceSerializer(serializers.ModelSerializer):
    division_name = serializers.ReadOnlyField(source='division.name')

    class Meta:
        model = CsmService
        fields = ['id', 'name', 'is_active', 'sort_order', 'division', 'division_name']


class StaffServiceSerializer(serializers.ModelSerializer):
    """Service catalog entry; regional admins may change only its division tag."""
    division_name = serializers.ReadOnlyField(source='division.name')

    class Meta:
        model = CsmService
        fields = ['id', 'name', 'is_active', 'sort_order', 'division', 'division_name']
        read_only_fields = ['id', 'name', 'is_active', 'sort_order']

    def validate_division(self, value):
        from .models import CANONICAL_DIVISIONS
        if value is not None and value.name not in CANONICAL_DIVISIONS:
            raise serializers.ValidationError(f"Division must be one of: {', '.join(CANONICAL_DIVISIONS)}.")
        return value


class CtmsCounterSerializer(serializers.ModelSerializer):
    office_name = serializers.ReadOnlyField(source='office.name')

    class Meta:
        model = CtmsCounter
        fields = ['id', 'office', 'office_name', 'name', 'is_active']


class WindowSerializer(serializers.ModelSerializer):
    """
    Window card data. Expects context:
      'current_by_window': {window_id: CtmsTransaction} for clients at each window
      'request': the DRF request (to flag the caller's own window)
    """
    office_name = serializers.ReadOnlyField(source='office.name')
    assigned_user_name = serializers.SerializerMethodField()
    is_mine = serializers.SerializerMethodField()
    is_archived = serializers.SerializerMethodField()
    current_client = serializers.SerializerMethodField()

    class Meta:
        model = CtmsCounter
        fields = [
            'id', 'office', 'office_name', 'name', 'is_active', 'is_archived', 'archived_at', 'sort_order',
            'assigned_user', 'assigned_user_name', 'assigned_at', 'is_mine', 'current_client',
        ]

    def get_assigned_user_name(self, obj):
        return personnel_display_name(obj.assigned_user) if obj.assigned_user_id else None

    def get_is_mine(self, obj):
        request = self.context.get('request')
        return bool(request and obj.assigned_user_id and obj.assigned_user_id == request.user.id)

    def get_is_archived(self, obj):
        return obj.archived_at is not None

    def get_current_client(self, obj):
        tx = self.context.get('current_by_window', {}).get(obj.id)
        if not tx:
            return None
        return {
            'id': tx.id,
            'queue_no': tx.queue_no,
            'status': tx.status,
            'is_priority': tx.is_priority,
            'service_name': tx.service.name if tx.service_id else '',
            'called_at': tx.called_at,
        }


class CtmsStaffOfficeSerializer(serializers.ModelSerializer):
    username = serializers.ReadOnlyField(source='user.username')
    office_name = serializers.ReadOnlyField(source='office.name')

    class Meta:
        model = CtmsStaffOffice
        fields = ['id', 'user', 'username', 'office', 'office_name']


class DolePositionSerializer(serializers.ModelSerializer):
    personnel_count = serializers.SerializerMethodField()

    class Meta:
        model = DolePosition
        fields = [
            'id',
            'title',
            'is_custom',
            'created_at',
            'personnel_count',
        ]
        read_only_fields = ['id', 'created_at', 'personnel_count']

    def get_personnel_count(self, obj):
        return DolePersonnel.objects.filter(position__iexact=obj.title).count()


class CtmsUserAccountSerializer(serializers.ModelSerializer):
    """
    One staff account = login credentials + its personnel profile (DolePersonnel).
    Read-only representation; writes go through StaffUserAccountViewSet.
    """
    full_name = serializers.SerializerMethodField()
    middle_name = serializers.SerializerMethodField()
    employee_id = serializers.SerializerMethodField()
    position = serializers.SerializerMethodField()
    office = serializers.SerializerMethodField()
    office_name = serializers.SerializerMethodField()
    office_code = serializers.SerializerMethodField()
    office_type = serializers.SerializerMethodField()
    role = serializers.SerializerMethodField()
    is_regional_admin = serializers.SerializerMethodField()
    must_change_password = serializers.SerializerMethodField()
    window_name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email',
            'first_name', 'middle_name', 'last_name', 'full_name',
            'employee_id', 'position', 'office', 'office_name', 'office_code', 'office_type',
            'role', 'is_regional_admin', 'is_superuser', 'is_active', 'must_change_password',
            'window_name', 'date_joined', 'last_login',
        ]

    @staticmethod
    def _profile(obj):
        try:
            return obj.dole_personnel
        except DolePersonnel.DoesNotExist:
            return None

    def _office(self, obj):
        from .permissions import primary_office
        return primary_office(obj)

    def get_full_name(self, obj):
        return personnel_display_name(obj)

    def get_middle_name(self, obj):
        p = self._profile(obj)
        return p.middle_name if p else ''

    def get_employee_id(self, obj):
        p = self._profile(obj)
        return p.employee_id if p else ''

    def get_position(self, obj):
        p = self._profile(obj)
        return p.position if p else ''

    def get_office(self, obj):
        office = self._office(obj)
        return office.id if office else None

    def get_office_name(self, obj):
        office = self._office(obj)
        return office.name if office else ''

    def get_office_code(self, obj):
        office = self._office(obj)
        return office.code if office else ''

    def get_office_type(self, obj):
        from .permissions import office_type
        return office_type(self._office(obj))

    def get_role(self, obj):
        if obj.is_superuser:
            return 'SYSTEM_ADMIN'
        p = self._profile(obj)
        return p.role if p else DolePersonnel.ROLE_PERSONNEL

    def get_is_regional_admin(self, obj):
        from .permissions import is_regional_admin
        return is_regional_admin(obj)

    def get_must_change_password(self, obj):
        p = self._profile(obj)
        return bool(p and p.must_change_password)

    def get_window_name(self, obj):
        window = getattr(obj, 'occupied_window', None)
        return window.name if window and window.archived_at is None else None


class CtmsNotificationSerializer(serializers.ModelSerializer):
    """Serializer for real-time staff notifications."""
    assigned_at_formatted = serializers.SerializerMethodField()
    created_at_formatted = serializers.SerializerMethodField()

    class Meta:
        model = CtmsNotification
        fields = [
            'id',
            'recipient',
            'transaction',
            'notification_type',
            'title',
            'message',
            'queue_no',
            'service_name',
            'assigned_at',
            'assigned_at_formatted',
            'is_read',
            'created_at',
            'created_at_formatted',
        ]
        read_only_fields = ['id', 'created_at']

    def get_assigned_at_formatted(self, obj):
        if not obj.assigned_at:
            return ""
        return obj.assigned_at.strftime('%I:%M %p')

    def get_created_at_formatted(self, obj):
        if not obj.created_at:
            return ""
        return obj.created_at.strftime('%I:%M %p')


class CheckinRequestSerializer(serializers.Serializer):
    office = serializers.PrimaryKeyRelatedField(queryset=CsmOffice.objects.filter(is_active=True))
    service = serializers.PrimaryKeyRelatedField(queryset=CsmService.objects.filter(is_active=True))
    client_name = serializers.CharField(max_length=200, required=False, allow_blank=True)
    is_priority = serializers.BooleanField(required=False, default=False)
    group_member_names = serializers.ListField(
        child=serializers.CharField(max_length=200),
        required=False, default=None, allow_null=True,
        help_text="List of individual member names for group registrations"
    )
    office_code = serializers.CharField(
        max_length=10, required=False, allow_blank=True, default='',
        help_text="Daily in-office code; required when the office enables it"
    )


class TicketPublicSerializer(serializers.ModelSerializer):
    office_name = serializers.ReadOnlyField(source='office.name')
    service_name = serializers.ReadOnlyField(source='service.name')
    counter = serializers.SerializerMethodField()
    ahead = serializers.SerializerMethodField()
    survey_url = serializers.ReadOnlyField()
    surveyed = serializers.ReadOnlyField(source='is_surveyed')
    started_at = serializers.SerializerMethodField()

    class Meta:
        model = CtmsTransaction
        fields = [
            'queue_no',
            'transaction_no',
            'claim_code',
            'status',
            'office_name',
            'service_name',
            'counter',
            'assigned_personnel',
            'ahead',
            'survey_url',
            'surveyed',
            'is_priority',
            'checked_in_at',
            'called_at',
            'started_at',
            'done_at',
        ]

    def get_counter(self, obj):
        return obj.counter.name if obj.counter else None

    def get_started_at(self, obj):
        val = obj.effective_started_at
        return val.isoformat() if val else None

    def get_ahead(self, obj):
        if obj.status != CtmsTransaction.STATUS_WAITING:
            return 0

        # Waiting queue ahead calculation:
        # Priority clients get served before regular.
        # If obj is priority: only priority checked in before obj are ahead.
        # If obj is regular: all priority waiting + regular checked in before obj are ahead.
        qs = CtmsTransaction.objects.filter(
            office=obj.office,
            status=CtmsTransaction.STATUS_WAITING
        )
        if obj.is_priority:
            return qs.filter(is_priority=True, checked_in_at__lt=obj.checked_in_at).count()
        else:
            priority_count = qs.filter(is_priority=True).count()
            regular_ahead = qs.filter(is_priority=False, checked_in_at__lt=obj.checked_in_at).count()
            return priority_count + regular_ahead


class StaffTransactionSerializer(serializers.ModelSerializer):
    office_name = serializers.ReadOnlyField(source='office.name')
    service_name = serializers.ReadOnlyField(source='service.name')
    division_name = serializers.ReadOnlyField(source='service.division.name')
    division_id = serializers.ReadOnlyField(source='service.division.id')
    counter_name = serializers.ReadOnlyField(source='counter.name')
    served_by_username = serializers.ReadOnlyField(source='served_by.username')
    is_surveyed = serializers.ReadOnlyField()
    assigned_to_name = serializers.SerializerMethodField()
    was_transferred = serializers.SerializerMethodField()
    latest_note = serializers.SerializerMethodField()
    started_at = serializers.SerializerMethodField()
    service_duration_seconds = serializers.ReadOnlyField()
    service_duration_display = serializers.SerializerMethodField()

    class Meta:
        model = CtmsTransaction
        fields = [
            'id',
            'transaction_no',
            'queue_no',
            'office',
            'office_name',
            'service',
            'service_name',
            'division_name',
            'division_id',
            'is_priority',
            'client_name',
            'group_member_names',
            'status',
            'counter',
            'counter_name',
            'assigned_personnel',
            'assigned_to',
            'assigned_to_name',
            'served_by_name',
            'was_transferred',
            'latest_note',
            'source',
            'checked_in_at',
            'called_at',
            'started_at',
            'done_at',
            'service_duration_seconds',
            'service_duration_display',
            'closed_at',
            'served_by',
            'served_by_username',
            'claim_code',
            'is_surveyed',
            'ticket_token',
            'survey_token',
        ]

    def get_started_at(self, obj):
        val = obj.effective_started_at
        return val.isoformat() if val else None

    def get_service_duration_display(self, obj):
        secs = obj.service_duration_seconds
        if secs is None:
            return None
        mins, s = divmod(secs, 60)
        hrs, m = divmod(mins, 60)
        if hrs > 0:
            return f"{hrs}h {m}m"
        elif m > 0:
            return f"{m}m {s}s"
        else:
            return f"{s}s"

    def get_was_transferred(self, obj):
        """Reassigned clients are handled off the TV board (no announcements)."""
        from .models import CtmsAssignmentHistory
        return obj.assignment_history.filter(event=CtmsAssignmentHistory.EVENT_TRANSFERRED).exists()

    def get_latest_note(self, obj):
        """Most recent note written when the client was reassigned or put on pending."""
        from .models import CtmsAssignmentHistory
        event = (obj.assignment_history
                 .filter(event__in=[CtmsAssignmentHistory.EVENT_TRANSFERRED, CtmsAssignmentHistory.EVENT_PENDING])
                 .exclude(reason='')
                 .order_by('-created_at', '-id')
                 .first())
        if not event:
            return None
        return {
            'kind': 'reassign' if event.event == CtmsAssignmentHistory.EVENT_TRANSFERRED else 'pending',
            'text': event.reason,
            'by': event.actor_name,
            'at': event.created_at,
        }

    def get_assigned_to_name(self, obj):
        return personnel_display_name(obj.assigned_to) if obj.assigned_to_id else None


class StaffTokenObtainPairSerializer(TokenObtainPairSerializer):
    """Staff-only login (is_staff, same requirement as the CSM) returning the session summary."""

    def validate(self, attrs):
        data = super().validate(attrs)
        if not self.user.is_staff:
            raise serializers.ValidationError("Access denied. Only DOLE staff members may log in.")
        from .permissions import staff_session
        data['user'] = staff_session(self.user)
        return data


class CtmsAuditLogSerializer(serializers.ModelSerializer):
    category_display = serializers.CharField(source='get_category_display', read_only=True)
    formatted_time = serializers.SerializerMethodField()

    class Meta:
        model = CtmsAuditLog
        fields = [
            'id',
            'timestamp',
            'formatted_time',
            'actor',
            'actor_username',
            'actor_role',
            'action',
            'category',
            'category_display',
            'target_type',
            'target_id',
            'target_repr',
            'office',
            'office_name',
            'division_name',
            'ip_address',
            'description',
            'details',
        ]
        read_only_fields = fields

    def get_formatted_time(self, obj):
        return obj.timestamp.strftime('%b %d, %Y %I:%M:%S %p')

