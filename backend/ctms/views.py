import io
import logging
import math
import secrets
from datetime import timedelta

import qrcode
from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import models, transaction
from django.db.models.functions import Coalesce
from django.http import HttpResponse, Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import status, viewsets, permissions
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from .security import (
    end_all_sessions, login_locked, mark_ended_on_purpose, record_office_code_failure, video_upload_error,
)
from .models import (
    CANONICAL_DIVISIONS,
    CsmDivision,
    CsmOffice,
    CsmService,
    CsmResponse,
    CtmsCounter,
    CtmsStaffOffice,
    DolePersonnel,
    DolePosition,
    DEFAULT_DOLE_POSITIONS,
    CtmsDisplayConfig,
    CtmsOfficeQrConfig,
    CtmsTransaction,
    CtmsAuditLog,
    CtmsNotification,
    CtmsAssignmentHistory,
    CtmsCallAnnouncement,
    log_audit_event,
)
from .serializers import (
    CsmDivisionSerializer,
    CsmOfficeSerializer,
    CsmServiceSerializer,
    StaffServiceSerializer,
    CtmsCounterSerializer,
    WindowSerializer,
    CtmsStaffOfficeSerializer,
    DolePositionSerializer,
    CtmsUserAccountSerializer,
    CtmsNotificationSerializer,
    CheckinRequestSerializer,
    TicketPublicSerializer,
    StaffTransactionSerializer,
    StaffTokenObtainPairSerializer,
    StaffTokenRefreshSerializer,
    CtmsAuditLogSerializer,
    remember_refresh_token,
)
from .throttling import CheckinThrottle, LoginThrottle
from .permissions import (
    IsRegionalAdmin,
    IsSystemAdmin,
    admin_scope_offices,
    is_display_account,
    is_registration_account,
    registration_office,
    office_type,
    staff_session,
)
from . import services

User = get_user_model()
logger = logging.getLogger(__name__)


def _query_date(request, name):
    """An optional YYYY-MM-DD query parameter; a malformed one is a 400, not a server error."""
    raw = (request.query_params.get(name) or '').strip()
    if not raw:
        return None
    try:
        value = parse_date(raw)   # None for a bad format; ValueError for e.g. month 13
    except ValueError:
        value = None
    if value is None:
        raise ValidationError({name: "Use a date in the format YYYY-MM-DD."})
    return value


def _query_int(request, name, default, minimum, maximum):
    """An optional integer query parameter, kept within [minimum, maximum]."""
    try:
        value = int(request.query_params.get(name, default))
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


def _surveyed_and_notes(qs):
    """
    Loads, in two queries for the whole list, what StaffTransactionSerializer would otherwise
    query once per row: whether the client answered the CSM survey, and the remarks history.
    """
    return qs.annotate(
        surveyed_flag=models.Exists(CsmResponse.objects.filter(ctms_transaction_id=models.OuterRef('pk')))
    ).prefetch_related(models.Prefetch(
        'assignment_history',
        queryset=CtmsAssignmentHistory.objects.exclude(reason='').order_by('-created_at', '-id'),
        to_attr='note_events',
    ))


# =====================================================================
# Auth Views & Permission Helpers
# =====================================================================

