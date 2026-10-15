from datetime import timedelta

from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer, TokenRefreshSerializer
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.utils import datetime_from_epoch
from django.conf import settings
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
    service_requires_concern,
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
    requires_concern = serializers.SerializerMethodField()

    class Meta:
        model = CsmService
        fields = ['id', 'name', 'is_active', 'sort_order', 'division', 'division_name', 'requires_concern']

    def get_requires_concern(self, obj):
        return service_requires_concern(obj.name)


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
            'id', 'office', 'office_name', 'name', 'description', 'is_active', 'is_archived', 'archived_at',
            'sort_order', 'assigned_user', 'assigned_user_name', 'assigned_at', 'is_mine', 'current_client',
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
    client_name = serializers.CharField(max_length=200, required=False, allow_blank=True, allow_null=True)
    is_priority = serializers.BooleanField(required=False, default=False)
    group_member_names = serializers.ListField(
        child=serializers.CharField(max_length=200),
        required=False, default=None, allow_null=True, max_length=50,
        help_text="List of individual member names for group registrations"
    )
    office_code = serializers.CharField(
        max_length=10, required=False, allow_blank=True, default='',
        help_text="Hourly in-office code; required when the office enables it"
    )
    concern_note = serializers.CharField(
        max_length=300, required=False, allow_blank=True, default='',
        help_text="What the client needs; required for a catch-all 'Other...' service"
    )

    def validate(self, attrs):
        service = attrs.get('service')
        if service and service_requires_concern(service.name) and not attrs.get('concern_note', '').strip():
            raise serializers.ValidationError({
                'concern_note': "Please describe what you need."
            })
        return attrs


class TicketPublicSerializer(serializers.ModelSerializer):
    office_name = serializers.ReadOnlyField(source='office.name')
    service_name = serializers.ReadOnlyField(source='service.name')
    counter = serializers.SerializerMethodField()
    ahead = serializers.SerializerMethodField()
    survey_url = serializers.ReadOnlyField()
    surveyed = serializers.ReadOnlyField(source='is_surveyed')
    started_at = serializers.SerializerMethodField()
    office_survey_url = serializers.SerializerMethodField()

    class Meta:
        model = CtmsTransaction
        fields = [
            'office_survey_url',
            'queue_no',
            'transaction_no',
            'claim_code',
            'status',
            'office_name',
            'service_name',
            'concern_note',
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

    def get_office_survey_url(self, obj):
        # The CSM's general survey page for this office, e.g. http://csm.dolero3.lan/survey/office/7
        return f"{settings.CSM_SURVEY_PUBLIC_URL.rstrip('/')}/survey/office/{obj.office_id}"

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
            'concern_note',
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
        """Most recent remarks written when the client was reassigned, put on pending, or completed."""
        from .models import CtmsAssignmentHistory as H
        events = [H.EVENT_TRANSFERRED, H.EVENT_PENDING]
        if obj.status == CtmsTransaction.STATUS_DONE:
            # Done remarks only while the ticket is still done (not after Undo Done)
            events.append(H.EVENT_COMPLETED)
        prefetched = getattr(obj, 'note_events', None)  # list views load these in one query
        if prefetched is not None:
            event = next((e for e in prefetched if e.event in events and e.reason), None)
        else:
            event = (obj.assignment_history
                     .filter(event__in=events)
                     .exclude(reason='')
                     .order_by('-created_at', '-id')
                     .first())
        if not event:
            return None
        kinds = {H.EVENT_TRANSFERRED: 'reassign', H.EVENT_PENDING: 'pending', H.EVENT_COMPLETED: 'done'}
        return {
            'kind': kinds[event.event],
            'text': event.reason,
            'by': event.actor_name,
            'at': event.created_at,
        }

    def get_assigned_to_name(self, obj):
        return personnel_display_name(obj.assigned_to) if obj.assigned_to_id else None


# "Remember me": the sign-in lasts this long instead of SIMPLE_JWT's REFRESH_TOKEN_LIFETIME
# (and the browser does not sign the user out after an hour of inactivity).
REMEMBER_ME_LIFETIME = timedelta(days=30)
# A TV Display account with "Remember me" stays signed in for good (a token needs an expiry,
# so: ten years, renewed on every refresh). Sign out, deactivation or deletion still end it.
REMEMBER_TV_LIFETIME = timedelta(days=3650)


def remember_refresh_token(refresh, tv=False):
    """Marks a refresh token as "Remember me" and gives it the longer lifetime."""
    refresh['remember'] = 'tv' if tv else True
    refresh.set_exp(lifetime=REMEMBER_TV_LIFETIME if tv else REMEMBER_ME_LIFETIME)
    from rest_framework_simplejwt.token_blacklist.models import OutstandingToken
    OutstandingToken.objects.filter(jti=refresh['jti']).update(expires_at=datetime_from_epoch(refresh['exp']))
    return refresh


class StaffTokenObtainPairSerializer(TokenObtainPairSerializer):
    """
    Staff login (is_staff, same requirement as the CSM) returning the session summary.
    TV Display accounts may also sign in; they are sent straight to their office's TV.
    """
    remember = serializers.BooleanField(required=False, default=False)

    def get_token(self, user):
        token = super().get_token(user)
        if getattr(self, '_remember', False):
            from .permissions import is_display_account
            remember_refresh_token(token, tv=is_display_account(user))
        return token

    def validate(self, attrs):
        self._remember = bool(attrs.get('remember'))
        data = super().validate(attrs)
        from .permissions import (display_session, is_display_account, is_registration_account,
                                  registration_office, staff_session)
        if is_display_account(self.user):
            if not display_session(self.user):
                raise serializers.ValidationError("This TV account's office is not active. Ask the system administrator.")
        elif is_registration_account(self.user):
            if not registration_office(self.user):
                raise serializers.ValidationError("This registration account's office is not active. Ask the system administrator.")
        elif not self.user.is_staff:
            raise serializers.ValidationError("Access denied. Only DOLE staff members may log in.")
        data['user'] = staff_session(self.user)
        data['remember'] = self._remember
        return data


class StaffTokenRefreshSerializer(TokenRefreshSerializer):
    """Token refresh that keeps a "Remember me" sign-in on its longer lifetime when rotating."""

    def validate(self, attrs):
        data = super().validate(attrs)
        if 'refresh' in data:
            rotated = RefreshToken(data['refresh'])
            if rotated.get('remember'):
                data['refresh'] = str(remember_refresh_token(rotated, tv=rotated['remember'] == 'tv'))
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

