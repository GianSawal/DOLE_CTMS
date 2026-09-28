from django.contrib import admin
from .models import (
    CsmDivision,
    CsmOffice,
    CsmService,
    CsmResponse,
    CtmsCounter,
    CtmsStaffOffice,
    CtmsDisplayConfig,
    CtmsTransaction,
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