class StaffLoginView(TokenObtainPairView):
    serializer_class = StaffTokenObtainPairSerializer
    throttle_classes = [LoginThrottle]

    def post(self, request, *args, **kwargs):
        if login_locked(str(request.data.get('username') or '')):
            msg = "Too many failed sign-ins for this account. Try again in 15 minutes, or ask your office administrator to reset your password."
            return Response({"detail": msg, "code": "ACCOUNT_LOCKED"}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        response = super().post(request, *args, **kwargs)
        if response.status_code == 200:
            typed = str(request.data.get('username') or '').strip()
            user_obj = (User.objects.filter(username=typed).first()
                        or User.objects.filter(username__iexact=typed).first())
            username = user_obj.username if user_obj else typed
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


class StaffTokenRefreshView(TokenRefreshView):
    serializer_class = StaffTokenRefreshSerializer


class StaffLogoutView(APIView):
    """Signs out: the refresh token is revoked, so a copy of it stops working."""
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        try:
            token = RefreshToken(str(request.data.get('refresh') or ''))
            mark_ended_on_purpose([token['jti']])  # a signed-out token gets no grace renewal
            token.blacklist()
        except Exception:
            pass  # already expired, revoked, or malformed: nothing left to revoke
        return Response(status=status.HTTP_205_RESET_CONTENT)


class StaffMeView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        if not request.user.is_staff and not is_display_account(request.user) \
                and not is_registration_account(request.user):
            return Response({"detail": "Forbidden: Staff account required."}, status=status.HTTP_403_FORBIDDEN)
        return Response(staff_session(request.user))


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
        
        qr_config = getattr(office, 'qr_config', None)
        if not qr_config:
            qr_config = CtmsOfficeQrConfig.objects.filter(office=office).first()

        is_qr_enabled = qr_config.is_qr_enabled if qr_config else True
        disabled_message = (
            qr_config.disabled_message if qr_config and qr_config.disabled_message
            else "Online registration is currently closed beyond office hours. Please visit us during regular office hours (Monday to Friday, 8:00 AM - 5:00 PM)."
        )

        services_data = CsmServiceSerializer(services_qs, many=True).data
        for row in services_data:
            # A plain-language line under each service, so clients can tell them apart
            row['description'] = get_service_description(row['name'])

        return Response({
            "office": CsmOfficeSerializer(office).data,
            "services": services_data,
            "is_qr_enabled": is_qr_enabled,
            "disabled_message": disabled_message,
            # Only whether a code is needed; the code itself is never sent here.
            "requires_office_code": bool(qr_config and qr_config.requires_office_code),
        })


def checkin_refusal(office, office_code):
    """
    The response refusing a client's QR check-in at `office`, or None when it may proceed.
    Used for new check-ins and for referred clients joining the line on arrival.
    """
    # Guard: verify client QR check-in is enabled for this office (e.g. within office hours)
    qr_config = getattr(office, 'qr_config', None)
    if not qr_config:
        qr_config = CtmsOfficeQrConfig.objects.filter(office=office).first()
    if qr_config and not qr_config.is_qr_enabled:
        msg = qr_config.disabled_message or "Online registration is currently closed beyond office hours."
        return Response({"detail": msg, "message": msg, "code": "QR_DISABLED"}, status=status.HTTP_403_FORBIDDEN)

    # Guard: the printed QR poster never changes, so a photo of it works anywhere. When
    # enabled, require this hour's code shown on the TV / board inside the office.
    if qr_config and qr_config.requires_office_code:
        if not services.office_code_matches(qr_config, office_code):
            if record_office_code_failure(office.id):
                # Someone is guessing codes: replace this office's code (the TV shows the new one)
                services.get_or_rotate_office_code(qr_config, force=True)
            msg = "Incorrect check-in code. Please enter the 4-digit code shown on the screen or board at the office."
            return Response({"detail": msg, "message": msg, "code": "OFFICE_CODE_INVALID"}, status=status.HTTP_403_FORBIDDEN)
    return None


class PublicCheckinView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [CheckinThrottle]

    def post(self, request):
        serializer = CheckinRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        office = data['office']
        refusal = checkin_refusal(office, data.get('office_code'))
        if refusal:
            return refusal

        # A client registering alone must give a name or choose "Anonymous" (groups always
        # send a representative name). Staff walk-ins may leave it blank.
        if not data.get('group_member_names') and not (data.get('client_name') or '').strip():
            msg = "Please type your name, or tap Anonymous."
            return Response({"detail": msg, "message": msg, "code": "NAME_REQUIRED"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            tx = services.create_transaction(
                office=office,
                service=data['service'],
                client_name=data.get('client_name'),
                is_priority=data.get('is_priority', False),
                source=CtmsTransaction.SOURCE_QR,
                group_member_names=data.get('group_member_names'),
                concern_note=data.get('concern_note'),
            )
            return Response({
                "ticket_token": tx.ticket_token,
                "queue_no": tx.queue_no,
                "transaction_no": tx.transaction_no,
            }, status=status.HTTP_201_CREATED)
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            logger.exception("Public check-in failed")
            return Response({"detail": "Check-in failed. Please try again or ask DOLE staff for assistance."},
                            status=status.HTTP_400_BAD_REQUEST)


class PublicTicketDetailView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request, ticket_token):
        tx = get_object_or_404(CtmsTransaction, ticket_token=ticket_token)
        return Response(TicketPublicSerializer(tx).data)


class PublicReferralArriveView(APIView):
    """
    A referred client checks in at the office they were sent to (they scanned its QR):
    they join its line now, under the same rules as any QR check-in there.
    """
    permission_classes = [permissions.AllowAny]
    throttle_classes = [CheckinThrottle]

    def post(self, request, ticket_token):
        tx = get_object_or_404(CtmsTransaction.objects.select_related('referral_office'), ticket_token=ticket_token)
        if tx.status != CtmsTransaction.STATUS_REFERRED or not tx.referral_office_id:
            return Response({"detail": "This ticket was not referred to another office."}, status=status.HTTP_409_CONFLICT)
        refusal = checkin_refusal(tx.referral_office, request.data.get('office_code'))
        if refusal:
            return refusal
        try:
            new_tx = services.receive_referral(tx)
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_409_CONFLICT)
        _log_referral_arrival(request, tx, new_tx, actor=None)
        return Response({"ticket_token": new_tx.ticket_token, "queue_no": new_tx.queue_no}, status=status.HTTP_201_CREATED)


def _log_referral_arrival(request, src, new_tx, actor):
    log_audit_event(
        action='REFERRAL_ARRIVED',
        category=CtmsAuditLog.CATEGORY_QUEUE,
        actor=actor,
        actor_username='' if actor else 'Client',
        actor_role='' if actor else 'QR check-in',
        request=request,
        target_type='Transaction',
        target_id=new_tx.id,
        target_repr=f"Queue #{new_tx.queue_no} ({new_tx.transaction_no})",
        office=new_tx.office,
        division_name=new_tx.service.division.name if new_tx.service and new_tx.service.division else '',
        description=(f"Referred client from {src.office.name} arrived and joined the line as Queue #{new_tx.queue_no}"
                     f" ({'confirmed by staff' if actor else 'QR check-in'})"),
        details={'from_office': src.office.name, 'from_transaction_no': src.transaction_no,
                 'queue_no': new_tx.queue_no, 'note': new_tx.referral_note},
    )


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


class PublicDisplayCallsView(APIView):
    """
    The office TV's announcement feed, polled about once a second.

    GET ?after=<id> returns every call logged after that id, oldest first, so calls made
    at the same moment by different windows are all announced, in order. Without `after`
    (a TV that just opened) it returns only the current cursor: earlier calls are not
    replayed. Calls from the last few seconds are always included as well, so a call whose
    database transaction committed after a later-numbered one is still picked up; the TV
    skips ids it has already announced. Nothing is consumed, so several TVs can follow
    the same office. Queue numbers and window names only, never client names.
    """
    permission_classes = [permissions.AllowAny]
    LOOKBACK = timedelta(seconds=15)
    BATCH = 50

    def get(self, request, office_id):
        if not CsmOffice.objects.filter(pk=office_id, is_active=True).exists():
            raise Http404
        now = timezone.now()
        office_calls = CtmsCallAnnouncement.objects.filter(office_id=office_id)
        latest_id = office_calls.order_by('-id').values_list('id', flat=True).first() or 0

        from . import tts
        raw_after = (request.query_params.get('after') or '').strip()
        if not raw_after.isdigit():
            return Response({"cursor": latest_id, "calls": [], "has_more": False, "server_voice": tts.is_enabled()})

        after = int(raw_after)
        rows = list(
            office_calls.filter(models.Q(id__gt=after) | models.Q(created_at__gte=now - self.LOOKBACK))
            .order_by('id')[:self.BATCH + 1]
        )
        has_more = len(rows) > self.BATCH
        rows = rows[:self.BATCH]
        calls = [{
            "id": r.id,
            "kind": r.kind,
            "queue_no": r.queue_no,
            "is_priority": r.is_priority,
            "counter": r.counter_name,
            "personnel": r.personnel_name,
            "created_at": r.created_at.isoformat(),
            "age_seconds": max(0, round((now - r.created_at).total_seconds(), 1)),
        } for r in rows]
        cursor = max([after] + [r.id for r in rows])
        return Response({"cursor": cursor, "calls": calls, "has_more": has_more, "server_voice": tts.is_enabled()})


class PublicDisplayCallAudioView(APIView):
    """The spoken announcement for one logged call, as WAV audio (server voice, ctms/tts.py).
    404 when the server voice is off; the TV then uses the browser's voice."""
    permission_classes = [permissions.AllowAny]

    def get(self, request, office_id, call_id):
        from . import tts
        call = get_object_or_404(CtmsCallAnnouncement, pk=call_id, office_id=office_id)
        audio = tts.synthesize(tts.announcement_text(call.queue_no, call.counter_name, call.personnel_name))
        if audio is None:
            raise Http404("Server voice is not enabled.")
        response = HttpResponse(audio, content_type='audio/wav')
        response['Cache-Control'] = 'no-store'  # a changed voice must be heard at once
        return response


class PublicDisplayVoiceCheckView(APIView):
    """The server voice saying a fixed sound-check sentence, played when the TV's sound is switched on."""
    permission_classes = [permissions.AllowAny]

    def get(self, request, office_id):
        from . import tts
        get_object_or_404(CsmOffice, pk=office_id, is_active=True)
        audio = tts.synthesize(tts.SOUND_CHECK_TEXT)
        if audio is None:
            raise Http404("Server voice is not enabled.")
        response = HttpResponse(audio, content_type='audio/wav')
        response['Cache-Control'] = 'no-store'  # a changed voice must be heard at once
        return response


class PublicDisplayBoardView(APIView):
    """
    Office TV board: one card per active, non-archived window created on the
    Windows page, with what each window is serving. Reassigned clients are not
    shown. Queue numbers only, never client names (RA 10173).
    """
    permission_classes = [permissions.AllowAny]

    def get(self, request, office_id):
        office = get_object_or_404(CsmOffice, pk=office_id, is_active=True)
        today = timezone.localdate()

        windows = list(
            CtmsCounter.objects.filter(office=office, is_active=True, archived_at__isnull=True)
            .select_related('assigned_user', 'assigned_user__dole_personnel')
            .order_by('sort_order', 'name', 'id')
        )
        # A window can hold more than one client (e.g. a transferred client served there by a
        # colleague without a window): the latest call is featured, the rest listed under it.
        related = ('service', 'assigned_to', 'assigned_to__dole_personnel')
        by_window = {}

        # Clients being served at a window. Reassigned clients are handled by their new
        # personnel off the board, so they never appear on the TV.
        reassigned = CtmsAssignmentHistory.objects.filter(
            transaction=models.OuterRef('pk'), event=CtmsAssignmentHistory.EVENT_TRANSFERRED)
        # Only today's calls, like the staff Queue page: a client left "serving" on an earlier
        # day must not show as "Now Serving" to today's clients.
        for tx in (CtmsTransaction.objects
                   .filter(counter__in=windows, status=CtmsTransaction.STATUS_SERVING)
                   .filter(models.Q(queue_date=today) | models.Q(called_at__date=today))
                   .exclude(models.Exists(reassigned))
                   .select_related(*related)):
            by_window.setdefault(tx.counter_id, []).append(tx)

        def client_entry(tx):
            service_name = tx.service.name if tx.service_id else ""
            personnel = services.personnel_display_name(tx.assigned_to) if tx.assigned_to_id else (tx.assigned_personnel or "")
            return {
                "id": tx.id,
                "queue_no": tx.queue_no,
                "is_priority": tx.is_priority,
                "service_name": service_name,
                "service_description": get_service_description(service_name),
                "personnel": personnel,
                "called_at": tx.called_at.isoformat() if tx.called_at else None,
                "status": tx.status,
            }

        window_cards = []
        serving = []
        for w in windows:
            # Latest call on top
            at_window = sorted(by_window.get(w.id, []), key=lambda t: -(t.called_at.timestamp() if t.called_at else 0))
            clients = [client_entry(t) for t in at_window]
            for entry in clients:
                serving.append({
                    "id": entry["id"],
                    "counter": w.name,
                    "queue_no": entry["queue_no"],
                    "called_at": entry["called_at"],
                    "service_name": entry["service_name"],
                    "assigned_personnel": entry["personnel"],
                    "is_priority": entry["is_priority"],
                })
            window_cards.append({
                "id": w.id,
                "kind": "window",
                "name": w.name,
                "description": w.description,
                "personnel_name": services.personnel_display_name(w.assigned_user) if w.assigned_user_id else "",
                "clients": clients,
                "current": clients[0] if clients else None,
                "also_serving": clients[1:],
            })

        next_qs = CtmsTransaction.objects.filter(
            office=office, status=CtmsTransaction.STATUS_WAITING, queue_date=today
        ).order_by('-is_priority', 'checked_in_at', 'id').values_list('queue_no', 'is_priority')[:25]
        next_details = [{"queue_no": q, "is_priority": p} for q, p in next_qs]

        latest = max(serving, key=lambda s: s["called_at"] or "", default=None)

        # This hour's check-in code, only for the office's own TV (opened with its secret key):
        # this endpoint is public, so anyone else gets no code.
        check_in_code = None
        key = request.GET.get('key') or ''
        qr_config = CtmsOfficeQrConfig.objects.filter(office=office).first()
        if (key and qr_config and qr_config.requires_office_code and qr_config.display_key
                and secrets.compare_digest(key, qr_config.display_key)):
            check_in_code = services.get_or_rotate_office_code(qr_config)

        return Response({
            "office": CsmOfficeSerializer(office).data,
            "windows": window_cards,
            "serving": serving,
            "next": [d["queue_no"] for d in next_details[:10]],
            "next_details": next_details,
            "waiting_count": CtmsTransaction.objects.filter(
                office=office, status=CtmsTransaction.STATUS_WAITING, queue_date=today
            ).count(),
            "latest_called_at": latest["called_at"] if latest else None,
            "latest_called_queue_no": latest["queue_no"] if latest else None,
            "latest_called_counter": latest["counter"] if latest else None,
            "latest_called_personnel": latest["assigned_personnel"] if latest else None,
            "check_in_code": check_in_code,
            "updated_at": timezone.now().isoformat(),
        })


# =====================================================================
# Staff Queue & Operations Endpoints
# =====================================================================

class StaffQueueView(APIView):
    """
    The office's shared queue. Every staff member of the office sees the same
    waiting line regardless of service division; calling requires a window.
    """
    permission_classes = [IsStaffUser]

    def get(self, request):
        office_id = request.query_params.get('office')

        allowed_offices = get_staff_offices(request.user)
        if not allowed_offices.exists():
            return Response({"detail": "Forbidden: No office assigned to your staff account."}, status=status.HTTP_403_FORBIDDEN)

        if office_id:
            office = allowed_offices.filter(pk=office_id).first()
            if not office:
                return Response({"detail": "Forbidden: You are not authorized to access this office queue."}, status=status.HTTP_403_FORBIDDEN)
        else:
            office = allowed_offices.first()

        today = timezone.localdate()
        related = ('office', 'service', 'service__division', 'counter', 'assigned_to', 'assigned_to__dole_personnel')

        waiting_qs = CtmsTransaction.objects.filter(
            office=office, status=CtmsTransaction.STATUS_WAITING, queue_date=today
        ).select_related(*related).order_by('-is_priority', 'checked_in_at', 'id')

        # Everyone being served in the office right now (pending tickets resumed today included)
        serving_qs = CtmsTransaction.objects.filter(
            office=office, status=CtmsTransaction.STATUS_SERVING,
        ).filter(
            models.Q(queue_date=today) | models.Q(called_at__date=today)
        ).select_related(*related).order_by('counter__sort_order', 'counter__name', '-called_at')

        # Paused / transferred tickets belong to their handler; unowned legacy ones stay visible to all.
        mine_or_unowned = models.Q(assigned_to=request.user) | models.Q(assigned_to__isnull=True)
        pending_qs = CtmsTransaction.objects.filter(
            office=office, status__in=[CtmsTransaction.STATUS_PENDING, CtmsTransaction.STATUS_TRANSFERRED],
        ).filter(mine_or_unowned).select_related(*related).order_by('-is_priority', 'checked_in_at')

        windows_qs = CtmsCounter.objects.filter(
            office=office, is_active=True, archived_at__isnull=True
        ).order_by('sort_order', 'name', 'id')

        my_window = services.user_window(request.user, office)
        # Not limited to today: a client left "serving" yesterday still blocks Call Next
        # ("You are still serving..."), so it must be visible here to be finished.
        my_current = (CtmsTransaction.objects
                      .filter(office=office, status=CtmsTransaction.STATUS_SERVING, assigned_to=request.user)
                      .select_related(*related).order_by('-called_at').first())

        return Response({
            "office": CsmOfficeSerializer(office).data,
            "waiting": StaffTransactionSerializer(waiting_qs, many=True).data,
            "serving": StaffTransactionSerializer(serving_qs, many=True).data,
            "pending": StaffTransactionSerializer(pending_qs, many=True).data,
            "counters": CtmsCounterSerializer(windows_qs, many=True).data,
            "my_window": {"id": my_window.id, "name": my_window.name} if my_window else None,
            "my_window_id": my_window.id if my_window else None,
            "my_current": StaffTransactionSerializer(my_current).data if my_current else None,
            # Referred here by other offices, still on the way: not in the line until they arrive
            "expected_referrals": [expected_referral_payload(tx) for tx in services.expected_referrals(office)],
        })


class IsStaffOrRegistrationDesk(permissions.BasePermission):
    def has_permission(self, request, view):
        return IsStaffUser().has_permission(request, view) or is_registration_account(request.user)


def walkin_offices(user):
    """Offices `user` may register walk-ins for: a desk account only its own office."""
    if is_registration_account(user):
        office = registration_office(user)
        return CsmOffice.objects.filter(pk=office.pk) if office else CsmOffice.objects.none()
    return get_staff_offices(user)


class StaffCreateWalkinView(APIView):
    permission_classes = [IsStaffOrRegistrationDesk]

    def post(self, request):
        serializer = CheckinRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        allowed_offices = walkin_offices(request.user)
        if not allowed_offices.filter(pk=data['office'].pk).exists():
            return Response({"detail": "Forbidden: You are not assigned to this office."}, status=status.HTTP_403_FORBIDDEN)

        try:
            tx = services.create_transaction(
                office=data['office'],
                service=data['service'],
                client_name=data.get('client_name'),
                is_priority=data.get('is_priority', False),
                source=CtmsTransaction.SOURCE_STAFF,
                group_member_names=data.get('group_member_names'),
                concern_note=data.get('concern_note'),
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
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            logger.exception("Walk-in registration failed")
            return Response({"detail": "Walk-in registration failed. Please try again."},
                            status=status.HTTP_400_BAD_REQUEST)


class RegistrationDeskView(APIView):
    """
    The Registration page's header: its office and how many clients are waiting (no names),
    plus the clients other offices referred here who are on the way, to confirm on arrival.
    """
    permission_classes = [IsStaffOrRegistrationDesk]

    def get(self, request):
        office = registration_office(request.user)
        if not office:
            office_id = request.query_params.get('office', '')
            office = walkin_offices(request.user).filter(pk=office_id).first() if office_id.isdigit() else None
        if not office:
            return Response({"detail": "No office to register clients for."}, status=status.HTTP_403_FORBIDDEN)
        waiting = CtmsTransaction.objects.filter(
            office=office, status=CtmsTransaction.STATUS_WAITING, queue_date=timezone.localdate())
        return Response({
            "office": {"id": office.id, "name": office.name, "code": office.code},
            "waiting_count": waiting.count(),
            "priority_waiting": waiting.filter(is_priority=True).count(),
            "expected_referrals": [expected_referral_payload(tx) for tx in services.expected_referrals(office)],
        })


class StaffCallNextView(APIView):
    """Calls the next client in the office's shared queue to the caller's window."""
    permission_classes = [IsStaffUser]

    def post(self, request):
        office_id = request.data.get('office')
        if not office_id:
            return Response({"detail": "Office is required."}, status=status.HTTP_400_BAD_REQUEST)

        office = get_staff_offices(request.user).filter(pk=office_id).first()
        if not office:
            return Response({"detail": "Forbidden: You are not authorized to call clients for this office."}, status=status.HTTP_403_FORBIDDEN)

        try:
            tx = services.call_next_transaction(office, request.user)
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_409_CONFLICT)
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
            description=f"Called next client Queue #{tx.queue_no} to {tx.counter.name} (Officer: {tx.assigned_personnel})",
            details={
                'queue_no': tx.queue_no,
                'transaction_no': tx.transaction_no,
                'counter': tx.counter.name,
                'assigned_personnel': tx.assigned_personnel,
                'service': tx.service.name if tx.service else '',
            }
        )
        return Response(StaffTransactionSerializer(tx).data)


