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
from django.db import models, transaction, IntegrityError
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
    CtmsStaffDivision,
    CtmsEmployee,
    DolePersonnel,
    CtmsDisplayConfig,
    CtmsTransaction,
    CtmsAuditLog,
    CtmsNotification,
    log_audit_event,
)
from .serializers import (
    CsmDivisionSerializer,
    CsmOfficeSerializer,
    CsmServiceSerializer,
    StaffServiceSerializer,
    CtmsCounterSerializer,
    CtmsStaffOfficeSerializer,
    CtmsEmployeeSerializer,
    DolePersonnelSerializer,
    CtmsUserAccountSerializer,
    CtmsNotificationSerializer,
    CheckinRequestSerializer,
    TicketPublicSerializer,
    StaffTransactionSerializer,
    StaffTokenObtainPairSerializer,
    CtmsAuditLogSerializer,
)
from .throttling import CheckinThrottle, LoginThrottle
from . import services


# =====================================================================
# Auth Views & Permission Helpers
# =====================================================================

class StaffLoginView(TokenObtainPairView):
    serializer_class = StaffTokenObtainPairSerializer
    throttle_classes = [LoginThrottle]

    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)
        if response.status_code == 200:
            username = request.data.get('username')
            user_obj = User.objects.filter(username=username).first()
            log_audit_event(
                action='LOGIN',
                category=CtmsAuditLog.CATEGORY_AUTH,
                actor=user_obj,
                request=request,
                target_type='User',
                target_id=user_obj.id if user_obj else '',
                target_repr=f"User '{username}'",
                description=f"User '{username}' successfully logged in."
            )
        return response


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

        linked_personnel_data = None
        try:
            if hasattr(user, 'dole_personnel') and user.dole_personnel:
                p = user.dole_personnel
                linked_personnel_data = {
                    "id": p.id,
                    "employee_id": p.employee_id,
                    "full_name": p.full_name,
                    "first_name": p.first_name,
                    "last_name": p.last_name,
                    "position": p.position,
                    "office_id": p.office_id,
                    "office_name": p.office.name if p.office else "",
                    "division_names": [d.name for d in p.divisions.all()],
                }
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
            "linked_personnel": linked_personnel_data,
        })


def get_staff_offices(user):
    """Returns queryset of CsmOffices the staff user has access to."""
    if not user or not user.is_authenticated or not user.is_staff:
        return CsmOffice.objects.none()
    assigned_ids = CtmsStaffOffice.objects.filter(user=user).values_list('office_id', flat=True)
    if assigned_ids.exists():
        return CsmOffice.objects.filter(id__in=assigned_ids, is_active=True)
    if user.is_superuser:
        return CsmOffice.objects.filter(is_active=True)
    # Strict RBAC: Staff without an explicit office assignment have access to NONE
    return CsmOffice.objects.none()


