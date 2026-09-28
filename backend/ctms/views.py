import io
import qrcode
from datetime import timedelta
from django.conf import settings
from django.db import models
from django.db.models import Avg, F, ExpressionWrapper, fields
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status, viewsets, permissions, exceptions
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from .models import (
    CsmOffice,
    CsmService,
    CsmResponse,
    CtmsCounter,
    CtmsStaffOffice,
    CtmsDisplayConfig,
    CtmsTransaction,
)
from .serializers import (
    CsmOfficeSerializer,
    CsmServiceSerializer,
    CtmsCounterSerializer,
    CtmsStaffOfficeSerializer,
    CheckinRequestSerializer,
    TicketPublicSerializer,
    StaffTransactionSerializer,
    StaffTokenObtainPairSerializer,
)
from .throttling import CheckinThrottle, LoginThrottle
from . import services


# =====================================================================
# Auth Views & Permission Helpers
# =====================================================================

class StaffLoginView(TokenObtainPairView):
    serializer_class = StaffTokenObtainPairSerializer
    throttle_classes = [LoginThrottle]


class StaffMeView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        if not user.is_staff:
            return Response({"detail": "Forbidden: Staff account required."}, status=status.HTTP_403_FORBIDDEN)

        assigned_offices = get_staff_offices(user)
        return Response({
            "id": user.id,
            "username": user.username,
            "is_superuser": user.is_superuser,
            "assigned_offices": CsmOfficeSerializer(assigned_offices, many=True).data,
        })


def get_staff_offices(user):
    """Returns queryset of CsmOffices the staff user has access to."""
    if not user or not user.is_authenticated or not user.is_staff:
        return CsmOffice.objects.none()
    if user.is_superuser:
        return CsmOffice.objects.filter(is_active=True)
    assigned_ids = CtmsStaffOffice.objects.filter(user=user).values_list('office_id', flat=True)
    if assigned_ids.exists():
        return CsmOffice.objects.filter(id__in=assigned_ids, is_active=True)
    # Strict RBAC: Staff without an explicit office assignment have access to NONE
    return CsmOffice.objects.none()


class IsStaffUser(permissions.BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_staff)


# =====================================================================
# Public Endpoints (No Auth)
# =====================================================================

class HealthCheckView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        return Response({
            "status": "ok",
            "system": "DOLE CTMS",
            "time": timezone.now().isoformat(),
        })


class PublicOfficeDetailView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request, office_id):
        office = get_object_or_404(CsmOffice, pk=office_id, is_active=True)
        services_qs = CsmService.objects.filter(is_active=True).order_by('sort_order', 'name')
        return Response({
            "office": CsmOfficeSerializer(office).data,
            "services": CsmServiceSerializer(services_qs, many=True).data,
        })


class PublicCheckinView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [CheckinThrottle]

    def post(self, request):
        serializer = CheckinRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            tx = services.create_transaction(
                office=data['office'],
                service=data['service'],
                client_name=data.get('client_name'),
                is_priority=data.get('is_priority', False),
                source=CtmsTransaction.SOURCE_QR,
            )
            return Response({
                "ticket_token": tx.ticket_token,
                "queue_no": tx.queue_no,
                "transaction_no": tx.transaction_no,
            }, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)


class PublicTicketDetailView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request, ticket_token):
        tx = get_object_or_404(CtmsTransaction, ticket_token=ticket_token)
        return Response(TicketPublicSerializer(tx).data)