class StaffTransactionActionView(APIView):
    permission_classes = [IsStaffUser]

    def post(self, request, pk, action):
        tx = get_object_or_404(CtmsTransaction, pk=pk)
        allowed_offices = get_staff_offices(request.user)
        if not allowed_offices.filter(pk=tx.office_id).exists():
            return Response({"detail": "Forbidden: Not assigned to this office."}, status=status.HTTP_403_FORBIDDEN)

        try:
            if action in ('call', 'recall'):
                tx = services.call_transaction(tx, request.user)

            elif action == 'done':
                tx = services.mark_done(tx, request.user, reason=str(request.data.get('reason', '')))

            elif action == 'undo-done':
                tx = services.undo_done(tx, actor=request.user)

            elif action == 'no-show':
                tx = services.mark_no_show(tx, actor=request.user)

            elif action == 'cancel':
                tx = services.cancel_transaction(tx, actor=request.user)

            elif action == 'delete':
                # Finished records (done, no-show, cancelled) are kept for reports.
                deletable = (CtmsTransaction.STATUS_WAITING, CtmsTransaction.STATUS_SERVING,
                             CtmsTransaction.STATUS_TRANSFERRED, CtmsTransaction.STATUS_PENDING)
                if tx.status not in deletable:
                    return Response({"detail": "Finished transactions cannot be deleted."},
                                    status=status.HTTP_409_CONFLICT)
                prev_status = tx.get_status_display()
                if tx.referred_from_id:
                    # The client joined from a referral: deleting their ticket ends the referral,
                    # instead of putting them back on the "on the way" list
                    CtmsTransaction.objects.filter(pk=tx.referred_from_id).update(referral_closed_at=timezone.now())
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
                    description=f"Deleted Queue #{q_no} ({t_no}) while {prev_status.lower()}",
                    details={
                        'queue_no': q_no,
                        'transaction_no': t_no,
                        'service': s_name,
                        'status': prev_status,
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
                tx = services.mark_pending(tx, actor=request.user, reason=str(request.data.get('reason', '')))

            elif action == 'requeue':
                tx = services.requeue_transaction(tx, actor=request.user)

            elif action == 'refer':
                to_office = CsmOffice.objects.filter(pk=request.data.get('to_office') or None).first()
                service = None
                if request.data.get('service'):
                    service = CsmService.objects.filter(pk=request.data.get('service'), is_active=True).first()
                    if not service:
                        raise ValueError("Choose an active service.")
                note = str(request.data.get('note', ''))
                tx = services.refer_transaction(tx, request.user, to_office, note, service=service)
                log_audit_event(
                    action='REFER_CLIENT',
                    category=CtmsAuditLog.CATEGORY_QUEUE,
                    actor=request.user,
                    request=request,
                    target_type='Transaction',
                    target_id=tx.id,
                    target_repr=f"Queue #{tx.queue_no} ({tx.transaction_no})",
                    office=tx.office,
                    division_name=tx.service.division.name if tx.service and tx.service.division else '',
                    description=f"Referred Queue #{tx.queue_no} to {tx.referral_office.name}",
                    details={
                        'to_office': tx.referral_office.name, 'service': tx.referral_service.name,
                        'note': tx.referral_note,
                    },
                )

            elif action == 'transfer':
                to_user = User.objects.filter(pk=request.data.get('to_user')).first()
                previous = services.personnel_display_name(tx.assigned_to) if tx.assigned_to_id else ''
                tx = services.transfer_transaction(tx, request.user, to_user, reason=str(request.data.get('reason', '')))
                log_audit_event(
                    action='TRANSFER_CLIENT',
                    category=CtmsAuditLog.CATEGORY_QUEUE,
                    actor=request.user,
                    request=request,
                    target_type='Transaction',
                    target_id=tx.id,
                    target_repr=f"Queue #{tx.queue_no} ({tx.transaction_no})",
                    office=tx.office,
                    division_name=tx.service.division.name if tx.service and tx.service.division else '',
                    description=f"Transferred Queue #{tx.queue_no} from {previous or 'unassigned'} to {tx.assigned_personnel}",
                    details={'from': previous, 'to': tx.assigned_personnel, 'to_user_id': tx.assigned_to_id,
                             'reason': str(request.data.get('reason', ''))},
                )

            else:
                return Response({"detail": f"Unknown action: {action}"}, status=status.HTTP_400_BAD_REQUEST)

            # Record audit log for queue actions
            action_map = {
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
                        **({'remarks': str(request.data.get('reason', '')).strip()}
                           if action in ('done', 'pending') and str(request.data.get('reason', '')).strip() else {}),
                    }
                )

            return Response(StaffTransactionSerializer(tx).data)

        except PermissionError as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_409_CONFLICT)