def get_staff_divisions(user):
    """
    Returns queryset of CsmDivision the staff user is allowed to access.
    Superusers have access to all divisions unless assigned specific divisions.
    Staff members with assigned divisions have access to their assigned divisions.
    """
    if not user or not user.is_authenticated or not user.is_staff:
        return CsmDivision.objects.none()
    div_ids = CtmsStaffDivision.objects.filter(user=user).values_list('division_id', flat=True)
    if div_ids.exists():
        return CsmDivision.objects.filter(id__in=div_ids).exclude(name__iexact='ALL').order_by('id')
    if user.is_superuser:
        return CsmDivision.objects.exclude(name__iexact='ALL').order_by('id')
    try:
        dole_p = getattr(user, 'dole_personnel', None)
        if dole_p and dole_p.divisions.exists():
            return dole_p.divisions.exclude(name__iexact='ALL').order_by('id')
        profile = getattr(user, 'employee_profile', None)
        if profile and profile.divisions.exists():
            return profile.divisions.exclude(name__iexact='ALL').order_by('id')
    except Exception:
        pass
    return CsmDivision.objects.exclude(name__iexact='ALL').order_by('id')


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
                group_member_names=data.get('group_member_names'),
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

        # Check if caller has an authenticated staff account with division restrictions or query param
        user = request.user if (request.user and request.user.is_authenticated) else None
        user_divisions = []
        restrict_to_divisions = False

        if user and user.is_staff and not user.is_superuser:
            has_explicit_divs = CtmsStaffDivision.objects.filter(user=user).exists()
            if not has_explicit_divs:
                try:
                    profile = getattr(user, 'employee_profile', None)
                    has_explicit_divs = bool(profile and profile.divisions.exists())
                except Exception:
                    has_explicit_divs = False

            if has_explicit_divs:
                allowed_divs = get_staff_divisions(user).exclude(name__iexact='ALL')
                user_divisions = list(allowed_divs.values_list('name', flat=True))
                all_ops_count = CsmDivision.objects.exclude(name__iexact='ALL').count()
                if allowed_divs.count() < all_ops_count:
                    restrict_to_divisions = bool(user_divisions)
                else:
                    restrict_to_divisions = False

        divisions_param = request.query_params.get('divisions') or request.query_params.get('division')
        if divisions_param:
            req_div_names = [d.strip() for d in divisions_param.split(',') if d.strip() and d.strip().upper() != 'ALL']
            if req_div_names:
                user_divisions = req_div_names
                restrict_to_divisions = True

        allowed_div_norms = {
            re.sub(r'[\s\-_]+', '', n.upper())
            for n in user_divisions if n
        }

        # Currently serving transactions at this office (including multi-day pending tickets resumed today)
        serving_qs = CtmsTransaction.objects.filter(
            office=office,
            status=CtmsTransaction.STATUS_SERVING,
        ).filter(
            models.Q(queue_date=today) | models.Q(called_at__date=today)
        ).select_related('counter', 'service', 'service__division').order_by('-called_at')

        serving_data = []
        filtered_serving_objs = []
        for s in serving_qs:
            service_name = s.service.name if s.service else ""
            div = s.service.division if (s.service and s.service.division) else None
            div_name = div.name if div else ""
            counter_name = s.counter.name if s.counter else "Counter"

            if restrict_to_divisions:
                tx_div_norm = re.sub(r'[\s\-_]+', '', (div_name or counter_name).upper())
                if tx_div_norm not in allowed_div_norms:
                    continue

            filtered_serving_objs.append(s)
            serving_data.append({
                "id": s.id,
                "counter": counter_name,
                "queue_no": s.queue_no,
                "called_at": s.called_at.isoformat() if s.called_at else None,
                "service_name": service_name,
                "service_description": get_service_description(service_name),
                "assigned_personnel": s.assigned_personnel or "",
                "is_priority": s.is_priority,
                "division_name": div_name or (counter_name if counter_name != "Counter" else ""),
                "division_id": div.id if div else None,
            })

        # Next waiting queue numbers (priority first, then FIFO) - numbers only, never names!
        next_waiting_qs = CtmsTransaction.objects.filter(
            office=office,
            status=CtmsTransaction.STATUS_WAITING,
            queue_date=today
        ).select_related('service', 'service__division').order_by('-is_priority', 'checked_in_at')[:50]

        next_details = []
        for tx in next_waiting_qs:
            div = tx.service.division if (tx.service and tx.service.division) else None
            div_name = div.name if div else ""

            if restrict_to_divisions:
                tx_div_norm = re.sub(r'[\s\-_]+', '', div_name.upper())
                if tx_div_norm not in allowed_div_norms:
                    continue

            next_details.append({
                "queue_no": tx.queue_no,
                "is_priority": tx.is_priority,
                "division_name": div_name,
                "division_id": div.id if div else None,
                "service_name": tx.service.name if tx.service else "",
            })

        next_details = next_details[:25]
        next_queue_numbers = [item["queue_no"] for item in next_details[:10]]

        first_serving = filtered_serving_objs[0] if filtered_serving_objs else None
        latest_called_at = first_serving.called_at.isoformat() if first_serving and first_serving.called_at else None


        # ARTA video is linked locally by staff on each TV display — not served from the server
        arta_video_url = ""

        all_divisions = list(CsmDivision.objects.exclude(name__iexact='ALL').values_list('name', flat=True).order_by('id'))

        return Response({
            "office": CsmOfficeSerializer(office).data,
            "serving": serving_data,
            "next": next_queue_numbers,
            "next_details": next_details,
            "user_divisions": user_divisions,
            "all_divisions": all_divisions,
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
        allowed_div_norms = {n.strip().upper().replace(' ', '') for n in allowed_div_names if n}

        # Retrieve divisions directly from csm_division table
        all_divisions = CsmDivision.objects.all().order_by('id')
        all_division_names = [d.name for d in all_divisions if d.name.strip().upper() != 'ALL']

        if all_division_names:
            # Ensure an active counter exists for each operational division in csm_division
            for div_name in all_division_names:
                cnt, created = CtmsCounter.objects.get_or_create(
                    office=office,
                    name=div_name,
                    defaults={'is_active': True}
                )
                if not created and not cnt.is_active:
                    cnt.is_active = True
                    cnt.save(update_fields=['is_active'])

            # Deactivate obsolete counters that do not match active divisions (e.g. Window 1, Window 2, ALL)
            CtmsCounter.objects.filter(office=office).exclude(name__in=all_division_names).update(is_active=False)

        counters_qs = CtmsCounter.objects.filter(office=office, is_active=True).order_by('id')

        # If regular staff (non-superuser), restrict counters and divisions to only assigned divisions
        if not request.user.is_superuser:
            allowed_counter_ids = [
                c.id for c in counters_qs
                if c.name.strip().upper().replace(' ', '') in allowed_div_norms
            ]
            counters_qs = counters_qs.filter(id__in=allowed_counter_ids)
            divisions_data = allowed_divisions
        else:
            divisions_data = all_divisions.exclude(name__iexact='ALL')

        # Waiting list: priority first, then FIFO
        waiting_qs = CtmsTransaction.objects.filter(
            office=office,
            status=CtmsTransaction.STATUS_WAITING,
            queue_date=today
        ).select_related('office', 'service', 'service__division')

        # Serving list: all serving in this office or counter (including pending tickets from previous days resumed today)
        serving_qs = CtmsTransaction.objects.filter(
            office=office,
            status=CtmsTransaction.STATUS_SERVING,
        ).filter(
            models.Q(queue_date=today) | models.Q(called_at__date=today)
        ).select_related('office', 'service', 'service__division', 'counter', 'served_by').order_by('-called_at')

        # Pending list: multi-day or hold services that cannot be finished in one day (persists across dates)
        pending_qs = CtmsTransaction.objects.filter(
            office=office,
            status=CtmsTransaction.STATUS_PENDING
        ).select_related('office', 'service', 'service__division', 'counter', 'served_by')

        # If not superuser, restrict waiting, serving, and pending queues to the user's assigned divisions
        if not request.user.is_superuser:
            waiting_qs = waiting_qs.filter(service__division__in=allowed_divisions)
            serving_qs = serving_qs.filter(service__division__in=allowed_divisions)
            pending_qs = pending_qs.filter(service__division__in=allowed_divisions)

        if counter_id:
            counter = CtmsCounter.objects.filter(pk=counter_id, office=office, is_active=True).first()
            if counter and not request.user.is_superuser:
                if counter.name.strip().upper().replace(' ', '') not in allowed_div_norms:
                    # Stale counter_id from a previous user session in localStorage: fallback to first allowed counter
                    counter = counters_qs.first()
            if counter:
                serving_qs = serving_qs.filter(counter=counter)
                division = CsmDivision.objects.filter(name__iexact=counter.name.strip()).first()
                if division:
                    waiting_qs = waiting_qs.filter(service__division=division)
                    pending_qs = pending_qs.filter(
                        models.Q(service__division=division) | models.Q(counter=counter)
                    )
                else:
                    pending_qs = pending_qs.filter(counter=counter)

        waiting_qs = waiting_qs.order_by('-is_priority', 'checked_in_at')
        pending_qs = pending_qs.order_by('-is_priority', '-called_at', 'checked_in_at')

        total_division_waiting = waiting_qs.count()

        # Check if user is linked to a DolePersonnel record
        linked_personnel = getattr(request.user, 'dole_personnel', None)
        p_name = linked_personnel.full_name.strip() if linked_personnel else None
        p_id = linked_personnel.employee_id.strip() if linked_personnel else None

        # Filter mode: personnel users default to only their assigned clients
        # Supports query param assigned_to_me: '1'/'true' (force only my clients), '0'/'false' (view all in division)
        assigned_to_me_param = request.query_params.get('assigned_to_me')
        filter_my_assigned_only = False
        if linked_personnel and not request.user.is_superuser:
            filter_my_assigned_only = (assigned_to_me_param != '0' and str(assigned_to_me_param).lower() != 'false')
        elif assigned_to_me_param in ('1', 'true'):
            filter_my_assigned_only = True

        if filter_my_assigned_only and (p_name or p_id):
            personnel_q = models.Q()
            if p_name:
                personnel_q |= models.Q(assigned_personnel__iexact=p_name)
            if p_id:
                personnel_q |= models.Q(assigned_personnel__iexact=p_id)
            waiting_qs = waiting_qs.filter(personnel_q)
            serving_qs = serving_qs.filter(personnel_q | models.Q(served_by=request.user))
            pending_qs = pending_qs.filter(personnel_q | models.Q(served_by=request.user))

        # Retrieve all currently active assignments in this office across all counters
        active_assignments = list(
            CtmsTransaction.objects.filter(
                office=office,
                status__in=[
                    CtmsTransaction.STATUS_WAITING,
                    CtmsTransaction.STATUS_SERVING,
                    CtmsTransaction.STATUS_PENDING,
                ],
            )
            .exclude(assigned_personnel__isnull=True)
            .exclude(assigned_personnel='')
            .values('id', 'queue_no', 'transaction_no', 'status', 'assigned_personnel')
        )

        return Response({
            "office": CsmOfficeSerializer(office).data,
            "waiting": StaffTransactionSerializer(waiting_qs, many=True).data,
            "serving": StaffTransactionSerializer(serving_qs, many=True).data,
            "pending": StaffTransactionSerializer(pending_qs, many=True).data,
            "active_assignments": active_assignments,
            "counters": CtmsCounterSerializer(counters_qs, many=True).data,
            "divisions": CsmDivisionSerializer(divisions_data, many=True).data,
            "is_personnel_filtered": filter_my_assigned_only,
            "linked_personnel": linked_personnel.full_name if linked_personnel else None,
            "total_division_waiting": total_division_waiting,
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

    # Look up in DolePersonnel by employee_id first
    personnel = DolePersonnel.objects.filter(employee_id__iexact=clean_str).first()

    # If not found by ID, look up by full name or parts in DolePersonnel
    if not personnel:
        for candidate in DolePersonnel.objects.all().prefetch_related('divisions'):
            c_full = candidate.full_name.strip().lower()
            c_simple = f"{candidate.first_name} {candidate.last_name}".strip().lower()
            if clean_str.lower() in (c_full, c_simple) or c_full in clean_str.lower():
                personnel = candidate
                break

    # Fallback to CtmsEmployee if any
    if not personnel:
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
        personnel = emp

    if personnel:
        p_divs = [d.name.strip().upper().replace(' ', '') for d in personnel.divisions.all()]
        if p_divs and svc_div not in p_divs and 'ALL' not in p_divs:
            div_names = ', '.join([d.name for d in personnel.divisions.all()])
            return False, f"Cannot assign {personnel.full_name}: Personnel is assigned to division {div_names} and cannot be assigned to {tx.service.name} ({tx.service.division.name})."

    return True, None


def validate_personnel_availability(office, personnel_name_or_id, current_tx_id=None, check_serving_only=False):
    """
    Validates that an officer is not currently assigned to another active client.
    When check_serving_only=True (used during calling or recalling tickets):
      Only checks if the officer is currently SERVING another transaction at a counter.
      An officer can have multiple clients waiting in line for them.
    When check_serving_only=False (used during manual waiting queue reassignment):
      Checks if the officer has active waiting/serving transactions so other available
      officers in the division can be prioritized.
    """
    if not personnel_name_or_id or not str(personnel_name_or_id).strip():
        return True, None, None

    clean_str = str(personnel_name_or_id).strip().lower()

    if check_serving_only:
        statuses_to_check = [CtmsTransaction.STATUS_SERVING]
    else:
        statuses_to_check = [
            CtmsTransaction.STATUS_WAITING,
            CtmsTransaction.STATUS_SERVING,
            CtmsTransaction.STATUS_PENDING,
        ]

    # Active transactions in the office
    active_qs = CtmsTransaction.objects.filter(
        office=office,
        status__in=statuses_to_check,
    ).exclude(assigned_personnel__isnull=True).exclude(assigned_personnel='')

    if current_tx_id:
        active_qs = active_qs.exclude(pk=current_tx_id)

    # Collect known aliases for personnel
    candidate_names = {clean_str}
    personnel = DolePersonnel.objects.filter(
        models.Q(employee_id__iexact=clean_str) | models.Q(first_name__iexact=clean_str)
    ).first()
    if personnel:
        candidate_names.add(personnel.full_name.strip().lower())
        if personnel.employee_id:
            candidate_names.add(personnel.employee_id.strip().lower())

    for active_tx in active_qs:
        assigned_clean = (active_tx.assigned_personnel or '').strip().lower()
        if assigned_clean in candidate_names:
            status_text = active_tx.get_status_display()
            if check_serving_only:
                return False, f"Officer '{active_tx.assigned_personnel}' is currently serving Queue #{active_tx.queue_no} and cannot call another client until their current transaction is completed.", active_tx
            else:
                return False, f"Officer '{active_tx.assigned_personnel}' is currently assigned to Queue #{active_tx.queue_no} ({status_text}) and cannot be assigned to another client until their current transaction is completed.", active_tx

    return True, None, None


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
                group_member_names=data.get('group_member_names'),
            )
            log_audit_event(
                action='CREATE_WALKIN',
                category=CtmsAuditLog.CATEGORY_QUEUE,
                actor=request.user,
                request=request,
                target_type='Transaction',
                target_id=tx.id,
                target_repr=f"Queue #{tx.queue_no} ({tx.transaction_no})",
                office=tx.office,
                division_name=tx.service.division.name if tx.service and tx.service.division else '',
                description=f"Created walk-in ticket Queue #{tx.queue_no} for {tx.service.name if tx.service else 'Service'}",
                details={
                    'queue_no': tx.queue_no,
                    'transaction_no': tx.transaction_no,
                    'client_name': tx.client_name,
                    'group_member_names': tx.group_member_names,
                    'is_priority': tx.is_priority,
                    'service': tx.service.name if tx.service else ''
                }
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
            counter = None

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

        if personnel and str(personnel).strip():
            avail, avail_err, _ = validate_personnel_availability(office, str(personnel).strip(), check_serving_only=True)
            if not avail:
                return Response({"detail": avail_err}, status=status.HTTP_400_BAD_REQUEST)

        try:
            tx = services.call_next_transaction(office=office, counter=counter, personnel=personnel)
            if not tx:
                return Response({"detail": "No waiting clients in the queue."}, status=status.HTTP_204_NO_CONTENT)

            log_audit_event(
                action='CALL_NEXT',
                category=CtmsAuditLog.CATEGORY_QUEUE,
                actor=request.user,
                request=request,
                target_type='Transaction',
                target_id=tx.id,
                target_repr=f"Queue #{tx.queue_no} ({tx.transaction_no})",
                office=tx.office,
                division_name=tx.service.division.name if tx.service and tx.service.division else '',
                description=f"Called next client Queue #{tx.queue_no} to {tx.counter.name if tx.counter else 'counter'} (Officer: {tx.assigned_personnel})",
                details={
                    'queue_no': tx.queue_no,
                    'transaction_no': tx.transaction_no,
                    'counter': tx.counter.name if tx.counter else '',
                    'assigned_personnel': tx.assigned_personnel,
                    'service': tx.service.name if tx.service else '',
                }
            )

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

                avail, avail_err, _ = validate_personnel_availability(tx.office, clean_personnel, current_tx_id=tx.pk)
                if not avail:
                    return Response({"detail": avail_err}, status=status.HTTP_400_BAD_REQUEST)

                old_personnel = tx.assigned_personnel
                tx = services.assign_personnel_to_transaction(tx, clean_personnel)

                log_audit_event(
                    action='REASSIGN_PERSONNEL' if old_personnel else 'ASSIGN_PERSONNEL',
                    category=CtmsAuditLog.CATEGORY_QUEUE,
                    actor=request.user,
                    request=request,
                    target_type='Transaction',
                    target_id=tx.id,
                    target_repr=f"Queue #{tx.queue_no} ({tx.transaction_no})",
                    office=tx.office,
                    division_name=tx.service.division.name if tx.service and tx.service.division else '',
                    description=(
                        f"Reassigned Queue #{tx.queue_no} to '{clean_personnel}' (previously: '{old_personnel}')"
                        if old_personnel
                        else f"Assigned Queue #{tx.queue_no} to '{clean_personnel}'"
                    )
                )

            elif action == 'call':
                counter_id = request.data.get('counter')
                personnel = request.data.get('personnel') or request.data.get('assigned_personnel')
                if personnel and str(personnel).strip():
                    valid, err_msg = validate_personnel_division_assignment(tx, str(personnel).strip())
                    if not valid:
                        return Response({"detail": err_msg}, status=status.HTTP_400_BAD_REQUEST)
                    avail, avail_err, _ = validate_personnel_availability(tx.office, str(personnel).strip(), current_tx_id=tx.pk, check_serving_only=True)
                    if not avail:
                        return Response({"detail": avail_err}, status=status.HTTP_400_BAD_REQUEST)
                counter = None
                if counter_id:
                    counter = CtmsCounter.objects.filter(pk=counter_id, office=tx.office, is_active=True).first()
                tx = services.call_specific_transaction(tx, counter, personnel=personnel)

            elif action == 'recall':
                if not tx.counter:
                    return Response({"detail": "Transaction is not assigned to a counter."}, status=status.HTTP_400_BAD_REQUEST)
                personnel = request.data.get('personnel') or request.data.get('assigned_personnel')
                if personnel and str(personnel).strip():
                    valid, err_msg = validate_personnel_division_assignment(tx, str(personnel).strip())
                    if not valid:
                        return Response({"detail": err_msg}, status=status.HTTP_400_BAD_REQUEST)
                    avail, avail_err, _ = validate_personnel_availability(tx.office, str(personnel).strip(), current_tx_id=tx.pk, check_serving_only=True)
                    if not avail:
                        return Response({"detail": avail_err}, status=status.HTTP_400_BAD_REQUEST)
                tx = services.call_specific_transaction(tx, tx.counter, personnel=personnel)

            elif action == 'done':
                tx = services.mark_done(tx, request.user)

            elif action == 'undo-done':
                tx = services.undo_done(tx)

            elif action == 'no-show':
                tx = services.mark_no_show(tx)

            elif action == 'cancel':
                tx = services.cancel_transaction(tx)

            elif action == 'delete':
                q_no = tx.queue_no
                t_no = tx.transaction_no
                s_name = tx.service.name if tx.service else ''
                t_office = tx.office
                t_div = tx.service.division.name if tx.service and tx.service.division else ''
                tx_id = tx.id

                log_audit_event(
                    action='DELETE_TICKET',
                    category=CtmsAuditLog.CATEGORY_QUEUE,
                    actor=request.user,
                    request=request,
                    target_type='Transaction',
                    target_id=tx_id,
                    target_repr=f"Queue #{q_no} ({t_no})",
                    office=t_office,
                    division_name=t_div,
                    description=f"Deleted Queue #{q_no} ({t_no}) from waiting line",
                    details={
                        'queue_no': q_no,
                        'transaction_no': t_no,
                        'service': s_name,
                    }
                )
                tx.delete()
                return Response({
                    "detail": f"Queue #{q_no} deleted successfully.",
                    "deleted": True,
                    "id": tx_id,
                    "queue_no": q_no,
                })

            elif action == 'pending':
                tx = services.mark_pending(tx)

            elif action == 'requeue':
                tx = services.requeue_transaction(tx)

            elif action == 'notify':
                if not tx.assigned_personnel or not str(tx.assigned_personnel).strip():
                    return Response({
                        "detail": f"Cannot notify: No officer is currently assigned to Queue #{tx.queue_no}."
                    }, status=status.HTTP_400_BAD_REQUEST)

                success, msg = services.notify_assigned_personnel(
                    tx,
                    is_reassignment=False,
                    previous_officer=None,
                    is_manual_reminder=True,
                    caller_user=request.user
                )

                if not success:
                    return Response({"detail": msg}, status=status.HTTP_400_BAD_REQUEST)

                log_audit_event(
                    action='NOTIFY_PERSONNEL',
                    category=CtmsAuditLog.CATEGORY_QUEUE,
                    actor=request.user,
                    request=request,
                    target_type='Transaction',
                    target_id=tx.id,
                    target_repr=f"Queue #{tx.queue_no} ({tx.transaction_no})",
                    office=tx.office,
                    division_name=tx.service.division.name if tx.service and tx.service.division else '',
                    description=f"Sent notification reminder to assigned officer '{tx.assigned_personnel}' for Queue #{tx.queue_no}",
                    details={
                        'queue_no': tx.queue_no,
                        'transaction_no': tx.transaction_no,
                        'assigned_personnel': tx.assigned_personnel,
                        'service': tx.service.name if tx.service else '',
                    }
                )

                return Response({
                    "detail": msg or f"Notification sent to {tx.assigned_personnel} successfully.",
                    "notified": True,
                    "queue_no": tx.queue_no,
                    "officer": tx.assigned_personnel,
                })

            else:
                return Response({"detail": f"Unknown action: {action}"}, status=status.HTTP_400_BAD_REQUEST)

            # Record audit log for queue actions
            action_map = {
                'assign': ('ASSIGN_OFFICER', f"Assigned officer '{tx.assigned_personnel}' to Queue #{tx.queue_no}"),
                'call': ('CALL_CLIENT', f"Called Queue #{tx.queue_no} to {tx.counter.name if tx.counter else 'counter'} (Officer: {tx.assigned_personnel})"),
                'recall': ('RECALL_CLIENT', f"Recalled Queue #{tx.queue_no} to {tx.counter.name if tx.counter else 'counter'}"),
                'done': ('COMPLETE_SERVICE', f"Marked Queue #{tx.queue_no} as Done / Completed (Survey unlocked)"),
                'undo-done': ('UNDO_DONE', f"Reopened / undone completed status for Queue #{tx.queue_no}"),
                'no-show': ('MARK_NO_SHOW', f"Marked Queue #{tx.queue_no} as No-Show"),
                'cancel': ('CANCEL_TICKET', f"Cancelled Queue #{tx.queue_no}"),
                'pending': ('HOLD_PENDING', f"Placed Queue #{tx.queue_no} on Pending line (multi-day service)"),
                'requeue': ('REQUEUE_TICKET', f"Returned Queue #{tx.queue_no} back to waiting line"),
            }
            if action in action_map:
                act_code, act_desc = action_map[action]
                log_audit_event(
                    action=act_code,
                    category=CtmsAuditLog.CATEGORY_QUEUE,
                    actor=request.user,
                    request=request,
                    target_type='Transaction',
                    target_id=tx.id,
                    target_repr=f"Queue #{tx.queue_no} ({tx.transaction_no})",
                    office=tx.office,
                    division_name=tx.service.division.name if tx.service and tx.service.division else '',
                    description=act_desc,
                    details={
                        'queue_no': tx.queue_no,
                        'transaction_no': tx.transaction_no,
                        'service': tx.service.name if tx.service else '',
                        'counter': tx.counter.name if tx.counter else '',
                        'assigned_personnel': tx.assigned_personnel,
                        'status': tx.status,
                    }
                )

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
                models.Q(group_member_names__icontains=q) |
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

        # Avg service time (done_at - (started_at or called_at) in minutes)
        done_txs = qs.filter(status=CtmsTransaction.STATUS_DONE, done_at__isnull=False)
        service_times = [
            (t.done_at - (t.started_at or t.called_at)).total_seconds() / 60.0
            for t in done_txs
            if t.done_at and (t.started_at or t.called_at)
        ]
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


class PublicDisplayVideoUploadView(APIView):
    permission_classes = [permissions.AllowAny]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, office_id):
        office = get_object_or_404(CsmOffice, pk=office_id)
        if 'video_file' not in request.FILES:
            return Response({"detail": "No video file provided."}, status=status.HTTP_400_BAD_REQUEST)

        file = request.FILES['video_file']
        config, _ = CtmsDisplayConfig.objects.get_or_create(office=office)
        if config.video_file:
            try:
                config.video_file.delete(save=False)
            except Exception:
                pass
        config.video_file = file
        config.arta_video_url = ''
        config.is_active = True
        config.save()

        video_url = config.video_file.url
        file_name = config.video_file.name.split('/')[-1]

        return Response({
            "status": "success",
            "office_id": office.id,
            "office_name": office.name,
            "arta_video_url": video_url,
            "video_file_name": file_name,
            "is_active": True,
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


class StaffUserAccountViewSet(viewsets.ModelViewSet):
    """
    CRUD ViewSet for managing user login accounts (User model).
    Accessible only by superuser administrators.
    """
    serializer_class = CtmsUserAccountSerializer
    permission_classes = [IsAdminUserOnly]
    queryset = User.objects.all().prefetch_related('staff_offices__office', 'staff_divisions__division').order_by('-is_superuser', 'username')

    def get_queryset(self):
        qs = User.objects.all().prefetch_related('staff_offices__office', 'staff_divisions__division').order_by('-is_superuser', 'username')
        office_id = self.request.query_params.get('office')
        if office_id:
            qs = qs.filter(models.Q(staff_offices__office_id=office_id) | models.Q(is_superuser=True))
        search = self.request.query_params.get('search')
        if search:
            qs = qs.filter(
                models.Q(username__icontains=search) |
                models.Q(first_name__icontains=search) |
                models.Q(last_name__icontains=search)
            )
        division_param = self.request.query_params.get('division')
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
            qs = qs.filter(models.Q(staff_divisions__division__name__in=names) | models.Q(staff_divisions__division__id__in=[div_clean] if div_clean.isdigit() else []) | models.Q(is_superuser=True))
        return qs.distinct()

    def get_object(self):
        lookup_url_kwarg = self.lookup_url_kwarg or self.lookup_field
        val = self.kwargs.get(lookup_url_kwarg)
        user = None

        # If request payload specifies username, match by username directly
        if hasattr(self, 'request') and self.request and hasattr(self.request, 'data'):
            target_username = self.request.data.get('username')
            if target_username:
                user = User.objects.filter(username__iexact=str(target_username).strip()).first()

        if not user and str(val).isdigit():
            # Prioritize User primary key first - /staff/users/{id}/ uses User.id
            user = User.objects.filter(pk=val).first()
            # Fallback for legacy employee id lookup only if no User with this PK exists
            if not user:
                emp = CtmsEmployee.objects.filter(pk=val).first()
                if emp and emp.user:
                    user = emp.user

        if not user:
            user = User.objects.filter(username__iexact=str(val)).first()

        if not user:
            raise Http404(f"No user found matching '{val}'.")
        self.check_object_permissions(self.request, user)
        return user

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        data = request.data
        username = str(data.get('username', '') or data.get('employee_id', '')).strip()
        password = str(data.get('password', '') or data.get('temporary_password', '')).strip() or username
        first_name = str(data.get('first_name', '')).strip()
        middle_name = str(data.get('middle_name', '')).strip()
        last_name = str(data.get('last_name', '')).strip()
        position = str(data.get('position', '')).strip()
        role = str(data.get('role', 'staff')).strip().lower()
        office_id = data.get('office')
        office_ids = data.get('office_ids', [])
        all_offices = bool(data.get('all_offices', False))
        division_ids = data.get('division_ids', [])
        all_divisions = bool(data.get('all_divisions', False))

        if not username:
            return Response({"detail": "Username is required."}, status=status.HTTP_400_BAD_REQUEST)
        if not password:
            return Response({"detail": "Password is required."}, status=status.HTTP_400_BAD_REQUEST)

        if User.objects.filter(username__iexact=username).exists():
            return Response({"detail": f"A user with username '{username}' already exists."}, status=status.HTTP_400_BAD_REQUEST)

        # Check if an existing employee record with this employee_id is already assigned to a different user
        existing_emp = CtmsEmployee.objects.filter(employee_id__iexact=username).first()
        if existing_emp and existing_emp.user is not None:
            return Response(
                {"detail": f"An employee profile with ID '{username}' is already linked to user '{existing_emp.user.username}'."},
                status=status.HTTP_400_BAD_REQUEST
            )

        is_superuser = (role in ('admin', 'administrator', 'true', '1'))
        try:
            user = User.objects.create_user(
                username=username,
                password=password,
                first_name=first_name,
                last_name=last_name,
                is_staff=True,
                is_superuser=is_superuser,
                is_active=True,
            )

            # Resolve Office assignments
            target_offices = CsmOffice.objects.none()
            if is_superuser:
                if all_offices or office_ids == 'all' or (not office_ids and not office_id):
                    target_offices = CsmOffice.objects.filter(is_active=True)
                elif office_ids:
                    if isinstance(office_ids, (list, tuple)):
                        target_offices = CsmOffice.objects.filter(id__in=office_ids, is_active=True)
                    elif str(office_ids).isdigit():
                        target_offices = CsmOffice.objects.filter(id=office_ids, is_active=True)
                elif office_id:
                    target_offices = CsmOffice.objects.filter(id=office_id, is_active=True)
            else:
                if office_ids and isinstance(office_ids, (list, tuple)) and len(office_ids) > 0:
                    target_offices = CsmOffice.objects.filter(id__in=office_ids, is_active=True)
                elif office_id:
                    target_offices = CsmOffice.objects.filter(id=office_id, is_active=True)
                elif CsmOffice.objects.exists():
                    target_offices = CsmOffice.objects.filter(id=CsmOffice.objects.first().id)

            for off in target_offices:
                CtmsStaffOffice.objects.get_or_create(user=user, office=off)

            primary_office = target_offices.first() or CsmOffice.objects.filter(is_active=True).first()

            # Create or link CtmsEmployee for backwards compatibility with legacy tests
            if existing_emp:
                emp = existing_emp
                emp.user = user
                emp.employee_id = username
                if first_name:
                    emp.first_name = first_name
                if middle_name:
                    emp.middle_name = middle_name
                if last_name:
                    emp.last_name = last_name
                if position:
                    emp.position = position
                if primary_office:
                    emp.office = primary_office
                elif not emp.office_id:
                    emp.office = CsmOffice.objects.first()
                emp.is_active = True
                emp.must_change_password = True
                emp.save()
            else:
                emp = CtmsEmployee.objects.create(
                    user=user,
                    employee_id=username,
                    first_name=first_name,
                    middle_name=middle_name,
                    last_name=last_name,
                    position=position,
                    office=primary_office or CsmOffice.objects.first(),
                    is_active=True,
                    must_change_password=True,
                )

            # Resolve Division assignments
            target_divisions = CsmDivision.objects.none()
            if is_superuser and (all_divisions or division_ids == 'all' or not division_ids):
                target_divisions = CsmDivision.objects.exclude(name__iexact='ALL')
            elif division_ids:
                id_filters = models.Q(id__in=[x for x in division_ids if isinstance(x, int) or (isinstance(x, str) and str(x).isdigit())])
                name_filters = models.Q(name__in=[str(x) for x in division_ids])
                if 'TSSD1' in division_ids:
                    name_filters |= models.Q(name='TSSD 1')
                if 'TSSD2' in division_ids:
                    name_filters |= models.Q(name='TSSD 2')
                target_divisions = CsmDivision.objects.filter(id_filters | name_filters).exclude(name__iexact='ALL')

            emp.divisions.set(target_divisions)
            for div in target_divisions:
                CtmsStaffDivision.objects.get_or_create(user=user, division=div)

            # Link to DolePersonnel record if provided
            personnel_id = data.get('personnel_id') or data.get('personnel')
            if personnel_id and str(personnel_id).isdigit() and int(personnel_id) > 0:
                target_p = DolePersonnel.objects.filter(pk=int(personnel_id)).first()
                if target_p:
                    target_p.user = user
                    target_p.save(update_fields=['user'])

            user = User.objects.prefetch_related('staff_offices__office', 'staff_divisions__division').get(pk=user.pk)
            serializer = self.get_serializer(user)
            log_audit_event(
                action='USER_CREATE',
                category=CtmsAuditLog.CATEGORY_USER,
                actor=request.user,
                request=request,
                target_type='User',
                target_id=user.id,
                target_repr=f"User '{user.username}'",
                office=primary_office,
                description=f"Created user account '{user.username}' ({'Admin' if user.is_superuser else 'Staff'})"
            )
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        except IntegrityError as err:
            return Response({"detail": f"Database integrity error: {str(err)}"}, status=status.HTTP_400_BAD_REQUEST)

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        user = self.get_object()
        data = request.data

        if 'first_name' in data:
            user.first_name = str(data['first_name']).strip()
        if 'last_name' in data:
            user.last_name = str(data['last_name']).strip()
        if 'role' in data:
            user.is_superuser = (str(data['role']).lower() in ('admin', 'administrator', 'true', '1'))
        if 'is_active' in data:
            user.is_active = bool(data['is_active'])
        if 'password' in data and data['password']:
            user.set_password(str(data['password']).strip())
        if 'temporary_password' in data and data['temporary_password']:
            user.set_password(str(data['temporary_password']).strip())
        user.save()

        primary_office = None
        if 'office_ids' in data or 'office' in data or 'all_offices' in data:
            CtmsStaffOffice.objects.filter(user=user).delete()
            target_offices = CsmOffice.objects.none()
            if user.is_superuser and (data.get('all_offices') or data.get('office_ids') == 'all'):
                target_offices = CsmOffice.objects.filter(is_active=True)
            elif 'office_ids' in data and data['office_ids']:
                off_ids = data['office_ids']
                if isinstance(off_ids, (list, tuple)):
                    target_offices = CsmOffice.objects.filter(id__in=off_ids, is_active=True)
                elif str(off_ids).isdigit():
                    target_offices = CsmOffice.objects.filter(id=off_ids, is_active=True)
            elif 'office' in data and data['office']:
                target_offices = CsmOffice.objects.filter(id=data['office'], is_active=True)
            elif user.is_superuser:
                target_offices = CsmOffice.objects.filter(is_active=True)

            for off in target_offices:
                CtmsStaffOffice.objects.get_or_create(user=user, office=off)
            primary_office = target_offices.first()

        if 'division_ids' in data or 'all_divisions' in data:
            CtmsStaffDivision.objects.filter(user=user).delete()
            target_divisions = CsmDivision.objects.none()
            if user.is_superuser and (data.get('all_divisions') or data.get('division_ids') == 'all'):
                target_divisions = CsmDivision.objects.exclude(name__iexact='ALL')
            elif 'division_ids' in data and data['division_ids']:
                div_ids = data['division_ids']
                id_filters = models.Q(id__in=[x for x in div_ids if isinstance(x, int) or (isinstance(x, str) and str(x).isdigit())])
                name_filters = models.Q(name__in=[str(x) for x in div_ids])
                if 'TSSD1' in div_ids:
                    name_filters |= models.Q(name='TSSD 1')
                if 'TSSD2' in div_ids:
                    name_filters |= models.Q(name='TSSD 2')
                target_divisions = CsmDivision.objects.filter(id_filters | name_filters).exclude(name__iexact='ALL')
            elif user.is_superuser:
                target_divisions = CsmDivision.objects.exclude(name__iexact='ALL')

            for div in target_divisions:
                CtmsStaffDivision.objects.get_or_create(user=user, division=div)

            try:
                if hasattr(user, 'employee_profile') and user.employee_profile:
                    user.employee_profile.divisions.set(target_divisions)
            except Exception:
                pass

        try:
            if hasattr(user, 'employee_profile') and user.employee_profile:
                emp = user.employee_profile
                if 'first_name' in data:
                    emp.first_name = user.first_name
                if 'last_name' in data:
                    emp.last_name = user.last_name
                if 'position' in data:
                    emp.position = str(data['position']).strip()
                if primary_office:
                    emp.office = primary_office
                if 'is_active' in data:
                    emp.is_active = user.is_active
                emp.save()
        except Exception:
            pass

        # Update DolePersonnel link if provided
        if 'personnel_id' in data or 'personnel' in data:
            raw_pid = data.get('personnel_id') if 'personnel_id' in data else data.get('personnel')
            DolePersonnel.objects.filter(user=user).update(user=None)
            if raw_pid and str(raw_pid).isdigit() and int(raw_pid) > 0:
                target_p = DolePersonnel.objects.filter(pk=int(raw_pid)).first()
                if target_p:
                    DolePersonnel.objects.filter(pk=target_p.pk).update(user=None)
                    target_p.user = user
                    target_p.save(update_fields=['user'])

        user = User.objects.prefetch_related('staff_offices__office', 'staff_divisions__division').get(pk=user.pk)
        serializer = self.get_serializer(user)
        log_audit_event(
            action='USER_UPDATE',
            category=CtmsAuditLog.CATEGORY_USER,
            actor=request.user,
            request=request,
            target_type='User',
            target_id=user.id,
            target_repr=f"User '{user.username}'",
            description=f"Updated user account '{user.username}' ({'Admin' if user.is_superuser else 'Staff'}, {'Active' if user.is_active else 'Inactive'})"
        )
        return Response(serializer.data)

    @transaction.atomic
    def destroy(self, request, *args, **kwargs):
        user = self.get_object()
        if user == request.user:
            return Response({"detail": "You cannot delete your own logged-in account."}, status=status.HTTP_400_BAD_REQUEST)
        username = user.username
        uid = user.id
        try:
            if hasattr(user, 'employee_profile') and user.employee_profile:
                user.employee_profile.delete()
        except Exception:
            pass
        user.delete()
        log_audit_event(
            action='USER_DELETE',
            category=CtmsAuditLog.CATEGORY_USER,
            actor=request.user,
            request=request,
            target_type='User',
            target_id=uid,
            target_repr=f"User '{username}'",
            description=f"Deleted user account '{username}'"
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'], url_path='reset-password')
    def reset_password(self, request, pk=None):
        user = self.get_object()
        new_pwd = str(request.data.get('password', '')).strip() or str(request.data.get('new_password', '')).strip()
        if not new_pwd:
            return Response({"detail": "New password cannot be empty."}, status=status.HTTP_400_BAD_REQUEST)
        user.set_password(new_pwd)
        user.save()
        try:
            if hasattr(user, 'employee_profile') and user.employee_profile:
                user.employee_profile.must_change_password = True
                user.employee_profile.save(update_fields=['must_change_password'])
        except Exception:
            pass
        log_audit_event(
            action='USER_PASSWORD_RESET',
            category=CtmsAuditLog.CATEGORY_USER,
            actor=request.user,
            request=request,
            target_type='User',
            target_id=user.id,
            target_repr=f"User '{user.username}'",
            description=f"Reset password for user '{user.username}'"
        )
        return Response({
            "status": "success",
            "message": f"Password for {user.username} has been reset to '{new_pwd}'."
        })

    @action(detail=True, methods=['post'], url_path='toggle-active')
    def toggle_active(self, request, pk=None):
        user = self.get_object()
        if user == request.user:
            return Response({"detail": "You cannot deactivate your own logged-in account."}, status=status.HTTP_400_BAD_REQUEST)
        user.is_active = not user.is_active
        user.save()
        try:
            if hasattr(user, 'employee_profile') and user.employee_profile:
                user.employee_profile.is_active = user.is_active
                user.employee_profile.save(update_fields=['is_active'])
        except Exception:
            pass
        log_audit_event(
            action='USER_TOGGLE_ACTIVE',
            category=CtmsAuditLog.CATEGORY_USER,
            actor=request.user,
            request=request,
            target_type='User',
            target_id=user.id,
            target_repr=f"User '{user.username}'",
            description=f"Toggled user '{user.username}' status to {'active' if user.is_active else 'inactive'}"
        )
        return Response({
            "status": "success",
            "is_active": user.is_active,
            "message": f"Account {user.username} is now {'active' if user.is_active else 'inactive'}."
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
        for std_div in ('IMSD', 'TSSD 1', 'TSSD 2', 'MALSU'):
            if not CsmDivision.objects.filter(name__iexact=std_div).exists():
                CsmDivision.objects.get_or_create(name=std_div)
        divisions = CsmDivision.objects.exclude(name__iexact='ALL').order_by('id')
        return Response(CsmDivisionSerializer(divisions, many=True).data)


class StaffPersonnelViewSet(viewsets.ModelViewSet):
    """
    CRUD ViewSet for managing DOLE personnel directory.
    - list/retrieve accessible to all authenticated staff (for assigning in queue).
    - create/update/delete accessible only to superuser administrators.
    - Creates personnel profiles WITHOUT requiring or creating login user accounts.
    """
    serializer_class = DolePersonnelSerializer
    queryset = DolePersonnel.objects.all().select_related('office').prefetch_related('divisions').order_by('last_name', 'first_name')

    def get_permissions(self):
        if self.action in ['list', 'retrieve']:
            return [IsStaffUser()]
        return [IsAdminUserOnly()]

    def get_queryset(self):
        qs = DolePersonnel.objects.all().select_related('office').prefetch_related('divisions').order_by('last_name', 'first_name')

        active_only = self.request.query_params.get('active_only')
        if active_only == 'true' or not self.request.user.is_superuser:
            qs = qs.filter(is_active=True)

        office_id = self.request.query_params.get('office')
        if office_id:
            qs = qs.filter(office_id=office_id)

        division_param = self.request.query_params.get('division')
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

        search = self.request.query_params.get('search')
        if search:
            qs = qs.filter(
                models.Q(employee_id__icontains=search) |
                models.Q(first_name__icontains=search) |
                models.Q(last_name__icontains=search) |
                models.Q(position__icontains=search)
            )

        return qs.distinct()

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

        if not employee_id:
            return Response({"detail": "Employee ID is required."}, status=status.HTTP_400_BAD_REQUEST)
        if not first_name or not last_name:
            return Response({"detail": "First name and last name are required."}, status=status.HTTP_400_BAD_REQUEST)
        if not office_id:
            return Response({"detail": "DOLE Office is required."}, status=status.HTTP_400_BAD_REQUEST)
        if not division_ids:
            return Response({"detail": "At least one division is required."}, status=status.HTTP_400_BAD_REQUEST)

        if DolePersonnel.objects.filter(employee_id__iexact=employee_id).exists():
            return Response({"detail": f"Personnel with Employee ID '{employee_id}' already exists."}, status=status.HTTP_400_BAD_REQUEST)

        office = get_object_or_404(CsmOffice, pk=office_id)

        # Create pure Personnel record without user account
        personnel = DolePersonnel.objects.create(
            employee_id=employee_id,
            first_name=first_name,
            middle_name=middle_name,
            last_name=last_name,
            position=position,
            office=office,
            is_active=True,
        )

        # Set divisions
        if division_ids:
            id_filters = models.Q(id__in=[x for x in division_ids if isinstance(x, int) or (isinstance(x, str) and x.isdigit())])
            name_filters = models.Q(name__in=[str(x) for x in division_ids])
            if 'TSSD1' in division_ids:
                name_filters |= models.Q(name='TSSD 1')
            if 'TSSD2' in division_ids:
                name_filters |= models.Q(name='TSSD 2')
            matched_divisions = CsmDivision.objects.filter(id_filters | name_filters)
            personnel.divisions.set(matched_divisions)

        log_audit_event(
            action='PERSONNEL_CREATE',
            category=CtmsAuditLog.CATEGORY_PERSONNEL,
            actor=request.user,
            request=request,
            target_type='Personnel',
            target_id=personnel.id,
            target_repr=f"{personnel.full_name} ({personnel.employee_id})",
            office=office,
            description=f"Created personnel record for '{personnel.full_name}' ({personnel.position or 'Staff'})"
        )

        return Response(DolePersonnelSerializer(personnel).data, status=status.HTTP_201_CREATED)

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        partial = kwargs.pop('partial', False)
        instance = self.get_object()
        data = request.data

        if 'first_name' in data:
            instance.first_name = str(data['first_name']).strip()
        if 'middle_name' in data:
            instance.middle_name = str(data['middle_name']).strip()
        if 'last_name' in data:
            instance.last_name = str(data['last_name']).strip()
        if 'position' in data:
            instance.position = str(data['position']).strip()
        if 'office' in data and data['office']:
            instance.office = get_object_or_404(CsmOffice, pk=data['office'])
        if 'is_active' in data:
            instance.is_active = bool(data['is_active'])

        instance.save()

        if 'division_ids' in data:
            division_ids = data['division_ids']
            id_filters = models.Q(id__in=[x for x in division_ids if isinstance(x, int) or (isinstance(x, str) and x.isdigit())])
            name_filters = models.Q(name__in=[str(x) for x in division_ids])
            if 'TSSD1' in division_ids:
                name_filters |= models.Q(name='TSSD 1')
            if 'TSSD2' in division_ids:
                name_filters |= models.Q(name='TSSD 2')
            matched_divisions = CsmDivision.objects.filter(id_filters | name_filters)
            instance.divisions.set(matched_divisions)

        if 'service_ids' in data:
            service_ids = data['service_ids']
            services_to_set = list(CsmService.objects.filter(id__in=service_ids).select_related('division'))
            p_div_names = {d.name.upper() for d in instance.divisions.all()} | {d.name.replace(' ', '').upper() for d in instance.divisions.all()}
            invalid_svcs = []
            for svc in services_to_set:
                if svc.division and svc.division.name.strip().upper() != 'ALL':
                    s_div = svc.division.name.strip()
                    if s_div.upper() not in p_div_names and s_div.replace(' ', '').upper() not in p_div_names and 'ALL' not in p_div_names:
                        invalid_svcs.append(f"{svc.name} ({svc.division.name})")
            if invalid_svcs:
                return Response(
                    {"detail": f"Division mismatch: The following services do not match personnel division(s): {', '.join(invalid_svcs)}."},
                    status=status.HTTP_400_BAD_REQUEST
                )
            instance.services.set(services_to_set)

        log_audit_event(
            action='PERSONNEL_UPDATE',
            category=CtmsAuditLog.CATEGORY_PERSONNEL,
            actor=request.user,
            request=request,
            target_type='Personnel',
            target_id=instance.id,
            target_repr=f"{instance.full_name} ({instance.employee_id})",
            office=instance.office,
            description=f"Updated personnel record for '{instance.full_name}'"
        )

        return Response(DolePersonnelSerializer(instance).data)

    @transaction.atomic
    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        name = instance.full_name
        emp_id = instance.employee_id
        office = instance.office
        instance.delete()
        log_audit_event(
            action='PERSONNEL_DELETE',
            category=CtmsAuditLog.CATEGORY_PERSONNEL,
            actor=request.user,
            request=request,
            target_type='Personnel',
            target_id=emp_id,
            target_repr=f"{name} ({emp_id})",
            office=office,
            description=f"Deleted personnel record for '{name}'"
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'], url_path='toggle-active')
    def toggle_active(self, request, pk=None):
        instance = self.get_object()
        instance.is_active = not instance.is_active
        instance.save()
        log_audit_event(
            action='PERSONNEL_TOGGLE_ACTIVE',
            category=CtmsAuditLog.CATEGORY_PERSONNEL,
            actor=request.user,
            request=request,
            target_type='Personnel',
            target_id=instance.id,
            target_repr=f"{instance.full_name} ({instance.employee_id})",
            office=instance.office,
            description=f"Toggled personnel '{instance.full_name}' status to {'active' if instance.is_active else 'inactive'}"
        )
        return Response({
            "status": "success",
            "is_active": instance.is_active,
            "message": f"Personnel status set to {'active' if instance.is_active else 'inactive'}."
        })


class StaffAuditLogListView(APIView):
    """
    Admin-only endpoint for querying, filtering, and inspecting system audit logs.
    """
    permission_classes = [IsStaffUser]

    def get(self, request):
        if not request.user.is_superuser:
            return Response(
                {"detail": "Forbidden: Audit logs are restricted to Administrator accounts."},
                status=status.HTTP_403_FORBIDDEN
            )

        qs = CtmsAuditLog.objects.all().select_related('actor', 'office')

        # Filters
        category = request.query_params.get('category', '').strip().lower()
        if category and category != 'all':
            qs = qs.filter(category=category)

        action_filter = request.query_params.get('action', '').strip()
        if action_filter and action_filter != 'all':
            qs = qs.filter(action=action_filter)

        office_id = request.query_params.get('office', '').strip()
        if office_id and office_id != 'all':
            qs = qs.filter(office_id=office_id)

        search = request.query_params.get('search', '').strip()
        if search:
            qs = qs.filter(
                models.Q(actor_username__icontains=search) |
                models.Q(description__icontains=search) |
                models.Q(target_repr__icontains=search) |
                models.Q(action__icontains=search) |
                models.Q(ip_address__icontains=search)
            )

        date_from = request.query_params.get('date_from', '').strip()
        if date_from:
            qs = qs.filter(timestamp__date__gte=date_from)

        date_to = request.query_params.get('date_to', '').strip()
        if date_to:
            qs = qs.filter(timestamp__date__lte=date_to)

        # Total count before pagination
        total_count = qs.count()

        # Category summary counts
        category_counts = {
            'all': CtmsAuditLog.objects.count(),
            'queue': CtmsAuditLog.objects.filter(category=CtmsAuditLog.CATEGORY_QUEUE).count(),
            'user': CtmsAuditLog.objects.filter(category=CtmsAuditLog.CATEGORY_USER).count(),
            'personnel': CtmsAuditLog.objects.filter(category=CtmsAuditLog.CATEGORY_PERSONNEL).count(),
            'auth': CtmsAuditLog.objects.filter(category=CtmsAuditLog.CATEGORY_AUTH).count(),
            'config': CtmsAuditLog.objects.filter(category=CtmsAuditLog.CATEGORY_CONFIG).count(),
        }

        # Available actions for filter dropdown
        distinct_actions = list(
            CtmsAuditLog.objects.order_by('action').values_list('action', flat=True).distinct()
        )

        # Pagination
        try:
            page = int(request.query_params.get('page', 1))
            page_size = int(request.query_params.get('page_size', 25))
        except ValueError:
            page = 1
            page_size = 25

        page = max(1, page)
        page_size = min(max(10, page_size), 100)

        start = (page - 1) * page_size
        end = start + page_size
        paged_qs = qs.order_by('-timestamp')[start:end]

        import math
        total_pages = math.ceil(total_count / page_size) if total_count > 0 else 1

        serializer = CtmsAuditLogSerializer(paged_qs, many=True)

        return Response({
            "total_count": total_count,
            "total_pages": total_pages,
            "current_page": page,
            "page_size": page_size,
            "category_counts": category_counts,
            "available_actions": distinct_actions,
            "results": serializer.data,
        })


class StaffServiceViewSet(viewsets.ModelViewSet):
    """
    CRUD/Management ViewSet for services (from csm_service table).
    Available to all accounts (IsStaffUser covers both staff and admin).
    - list: list all services from csm_service with division and assigned personnel
    - retrieve: retrieve single service details
    - eligible_personnel: get personnel eligible for assignment matching the service division
    - assign_personnel: assign multiple personnel to the service (strictly division-enforced)
    - summary: summary counts of services, assigned status, and division breakdown
    """
    serializer_class = StaffServiceSerializer
    permission_classes = [IsStaffUser]
    http_method_names = ['get', 'post', 'patch', 'head', 'options']

    def get_queryset(self):
        qs = CsmService.objects.all().select_related('division').prefetch_related(
            'assigned_personnel__office',
            'assigned_personnel__divisions'
        ).order_by('sort_order', 'name')

        search = self.request.query_params.get('search')
        if search:
            qs = qs.filter(name__icontains=search.strip())

        division_param = self.request.query_params.get('division')
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
            elif div_clean.upper() == 'ALL':
                names = ['ALL']
            qs = qs.filter(
                models.Q(division__name__in=names) |
                models.Q(division__id__in=[div_clean] if div_clean.isdigit() else [])
            )

        active_param = self.request.query_params.get('is_active')
        if active_param is not None:
            if active_param.lower() in ('true', '1'):
                qs = qs.filter(is_active=True)
            elif active_param.lower() in ('false', '0'):
                qs = qs.filter(is_active=False)

        assigned_param = self.request.query_params.get('assigned')
        if assigned_param == 'true':
            qs = qs.filter(assigned_personnel__isnull=False).distinct()
        elif assigned_param == 'false':
            qs = qs.filter(assigned_personnel__isnull=True)

        return qs

    @action(detail=False, methods=['get'], url_path='summary')
    def summary(self, request):
        total = CsmService.objects.count()
        active = CsmService.objects.filter(is_active=True).count()
        with_assigned = CsmService.objects.filter(assigned_personnel__isnull=False).distinct().count()
        unassigned = total - with_assigned

        by_division = {}
        for div in CsmDivision.objects.all():
            cnt = CsmService.objects.filter(division=div).count()
            assigned_cnt = CsmService.objects.filter(division=div, assigned_personnel__isnull=False).distinct().count()
            by_division[div.name] = {
                'total': cnt,
                'assigned': assigned_cnt,
            }

        return Response({
            'total_services': total,
            'active_services': active,
            'services_with_personnel': with_assigned,
            'services_unassigned': unassigned,
            'by_division': by_division,
        })

    @action(detail=True, methods=['get'], url_path='eligible-personnel')
    def eligible_personnel(self, request, pk=None):
        """
        Returns only personnel whose assigned division matches the service's division.
        Enforces division restriction on personnel listing.
        """
        service = self.get_object()
        personnel_qs = DolePersonnel.objects.filter(is_active=True)

        if service.division and service.division.name.strip().upper() != 'ALL':
            div_name = service.division.name.strip()
            names = [div_name]
            if div_name.upper() in ('TSSD1', 'TSSD 1'):
                names = ['TSSD 1', 'TSSD1']
            elif div_name.upper() in ('TSSD2', 'TSSD 2'):
                names = ['TSSD 2', 'TSSD2']
            elif div_name.upper() == 'IMSD':
                names = ['IMSD']
            elif div_name.upper() == 'MALSU':
                names = ['MALSU']

            personnel_qs = personnel_qs.filter(
                models.Q(divisions=service.division) |
                models.Q(divisions__name__in=names) |
                models.Q(divisions__name__iexact='ALL')
            ).distinct()

        office_id = request.query_params.get('office')
        if office_id:
            personnel_qs = personnel_qs.filter(office_id=office_id)

        search = request.query_params.get('search')
        if search:
            search_str = search.strip()
            personnel_qs = personnel_qs.filter(
                models.Q(employee_id__icontains=search_str) |
                models.Q(first_name__icontains=search_str) |
                models.Q(last_name__icontains=search_str) |
                models.Q(position__icontains=search_str)
            )

        personnel_qs = personnel_qs.select_related('office').prefetch_related('divisions').order_by('last_name', 'first_name')
        assigned_ids = set(service.assigned_personnel.values_list('id', flat=True))

        personnel_data = []
        for p in personnel_qs:
            personnel_data.append({
                'id': p.id,
                'employee_id': p.employee_id,
                'full_name': p.full_name,
                'first_name': p.first_name,
                'last_name': p.last_name,
                'position': p.position,
                'office_id': p.office_id,
                'office_name': p.office.name if p.office else '',
                'office_code': p.office.code if p.office else '',
                'division_names': [d.name for d in p.divisions.all()],
                'is_active': p.is_active,
                'is_assigned': p.id in assigned_ids,
            })

        return Response({
            'service_id': service.id,
            'service_name': service.name,
            'division_id': service.division_id,
            'division_name': service.division.name if service.division else 'ALL',
            'total_eligible': len(personnel_data),
            'assigned_count': len([p for p in personnel_data if p['is_assigned']]),
            'personnel': personnel_data,
        })

    @action(detail=True, methods=['post'], url_path='assign-personnel')
    @transaction.atomic
    def assign_personnel(self, request, pk=None):
        """
        Assigns or updates personnel responsible for handling this service.
        Strictly enforces division-based restrictions:
        Personnel whose assigned division does not match the service's division will be rejected.
        """
        service = self.get_object()
        personnel_ids = request.data.get('personnel_ids', [])

        if not isinstance(personnel_ids, list):
            return Response(
                {"detail": "'personnel_ids' must be a list of personnel IDs."},
                status=status.HTTP_400_BAD_REQUEST
            )

        personnel_qs = list(DolePersonnel.objects.filter(id__in=personnel_ids).prefetch_related('divisions'))
        if len(personnel_qs) != len(set(personnel_ids)):
            found_ids = {p.id for p in personnel_qs}
            missing_ids = set(personnel_ids) - found_ids
            return Response(
                {"detail": f"One or more personnel IDs not found: {list(missing_ids)}."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Division-based enforcement
        if service.division and service.division.name.strip().upper() != 'ALL':
            service_div_name = service.division.name.strip()
            allowed_divs = {
                service_div_name.upper(),
                service_div_name.replace(' ', '').upper(),
                'ALL'
            }
            mismatched = []
            for p in personnel_qs:
                p_div_names = {d.name.upper() for d in p.divisions.all()} | {d.name.replace(' ', '').upper() for d in p.divisions.all()}
                if not (p_div_names & allowed_divs):
                    p_div_str = ', '.join([d.name for d in p.divisions.all()]) or 'None'
                    mismatched.append(f"{p.full_name} ({p.employee_id}) [Divisions: {p_div_str}]")

            if mismatched:
                return Response(
                    {
                        "detail": (
                            f"Division Restriction Error: Personnel can only be assigned to services within their "
                            f"authorized division. The service '{service.name}' belongs to '{service.division.name}', "
                            f"but the following personnel are not assigned to this division: {', '.join(mismatched)}."
                        ),
                        "mismatched_personnel": mismatched,
                        "service_division": service.division.name,
                    },
                    status=status.HTTP_400_BAD_REQUEST
                )

        service.assigned_personnel.set(personnel_qs)

        log_audit_event(
            action='SERVICE_ASSIGN_PERSONNEL',
            category=CtmsAuditLog.CATEGORY_PERSONNEL,
            actor=request.user,
            request=request,
            target_type='CsmService',
            target_id=service.id,
            target_repr=service.name,
            description=(
                f"Assigned {len(personnel_qs)} personnel to service '{service.name}' "
                f"({service.division.name if service.division else 'All'}): "
                f"{', '.join([p.full_name for p in personnel_qs]) or 'None'}"
            )
        )

        serializer = StaffServiceSerializer(service)
        return Response({
            "message": f"Successfully updated assigned personnel for '{service.name}'.",
            "service": serializer.data,
        })


class StaffNotificationListView(APIView):
    """
    List and manage real-time notifications for the authenticated user.
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        qs = CtmsNotification.objects.filter(recipient=request.user)
        unread_only = request.query_params.get('unread_only')
        if unread_only in ('true', '1'):
            qs = qs.filter(is_read=False)
        since_id = request.query_params.get('since_id')
        if since_id and str(since_id).isdigit():
            qs = qs.filter(id__gt=int(since_id))

        total_unread = CtmsNotification.objects.filter(recipient=request.user, is_read=False).count()
        notifications = qs.order_by('-created_at')[:40]
        serializer = CtmsNotificationSerializer(notifications, many=True)
        return Response({
            "unread_count": total_unread,
            "results": serializer.data,
        })

    def post(self, request):
        action = request.data.get('action', 'mark_all_read')
        if action == 'mark_all_read':
            CtmsNotification.objects.filter(recipient=request.user, is_read=False).update(is_read=True)
            return Response({"detail": "All notifications marked as read.", "unread_count": 0})
        elif action == 'mark_read':
            notif_id = request.data.get('id')
            if notif_id:
                CtmsNotification.objects.filter(recipient=request.user, id=notif_id).update(is_read=True)
            total_unread = CtmsNotification.objects.filter(recipient=request.user, is_read=False).count()
            return Response({"detail": "Notification marked as read.", "unread_count": total_unread})
        return Response({"detail": "Unknown action."}, status=status.HTTP_400_BAD_REQUEST)




