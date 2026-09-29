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

    class Meta:
        model = CsmService
        fields = ['id', 'name', 'is_active', 'sort_order', 'division', 'division_name']


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

    class Meta:
        model = DolePersonnel
        fields = [
            'id',
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
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_division_names(self, obj):
        return [d.name for d in obj.divisions.all()]


class CtmsUserAccountSerializer(serializers.ModelSerializer):
    """Serializer for login user accounts."""
    role = serializers.SerializerMethodField()
    office = serializers.SerializerMethodField()
    office_name = serializers.SerializerMethodField()
    division_ids = serializers.SerializerMethodField()
    division_names = serializers.SerializerMethodField()
    full_name = serializers.SerializerMethodField()
    employee_id = serializers.CharField(source='username', read_only=True)

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
            'office',
            'office_name',
            'division_ids',
            'division_names',
            'date_joined',
            'last_login',
        ]
        read_only_fields = ['id', 'date_joined', 'last_login']

    def get_role(self, obj):
        return "Administrator" if obj.is_superuser else "Staff"

    def get_full_name(self, obj):
        name = f"{obj.first_name} {obj.last_name}".strip()
        return name if name else obj.username

    def get_office(self, obj):
        staff_off = obj.staff_offices.select_related('office').first()
        return staff_off.office_id if staff_off else None

    def get_office_name(self, obj):
        staff_off = obj.staff_offices.select_related('office').first()
        return staff_off.office.name if staff_off else ("All Offices" if obj.is_superuser else "Unassigned")

    def get_division_ids(self, obj):
        return list(obj.staff_divisions.values_list('division_id', flat=True))

    def get_division_names(self, obj):
        return list(obj.staff_divisions.values_list('division__name', flat=True))


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
            'status',
            'counter',
            'counter_name',
            'assigned_personnel',
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
        try:
            profile = self.user.employee_profile
            assigned_divisions = [
                {'id': d.id, 'name': d.name} for d in profile.divisions.all()
            ]
        except Exception:
            pass

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