SERVICE_DESCRIPTIONS = {
    'Single Entry Approach (SEnA)': 'Conciliation-mediation of labor issues, employment disputes, and worker grievances.',
    'Alien Employment Permit (AEP)': 'Issuance and renewal of employment permits for foreign nationals.',
    'Application for Alien Employment Permit (New/Renewal)': 'Issuance and renewal of employment permits for foreign nationals.',
    'Issuance of Certificate of Exclusion from Alien Employment Permit': 'Exclusion certification for foreign nationals exempt from AEP requirements.',
    'Labor Inspection / Clearance': 'Compliance verification for general labor standards and occupational safety.',
    'General Labor Standards Assistance': 'Assistance on minimum wages, overtime, holiday pay, and worker monetary benefits.',
    'Registration of Establishment (Rule 1020)': 'Mandatory registration of commercial, industrial, or agricultural establishments under OSH standards.',
    'Registration of Establishment under Rule 1020 of the Occupational Safety and Health Standards': 'Mandatory registration of commercial, industrial, or agricultural establishments under OSH standards.',
    'Special Program for Employment of Students (SPES)': 'Youth employment assistance providing temporary employment during academic breaks.',
    'TUPAD Program Assistance': 'Emergency community employment assistance for displaced, underemployed, and seasonal workers.',
    'Livelihood Assistance / DILP': 'Grant assistance and enterprise development for vulnerable and informal sector workers.',
    'Application for Livelihood Project Assistance': 'Grant assistance and enterprise development for vulnerable and informal sector workers.',
    'Issuance of Letter of Approval /Disapproval of Construction Safety and Health Program (CSHP) Application': 'Evaluation and approval of construction safety and health programs for infrastructure and building projects.',
    'Registration of Workers\' Association': 'Formal registration and certification of legitimate workers\' associations.',
    'Registration of Union': 'Formal registration and certification of legitimate labor unions.',
    'Registration of Collective Bargaining Agreement': 'Registration of certified collective bargaining agreements between labor and management.',
    'Registration of Contractors': 'Registration of legitimate job contractors and subcontractors under DOLE D.O. 174.',
    'Application for Working Child Permit': 'Permit processing for children under 15 years old engaged in public entertainment or information.',
    'Application for Sugar Workers\' Death Benefit Claim': 'Welfare benefit assistance for families of deceased sugar industry workers.',
    'Application for Sugar Workers\' Maternity Benefit Claim': 'Maternity welfare assistance for covered female sugar industry workers.',
    'Application for Accreditation of Co-Partner': 'Accreditation of program partner organizations and civil society partners.',
    'Clearing of Technical Plans for Mechanical Equipment and Electrical Installation': 'Plan evaluation and safety clearance for mechanical and electrical equipment installations.',
    'Conduct of Technical Safety Inspection for the Issuance of Permit to Operate (PTO) Mechanical Installation/Certificate of Electrical Inspection (CEI)': 'On-site technical safety inspection for boilers, pressure vessels, and electrical systems.',
    'Issuance of Permit to Operate (PTO) Mechanical Installation/Certificate of Electrical Inspection(CEI)': 'Issuance of regulatory permits to operate mechanical installations and certificates of electrical inspection.',
    'Issuance of Certificate of Appearance for Professional Mechanical Engineer/Professional Electric Engineer': 'Certification of official appearance for mechanical and electrical safety engineers.',
    'Application for Job Fair Clearance': 'Clearance verification for organizing recruitment job fairs.',
    'Application for Job Fair Permit': 'Regulatory permit issuance for conducting local and overseas job recruitment fairs.',
    'Application for Authority to Operate Branch Office of a Private Employment Agency': 'Authorization for operating local branch offices of private employment agencies.',
    'Application for Authority to Recruit': 'Authorization for authorized agency representatives to conduct local recruitment.',
    'Application for License to Operate Private Employment Agency (PEA)': 'Licensing and renewal for private recruitment and placement agencies.',
}

def get_service_description(service_name):
    if not service_name:
        return ""
    if service_name in SERVICE_DESCRIPTIONS:
        return SERVICE_DESCRIPTIONS[service_name]
    s_lower = service_name.lower()
    if 'sena' in s_lower or 'single entry' in s_lower:
        return 'Conciliation-mediation of labor issues, employment disputes, and worker grievances.'
    if 'alien' in s_lower or 'aep' in s_lower:
        return 'Issuance and renewal of employment permits for foreign nationals.'
    if 'tupad' in s_lower:
        return 'Emergency community employment assistance for displaced, underemployed, and seasonal workers.'
    if 'livelihood' in s_lower or 'dilp' in s_lower or 'kabuhayan' in s_lower:
        return 'Grant assistance and enterprise development for vulnerable and informal sector workers.'
    if 'spes' in s_lower or 'student' in s_lower:
        return 'Youth employment assistance providing temporary employment during academic breaks.'
    if '1020' in s_lower:
        return 'Mandatory registration of commercial, industrial, or agricultural establishments under OSH standards.'
    if 'cshp' in s_lower or 'construction' in s_lower:
        return 'Evaluation and approval of construction safety and health programs for infrastructure and building projects.'
    if 'inspection' in s_lower or 'labor standards' in s_lower:
        return 'Compliance verification for general labor standards and occupational safety.'
    if 'working child' in s_lower:
        return 'Permit processing for children under 15 years old engaged in public entertainment or information.'
    if 'contractor' in s_lower:
        return 'Registration of legitimate job contractors and subcontractors under DOLE D.O. 174.'
    if 'sugar' in s_lower:
        return 'Social welfare benefit claims for covered sugar industry workers.'
    if 'job fair' in s_lower:
        return 'Regulatory evaluation and permit issuance for job recruitment fairs.'
    return 'Frontline public service, inquiry assistance, and document processing.'


