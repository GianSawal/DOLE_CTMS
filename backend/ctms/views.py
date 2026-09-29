import io
import os
import re
import urllib.request
import urllib.parse
import mimetypes
import qrcode
from datetime import timedelta
from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import models, transaction
from django.db.models import Avg, F, ExpressionWrapper, fields
from django.http import HttpResponse, FileResponse, Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status, viewsets, permissions, exceptions
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

User = get_user_model()

from .models import (
    CsmDivision,
    CsmOffice,
    CsmService,
    CsmResponse,
    CtmsCounter,
    CtmsStaffOffice,
    CtmsEmployee,
    CtmsDisplayConfig,
    CtmsTransaction,
)
from .serializers import (
    CsmDivisionSerializer,
    CsmOfficeSerializer,
    CsmServiceSerializer,
    CtmsCounterSerializer,
    CtmsStaffOfficeSerializer,
    CtmsEmployeeSerializer,
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
        assigned_divisions = get_staff_divisions(user)
        employee_data = None
        must_change_password = False
        try:
            profile = user.employee_profile
            employee_data = CtmsEmployeeSerializer(profile).data
            must_change_password = bool(profile.must_change_password)
        except Exception:
            pass

        return Response({
            "id": user.id,
            "username": user.username,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "is_superuser": user.is_superuser,
            "must_change_password": must_change_password,
            "assigned_offices": CsmOfficeSerializer(assigned_offices, many=True).data,
            "assigned_divisions": CsmDivisionSerializer(assigned_divisions, many=True).data,
            "employee_profile": employee_data,
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


def get_staff_divisions(user):
    """
    Returns queryset of CsmDivision the staff user is allowed to access.
    Superusers have access to all divisions.
    Staff members with employee profiles have access to their assigned divisions.
    """
    if not user or not user.is_authenticated or not user.is_staff:
        return CsmDivision.objects.none()
    if user.is_superuser:
        return CsmDivision.objects.all().order_by('id')
    try:
        profile = getattr(user, 'employee_profile', None)
        if profile:
            return profile.divisions.all().order_by('id')
    except Exception:
        pass
    return CsmDivision.objects.all().order_by('id')


class IsStaffUser(permissions.BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_staff)


class IsAdminUserOnly(permissions.BasePermission):
    """Allows access only to superuser admin accounts."""
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_superuser)


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
        allowed_divisions = get_staff_divisions(request.user)
        allowed_div_names = list(allowed_divisions.values_list('name', flat=True))

        # Waiting list: priority first, then FIFO
        waiting_qs = CtmsTransaction.objects.filter(
            office=office,
            status=CtmsTransaction.STATUS_WAITING,
            queue_date=today
        ).select_related('office', 'service', 'service__division')

        # Serving list: all serving in this office or counter
        serving_qs = CtmsTransaction.objects.filter(
            office=office,
            status=CtmsTransaction.STATUS_SERVING,
            queue_date=today
        ).select_related('office', 'service', 'service__division', 'counter', 'served_by').order_by('-called_at')

        # If not superuser, restrict waiting and serving queues to the user's assigned divisions
        if not request.user.is_superuser:
            waiting_qs = waiting_qs.filter(service__division__in=allowed_divisions)
            serving_qs = serving_qs.filter(service__division__in=allowed_divisions)

        if counter_id:
            counter = CtmsCounter.objects.filter(pk=counter_id, office=office, is_active=True).first()
            if counter:
                if not request.user.is_superuser and counter.name not in allowed_div_names:
                    return Response({"detail": "Forbidden: You are not authorized to access this counter / division queue."}, status=status.HTTP_403_FORBIDDEN)
                serving_qs = serving_qs.filter(counter=counter)
                division = CsmDivision.objects.filter(name=counter.name).first()
                if division:
                    waiting_qs = waiting_qs.filter(service__division=division)

        waiting_qs = waiting_qs.order_by('-is_priority', 'checked_in_at')

        # Retrieve divisions directly from csm_division table
        all_divisions = CsmDivision.objects.all().order_by('id')
        all_division_names = [d.name for d in all_divisions]

        if all_division_names:
            # Ensure an active counter exists for each division in csm_division
            for div_name in all_division_names:
                cnt, created = CtmsCounter.objects.get_or_create(
                    office=office,
                    name=div_name,
                    defaults={'is_active': True}
                )
                if not created and not cnt.is_active:
                    cnt.is_active = True
                    cnt.save(update_fields=['is_active'])

            # Deactivate obsolete counters that do not match csm_division (e.g. Window 1, Window 2)
            CtmsCounter.objects.filter(office=office).exclude(name__in=all_division_names).update(is_active=False)

        counters_qs = CtmsCounter.objects.filter(office=office, is_active=True).order_by('id')

        # If regular staff (non-superuser), restrict counters and divisions to only assigned divisions
        if not request.user.is_superuser:
            counters_qs = counters_qs.filter(name__in=allowed_div_names)
            divisions_data = allowed_divisions
        else:
            divisions_data = all_divisions

        return Response({
            "office": CsmOfficeSerializer(office).data,
            "waiting": StaffTransactionSerializer(waiting_qs, many=True).data,
            "serving": StaffTransactionSerializer(serving_qs, many=True).data,
            "counters": CtmsCounterSerializer(counters_qs, many=True).data,
            "divisions": CsmDivisionSerializer(divisions_data, many=True).data,
        })


def validate_personnel_division_assignment(tx, personnel_name_or_id):
    """
    Enforces division restriction:
    A personnel can only be assigned to services belonging to their assigned division.
    For example, if assigned to TSSD1, they can only be assigned to services under TSSD1,
    and cannot be assigned to services belonging to other divisions.
    """
    if not tx or not tx.service or not tx.service.division or not personnel_name_or_id:
        return True, None

    svc_div = tx.service.division.name.strip().upper().replace(' ', '')
    if svc_div == 'ALL':
        return True, None

    clean_str = str(personnel_name_or_id).strip()

    # Look up by employee_id or username first
    emp = CtmsEmployee.objects.filter(
        models.Q(employee_id__iexact=clean_str) |
        models.Q(user__username__iexact=clean_str)
    ).first()

    # If not found by ID, look up by full name or parts
    if not emp:
        for candidate in CtmsEmployee.objects.all().prefetch_related('divisions'):
            c_full = candidate.full_name.strip().lower()
            c_simple = f"{candidate.first_name} {candidate.last_name}".strip().lower()
            if clean_str.lower() in (c_full, c_simple) or c_full in clean_str.lower():
                emp = candidate
                break

    if emp:
        emp_divs = [d.name.strip().upper().replace(' ', '') for d in emp.divisions.all()]
        if emp_divs and svc_div not in emp_divs and 'ALL' not in emp_divs:
            div_names = ', '.join([d.name for d in emp.divisions.all()])
            return False, f"Cannot assign {emp.full_name}: Personnel is assigned to division {div_names} and cannot be assigned to {tx.service.name} ({tx.service.division.name})."

    return True, None


class StaffCreateWalkinView(APIView):
    permission_classes = [IsStaffUser]

    def post(self, request):
        serializer = CheckinRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        allowed_offices = get_staff_offices(request.user)
        if not allowed_offices.filter(pk=data['office'].pk).exists():
            return Response({"detail": "Forbidden: You are not assigned to this office."}, status=status.HTTP_403_FORBIDDEN)

        if not request.user.is_superuser:
            allowed_divs = get_staff_divisions(request.user)
            if data['service'].division and not allowed_divs.filter(pk=data['service'].division_id).exists():
                return Response({
                    "detail": f"Forbidden: You are not authorized to create walk-in tickets for services under {data['service'].division.name}."
                }, status=status.HTTP_403_FORBIDDEN)

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

        allowed_divs = get_staff_divisions(request.user)
        allowed_div_names = list(allowed_divs.values_list('name', flat=True))

        if counter_id:
            counter = get_object_or_404(CtmsCounter, pk=counter_id, office=office, is_active=True)
            if not request.user.is_superuser and counter.name not in allowed_div_names:
                return Response({"detail": "Forbidden: You are not authorized to call clients for this counter / division."}, status=status.HTTP_403_FORBIDDEN)
        else:
            counter_candidates = CtmsCounter.objects.filter(office=office, is_active=True)
            if not request.user.is_superuser:
                counter_candidates = counter_candidates.filter(name__in=allowed_div_names)
            counter = counter_candidates.first()
            if not counter:
                first_div = allowed_divs.first() or CsmDivision.objects.first()
                default_name = first_div.name if first_div else "General"
                counter, _ = CtmsCounter.objects.get_or_create(office=office, name=default_name, defaults={'is_active': True})

        personnel = request.data.get('personnel') or request.data.get('assigned_personnel')
        if personnel and str(personnel).strip() and counter:
            div = CsmDivision.objects.filter(name=counter.name).first()
            if div:
                clean_str = str(personnel).strip()
                emp = CtmsEmployee.objects.filter(
                    models.Q(employee_id__iexact=clean_str) |
                    models.Q(user__username__iexact=clean_str)
                ).first()
                if not emp:
                    for candidate in CtmsEmployee.objects.all().prefetch_related('divisions'):
                        c_full = candidate.full_name.strip().lower()
                        c_simple = f"{candidate.first_name} {candidate.last_name}".strip().lower()
                        if clean_str.lower() in (c_full, c_simple) or c_full in clean_str.lower():
                            emp = candidate
                            break
                if emp:
                    emp_divs = [d.name.strip().upper().replace(' ', '') for d in emp.divisions.all()]
                    c_div = div.name.strip().upper().replace(' ', '')
                    if emp_divs and c_div not in emp_divs and 'ALL' not in emp_divs:
                        div_names = ', '.join([d.name for d in emp.divisions.all()])
                        return Response({
                            "detail": f"Cannot assign {emp.full_name}: Personnel is assigned to division {div_names} and cannot be assigned to {div.name}."
                        }, status=status.HTTP_400_BAD_REQUEST)

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

        if not request.user.is_superuser:
            allowed_divs = get_staff_divisions(request.user)
            if tx.service and tx.service.division and not allowed_divs.filter(pk=tx.service.division_id).exists():
                return Response({"detail": "Forbidden: You are not authorized to access transactions for this division."}, status=status.HTTP_403_FORBIDDEN)

        try:
            if action == 'assign':
                personnel = request.data.get('personnel') or request.data.get('assigned_personnel')
                if not personnel or not str(personnel).strip():
                    return Response({"detail": "Personnel name cannot be empty."}, status=status.HTTP_400_BAD_REQUEST)
                clean_personnel = str(personnel).strip()
                valid, err_msg = validate_personnel_division_assignment(tx, clean_personnel)
                if not valid:
                    return Response({"detail": err_msg}, status=status.HTTP_400_BAD_REQUEST)
                tx = services.assign_personnel_to_transaction(tx, clean_personnel)

            elif action == 'call':
                counter_id = request.data.get('counter')
                personnel = request.data.get('personnel') or request.data.get('assigned_personnel')
                if personnel and str(personnel).strip():
                    valid, err_msg = validate_personnel_division_assignment(tx, str(personnel).strip())
                    if not valid:
                        return Response({"detail": err_msg}, status=status.HTTP_400_BAD_REQUEST)
                if counter_id:
                    counter = get_object_or_404(CtmsCounter, pk=counter_id, office=tx.office, is_active=True)
                else:
                    counter = CtmsCounter.objects.filter(office=tx.office, is_active=True).first()
                    if not counter:
                        first_div = CsmDivision.objects.first()
                        default_name = first_div.name if first_div else "General"
                        counter, _ = CtmsCounter.objects.get_or_create(office=tx.office, name=default_name, defaults={'is_active': True})
                tx = services.call_specific_transaction(tx, counter, personnel=personnel)

            elif action == 'recall':
                if not tx.counter:
                    return Response({"detail": "Transaction is not assigned to a counter."}, status=status.HTTP_400_BAD_REQUEST)
                personnel = request.data.get('personnel') or request.data.get('assigned_personnel')
                if personnel and str(personnel).strip():
                    valid, err_msg = validate_personnel_division_assignment(tx, str(personnel).strip())
                    if not valid:
                        return Response({"detail": err_msg}, status=status.HTTP_400_BAD_REQUEST)
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

        qs = qs.select_related('office', 'service', 'service__division', 'counter', 'served_by')

        service_id = request.query_params.get('service')
        if service_id:
            qs = qs.filter(service_id=service_id)

        division_param = request.query_params.get('division')
        if division_param:
            if division_param.isdigit():
                qs = qs.filter(service__division_id=int(division_param))
            else:
                qs = qs.filter(
                    models.Q(service__division__name__iexact=division_param) |
                    models.Q(service__division__name__icontains=division_param)
                )

        personnel_param = request.query_params.get('personnel')
        if personnel_param:
            qs = qs.filter(assigned_personnel__icontains=personnel_param)

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
                models.Q(client_name__icontains=q) |
                models.Q(assigned_personnel__icontains=q) |
                models.Q(service__division__name__icontains=q)
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


class StaffEmployeeViewSet(viewsets.ModelViewSet):
    """
    CRUD ViewSet for managing DOLE staff employees.
    Accessible only by superuser administrators.
    """
    serializer_class = CtmsEmployeeSerializer
    permission_classes = [IsAdminUserOnly]
    queryset = CtmsEmployee.objects.all().select_related('user', 'office').prefetch_related('divisions').order_by('-id')

    def get_queryset(self):
        qs = CtmsEmployee.objects.all().select_related('user', 'office').prefetch_related('divisions').order_by('-id')
        office_id = self.request.query_params.get('office')
        if office_id:
            qs = qs.filter(office_id=office_id)
        search = self.request.query_params.get('search')
        if search:
            qs = qs.filter(
                models.Q(employee_id__icontains=search) |
                models.Q(first_name__icontains=search) |
                models.Q(last_name__icontains=search) |
                models.Q(position__icontains=search)
            )
        return qs

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        data = request.data
        employee_id = str(data.get('employee_id', '')).strip()
        first_name = str(data.get('first_name', '')).strip()
        middle_name = str(data.get('middle_name', '')).strip()
        last_name = str(data.get('last_name', '')).strip()
        position = str(data.get('position', '')).strip()
        office_id = data.get('office')
        division_ids = data.get('division_ids', [])
        temporary_password = str(data.get('temporary_password', '')).strip() or employee_id

        if not employee_id:
            return Response({"detail": "Employee ID is required."}, status=status.HTTP_400_BAD_REQUEST)
        if not first_name or not last_name:
            return Response({"detail": "First name and last name are required."}, status=status.HTTP_400_BAD_REQUEST)
        if not office_id:
            return Response({"detail": "Office is required."}, status=status.HTTP_400_BAD_REQUEST)

        # Check unique employee_id in User and CtmsEmployee
        if User.objects.filter(username__iexact=employee_id).exists():
            return Response({"detail": f"A user with username/Employee ID '{employee_id}' already exists."}, status=status.HTTP_400_BAD_REQUEST)
        if CtmsEmployee.objects.filter(employee_id__iexact=employee_id).exists():
            return Response({"detail": f"An employee with Employee ID '{employee_id}' already exists."}, status=status.HTTP_400_BAD_REQUEST)

        office = get_object_or_404(CsmOffice, pk=office_id)

        # Create Django User
        user = User.objects.create(
            username=employee_id,
            first_name=first_name,
            last_name=last_name,
            is_staff=True,
            is_superuser=False,
            is_active=True,
        )
        user.set_password(temporary_password)
        user.save()

        # Create Employee profile
        employee = CtmsEmployee.objects.create(
            user=user,
            employee_id=employee_id,
            first_name=first_name,
            middle_name=middle_name,
            last_name=last_name,
            position=position,
            office=office,
        )

        # Set divisions
        if division_ids:
            id_filters = models.Q(id__in=[x for x in division_ids if isinstance(x, int) or (isinstance(x, str) and x.isdigit())])
            name_filters = models.Q(name__in=[str(x) for x in division_ids])
            normalized_names = []
            for d in division_ids:
                ds = str(d).strip().upper()
                if ds == 'TSSD1':
                    normalized_names.append('TSSD 1')
                elif ds == 'TSSD2':
                    normalized_names.append('TSSD 2')
            if normalized_names:
                name_filters |= models.Q(name__in=normalized_names)

            divs = CsmDivision.objects.filter(id_filters | name_filters)
            employee.divisions.set(divs)

        # Assign CtmsStaffOffice
        CtmsStaffOffice.objects.get_or_create(user=user, office=office)

        serializer = self.get_serializer(employee)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        employee = self.get_object()
        data = request.data

        if 'first_name' in data:
            employee.first_name = str(data['first_name']).strip()
            employee.user.first_name = employee.first_name
        if 'middle_name' in data:
            employee.middle_name = str(data['middle_name']).strip()
        if 'last_name' in data:
            employee.last_name = str(data['last_name']).strip()
            employee.user.last_name = employee.last_name
        if 'position' in data:
            employee.position = str(data['position']).strip()
        if 'office' in data and data['office']:
            office = get_object_or_404(CsmOffice, pk=data['office'])
            employee.office = office
            CtmsStaffOffice.objects.filter(user=employee.user).delete()
            CtmsStaffOffice.objects.create(user=employee.user, office=office)
        if 'is_active' in data:
            employee.user.is_active = bool(data['is_active'])
        if 'temporary_password' in data and data['temporary_password']:
            pwd = str(data['temporary_password']).strip()
            employee.user.set_password(pwd)

        employee.user.save()
        employee.save()

        if 'division_ids' in data:
            division_ids = data.get('division_ids', [])
            id_filters = models.Q(id__in=[x for x in division_ids if isinstance(x, int) or (isinstance(x, str) and x.isdigit())])
            name_filters = models.Q(name__in=[str(x) for x in division_ids])
            normalized_names = []
            for d in division_ids:
                ds = str(d).strip().upper()
                if ds == 'TSSD1':
                    normalized_names.append('TSSD 1')
                elif ds == 'TSSD2':
                    normalized_names.append('TSSD 2')
            if normalized_names:
                name_filters |= models.Q(name__in=normalized_names)

            divs = CsmDivision.objects.filter(id_filters | name_filters)
            employee.divisions.set(divs)

        serializer = self.get_serializer(employee)
        return Response(serializer.data)

    @transaction.atomic
    def destroy(self, request, *args, **kwargs):
        employee = self.get_object()
        user = employee.user
        employee.delete()
        if user:
            user.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'], url_path='reset-password')
    def reset_password(self, request, pk=None):
        employee = self.get_object()
        new_pwd = str(request.data.get('password', '')).strip() or employee.employee_id
        employee.user.set_password(new_pwd)
        employee.user.save()
        employee.must_change_password = True
        employee.save(update_fields=['must_change_password'])
        return Response({
            "status": "success",
            "message": f"Password for {employee.employee_id} ({employee.full_name}) has been reset to '{new_pwd}'. They will be required to change it on their next login."
        })

    @action(detail=True, methods=['post'], url_path='toggle-active')
    def toggle_active(self, request, pk=None):
        employee = self.get_object()
        employee.user.is_active = not employee.user.is_active
        employee.user.save()
        return Response({
            "status": "success",
            "is_active": employee.user.is_active
        })


class StaffChangePasswordView(APIView):
    """
    Allows authenticated staff to change their temporary password.
    Clears must_change_password flag upon successful change.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        user = request.user
        current_password = request.data.get('current_password', '').strip()
        new_password = request.data.get('new_password', '').strip()
        confirm_password = request.data.get('confirm_password', '').strip()

        if not new_password:
            return Response({"detail": "New password cannot be empty."}, status=status.HTTP_400_BAD_REQUEST)

        if len(new_password) < 6:
            return Response({"detail": "Password must be at least 6 characters long."}, status=status.HTTP_400_BAD_REQUEST)

        if confirm_password and new_password != confirm_password:
            return Response({"detail": "New passwords do not match."}, status=status.HTTP_400_BAD_REQUEST)

        # If current_password is provided, verify it
        if current_password:
            if not user.check_password(current_password):
                return Response({"detail": "Current temporary password is incorrect."}, status=status.HTTP_400_BAD_REQUEST)

        # Disallow setting new password to the exact same temporary password / employee_id
        if user.check_password(new_password):
            return Response({"detail": "New password cannot be the same as your current temporary password."}, status=status.HTTP_400_BAD_REQUEST)

        user.set_password(new_password)
        user.save()

        # Clear must_change_password flag on employee profile
        try:
            profile = user.employee_profile
            profile.must_change_password = False
            profile.save(update_fields=['must_change_password'])
        except Exception:
            pass

        return Response({
            "status": "success",
            "message": "Password updated successfully. You can now access the staff portal.",
            "must_change_password": False,
        })


class CsmOfficeListView(APIView):
    """
    Returns list of active DOLE offices for dropdown selection.
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        offices = CsmOffice.objects.filter(is_active=True).order_by('name')
        return Response(CsmOfficeSerializer(offices, many=True).data)


# =====================================================================
# TV Display Local Folder Video Scanner & Streamer
# =====================================================================

class PublicFolderVideosView(APIView):
    """
    Parses a local folder path, HTTP folder URL, or multi-line video list
    and returns a playlist of video URLs for continuous playback on the TV display.
    Uses 0 server storage by streaming directly or referencing external links.
    """
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        folder = request.query_params.get('folder', '').strip()
        if not folder:
            return Response({"status": "error", "message": "Folder link or path is required.", "videos": []})

        video_extensions = ('.mp4', '.webm', '.ogg', '.mov', '.mkv', '.m4v')

        # 1. Multiple URLs separated by newlines, commas, or semicolons
        lines = [line.strip() for line in re.split(r'[\r\n,;]+', folder) if line.strip()]
        if len(lines) > 1:
            videos = []
            for i, line in enumerate(lines):
                name = os.path.basename(line.split('?')[0]) or f"Video {i + 1}"
                videos.append({"id": i, "name": name, "url": line})
            return Response({"status": "success", "videos": videos})

        # 2. Local filesystem directory path
        clean_folder = folder.replace('file:///', '').replace('file://', '')
        if os.path.isdir(clean_folder):
            try:
                entries = os.listdir(clean_folder)
                video_files = [f for f in entries if os.path.isfile(os.path.join(clean_folder, f)) and f.lower().endswith(video_extensions)]
                def natural_sort_key(s):
                    return [int(text) if text.isdigit() else text.lower() for text in re.split(r'(\d+)', s)]
                video_files.sort(key=natural_sort_key)

                videos = []
                for i, filename in enumerate(video_files):
                    file_full_path = os.path.join(clean_folder, filename)
                    stream_url = f"/api/public/stream-video/?file={urllib.parse.quote(file_full_path)}"
                    videos.append({
                        "id": i,
                        "name": filename,
                        "url": stream_url,
                    })
                return Response({"status": "success", "videos": videos})
            except Exception as e:
                return Response({"status": "error", "message": str(e), "videos": []})

        # 3. HTTP / HTTPS directory link (e.g. Apache/Nginx autoindex)
        if folder.startswith('http://') or folder.startswith('https://'):
            if folder.lower().endswith(video_extensions):
                name = os.path.basename(folder.split('?')[0]) or "Video 1"
                return Response({"status": "success", "videos": [{"id": 0, "name": name, "url": folder}]})

            try:
                req = urllib.request.Request(folder, headers={'User-Agent': 'Mozilla/5.0 DOLE-CTMS-Display/1.0'})
                with urllib.request.urlopen(req, timeout=5) as response:
                    content = response.read().decode('utf-8', errors='ignore')
                    found_links = re.findall(r'href=["\']([^"\']+\.(?:mp4|webm|ogg|mov|mkv|m4v))["\']', content, re.IGNORECASE)
                    if found_links:
                        def natural_sort_key(s):
                            return [int(text) if text.isdigit() else text.lower() for text in re.split(r'(\d+)', s)]
                        found_links.sort(key=natural_sort_key)

                        videos = []
                        seen = set()
                        for href in found_links:
                            full_url = urllib.parse.urljoin(folder, href)
                            if full_url not in seen:
                                seen.add(full_url)
                                name = os.path.basename(href.split('?')[0]) or f"Video {len(videos) + 1}"
                                videos.append({"id": len(videos), "name": name, "url": full_url})
                        if videos:
                            return Response({"status": "success", "videos": videos})
            except Exception:
                pass

        # Fallback: single video item
        name = os.path.basename(folder.split('?')[0]) or "ARTA Video"
        return Response({"status": "success", "videos": [{"id": 0, "name": name, "url": folder}]})


class PublicStreamLocalVideoView(APIView):
    """
    Streams a local video file with HTTP 206 Partial Content / Range support for smooth seeking.
    """
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        file_param = request.query_params.get('file', '').strip()
        if not file_param:
            raise Http404("Video file parameter required.")

        file_path = urllib.parse.unquote(file_param)
        if not os.path.isfile(file_path):
            raise Http404("Video file not found.")

        ext = os.path.splitext(file_path)[1].lower()
        if ext not in ('.mp4', '.webm', '.ogg', '.mov', '.mkv', '.m4v'):
            raise Http404("Unsupported video format.")

        content_type, _ = mimetypes.guess_type(file_path)
        if not content_type:
            content_type = 'video/mp4'

        response = FileResponse(open(file_path, 'rb'), content_type=content_type)
        response['Accept-Ranges'] = 'bytes'
        return response


class CsmDivisionListView(APIView):
    """
    Returns list of all active divisions from the csm_division table.
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        divisions = CsmDivision.objects.all().order_by('id')
        return Response(CsmDivisionSerializer(divisions, many=True).data)


class StaffPersonnelListView(APIView):
    """
    Returns active personnel for staff assignment, optionally filtered by office and/or division.
    Accessible by all authenticated staff users.
    """
    permission_classes = [IsStaffUser]

    def get(self, request):
        qs = CtmsEmployee.objects.filter(user__is_active=True).select_related('office', 'user').prefetch_related('divisions').order_by('last_name', 'first_name')
        office_id = request.query_params.get('office')
        if office_id:
            qs = qs.filter(office_id=office_id)

        division_param = request.query_params.get('division')
        if division_param:
            div_clean = division_param.strip()
            names = [div_clean]
            if div_clean.upper() in ('TSSD1', 'TSSD 1'):
                names = ['TSSD 1', 'TSSD1']
            elif div_clean.upper() in ('TSSD2', 'TSSD 2'):
                names = ['TSSD 2', 'TSSD2']
            elif div_clean.upper() == 'IMSD':
                names = ['IMSD']
            elif div_clean.upper() == 'MALSU':
                names = ['MALSU']

            qs = qs.filter(models.Q(divisions__name__in=names) | models.Q(divisions__id__in=[div_clean] if div_clean.isdigit() else []))

        data = []
        for emp in qs.distinct():
            div_names = [d.name for d in emp.divisions.all()]
            data.append({
                "id": emp.id,
                "employee_id": emp.employee_id,
                "first_name": emp.first_name,
                "middle_name": emp.middle_name,
                "last_name": emp.last_name,
                "full_name": emp.full_name,
                "position": emp.position,
                "office_id": emp.office_id,
                "office_name": emp.office.name,
                "division_ids": [d.id for d in emp.divisions.all()],
                "division_names": div_names,
            })
        return Response(data)


