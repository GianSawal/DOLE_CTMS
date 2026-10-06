from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from django.contrib.auth import get_user_model
from .models import (
    CsmDivision,
    CsmOffice,
    CsmService,
    CtmsCounter,
    CtmsStaffOffice,
    CtmsStaffDivision,
    CtmsEmployee,
    DolePersonnel,
    CtmsTransaction,
    CtmsAuditLog,
    CtmsNotification,
)

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
    default_officer = serializers.SerializerMethodField()

    class Meta:
        model = CsmService
        fields = ['id', 'name', 'is_active', 'sort_order', 'division', 'division_name', 'default_officer']

    def get_default_officer(self, obj):
        from .services import get_default_officer_for_service
        return get_default_officer_for_service(obj)


class StaffServicePersonnelBriefSerializer(serializers.ModelSerializer):
    office_name = serializers.ReadOnlyField(source='office.name')
    office_code = serializers.ReadOnlyField(source='office.code')
    division_names = serializers.SerializerMethodField()

    class Meta:
        model = DolePersonnel
        fields = [
            'id',
            'employee_id',
            'full_name',
            'first_name',
            'last_name',
            'position',
            'office_id',
            'office_name',
            'office_code',
            'division_names',
            'is_active',
        ]

    def get_division_names(self, obj):
        return [d.name for d in obj.divisions.all()]


class StaffServiceSerializer(serializers.ModelSerializer):
    division_name = serializers.ReadOnlyField(source='division.name')
    default_officer = serializers.SerializerMethodField()
    assigned_personnel = StaffServicePersonnelBriefSerializer(many=True, read_only=True)
    assigned_personnel_ids = serializers.SerializerMethodField()
    assigned_count = serializers.SerializerMethodField()

    class Meta:
        model = CsmService
        fields = [
            'id',
            'name',
            'is_active',
            'sort_order',
            'division',
            'division_name',
            'default_officer',
            'assigned_personnel',
            'assigned_personnel_ids',
            'assigned_count',
        ]

    def get_default_officer(self, obj):
        from .services import get_default_officer_for_service
        return get_default_officer_for_service(obj)

    def get_assigned_personnel_ids(self, obj):
        return [p.id for p in obj.assigned_personnel.all()]

    def get_assigned_count(self, obj):
        return obj.assigned_personnel.count()


class CtmsCounterSerializer(serializers.ModelSerializer):
    office_name = serializers.ReadOnlyField(source='office.name')

    class Meta:
        model = CtmsCounter
        fields = ['id', 'office', 'office_name', 'name', 'is_active']


class CtmsStaffOfficeSerializer(serializers.ModelSerializer):
    username = serializers.ReadOnlyField(source='user.username')
    office_name = serializers.ReadOnlyField(source='office.name')

    class Meta:
        model = CtmsStaffOffice
        fields = ['id', 'user', 'username', 'office', 'office_name']


