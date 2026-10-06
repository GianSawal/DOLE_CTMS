from django.contrib import admin
from .models import (
    CsmDivision,
    CsmOffice,
    CsmService,
    CsmResponse,
    CtmsCounter,
    CtmsStaffOffice,
    CtmsEmployee,
    CtmsDisplayConfig,
    CtmsOfficeQrConfig,
    CtmsServiceDefaultOfficer,
    CtmsTransaction,
    CtmsAuditLog,
)

@admin.register(CsmDivision)
class CsmDivisionAdmin(admin.ModelAdmin):
    list_display = ('id', 'name')
    search_fields = ('name',)
    ordering = ('id',)


@admin.register(CtmsDisplayConfig)
class CtmsDisplayConfigAdmin(admin.ModelAdmin):
    list_display = ('id', 'office', 'is_active', 'updated_at')
    search_fields = ('office__name', 'office__code', 'arta_video_url')
    list_filter = ('is_active',)


@admin.register(CtmsOfficeQrConfig)
class CtmsOfficeQrConfigAdmin(admin.ModelAdmin):
    list_display = ('id', 'office', 'is_qr_enabled', 'disabled_at', 'disabled_by', 'updated_at')
    search_fields = ('office__name', 'office__code', 'disabled_message')
    list_filter = ('is_qr_enabled',)
    readonly_fields = ('updated_at',)


@admin.register(CsmOffice)
class CsmOfficeAdmin(admin.ModelAdmin):
    list_display = ('id', 'name', 'code', 'is_active', 'qr_issued_at')
    search_fields = ('name', 'code')
    list_filter = ('is_active',)

@admin.register(CsmService)
class CsmServiceAdmin(admin.ModelAdmin):
    list_display = ('id', 'name', 'sort_order', 'is_active')
    search_fields = ('name',)
    list_filter = ('is_active',)
    ordering = ('sort_order', 'name')


@admin.register(CtmsServiceDefaultOfficer)
class CtmsServiceDefaultOfficerAdmin(admin.ModelAdmin):
    list_display = ('id', 'service', 'officer_name', 'office', 'updated_at')
    search_fields = ('service__name', 'officer_name', 'office__name')
    list_filter = ('office', 'service__division')

@admin.register(CtmsCounter)
class CtmsCounterAdmin(admin.ModelAdmin):
    list_display = ('id', 'office', 'name', 'is_active')
    list_filter = ('office', 'is_active')
    search_fields = ('name', 'office__name')

@admin.register(CtmsStaffOffice)
class CtmsStaffOfficeAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'office')
    list_filter = ('office',)
    search_fields = ('user__username', 'office__name')


@admin.register(CtmsEmployee)
class CtmsEmployeeAdmin(admin.ModelAdmin):
    list_display = ('employee_id', 'last_name', 'first_name', 'position', 'office', 'get_divisions', 'is_active', 'created_at')
    search_fields = ('employee_id', 'first_name', 'last_name', 'position', 'office__name')
    list_filter = ('office', 'divisions', 'user__is_active')
    filter_horizontal = ('divisions',)

    def is_active(self, obj):
        return obj.user.is_active
    is_active.boolean = True

    def get_divisions(self, obj):
        return ", ".join([d.name for d in obj.divisions.all()])
    get_divisions.short_description = 'Divisions'

@admin.register(CtmsTransaction)
class CtmsTransactionAdmin(admin.ModelAdmin):
    list_display = (
        'transaction_no',
        'queue_no',
        'office',
        'service',
        'is_priority',
        'status',
        'counter',
        'checked_in_at',
        'done_at',
    )
    list_filter = ('status', 'is_priority', 'office', 'queue_date')
    search_fields = ('transaction_no', 'queue_no', 'client_name', 'claim_code')
    readonly_fields = ('ticket_token', 'survey_token', 'claim_code', 'checked_in_at')


@admin.register(CtmsAuditLog)
class CtmsAuditLogAdmin(admin.ModelAdmin):
    list_display = (
        'timestamp',
        'actor_username',
        'actor_role',
        'action',
        'category',
        'target_repr',
        'office_name',
        'ip_address',
    )
    list_filter = ('category', 'action', 'office', 'actor_role', 'timestamp')
    search_fields = ('actor_username', 'description', 'target_repr', 'action', 'ip_address')
    readonly_fields = [
        'id', 'timestamp', 'actor', 'actor_username', 'actor_role',
        'action', 'category', 'target_type', 'target_id', 'target_repr',
        'office', 'office_name', 'division_name', 'ip_address',
        'description', 'details'
    ]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