MY_CLIENT_TABS = {
    'ongoing': [CtmsTransaction.STATUS_SERVING, CtmsTransaction.STATUS_TRANSFERRED],
    'pending': [CtmsTransaction.STATUS_PENDING],
    'done': [CtmsTransaction.STATUS_DONE, CtmsTransaction.STATUS_REFERRED],
}
MY_CLIENTS_DONE_LIMIT = 200


class StaffMyClientsView(APIView):
    """
    The caller's own workload: Ongoing (serving or transferred to them), Pending
    (paused, still theirs) and Done (completed with them as final handler).
    """
    permission_classes = [IsStaffUser]

    def get(self, request):
        tab = request.query_params.get('tab', 'ongoing')
        if tab not in MY_CLIENT_TABS:
            return Response({"detail": "tab must be ongoing, pending, or done."}, status=status.HTTP_400_BAD_REQUEST)

        base = CtmsTransaction.objects.filter(
            assigned_to=request.user, office__in=get_staff_offices(request.user)
        )
        counts = {name: base.filter(status__in=statuses).count() for name, statuses in MY_CLIENT_TABS.items()}

        qs = base.filter(status__in=MY_CLIENT_TABS[tab]).select_related(
            'office', 'service', 'service__division', 'counter', 'assigned_to', 'assigned_to__dole_personnel'
        )
        q = (request.query_params.get('q') or '').strip()
        if q:
            qs = qs.filter(
                models.Q(queue_no__icontains=q) | models.Q(transaction_no__icontains=q) |
                models.Q(client_name__icontains=q) | models.Q(service__name__icontains=q)
            )

        if tab == 'done':
            # Referred tickets have no done_at; they finished when they were closed
            qs = qs.order_by(Coalesce('done_at', 'closed_at').desc())[:MY_CLIENTS_DONE_LIMIT]
        elif tab == 'pending':
            qs = qs.order_by('-is_priority', 'checked_in_at')
        else:
            # transferred-but-not-started first, so new hand-offs are noticed
            qs = qs.order_by('-status', '-called_at', 'checked_in_at')

        window = CtmsCounter.objects.filter(
            assigned_user=request.user, is_active=True, archived_at__isnull=True
        ).first()
        return Response({
            "tab": tab,
            "counts": counts,
            "results": StaffTransactionSerializer(qs, many=True).data,
            "my_window": {"id": window.id, "name": window.name, "office": window.office_id} if window else None,
        })


def expected_referral_payload(tx):
    """A referred client on the way to another office, as that office's staff see it."""
    referred = tx.assignment_history.filter(event=CtmsAssignmentHistory.EVENT_REFERRED).order_by('-id').first()
    service = tx.referral_service or tx.service
    return {
        "id": tx.id,
        "client_name": tx.client_name,
        "group_member_names": tx.group_member_names,
        "is_priority": tx.is_priority,
        "service_name": service.name if service else '',
        "from_office_name": tx.office.name,
        "from_queue_no": tx.queue_no,
        "from_transaction_no": tx.transaction_no,
        "referral_note": tx.referral_note,
        "referred_by": referred.actor_name if referred else '',
        "referred_at": tx.closed_at,
        "expires_at": services.referral_expires_at(tx),
    }


class StaffReferralArrivedView(APIView):
    """
    The receiving office's staff or registration desk confirm a referred client has arrived
    (e.g. they showed their first slip): they join the line now.
    """
    permission_classes = [IsStaffOrRegistrationDesk]

    def post(self, request, pk):
        tx = get_object_or_404(CtmsTransaction.objects.select_related('office', 'referral_office'), pk=pk,
                               referral_office__in=walkin_offices(request.user))
        try:
            new_tx = services.receive_referral(tx, actor=request.user)
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_409_CONFLICT)
        _log_referral_arrival(request, tx, new_tx, actor=request.user)
        return Response(StaffTransactionSerializer(new_tx).data, status=status.HTTP_201_CREATED)


class StaffTransferRecipientsView(APIView):
    """Personnel in the transaction's office who can take over the client."""
    permission_classes = [IsStaffUser]

    def get(self, request, pk):
        tx = get_object_or_404(CtmsTransaction, pk=pk, office__in=get_staff_offices(request.user))
        busy_ids = set(CtmsTransaction.objects.filter(
            office=tx.office, status=CtmsTransaction.STATUS_SERVING
        ).values_list('assigned_to_id', flat=True))

        results = []
        for u in services.transfer_recipients(tx.office, exclude_users=[request.user, tx.assigned_to]):
            profile = getattr(u, 'dole_personnel', None)
            window = getattr(u, 'occupied_window', None)
            at_window = window if window and window.office_id == tx.office_id and window.is_active else None
            results.append({
                "id": u.id,
                "name": services.personnel_display_name(u),
                "username": u.username,
                "position": profile.position if profile else '',
                "window": at_window.name if at_window else None,
                "is_serving": u.id in busy_ids,
            })
        return Response(results)


class StaffTransactionHistoryView(APIView):
    """Immutable assignment history of one transaction."""
    permission_classes = [IsStaffUser]

    def get(self, request, pk):
        tx = get_object_or_404(CtmsTransaction, pk=pk, office__in=get_staff_offices(request.user))
        events = CtmsAssignmentHistory.objects.filter(transaction=tx).order_by('created_at', 'id')
        return Response({
            "transaction": StaffTransactionSerializer(tx).data,
            "events": [{
                "id": e.id,
                "event": e.event,
                "event_label": e.get_event_display(),
                "from_status": e.from_status,
                "to_status": e.to_status,
                "from_user_name": e.from_user_name,
                "to_user_name": e.to_user_name,
                "from_counter_name": e.from_counter_name,
                "to_counter_name": e.to_counter_name,
                "actor_name": e.actor_name,
                "reason": e.reason,
                "created_at": e.created_at,
            } for e in events],
        })


class StaffTransactionsListView(APIView):
    permission_classes = [IsStaffUser]

    def get(self, request):
        allowed_offices = admin_scope_offices(request.user)
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

        date_from = _query_date(request, 'date_from')
        if date_from:
            qs = qs.filter(queue_date__gte=date_from)

        date_to = _query_date(request, 'date_to')
        if date_to:
            qs = qs.filter(queue_date__lte=date_to)

        q = (request.query_params.get('q') or '').strip()
        if q:
            # Same fields the Transactions page searches, so server and page agree
            qs = qs.filter(
                models.Q(transaction_no__icontains=q) |
                models.Q(queue_no__icontains=q) |
                models.Q(client_name__icontains=q) |
                models.Q(group_member_names__icontains=q) |
                models.Q(assigned_personnel__icontains=q) |
                models.Q(service__name__icontains=q) |
                models.Q(service__division__name__icontains=q) |
                models.Q(counter__name__icontains=q) |
                models.Q(claim_code__icontains=q)
            )

        limit = _query_int(request, 'limit', default=100, minimum=1, maximum=1000)
        qs = _surveyed_and_notes(qs.order_by('-checked_in_at'))[:limit]

        return Response(StaffTransactionSerializer(qs, many=True).data)