class PublicDisplayBoardView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request, office_id):
        office = get_object_or_404(CsmOffice, pk=office_id, is_active=True)
        today = timezone.localdate()

        # Currently serving transactions at this office
        serving_qs = CtmsTransaction.objects.filter(
            office=office,
            status=CtmsTransaction.STATUS_SERVING,
            queue_date=today
        ).select_related('counter', 'service').order_by('-called_at')

        serving_data = []
        for s in serving_qs:
            service_name = s.service.name if s.service else ""
            serving_data.append({
                "id": s.id,
                "counter": s.counter.name if s.counter else "Counter",
                "queue_no": s.queue_no,
                "called_at": s.called_at.isoformat() if s.called_at else None,
                "service_name": service_name,
                "service_description": get_service_description(service_name),
                "assigned_personnel": s.assigned_personnel or "",
            })

        # Next waiting queue numbers (priority first, then FIFO) - numbers only, never names!
        next_waiting_qs = CtmsTransaction.objects.filter(
            office=office,
            status=CtmsTransaction.STATUS_WAITING,
            queue_date=today
        ).order_by('-is_priority', 'checked_in_at')[:10]

        next_queue_numbers = [tx.queue_no for tx in next_waiting_qs]
        first_serving = serving_qs.first()
        latest_called_at = first_serving.called_at.isoformat() if first_serving and first_serving.called_at else None

        display_config = CtmsDisplayConfig.objects.filter(office=office).first()
        arta_video_url = ""
        if display_config and display_config.is_active:
            if display_config.video_file:
                arta_video_url = display_config.video_file.url
            else:
                arta_video_url = display_config.arta_video_url or ""

        return Response({
            "office": CsmOfficeSerializer(office).data,
            "serving": serving_data,
            "next": next_queue_numbers,
            "latest_called_at": latest_called_at,
            "latest_called_queue_no": first_serving.queue_no if first_serving else None,
            "latest_called_counter": (first_serving.counter.name if first_serving.counter else "Counter") if first_serving else None,
            "latest_called_personnel": (first_serving.assigned_personnel or "") if first_serving else None,
            "arta_video_url": arta_video_url,
            "updated_at": timezone.now().isoformat(),
        })


# =====================================================================
# Staff Queue & Operations Endpoints
# =====================================================================

class StaffQueueView(APIView):
    permission_classes = [IsStaffUser]

    def get(self, request):
        office_id = request.query_params.get('office')
        counter_id = request.query_params.get('counter')

        allowed_offices = get_staff_offices(request.user)
        if not allowed_offices.exists():
            return Response({"detail": "Forbidden: No office assigned to your staff account."}, status=status.HTTP_403_FORBIDDEN)

        if office_id:
            try:
                office = allowed_offices.get(pk=office_id)
            except CsmOffice.DoesNotExist:
                return Response({"detail": "Forbidden: You are not authorized to access this office queue."}, status=status.HTTP_403_FORBIDDEN)
        else:
            office = allowed_offices.first()

        today = timezone.localdate()

        # Waiting list: priority first, then FIFO
        waiting_qs = CtmsTransaction.objects.filter(
            office=office,
            status=CtmsTransaction.STATUS_WAITING,
            queue_date=today
        ).select_related('office', 'service').order_by('-is_priority', 'checked_in_at')

        # Serving list: all serving in this office or counter
        serving_qs = CtmsTransaction.objects.filter(
            office=office,
            status=CtmsTransaction.STATUS_SERVING,
            queue_date=today
        ).select_related('office', 'service', 'counter', 'served_by').order_by('-called_at')

        if counter_id:
            serving_qs = serving_qs.filter(counter_id=counter_id)

        counters_qs = CtmsCounter.objects.filter(office=office, is_active=True)
        if not counters_qs.exists():
            counter_names = ["Window 1", "Window 2", "Window 3 (Priority)", "Helpdesk"]
            for name in counter_names:
                CtmsCounter.objects.get_or_create(office=office, name=name, defaults={'is_active': True})
            counters_qs = CtmsCounter.objects.filter(office=office, is_active=True)

        return Response({
            "office": CsmOfficeSerializer(office).data,
            "waiting": StaffTransactionSerializer(waiting_qs, many=True).data,
            "serving": StaffTransactionSerializer(serving_qs, many=True).data,
            "counters": CtmsCounterSerializer(counters_qs, many=True).data,
        })


