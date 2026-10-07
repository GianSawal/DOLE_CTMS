from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from .views import (
    HealthCheckView,
    PublicOfficeDetailView,
    PublicCheckinView,
    PublicTicketDetailView,
    PublicDisplayBoardView,
    StaffLoginView,
    StaffMeView,
    StaffChangePasswordView,
    StaffQueueView,
    StaffCreateWalkinView,
    StaffCallNextView,
    StaffTransactionActionView,
    StaffTransactionsListView,
    StaffReportsSummaryView,
    StaffQrCodeView,
    StaffQrConfigView,
    StaffDisplayVideoView,
    PublicFolderVideosView,
    PublicStreamLocalVideoView,
    PublicDisplayVideoUploadView,
    CsmDivisionListView,
    CsmOfficeListView,
    StaffPersonnelViewSet,
    StaffPositionViewSet,
    StaffServiceViewSet,
    CtmsCounterViewSet,
    CtmsStaffOfficeViewSet,
    StaffUserAccountViewSet,
    StaffAuditLogListView,
    StaffNotificationListView,
)

router = DefaultRouter()
router.register(r'staff/counters', CtmsCounterViewSet, basename='staff-counters')
router.register(r'staff/staff-offices', CtmsStaffOfficeViewSet, basename='staff-offices')
router.register(r'staff/users', StaffUserAccountViewSet, basename='staff-users')
router.register(r'staff/employees', StaffUserAccountViewSet, basename='staff-employees')
router.register(r'staff/personnel', StaffPersonnelViewSet, basename='staff-personnel')
router.register(r'staff/positions', StaffPositionViewSet, basename='staff-positions')
router.register(r'staff/services', StaffServiceViewSet, basename='staff-services')

urlpatterns = [
    # Public endpoints
    path('health/', HealthCheckView.as_view(), name='health'),
    path('public/offices/<int:office_id>/', PublicOfficeDetailView.as_view(), name='public-office-detail'),
    path('public/checkin/', PublicCheckinView.as_view(), name='public-checkin'),
    path('public/tickets/<str:ticket_token>/', PublicTicketDetailView.as_view(), name='public-ticket-detail'),
    path('public/display/<int:office_id>/', PublicDisplayBoardView.as_view(), name='public-display-board'),
    path('public/display-video-upload/<int:office_id>/', PublicDisplayVideoUploadView.as_view(), name='public-display-video-upload'),
    path('public/folder-videos/', PublicFolderVideosView.as_view(), name='public-folder-videos'),
    path('public/stream-video/', PublicStreamLocalVideoView.as_view(), name='public-stream-video'),

    # Staff authentication
    path('staff/auth/login/', StaffLoginView.as_view(), name='staff-login'),
    path('staff/auth/refresh/', TokenRefreshView.as_view(), name='staff-refresh'),
    path('staff/auth/me/', StaffMeView.as_view(), name='staff-me'),
    path('staff/auth/change-password/', StaffChangePasswordView.as_view(), name='staff-change-password'),

    # Staff queue operations
    path('staff/queue/', StaffQueueView.as_view(), name='staff-queue'),
    path('staff/call-next/', StaffCallNextView.as_view(), name='staff-call-next'),
    path('staff/transactions/', StaffTransactionsListView.as_view(), name='staff-transactions-list'),
    path('staff/transactions/walkin/', StaffCreateWalkinView.as_view(), name='staff-walkin'),
    path('staff/transactions/<int:pk>/<str:action>/', StaffTransactionActionView.as_view(), name='staff-transaction-action'),

    # Reports, QR, and TV Display Video
    path('staff/reports/summary/', StaffReportsSummaryView.as_view(), name='staff-reports-summary'),
    path('staff/qr/<int:office_id>/', StaffQrCodeView.as_view(), name='staff-qr-code'),
    path('staff/qr-config/', StaffQrConfigView.as_view(), name='staff-qr-config'),
    path('staff/qr-config/toggle/', StaffQrConfigView.as_view(), name='staff-qr-config-toggle'),
    path('staff/display-video/', StaffDisplayVideoView.as_view(), name='staff-display-video'),
    path('staff/divisions/', CsmDivisionListView.as_view(), name='staff-divisions'),
    path('staff/offices/', CsmOfficeListView.as_view(), name='staff-offices-list'),
    path('staff/audit-logs/', StaffAuditLogListView.as_view(), name='staff-audit-logs'),
    path('staff/notifications/', StaffNotificationListView.as_view(), name='staff-notifications'),

    # Routers (Counters & Staff-Offices)
    path('', include(router.urls)),
]