class StaffReportsSummaryView(APIView):
    permission_classes = [IsRegionalAdmin]

    def get(self, request):
        allowed_offices = admin_scope_offices(request.user)
        if not allowed_offices.exists():
            return Response({"detail": "Forbidden: No office assigned to your account."}, status=status.HTTP_403_FORBIDDEN)

        office_id = request.query_params.get('office')
        if office_id:
            if not allowed_offices.filter(pk=office_id).exists():
                return Response({"detail": "Forbidden: You are not assigned to this office."}, status=status.HTTP_403_FORBIDDEN)
            qs = CtmsTransaction.objects.filter(office_id=office_id)
        else:
            qs = CtmsTransaction.objects.filter(office__in=allowed_offices)

        date_from = _query_date(request, 'date_from')
        if date_from:
            qs = qs.filter(queue_date__gte=date_from)

        date_to = _query_date(request, 'date_to')
        if date_to:
            qs = qs.filter(queue_date__lte=date_to)

        total_checked_in = qs.count()
        total_done = qs.filter(status=CtmsTransaction.STATUS_DONE).count()
        total_waiting = qs.filter(status=CtmsTransaction.STATUS_WAITING).count()
        total_serving = qs.filter(status=CtmsTransaction.STATUS_SERVING).count()
        total_no_show = qs.filter(status=CtmsTransaction.STATUS_NO_SHOW).count()
        total_cancelled = qs.filter(status=CtmsTransaction.STATUS_CANCELLED).count()
        referred_out = qs.filter(status=CtmsTransaction.STATUS_REFERRED)
        total_referred_out = referred_out.count()
        # Sent away, never arrived, and the referral has lapsed
        total_referred_not_arrived = referred_out.filter(
            referred_to__isnull=True, referral_closed_at__isnull=True,
            closed_at__lt=timezone.now() - services.REFERRAL_VALID_FOR).count()
        total_referred_in = qs.filter(referred_from__isnull=False).count()

        # Avg wait time: check-in to the FIRST call (started_at). called_at is moved by every
        # recall, resume and reassignment, so using it counted hours of service as "waiting".
        first_calls = qs.filter(models.Q(started_at__isnull=False) | models.Q(called_at__isnull=False)) \
            .values_list('checked_in_at', 'started_at', 'called_at')
        wait_times = [
            ((started or called) - checked_in).total_seconds() / 60.0
            for checked_in, started, called in first_calls
            if checked_in and (started or called) and (started or called) >= checked_in
        ]
        avg_wait_min = round(sum(wait_times) / len(wait_times), 1) if wait_times else 0

        # Avg service time (done_at - (started_at or called_at) in minutes)
        done_txs = qs.filter(status=CtmsTransaction.STATUS_DONE, done_at__isnull=False) \
            .values_list('done_at', 'started_at', 'called_at')
        service_times = [
            (done - (started or called)).total_seconds() / 60.0
            for done, started, called in done_txs
            if done and (started or called)
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
            "total_referred_out": total_referred_out,
            "total_referred_in": total_referred_in,
            "total_referred_not_arrived": total_referred_not_arrived,
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


def qr_config_payload(office, config):
    payload = {
        "office_id": office.id,
        "office_name": office.name,
        "is_qr_enabled": config.is_qr_enabled,
        "disabled_message": config.disabled_message,
        "disabled_at": config.disabled_at.isoformat() if config.disabled_at else None,
        "disabled_by_username": config.disabled_by.username if config.disabled_by else None,
        "updated_at": config.updated_at.isoformat() if config.updated_at else None,
        "requires_office_code": config.requires_office_code,
        "office_code": None,
        "office_code_valid_until": None,
        "display_key": services.get_display_key(config),
    }
    if config.requires_office_code:
        payload["office_code"] = services.get_or_rotate_office_code(config)
        payload["office_code_valid_until"] = (config.office_code_period + services.OFFICE_CODE_PERIOD).isoformat()
    return payload


class StaffQrConfigView(APIView):
    permission_classes = [IsStaffUser]

    def get(self, request):
        office_id = request.GET.get('office')
        if not office_id:
            return Response({"detail": "Office ID required."}, status=status.HTTP_400_BAD_REQUEST)

        allowed_offices = get_staff_offices(request.user)
        if not allowed_offices.filter(pk=office_id).exists() and not request.user.is_superuser:
            return Response({"detail": "Forbidden: You are not assigned to this office."}, status=status.HTTP_403_FORBIDDEN)

        office = get_object_or_404(CsmOffice, pk=office_id)
        config, _ = CtmsOfficeQrConfig.objects.get_or_create(office=office)

        return Response(qr_config_payload(office, config))

    def post(self, request):
        office_id = request.data.get('office_id') or request.data.get('office')
        if not office_id:
            return Response({"detail": "Office ID required."}, status=status.HTTP_400_BAD_REQUEST)

        allowed_offices = get_staff_offices(request.user)
        if not allowed_offices.filter(pk=office_id).exists() and not request.user.is_superuser:
            return Response({"detail": "Forbidden: You are not assigned to this office."}, status=status.HTTP_403_FORBIDDEN)

        office = get_object_or_404(CsmOffice, pk=office_id)
        config, _ = CtmsOfficeQrConfig.objects.get_or_create(office=office)

        is_qr_enabled = request.data.get('is_qr_enabled')
        if is_qr_enabled is None:
            is_qr_enabled = not config.is_qr_enabled
        else:
            is_qr_enabled = bool(is_qr_enabled)

        config.is_qr_enabled = is_qr_enabled
        if 'disabled_message' in request.data and str(request.data['disabled_message']).strip():
            config.disabled_message = str(request.data['disabled_message']).strip()

        if not is_qr_enabled:
            config.disabled_at = timezone.now()
            config.disabled_by = request.user
        else:
            config.disabled_at = None
            config.disabled_by = None

        config.save()

        action_name = "ENABLE_QR" if is_qr_enabled else "DISABLE_QR"
        desc = (
            f"Enabled client QR registration for {office.name}"
            if is_qr_enabled
            else f"Disabled client QR registration for {office.name} (beyond office hours)"
        )
        log_audit_event(
            action=action_name,
            category=CtmsAuditLog.CATEGORY_CONFIG,
            actor=request.user,
            request=request,
            target_type="CtmsOfficeQrConfig",
            target_id=str(config.id),
            target_repr=f"QR Config for {office.name}",
            office=office,
            description=desc,
            details={
                "office_id": office.id,
                "office_name": office.name,
                "is_qr_enabled": is_qr_enabled,
            }
        )

        return Response({
            **qr_config_payload(office, config),
            "detail": f"QR registration has been {'enabled' if is_qr_enabled else 'disabled'} for {office.name}.",
        })


def _truthy(value):
    return value in (True, 'true', 'True', '1', 1)


class StaffOfficeCodeView(APIView):
    """
    Hourly in-office check-in code settings for one office:
      - requires_office_code: turns the requirement on or off
      - regenerate: replaces the current code now (e.g. it was shared outside the office)
      - regenerate_display_key: issues a new TV link (old TV links stop showing the code)
    """
    permission_classes = [IsStaffUser]

    def post(self, request):
        office_id = request.data.get('office_id') or request.data.get('office')
        if not office_id:
            return Response({"detail": "Office ID required."}, status=status.HTTP_400_BAD_REQUEST)

        allowed_offices = get_staff_offices(request.user)
        if not allowed_offices.filter(pk=office_id).exists() and not request.user.is_superuser:
            return Response({"detail": "Forbidden: You are not assigned to this office."}, status=status.HTTP_403_FORBIDDEN)

        office = get_object_or_404(CsmOffice, pk=office_id)
        config, _ = CtmsOfficeQrConfig.objects.get_or_create(office=office)

        changes = []
        if 'requires_office_code' in request.data:
            required = _truthy(request.data.get('requires_office_code'))
            if required != config.requires_office_code:
                config.requires_office_code = required
                config.save(update_fields=['requires_office_code', 'updated_at'])
                changes.append("ENABLE_OFFICE_CODE" if required else "DISABLE_OFFICE_CODE")
        if _truthy(request.data.get('regenerate')):
            services.get_or_rotate_office_code(config, force=True)
            changes.append("REGENERATE_OFFICE_CODE")
        if _truthy(request.data.get('regenerate_display_key')):
            services.get_display_key(config, force=True)
            changes.append("REGENERATE_DISPLAY_KEY")

        descriptions = {
            "ENABLE_OFFICE_CODE": f"Required the hourly check-in code for {office.name}",
            "DISABLE_OFFICE_CODE": f"Stopped requiring the hourly check-in code for {office.name}",
            "REGENERATE_OFFICE_CODE": f"Generated a new check-in code for {office.name}",
            "REGENERATE_DISPLAY_KEY": f"Issued a new TV display link for {office.name}",
        }
        for action_name in changes:
            # The code itself is never written to the audit log.
            log_audit_event(
                action=action_name,
                category=CtmsAuditLog.CATEGORY_CONFIG,
                actor=request.user,
                request=request,
                target_type="CtmsOfficeQrConfig",
                target_id=str(config.id),
                target_repr=f"QR Config for {office.name}",
                office=office,
                description=descriptions[action_name],
                details={"office_id": office.id, "office_name": office.name},
            )

        return Response(qr_config_payload(office, config))


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

        # Handle uploaded video file (real video files only; never HTML, SVG, scripts...)
        if 'video_file' in request.FILES:
            upload_error = video_upload_error(request.FILES['video_file'])
            if upload_error:
                return Response({"detail": upload_error}, status=status.HTTP_400_BAD_REQUEST)
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

class CtmsCounterViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only window listing; windows are managed through /staff/windows/."""
    serializer_class = CtmsCounterSerializer
    permission_classes = [IsStaffUser]

    def get_queryset(self):
        allowed_offices = get_staff_offices(self.request.user)
        return CtmsCounter.objects.filter(office__in=allowed_offices, archived_at__isnull=True)


class StaffWindowViewSet(viewsets.ViewSet):
    """
    Office-scoped service windows. Any staff member of an office may manage that
    office's windows and take or release a window there.
    """
    permission_classes = [IsStaffUser]

    def _allowed_offices(self):
        return get_staff_offices(self.request.user)

    def _get_window(self, pk):
        window = CtmsCounter.objects.select_related('office', 'assigned_user').filter(
            pk=pk, office__in=self._allowed_offices()
        ).first()
        if not window:
            raise Http404("Window not found.")
        return window

    def _serialize(self, windows, many=True):
        window_list = list(windows) if many else [windows]
        current = {}
        busy = CtmsTransaction.objects.filter(
            counter__in=window_list, status__in=services.WINDOW_BUSY_STATUSES
        ).select_related('service').order_by('called_at')
        for tx in busy:
            current[tx.counter_id] = tx
        ser = WindowSerializer(window_list if many else windows, many=many,
                               context={'request': self.request, 'current_by_window': current})
        return ser.data

    def _audit(self, action, window, description, details=None):
        log_audit_event(
            action=action,
            category=CtmsAuditLog.CATEGORY_CONFIG,
            request=self.request,
            target_type='Window',
            target_id=window.id,
            target_repr=f"{window.name} ({window.office.code})",
            office=window.office,
            description=description,
            details=details or {},
        )

    def list(self, request):
        offices = self._allowed_offices()
        office_id = request.query_params.get('office')
        if office_id:
            offices = offices.filter(pk=office_id)
            if not offices.exists():
                return Response({"detail": "You are not assigned to this office."}, status=status.HTTP_403_FORBIDDEN)

        include_archived = request.query_params.get('include_archived') in ('1', 'true')
        windows = []
        for office in offices:
            windows.extend(services.office_windows(office, include_archived=include_archived))

        my_window = CtmsCounter.objects.filter(assigned_user=request.user).select_related('office').first()
        return Response({
            "windows": self._serialize(windows),
            "my_window": {"id": my_window.id, "name": my_window.name, "office": my_window.office_id,
                          "office_name": my_window.office.name} if my_window else None,
        })

    def create(self, request):
        office = self._allowed_offices().filter(pk=request.data.get('office')).first()
        if not office:
            return Response({"detail": "Choose an office you are assigned to."}, status=status.HTTP_403_FORBIDDEN)
        try:
            window = services.create_window(office, request.data.get('name'), request.data.get('description', ''))
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        self._audit('WINDOW_CREATE', window, f"Created window '{window.name}' at {office.name}.")
        return Response(self._serialize(window, many=False), status=status.HTTP_201_CREATED)

    def partial_update(self, request, pk=None):
        window = self._get_window(pk)
        changes = {k: request.data[k] for k in ('name', 'description', 'sort_order', 'is_active') if k in request.data}
        try:
            window = services.update_window(window, **changes)
        except (ValueError, TypeError) as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        self._audit('WINDOW_UPDATE', window, f"Updated window '{window.name}'.", details=changes)
        return Response(self._serialize(window, many=False))

    def destroy(self, request, pk=None):
        window = self._get_window(pk)
        try:
            window = services.archive_window(window)
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        self._audit('WINDOW_ARCHIVE', window, f"Deleted window '{window.name}'.")
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'], url_path='assign-me')
    def assign_me(self, request, pk=None):
        window = self._get_window(pk)
        try:
            window = services.assign_window(window, request.user)
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_409_CONFLICT)
        self._audit('WINDOW_ASSIGN', window,
                    f"{services.personnel_display_name(request.user)} took {window.name}.")
        return Response(self._serialize(window, many=False))

    @action(detail=True, methods=['post'], url_path='release')
    def release(self, request, pk=None):
        window = self._get_window(pk)
        try:
            previous = services.release_window(window)
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        window.refresh_from_db()
        released_name = services.personnel_display_name(previous)
        if previous.id == request.user.id:
            desc = f"{released_name} released {window.name}."
        else:
            desc = f"{services.personnel_display_name(request.user)} released {released_name} from {window.name}."
        self._audit('WINDOW_RELEASE', window, desc, details={'released_user_id': previous.id})
        return Response(self._serialize(window, many=False))


class CtmsStaffOfficeViewSet(viewsets.ModelViewSet):
    """Raw office assignments. Account offices are normally set through User Management."""
    serializer_class = CtmsStaffOfficeSerializer
    permission_classes = [IsSystemAdmin]
    queryset = CtmsStaffOffice.objects.all().select_related('user', 'office')


ACTIVE_CLIENT_STATUSES = (
    CtmsTransaction.STATUS_SERVING,
    CtmsTransaction.STATUS_TRANSFERRED,
    CtmsTransaction.STATUS_PENDING,
)


class StaffUserAccountViewSet(viewsets.ViewSet):
    """
    Unified User Management: each staff account is created and edited together
    with its personnel profile (name, personnel ID, office, position, role).
    Regional administrators only; the system admin account is not listed.
    TV Display accounts are created, listed and managed by the system admin only.
    """
    permission_classes = [IsRegionalAdmin]

    # ---------------------------------------------------------------- helpers
    def _queryset(self):
        is_tv = models.Q(dole_personnel__role__in=DolePersonnel.NON_STAFF_ROLES)
        qs = (User.objects.filter(models.Q(is_staff=True) | is_tv)
              .select_related('dole_personnel', 'dole_personnel__office', 'occupied_window')
              .prefetch_related('staff_offices__office'))
        if not self.request.user.is_superuser:
            qs = qs.filter(is_superuser=False).exclude(is_tv)
        return qs

    def _get(self, pk):
        user = self._queryset().filter(pk=pk).first()
        if not user:
            raise Http404("Account not found.")
        return user

    def _out(self, user):
        user = self._queryset().get(pk=user.pk)
        return CtmsUserAccountSerializer(user).data

    def _audit(self, action, user, description, office=None, details=None):
        log_audit_event(
            action=action,
            category=CtmsAuditLog.CATEGORY_USER,
            actor=self.request.user,
            request=self.request,
            target_type='User',
            target_id=user.id,
            target_repr=f"User '{user.username}'",
            office=office,
            description=description,
            details=details or {},
        )

    @staticmethod
    def _clean(data, key):
        return str(data.get(key) or '').strip()

    def _validate_password(self, data, required):
        # Not trimmed: sign-in compares the password exactly as typed
        password = str(data.get('password') or '')
        confirm = str(data.get('confirm_password') or '')
        if not password:
            if required:
                raise ValueError("Password is required.")
            return None
        if len(password) < 6:
            raise ValueError("Password must be at least 6 characters long.")
        if 'confirm_password' in data and confirm != password:
            raise ValueError("Password and confirmation do not match.")
        return password

    def _resolve_office(self, data):
        office = CsmOffice.objects.filter(pk=data.get('office'), is_active=True).first()
        if not office:
            raise ValueError("Choose the account's office.")
        return office

    def _resolve_role(self, data, office, current=None):
        role = self._clean(data, 'role').upper() or current or DolePersonnel.ROLE_PERSONNEL
        if role not in (DolePersonnel.ROLE_PERSONNEL, DolePersonnel.ROLE_ADMIN) + DolePersonnel.NON_STAFF_ROLES:
            raise ValueError("Role must be Personnel, Administrator, TV Display or Registration Desk.")
        if role == DolePersonnel.ROLE_ADMIN and office_type(office) != 'REGIONAL':
            raise ValueError("Administrator role is only available for regional office accounts.")
        kind = dict(DolePersonnel.ROLE_CHOICES).get(role, role)
        if role in DolePersonnel.NON_STAFF_ROLES and not self.request.user.is_superuser:
            raise ValueError(f"Only the system administrator can create {kind} accounts.")
        # TV, desk and staff sign-ins differ in what they can reach: no switching between them
        single_purpose = (DolePersonnel.ROLE_DISPLAY, DolePersonnel.ROLE_REGISTRAR)
        if current and current != role and (current in single_purpose or role in single_purpose):
            raise ValueError(f"A {dict(DolePersonnel.ROLE_CHOICES).get(current, current)} account can't be changed "
                             f"to {kind}. Create a new account instead.")
        return role

    def _active_clients(self, user):
        return CtmsTransaction.objects.filter(assigned_to=user, status__in=ACTIVE_CLIENT_STATUSES).count()

    def _release_window(self, user):
        CtmsCounter.objects.filter(assigned_user=user).update(assigned_user=None, assigned_at=None)

    # ---------------------------------------------------------------- endpoints
    def list(self, request):
        qs = self._queryset()
        office_id = request.query_params.get('office')
        if office_id:
            qs = qs.filter(models.Q(dole_personnel__office_id=office_id) | models.Q(staff_offices__office_id=office_id))
        role = (request.query_params.get('role') or '').upper()
        if role in (DolePersonnel.ROLE_PERSONNEL, DolePersonnel.ROLE_ADMIN) + DolePersonnel.NON_STAFF_ROLES:
            qs = qs.filter(dole_personnel__role=role)
        status_param = request.query_params.get('status')
        if status_param in ('active', 'inactive'):
            qs = qs.filter(is_active=(status_param == 'active'))
        search = (request.query_params.get('search') or '').strip()
        if search:
            qs = qs.filter(
                models.Q(username__icontains=search) | models.Q(first_name__icontains=search) |
                models.Q(last_name__icontains=search) | models.Q(email__icontains=search) |
                models.Q(dole_personnel__employee_id__icontains=search) |
                models.Q(dole_personnel__position__icontains=search)
            )
        qs = qs.distinct().order_by('dole_personnel__office__name', 'last_name', 'first_name', 'username')
        return Response(CtmsUserAccountSerializer(qs, many=True).data)

    def retrieve(self, request, pk=None):
        return Response(CtmsUserAccountSerializer(self._get(pk)).data)

    @transaction.atomic
    def create(self, request):
        data = request.data
        try:
            username = self._clean(data, 'username')
            if not username:
                raise ValueError("Username is required.")
            if User.objects.filter(username__iexact=username).exists():
                raise ValueError(f"The username '{username}' is already taken.")
            password = self._validate_password(data, required=True)
            office = self._resolve_office(data)
            role = self._resolve_role(data, office)
            is_tv = role == DolePersonnel.ROLE_DISPLAY
            single_purpose = role in DolePersonnel.NON_STAFF_ROLES
            first_name, last_name = self._clean(data, 'first_name'), self._clean(data, 'last_name')
            if single_purpose:  # names are optional for a TV or desk sign-in
                default_first = 'TV Display' if is_tv else 'Registration Desk'
                first_name, last_name = first_name or default_first, last_name or office.name[:100]
            if not first_name or not last_name:
                raise ValueError("First and last name are required.")
            employee_id = self._clean(data, 'employee_id') or username
            if DolePersonnel.objects.filter(employee_id__iexact=employee_id).exists():
                raise ValueError(f"Personnel ID '{employee_id}' is already used by another account.")
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        # A TV or desk account is not staff and has no office assignment, so it never appears
        # among personnel (windows, transfers, reports) and every staff endpoint refuses it.
        user = User.objects.create_user(
            username=username, password=password, email=self._clean(data, 'email'),
            first_name=first_name[:150], last_name=last_name[:150], is_staff=not single_purpose, is_active=True,
        )
        if not single_purpose:
            CtmsStaffOffice.objects.create(user=user, office=office)
        DolePersonnel.objects.create(
            user=user, employee_id=employee_id, first_name=first_name,
            middle_name=self._clean(data, 'middle_name'), last_name=last_name,
            position='' if single_purpose else self._clean(data, 'position'), office=office, role=role,
            is_active=True, must_change_password=not is_tv,  # nobody types a new password on a TV
        )
        kind = dict(DolePersonnel.ROLE_CHOICES).get(role, role.title())
        self._audit('USER_CREATE', user, f"Created account '{user.username}' ({kind}, {office.name})", office=office)
        return Response(self._out(user), status=status.HTTP_201_CREATED)

    def partial_update(self, request, pk=None):
        return self._update(self._get(pk), request.data)

    update = partial_update

    @transaction.atomic
    def _update(self, user, data):
        request = self.request
        profile = getattr(user, 'dole_personnel', None)
        changes = {}
        try:
            current_office = profile.office if profile else None
            office = self._resolve_office(data) if 'office' in data else current_office
            if not office:
                office = self._resolve_office(data)

            if office != current_office and current_office is not None:
                active = self._active_clients(user)
                if active:
                    raise ValueError(f"{user.username} still has {active} active client(s). Reassign them before changing office.")
                changes['office'] = office.name

            role = self._resolve_role(data, office, current=profile.role if profile else None)
            if user.pk == request.user.pk and role != (profile.role if profile else role) and not request.user.is_superuser:
                raise ValueError("You cannot change your own role.")

            if 'is_active' in data and not bool(data['is_active']) and user.is_active:
                if user.pk == request.user.pk:
                    raise ValueError("You cannot deactivate your own account.")
                active = self._active_clients(user)
                if active:
                    raise ValueError(f"{user.username} still has {active} active client(s). Reassign them before deactivating the account.")

            password = self._validate_password(data, required=False)

            if 'employee_id' in data:
                employee_id = self._clean(data, 'employee_id') or user.username
                clash = DolePersonnel.objects.filter(employee_id__iexact=employee_id)
                if profile:
                    clash = clash.exclude(pk=profile.pk)
                if clash.exists():
                    raise ValueError(f"Personnel ID '{employee_id}' is already used by another account.")
            if 'first_name' in data and not self._clean(data, 'first_name'):
                raise ValueError("First name cannot be empty.")
            if 'last_name' in data and not self._clean(data, 'last_name'):
                raise ValueError("Last name cannot be empty.")
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        # Account
        for field in ('first_name', 'last_name', 'email'):
            if field in data:
                setattr(user, field, self._clean(data, field)[:150])
        if 'is_active' in data:
            user.is_active = bool(data['is_active'])
            if not user.is_active:
                self._release_window(user)
            changes['is_active'] = user.is_active
        if password:
            user.set_password(password)
            changes['password'] = 'reset'
        user.save()
        if password or not user.is_active:
            # A new password or a disabled account must not leave other sign-ins working
            end_all_sessions(user)

        # Office assignment (single office per account); TV and desk accounts have none
        is_tv = role == DolePersonnel.ROLE_DISPLAY
        if role not in DolePersonnel.NON_STAFF_ROLES and ('office' in changes or not CtmsStaffOffice.objects.filter(user=user).exists()):
            CtmsStaffOffice.objects.filter(user=user).exclude(office=office).delete()
            CtmsStaffOffice.objects.get_or_create(user=user, office=office)
            CtmsCounter.objects.filter(assigned_user=user).exclude(office=office).update(assigned_user=None, assigned_at=None)

        # Personnel profile
        if not profile:
            profile = DolePersonnel(user=user, employee_id=user.username, first_name=user.first_name or user.username,
                                    last_name=user.last_name, office=office)
        profile.first_name = user.first_name or profile.first_name
        profile.last_name = user.last_name
        if 'middle_name' in data:
            profile.middle_name = self._clean(data, 'middle_name')
        if 'employee_id' in data:
            profile.employee_id = self._clean(data, 'employee_id') or user.username
        if 'position' in data:
            profile.position = self._clean(data, 'position')
        if profile.role != role:
            changes['role'] = role
        profile.role = role
        profile.office = office
        profile.is_active = user.is_active
        if password and not is_tv:
            profile.must_change_password = True
        profile.save()

        self._audit('USER_UPDATE', user, f"Updated account '{user.username}'", office=office, details=changes)
        return Response(self._out(user))

    @transaction.atomic
    def destroy(self, request, pk=None):
        user = self._get(pk)
        if user.pk == request.user.pk:
            return Response({"detail": "You cannot delete your own account."}, status=status.HTTP_400_BAD_REQUEST)
        has_history = (
            CtmsTransaction.objects.filter(models.Q(assigned_to=user) | models.Q(served_by=user)).exists()
            or CtmsAssignmentHistory.objects.filter(
                models.Q(from_user=user) | models.Q(to_user=user) | models.Q(actor=user)).exists()
        )
        if has_history:
            return Response(
                {"detail": f"{user.username} has handled transactions, so the account is kept for history. Deactivate it instead."},
                status=status.HTTP_409_CONFLICT,
            )
        username, uid = user.username, user.id
        DolePersonnel.objects.filter(user=user).delete()
        user.delete()
        log_audit_event(
            action='USER_DELETE', category=CtmsAuditLog.CATEGORY_USER, actor=request.user, request=request,
            target_type='User', target_id=uid, target_repr=f"User '{username}'",
            description=f"Deleted account '{username}'",
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'], url_path='reset-password')
    @transaction.atomic
    def reset_password(self, request, pk=None):
        user = self._get(pk)
        try:
            password = self._validate_password(request.data, required=True)
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        user.set_password(password)
        user.save()
        end_all_sessions(user)  # whoever had the old password is signed out everywhere
        if is_display_account(user):
            self._audit('USER_PASSWORD_RESET', user, f"Reset password for '{user.username}'")
            return Response({"status": "success", "message": f"New password set for {user.username}. Sign in on the TV with it."})
        DolePersonnel.objects.filter(user=user).update(must_change_password=True)
        self._audit('USER_PASSWORD_RESET', user, f"Reset password for '{user.username}'")
        return Response({"status": "success", "message": f"Temporary password set for {user.username}. They must change it at next login."})

    @action(detail=True, methods=['post'], url_path='toggle-active')
    def toggle_active(self, request, pk=None):
        user = self._get(pk)
        return self._update(user, {'is_active': not user.is_active})


class StaffChangePasswordView(APIView):
    """
    Allows authenticated staff to change their temporary password.
    Clears must_change_password flag upon successful change.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        user = request.user
        # Not trimmed: sign-in compares the password exactly as typed
        current_password = str(request.data.get('current_password') or '')
        new_password = str(request.data.get('new_password') or '')
        confirm_password = str(request.data.get('confirm_password') or '')

        # The current password is always required, so an unattended signed-in browser
        # can't be used to change it
        if not current_password or not user.check_password(current_password):
            return Response({"detail": "Current password is incorrect."}, status=status.HTTP_400_BAD_REQUEST)

        if not new_password.strip():
            return Response({"detail": "New password cannot be empty."}, status=status.HTTP_400_BAD_REQUEST)

        if len(new_password) < 6:
            return Response({"detail": "Password must be at least 6 characters long."}, status=status.HTTP_400_BAD_REQUEST)

        if confirm_password and new_password != confirm_password:
            return Response({"detail": "New passwords do not match."}, status=status.HTTP_400_BAD_REQUEST)

        # Disallow setting new password to the exact same temporary password / employee_id
        if user.check_password(new_password):
            return Response({"detail": "New password cannot be the same as your current temporary password."}, status=status.HTTP_400_BAD_REQUEST)

        user.set_password(new_password)
        user.save()

        DolePersonnel.objects.filter(user=user).update(must_change_password=False)

        # Sign out every other browser, and give this one a fresh sign-in (keeping "Remember me")
        end_all_sessions(user)
        refresh = RefreshToken.for_user(user)
        try:
            if RefreshToken(str(request.data.get('refresh') or ''), verify=False).get('remember'):
                remember_refresh_token(refresh)
        except Exception:
            pass  # no or unreadable current token: a normal-length sign-in

        return Response({
            "status": "success",
            "message": "Password updated successfully. You can now access the staff portal.",
            "must_change_password": False,
            "access": str(refresh.access_token),
            "refresh": str(refresh),
        })


class CsmOfficeListView(APIView):
    """
    Returns list of active DOLE offices for dropdown selection.
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        offices = CsmOffice.objects.filter(is_active=True).order_by('name')
        data = CsmOfficeSerializer(offices, many=True).data
        for row, office in zip(data, offices):
            row['office_type'] = office_type(office)
        return Response(data)


class CsmDivisionListView(APIView):
    """The service divisions (TSSD 1, TSSD 2, IMSD), used to tag and filter services."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        divisions = CsmDivision.objects.filter(name__in=CANONICAL_DIVISIONS).order_by('id')
        return Response(CsmDivisionSerializer(divisions, many=True).data)


class StaffPositionViewSet(viewsets.ModelViewSet):
    """
    CRUD management for DOLE positions catalog.
    Enables administrators to view, add, and remove custom positions dynamically.
    """
    serializer_class = DolePositionSerializer
    queryset = DolePosition.objects.all().order_by('title')

    def get_permissions(self):
        return [IsRegionalAdmin()]

    def list(self, request, *args, **kwargs):
        # Auto-seed standard positions if not yet populated
        if not DolePosition.objects.filter(is_custom=False).exists():
            default_objs = [DolePosition(title=title, is_custom=False) for title in DEFAULT_DOLE_POSITIONS]
            DolePosition.objects.bulk_create(default_objs, ignore_conflicts=True)

            # Also seed any distinct positions already used in DolePersonnel records
            existing_pers_pos = (
                DolePersonnel.objects.exclude(position='')
                .values_list('position', flat=True)
                .distinct()
            )
            custom_objs = [
                DolePosition(title=pos.strip(), is_custom=True)
                for pos in existing_pers_pos
                if pos.strip() and not DolePosition.objects.filter(title__iexact=pos.strip()).exists()
            ]
            if custom_objs:
                DolePosition.objects.bulk_create(custom_objs, ignore_conflicts=True)

        return super().list(request, *args, **kwargs)

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        title = str(request.data.get('title', '')).strip()
        if not title:
            return Response({"detail": "Position title is required."}, status=status.HTTP_400_BAD_REQUEST)
        if len(title) > 150:
            return Response({"detail": "Position title cannot exceed 150 characters."}, status=status.HTTP_400_BAD_REQUEST)

        existing = DolePosition.objects.filter(title__iexact=title).first()
        if existing:
            return Response(
                {
                    "detail": f"Position '{existing.title}' already exists.",
                    "position": DolePositionSerializer(existing).data,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        pos_obj = DolePosition.objects.create(title=title, is_custom=True)

        log_audit_event(
            action='POSITION_CREATE',
            category=CtmsAuditLog.CATEGORY_PERSONNEL,
            actor=request.user,
            request=request,
            target_type='Position',
            target_id=pos_obj.id,
            target_repr=pos_obj.title,
            description=f"Created custom position '{pos_obj.title}'"
        )

        return Response(DolePositionSerializer(pos_obj).data, status=status.HTTP_201_CREATED)

    @transaction.atomic
    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if not instance.is_custom:
            return Response(
                {"detail": "Standard DOLE positions cannot be deleted."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        active_count = DolePersonnel.objects.filter(position__iexact=instance.title).count()
        if active_count > 0:
            return Response(
                {"detail": f"Cannot delete '{instance.title}' because it is assigned to {active_count} personnel record(s)."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        pos_title = instance.title
        instance.delete()

        log_audit_event(
            action='POSITION_DELETE',
            category=CtmsAuditLog.CATEGORY_PERSONNEL,
            actor=request.user,
            request=request,
            target_type='Position',
            target_id=kwargs.get('pk', ''),
            target_repr=pos_title,
            description=f"Deleted custom position '{pos_title}'"
        )

        return Response(status=status.HTTP_204_NO_CONTENT)


class StaffAuditLogListView(APIView):
    """
    Admin-only endpoint for querying, filtering, and inspecting system audit logs.
    """
    permission_classes = [IsRegionalAdmin]

    def get(self, request):
        qs = CtmsAuditLog.objects.all().select_related('actor', 'office')

        # Filters
        category = request.query_params.get('category', '').strip().lower()
        if category and category != 'all':
            qs = qs.filter(category=category)

        action_filter = request.query_params.get('action', '').strip()
        if action_filter and action_filter != 'all':
            qs = qs.filter(action=action_filter)

        office_id = request.query_params.get('office', '').strip()
        if office_id.isdigit():
            qs = qs.filter(office_id=int(office_id))

        search = request.query_params.get('search', '').strip()
        if search:
            qs = qs.filter(
                models.Q(actor_username__icontains=search) |
                models.Q(description__icontains=search) |
                models.Q(target_repr__icontains=search) |
                models.Q(action__icontains=search) |
                models.Q(ip_address__icontains=search)
            )

        date_from = _query_date(request, 'date_from')
        if date_from:
            qs = qs.filter(timestamp__date__gte=date_from)

        date_to = _query_date(request, 'date_to')
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
        page = _query_int(request, 'page', default=1, minimum=1, maximum=1_000_000)
        page_size = _query_int(request, 'page_size', default=25, minimum=10, maximum=100)

        start = (page - 1) * page_size
        end = start + page_size
        paged_qs = qs.order_by('-timestamp')[start:end]

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
    Service catalog (csm_service). Everyone can read it; regional admins may
    change a service's division tag (TSSD 1, TSSD 2, IMSD, or none).
    """
    serializer_class = StaffServiceSerializer
    http_method_names = ['get', 'patch', 'head', 'options']

    def get_permissions(self):
        if self.action in ('list', 'retrieve', 'summary'):
            return [IsStaffUser()]
        return [IsRegionalAdmin()]

    def get_queryset(self):
        qs = CsmService.objects.all().select_related('division').order_by('sort_order', 'name')
        search = (self.request.query_params.get('search') or '').strip()
        if search:
            qs = qs.filter(name__icontains=search)
        division = (self.request.query_params.get('division') or '').strip()
        if division == 'none':
            qs = qs.filter(division__isnull=True)
        elif division.isdigit():
            qs = qs.filter(division_id=division)
        elif division:
            qs = qs.filter(division__name__iexact=division)
        active = (self.request.query_params.get('is_active') or '').lower()
        if active in ('true', '1', 'false', '0'):
            qs = qs.filter(is_active=active in ('true', '1'))
        return qs

    def perform_update(self, serializer):
        before = serializer.instance.division.name if serializer.instance.division_id else 'None'
        service = serializer.save()
        after = service.division.name if service.division_id else 'None'
        log_audit_event(
            action='SERVICE_DIVISION_UPDATE',
            category=CtmsAuditLog.CATEGORY_CONFIG,
            request=self.request,
            target_type='Service',
            target_id=service.id,
            target_repr=service.name,
            description=f"Changed division of '{service.name}' from {before} to {after}",
        )

    @action(detail=False, methods=['get'], url_path='summary')
    def summary(self, request):
        qs = CsmService.objects.all()
        by_division = {name: qs.filter(division__name=name).count() for name in CANONICAL_DIVISIONS}
        return Response({
            'total_services': qs.count(),
            'active_services': qs.filter(is_active=True).count(),
            'untagged_services': qs.filter(division__isnull=True).count(),
            'by_division': by_division,
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