class DolePersonnelSerializer(serializers.ModelSerializer):
    """Serializer for pure DOLE Personnel directory (no user accounts)."""
    office_name = serializers.ReadOnlyField(source='office.name')
    office_code = serializers.ReadOnlyField(source='office.code')
    divisions_detail = CsmDivisionSerializer(source='divisions', many=True, read_only=True)
    division_names = serializers.SerializerMethodField()
    division_ids = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=CsmDivision.objects.all(),
        source='divisions',
        required=False
    )
    full_name = serializers.ReadOnlyField()
    services_detail = serializers.SerializerMethodField()
    service_ids = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=CsmService.objects.all(),
        source='services',
        required=False
    )
    service_names = serializers.SerializerMethodField()

    user = serializers.PrimaryKeyRelatedField(read_only=True)
    user_username = serializers.ReadOnlyField(source='user.username')

    class Meta:
        model = DolePersonnel
        fields = [
            'id',
            'user',
            'user_username',
            'employee_id',
            'first_name',
            'middle_name',
            'last_name',
            'full_name',
            'position',
            'office',
            'office_name',
            'office_code',
            'division_ids',
            'division_names',
            'divisions_detail',
            'service_ids',
            'service_names',
            'services_detail',
            'is_active',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_division_names(self, obj):
        return [d.name for d in obj.divisions.all()]

    def get_services_detail(self, obj):
        return [
            {
                'id': s.id,
                'name': s.name,
                'division_id': s.division_id,
                'division_name': s.division.name if s.division else None
            }
            for s in obj.services.all()
        ]

    def get_service_names(self, obj):
        return [s.name for s in obj.services.all()]


class CtmsUserAccountSerializer(serializers.ModelSerializer):
    """Serializer for login user accounts."""
    role = serializers.SerializerMethodField()
    office = serializers.SerializerMethodField()
    office_name = serializers.SerializerMethodField()
    office_ids = serializers.SerializerMethodField()
    office_names = serializers.SerializerMethodField()
    all_offices_access = serializers.SerializerMethodField()
    all_divisions_access = serializers.SerializerMethodField()
    division_ids = serializers.SerializerMethodField()
    division_names = serializers.SerializerMethodField()
    full_name = serializers.SerializerMethodField()
    employee_id = serializers.CharField(source='username', read_only=True)

    personnel_id = serializers.SerializerMethodField()
    personnel_name = serializers.SerializerMethodField()
    personnel_employee_id = serializers.SerializerMethodField()
    personnel_position = serializers.SerializerMethodField()
    personnel_detail = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id',
            'username',
            'employee_id',
            'first_name',
            'last_name',
            'full_name',
            'role',
            'is_staff',
            'is_superuser',
            'is_active',
            'personnel_id',
            'personnel_name',
            'personnel_employee_id',
            'personnel_position',
            'personnel_detail',
            'office',
            'office_name',
            'office_ids',
            'office_names',
            'all_offices_access',
            'all_divisions_access',
            'division_ids',
            'division_names',
            'date_joined',
            'last_login',
        ]
        read_only_fields = ['id', 'date_joined', 'last_login']

    def get_personnel_id(self, obj):
        p = getattr(obj, 'dole_personnel', None)
        return p.id if p else None

    def get_personnel_name(self, obj):
        p = getattr(obj, 'dole_personnel', None)
        return p.full_name if p else None

    def get_personnel_employee_id(self, obj):
        p = getattr(obj, 'dole_personnel', None)
        return p.employee_id if p else None

    def get_personnel_position(self, obj):
        p = getattr(obj, 'dole_personnel', None)
        return p.position if p else None

    def get_personnel_detail(self, obj):
        p = getattr(obj, 'dole_personnel', None)
        if not p:
            return None
        return {
            'id': p.id,
            'full_name': p.full_name,
            'employee_id': p.employee_id,
            'position': p.position,
            'office_id': p.office_id,
            'office_name': p.office.name if p.office else '',
            'division_names': [d.name for d in p.divisions.all()],
        }

    def get_role(self, obj):
        return "Administrator" if obj.is_superuser else "Staff"

    def get_full_name(self, obj):
        name = f"{obj.first_name} {obj.last_name}".strip()
        return name if name else obj.username

    def get_all_offices_access(self, obj):
        if not obj.is_superuser:
            return False
        total_active_offices = CsmOffice.objects.filter(is_active=True).count()
        assigned_count = obj.staff_offices.count()
        return assigned_count == 0 or (total_active_offices > 0 and assigned_count >= total_active_offices)

    def get_all_divisions_access(self, obj):
        if not obj.is_superuser:
            return False
        total_divisions = CsmDivision.objects.exclude(name__iexact='ALL').count()
        assigned_count = obj.staff_divisions.count()
        return assigned_count == 0 or (total_divisions > 0 and assigned_count >= total_divisions)

    def get_office(self, obj):
        staff_off = obj.staff_offices.select_related('office').first()
        return staff_off.office_id if staff_off else None

    def get_office_ids(self, obj):
        ids = list(obj.staff_offices.values_list('office_id', flat=True))
        if not ids and obj.is_superuser:
            return list(CsmOffice.objects.filter(is_active=True).values_list('id', flat=True).order_by('id'))
        return ids

    def get_office_names(self, obj):
        names = list(obj.staff_offices.values_list('office__name', flat=True))
        if not names and obj.is_superuser:
            return list(CsmOffice.objects.filter(is_active=True).values_list('name', flat=True).order_by('name'))
        return names

    def get_office_name(self, obj):
        if self.get_all_offices_access(obj):
            return "All Offices"
        office_names = self.get_office_names(obj)
        if not office_names:
            return "All Offices" if obj.is_superuser else "Unassigned"
        if len(office_names) == 1:
            return office_names[0]
        return f"{office_names[0]} (+{len(office_names) - 1} more)"

    def get_division_ids(self, obj):
        ids = list(obj.staff_divisions.values_list('division_id', flat=True))
        if not ids and obj.is_superuser:
            return list(CsmDivision.objects.exclude(name__iexact='ALL').values_list('id', flat=True).order_by('id'))
        return ids

    def get_division_names(self, obj):
        names = list(obj.staff_divisions.values_list('division__name', flat=True))
        if not names and obj.is_superuser:
            return list(CsmDivision.objects.exclude(name__iexact='ALL').values_list('name', flat=True).order_by('id'))
        return names


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