class StaffCreateWalkinView(APIView):
    permission_classes = [IsStaffUser]

    def post(self, request):
        serializer = CheckinRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        allowed_offices = get_staff_offices(request.user)
        if not allowed_offices.filter(pk=data['office'].pk).exists():
            return Response({"detail": "Forbidden: You are not assigned to this office."}, status=status.HTTP_403_FORBIDDEN)

        try:
            tx = services.create_transaction(
                office=data['office'],
                service=data['service'],
                client_name=data.get('client_name'),
                is_priority=data.get('is_priority', False),
                source=CtmsTransaction.SOURCE_STAFF,
            )
            return Response(StaffTransactionSerializer(tx).data, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)


class StaffCallNextView(APIView):
    permission_classes = [IsStaffUser]

    def post(self, request):
        office_id = request.data.get('office')
        counter_id = request.data.get('counter')

        if not office_id:
            return Response({"detail": "Office is required."}, status=status.HTTP_400_BAD_REQUEST)

        allowed_offices = get_staff_offices(request.user)
        try:
            office = allowed_offices.get(pk=office_id)
        except CsmOffice.DoesNotExist:
            return Response({"detail": "Forbidden: You are not authorized to call clients for this office."}, status=status.HTTP_403_FORBIDDEN)

        if counter_id:
            counter = get_object_or_404(CtmsCounter, pk=counter_id, office=office, is_active=True)
        else:
            counter = CtmsCounter.objects.filter(office=office, is_active=True).first()
            if not counter:
                counter, _ = CtmsCounter.objects.get_or_create(office=office, name="Window 1", defaults={'is_active': True})

        personnel = request.data.get('personnel') or request.data.get('assigned_personnel')
        try:
            tx = services.call_next_transaction(office=office, counter=counter, personnel=personnel)
            if not tx:
                return Response({"detail": "No waiting clients in the queue."}, status=status.HTTP_204_NO_CONTENT)
            return Response(StaffTransactionSerializer(tx).data)
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)


class StaffTransactionActionView(APIView):
    permission_classes = [IsStaffUser]

    def post(self, request, pk, action):
        tx = get_object_or_404(CtmsTransaction, pk=pk)
        allowed_offices = get_staff_offices(request.user)
        if not allowed_offices.filter(pk=tx.office_id).exists():
            return Response({"detail": "Forbidden: Not assigned to this office."}, status=status.HTTP_403_FORBIDDEN)

        try:
            if action == 'assign':
                personnel = request.data.get('personnel') or request.data.get('assigned_personnel')
                if not personnel or not str(personnel).strip():
                    return Response({"detail": "Personnel name cannot be empty."}, status=status.HTTP_400_BAD_REQUEST)
                tx = services.assign_personnel_to_transaction(tx, str(personnel).strip())

            elif action == 'call':
                counter_id = request.data.get('counter')
                personnel = request.data.get('personnel') or request.data.get('assigned_personnel')
                if counter_id:
                    counter = get_object_or_404(CtmsCounter, pk=counter_id, office=tx.office, is_active=True)
                else:
                    counter = CtmsCounter.objects.filter(office=tx.office, is_active=True).first()
                    if not counter:
                        counter, _ = CtmsCounter.objects.get_or_create(office=tx.office, name="Window 1", defaults={'is_active': True})
                tx = services.call_specific_transaction(tx, counter, personnel=personnel)

            elif action == 'recall':
                if not tx.counter:
                    return Response({"detail": "Transaction is not assigned to a counter."}, status=status.HTTP_400_BAD_REQUEST)
                personnel = request.data.get('personnel') or request.data.get('assigned_personnel')
                tx = services.call_specific_transaction(tx, tx.counter, personnel=personnel)

            elif action == 'done':
                tx = services.mark_done(tx, request.user)

            elif action == 'undo-done':
                tx = services.undo_done(tx)

            elif action == 'no-show':
                tx = services.mark_no_show(tx)

            elif action == 'cancel':
                tx = services.cancel_transaction(tx)

            elif action == 'requeue':
                tx = services.requeue_transaction(tx)

            else:
                return Response({"detail": f"Unknown action: {action}"}, status=status.HTTP_400_BAD_REQUEST)

            return Response(StaffTransactionSerializer(tx).data)

        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_409_CONFLICT)


class StaffTransactionsListView(APIView):
    permission_classes = [IsStaffUser]

    def get(self, request):
        allowed_offices = get_staff_offices(request.user)
        if not allowed_offices.exists():
            return Response([])

        office_id = request.query_params.get('office')
        if office_id:
            if not allowed_offices.filter(pk=office_id).exists():
                return Response({"detail": "Forbidden: You are not assigned to this office."}, status=status.HTTP_403_FORBIDDEN)
            qs = CtmsTransaction.objects.filter(office_id=office_id)
        else:
            qs = CtmsTransaction.objects.filter(office__in=allowed_offices)

        qs = qs.select_related('office', 'service', 'counter', 'served_by')

        service_id = request.query_params.get('service')
        if service_id:
            qs = qs.filter(service_id=service_id)

        status_param = request.query_params.get('status')
        if status_param:
            qs = qs.filter(status=status_param)

        date_from = request.query_params.get('date_from')
        if date_from:
            qs = qs.filter(queue_date__gte=date_from)

        date_to = request.query_params.get('date_to')
        if date_to:
            qs = qs.filter(queue_date__lte=date_to)

        q = request.query_params.get('q')
        if q:
            qs = qs.filter(
                models.Q(transaction_no__icontains=q) |
                models.Q(queue_no__icontains=q) |
                models.Q(client_name__icontains=q)
            )

        # Pagination / limit
        limit = int(request.query_params.get('limit', 100))
        qs = qs.order_by('-checked_in_at')[:limit]

        return Response(StaffTransactionSerializer(qs, many=True).data)


class StaffReportsSummaryView(APIView):
    permission_classes = [IsStaffUser]

    def get(self, request):
        allowed_offices = get_staff_offices(request.user)
        if not allowed_offices.exists():
            return Response({"detail": "Forbidden: No office assigned to your account."}, status=status.HTTP_403_FORBIDDEN)

        office_id = request.query_params.get('office')
        if office_id:
            if not allowed_offices.filter(pk=office_id).exists():
                return Response({"detail": "Forbidden: You are not assigned to this office."}, status=status.HTTP_403_FORBIDDEN)
            qs = CtmsTransaction.objects.filter(office_id=office_id)
        else:
            qs = CtmsTransaction.objects.filter(office__in=allowed_offices)

        date_from = request.query_params.get('date_from')
        if date_from:
            qs = qs.filter(queue_date__gte=date_from)

        date_to = request.query_params.get('date_to')
        if date_to:
            qs = qs.filter(queue_date__lte=date_to)

        total_checked_in = qs.count()
        total_done = qs.filter(status=CtmsTransaction.STATUS_DONE).count()
        total_waiting = qs.filter(status=CtmsTransaction.STATUS_WAITING).count()
        total_serving = qs.filter(status=CtmsTransaction.STATUS_SERVING).count()
        total_no_show = qs.filter(status=CtmsTransaction.STATUS_NO_SHOW).count()
        total_cancelled = qs.filter(status=CtmsTransaction.STATUS_CANCELLED).count()

        # Avg wait time (called_at - checked_in_at in minutes)
        called_txs = qs.filter(called_at__isnull=False)
        wait_times = [(t.called_at - t.checked_in_at).total_seconds() / 60.0 for t in called_txs if t.called_at and t.checked_in_at]
        avg_wait_min = round(sum(wait_times) / len(wait_times), 1) if wait_times else 0

        # Avg service time (done_at - called_at in minutes)
        done_txs = qs.filter(status=CtmsTransaction.STATUS_DONE, done_at__isnull=False, called_at__isnull=False)
        service_times = [(t.done_at - t.called_at).total_seconds() / 60.0 for t in done_txs if t.done_at and t.called_at]
        avg_service_min = round(sum(service_times) / len(service_times), 1) if service_times else 0

        # Survey rate calculation
        # Reads ctms_transaction_id from csm_csmresponse
        done_ids = list(qs.filter(status=CtmsTransaction.STATUS_DONE).values_list('id', flat=True))
        try:
            surveyed_count = CsmResponse.objects.filter(ctms_transaction_id__in=done_ids).count()
        except Exception:
            surveyed_count = 0

        survey_rate = round((surveyed_count / total_done * 100), 1) if total_done > 0 else 0

        return Response({
            "total_checked_in": total_checked_in,
            "total_done": total_done,
            "total_waiting": total_waiting,
            "total_serving": total_serving,
            "total_no_show": total_no_show,
            "total_cancelled": total_cancelled,
            "avg_wait_min": avg_wait_min,
            "avg_service_min": avg_service_min,
            "surveyed_count": surveyed_count,
            "survey_rate_percent": survey_rate,
        })