class CtmsEmployeeSerializer(serializers.ModelSerializer):
    username = serializers.SerializerMethodField()
    office_name = serializers.ReadOnlyField(source='office.name')
    office_code = serializers.ReadOnlyField(source='office.code')
    divisions_detail = CsmDivisionSerializer(source='divisions', many=True, read_only=True)
    division_names = serializers.SerializerMethodField()
    division_ids = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=CsmDivision.objects.all(),
        source='divisions',
        required=False
    )
    is_active = serializers.SerializerMethodField()

    class Meta:
        model = CtmsEmployee
        fields = [
            'id',
            'user',
            'username',
            'employee_id',
            'first_name',
            'middle_name',
            'last_name',
            'full_name',
            'position',
            'office',
            'office_name',
            'office_code',
            'division_ids',
            'division_names',
            'divisions_detail',
            'is_active',
            'must_change_password',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'user', 'created_at', 'updated_at']

    def get_username(self, obj):
        return obj.user.username if obj.user else obj.employee_id

    def get_is_active(self, obj):
        if obj.user:
            return bool(obj.user.is_active and obj.is_active)
        return bool(obj.is_active)

    def get_division_names(self, obj):
        return [d.name for d in obj.divisions.all()]


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


class TicketPublicSerializer(serializers.ModelSerializer):
    office_name = serializers.ReadOnlyField(source='office.name')
    service_name = serializers.ReadOnlyField(source='service.name')
    counter = serializers.SerializerMethodField()
    ahead = serializers.SerializerMethodField()
    survey_url = serializers.ReadOnlyField()
    surveyed = serializers.ReadOnlyField(source='is_surveyed')

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
            'done_at',
        ]

    def get_counter(self, obj):
        return obj.counter.name if obj.counter else None

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
    default_officer = serializers.SerializerMethodField()

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
            'default_officer',
            'source',
            'checked_in_at',
            'called_at',
            'done_at',
            'closed_at',
            'served_by',
            'served_by_username',
            'claim_code',
            'is_surveyed',
            'ticket_token',
            'survey_token',
        ]

    def get_default_officer(self, obj):
        if not obj or not obj.service:
            return None
        from .services import get_default_officer_for_service
        return get_default_officer_for_service(obj.service, office=obj.office)


class StaffTokenObtainPairSerializer(TokenObtainPairSerializer):
    """
    Ensures user is staff (is_staff = True), same requirement as CSM.
    Returns user details and assigned offices in token response.
    """
    def validate(self, attrs):
        data = super().validate(attrs)

        if not self.user.is_staff:
            raise serializers.ValidationError("Access denied. Only DOLE staff members may log in.")

        assigned_offices = list(
            CtmsStaffOffice.objects.filter(user=self.user).values('office_id', 'office__name', 'office__code')
        )

        assigned_divisions = []
        staff_divs = CtmsStaffDivision.objects.filter(user=self.user).select_related('division').order_by('division__id')
        if staff_divs.exists():
            assigned_divisions = [
                {'id': sd.division.id, 'name': sd.division.name} for sd in staff_divs if sd.division
            ]
        else:
            try:
                profile = self.user.employee_profile
                if profile and profile.divisions.exists():
                    assigned_divisions = [
                        {'id': d.id, 'name': d.name} for d in profile.divisions.all()
                    ]
            except Exception:
                pass

        if not assigned_divisions:
            # Superusers and unrestricted accounts have access to all operational divisions
            all_divs = CsmDivision.objects.exclude(name__iexact='ALL').order_by('id')
            assigned_divisions = [
                {'id': d.id, 'name': d.name} for d in all_divs
            ]

        must_change_password = False
        try:
            profile = self.user.employee_profile
            must_change_password = bool(profile.must_change_password)
        except Exception:
            pass

        data['user'] = {
            'id': self.user.id,
            'username': self.user.username,
            'first_name': self.user.first_name,
            'last_name': self.user.last_name,
            'is_superuser': self.user.is_superuser,
            'must_change_password': must_change_password,
            'assigned_offices': [
                {'id': o['office_id'], 'name': o['office__name'], 'code': o['office__code']}
                for o in assigned_offices
            ],
            'assigned_divisions': assigned_divisions,
        }
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