class StaffQrCodeView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request, office_id):
        office = get_object_or_404(CsmOffice, pk=office_id)
        base_url = settings.CTMS_BASE_URL.rstrip('/')
        checkin_url = f"{base_url}/checkin/office/{office.id}"

        qr = qrcode.QRCode(
            version=None,
            error_correction=qrcode.constants.ERROR_CORRECT_H,
            box_size=10,
            border=4,
        )
        qr.add_data(checkin_url)
        qr.make(fit=True)
        img = qr.make_image(fill_color="#0305ba", back_color="white")

        buffer = io.BytesIO()
        img.save(buffer, format="PNG")
        buffer.seek(0)
        return HttpResponse(buffer.getvalue(), content_type="image/png")


class StaffDisplayVideoView(APIView):
    permission_classes = [IsStaffUser]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request):
        office_id = request.GET.get('office')
        if not office_id:
            return Response({"detail": "Office ID required."}, status=status.HTTP_400_BAD_REQUEST)
        allowed_offices = get_staff_offices(request.user)
        office = get_object_or_404(allowed_offices, pk=office_id)
        config, _ = CtmsDisplayConfig.objects.get_or_create(office=office)
        
        video_url = config.video_file.url if config.video_file else config.arta_video_url
        file_name = config.video_file.name.split('/')[-1] if config.video_file else ''

        return Response({
            "office_id": office.id,
            "office_name": office.name,
            "arta_video_url": video_url,
            "raw_video_url": config.arta_video_url,
            "video_file_name": file_name,
            "has_file": bool(config.video_file),
            "is_active": config.is_active,
        })

    def post(self, request):
        office_id = request.data.get('office')
        if not office_id:
            return Response({"detail": "Office ID required."}, status=status.HTTP_400_BAD_REQUEST)
        allowed_offices = get_staff_offices(request.user)
        office = get_object_or_404(allowed_offices, pk=office_id)
        config, _ = CtmsDisplayConfig.objects.get_or_create(office=office)

        # Handle uploaded video file
        if 'video_file' in request.FILES:
            if config.video_file:
                try:
                    config.video_file.delete(save=False)
                except Exception:
                    pass
            config.video_file = request.FILES['video_file']
            config.arta_video_url = ''
        elif 'arta_video_url' in request.data:
            url_val = request.data.get('arta_video_url', '').strip()
            config.arta_video_url = url_val
            clear_file = request.data.get('clear_file')
            if not url_val or clear_file:
                if config.video_file:
                    try:
                        config.video_file.delete(save=False)
                    except Exception:
                        pass
                config.video_file = None
        elif request.data.get('clear_file'):
            if config.video_file:
                try:
                    config.video_file.delete(save=False)
                except Exception:
                    pass
            config.video_file = None
            config.arta_video_url = ''

        if 'is_active' in request.data:
            val = request.data.get('is_active')
            if isinstance(val, str):
                config.is_active = val.lower() in ('true', '1')
            else:
                config.is_active = bool(val)

        config.save()

        video_url = config.video_file.url if config.video_file else config.arta_video_url
        file_name = config.video_file.name.split('/')[-1] if config.video_file else ''

        return Response({
            "status": "success",
            "office_id": office.id,
            "office_name": office.name,
            "arta_video_url": video_url,
            "raw_video_url": config.arta_video_url,
            "video_file_name": file_name,
            "has_file": bool(config.video_file),
            "is_active": config.is_active,
        })


# =====================================================================
# Counters and Staff Assignment Management
# =====================================================================

class CtmsCounterViewSet(viewsets.ModelViewSet):
    serializer_class = CtmsCounterSerializer
    permission_classes = [IsStaffUser]

    def get_queryset(self):
        allowed_offices = get_staff_offices(self.request.user)
        return CtmsCounter.objects.filter(office__in=allowed_offices)

    def perform_create(self, serializer):
        allowed_offices = get_staff_offices(self.request.user)
        office = serializer.validated_data.get('office')
        if not allowed_offices.filter(pk=office.pk).exists():
            raise exceptions.PermissionDenied("Forbidden: You are not authorized to create counters for this office.")
        serializer.save()


class CtmsStaffOfficeViewSet(viewsets.ModelViewSet):
    serializer_class = CtmsStaffOfficeSerializer
    permission_classes = [permissions.IsAdminUser]
    queryset = CtmsStaffOffice.objects.all().select_related('user', 'office')
