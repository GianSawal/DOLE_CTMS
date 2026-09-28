import re
from datetime import datetime, time
from django.shortcuts import render, redirect, get_object_or_404
from django.http import HttpResponse, JsonResponse, HttpResponseForbidden
from django.contrib.auth.decorators import login_required, permission_required
from django.contrib import messages
from django.db.models import Count, Avg, F, Q
from django.utils import timezone
from django.conf import settings
from django.views.decorators.http import require_POST, require_GET

from .models import (
    Office,
    Unit,
    Service,
    QueueTicket,
    TicketItem,
    StaffProfile,
)
from .services import (
    issue_ticket,
    call_item,
    start_item,
    complete_item,
    skip_item,
    requeue_item,
)
from .qr import generate_qr_data_uri
from .ratelimit import ratelimit_ip


# PH mobile format regex: 09XXXXXXXXX or +639XXXXXXXXX
PH_MOBILE_RE = re.compile(r'^(09\d{9}|\+639\d{9})$')


# =====================================================================
# PUBLIC CLIENT FLOW (SCOPED BY OFFICE SLUG)
# =====================================================================

def queue_root(request):
    """
    Fallback / landing route for /queue/ and /.
    If QUEUE_DEFAULT_OFFICE_SLUG is configured, redirects to that office's queue.
    Otherwise displays the "Scan QR Code" notice page.
    """
    default_slug = getattr(settings, 'QUEUE_DEFAULT_OFFICE_SLUG', None)
    if default_slug:
        return redirect('queueing:start', office_slug=default_slug)
    return render(request, 'queueing/scan_qr_notice.html')


def client_step1_services(request, office_slug):
    """
    Step 1: Choose services for a specific office.
    Office is determined by the URL slug, with no office picker dropdown.
    """
    office = Office.objects.filter(slug=office_slug, is_active=True).first()
    if not office:
        return render(request, 'queueing/404_office_inactive.html', status=404)

    # Active units and active services for this office only
    units = Unit.objects.filter(
        office=office,
        is_active=True
    ).prefetch_related('services').order_by('sort_order', 'name')

    session_key = f'queue_wizard_{office_slug}'
    selected_service_ids = request.session.get(session_key, {}).get('service_ids', [])

    if request.method == 'POST':
        service_ids = request.POST.getlist('service_ids')

        if not service_ids:
            messages.error(request, "Please select at least one service.")
            return redirect('queueing:start', office_slug=office_slug)

        # Validate that all chosen services strictly belong to this office and are active
        valid_services = Service.objects.filter(
            id__in=service_ids,
            is_active=True,
            unit__office=office
        )
        if valid_services.count() != len(set(service_ids)):
            messages.error(request, "One or more selected services are invalid for this office.")
            return redirect('queueing:start', office_slug=office_slug)

        request.session[session_key] = {
            'office_slug': office_slug,
            'service_ids': [int(sid) for sid in service_ids],
        }
        return redirect('queueing:client_step2', office_slug=office_slug)

    context = {
        'office': office,
        'units': units,
        'selected_service_ids': selected_service_ids,
    }
    return render(request, 'queueing/client_step1_services.html', context)


def client_step2_details(request, office_slug):
    """
    Step 2: Client optional contact details or anonymous choice.
    Data Privacy Act notice and Back button.
    Session is strictly keyed by office slug.
    """
    office = Office.objects.filter(slug=office_slug, is_active=True).first()
    if not office:
        return render(request, 'queueing/404_office_inactive.html', status=404)

    session_key = f'queue_wizard_{office_slug}'
    wizard = request.session.get(session_key)

    if not wizard or wizard.get('office_slug') != office_slug or not wizard.get('service_ids'):
        messages.info(request, "Please select your desired service(s) first.")
        return redirect('queueing:start', office_slug=office_slug)

    services = Service.objects.filter(
        id__in=wizard['service_ids'],
        is_active=True,
        unit__office=office
    ).select_related('unit')

    if not services.exists():
        messages.error(request, "Selected services are no longer available.")
        return redirect('queueing:start', office_slug=office_slug)

    context = {
        'office': office,
        'services': services,
    }
    return render(request, 'queueing/client_step2_details.html', context)


@require_POST
@ratelimit_ip(max_requests=15, window_seconds=60)
def client_submit(request, office_slug):
    """
    Submit client registration: calls issue_ticket(), clears session,
    and redirects to ticket UUID page scoped by office slug.
    """
    office = Office.objects.filter(slug=office_slug, is_active=True).first()
    if not office:
        return render(request, 'queueing/404_office_inactive.html', status=404)

    session_key = f'queue_wizard_{office_slug}'
    wizard = request.session.get(session_key)
    if not wizard or wizard.get('office_slug') != office_slug:
        return redirect('queueing:start', office_slug=office_slug)

    # Validate services belong to this office
    service_ids = wizard.get('service_ids', [])
    services = Service.objects.filter(
        id__in=service_ids,
        is_active=True,
        unit__office=office
    ).select_related('unit')

    if not services.exists() or services.count() != len(set(service_ids)):
        messages.error(request, "Invalid service selection.")
        return redirect('queueing:start', office_slug=office_slug)

    is_anonymous = request.POST.get('is_anonymous') in ['1', 'true', 'on', 'True']
    client_name = request.POST.get('client_name', '').strip()
    email = request.POST.get('email', '').strip()
    contact_number = request.POST.get('contact_number', '').strip()

    if not is_anonymous and contact_number:
        cleaned_contact = contact_number.replace(' ', '').replace('-', '')
        if not PH_MOBILE_RE.match(cleaned_contact):
            messages.error(request, "Invalid contact number. Please enter a valid PH mobile number (e.g. 09171234567).")
            return redirect('queueing:client_step2', office_slug=office_slug)
        contact_number = cleaned_contact

    ticket = issue_ticket(
        office=office,
        services=services,
        source=QueueTicket.Source.SELF_SERVICE,
        client_name=client_name,
        email=email,
        contact_number=contact_number,
        is_anonymous=is_anonymous,
    )

    # Clear the wizard session for this office
    request.session.pop(session_key, None)

    return redirect('queueing:client_ticket', office_slug=office_slug, public_id=ticket.public_id)


def client_ticket(request, office_slug, public_id):
    """
    Public live ticket page scoped by office slug.
    Shows queue number, transaction number, units & directions, live status, and CSM QR code.
    """
    office = Office.objects.filter(slug=office_slug, is_active=True).first()
    if not office:
        return render(request, 'queueing/404_office_inactive.html', status=404)

    ticket = get_object_or_404(
        QueueTicket.objects.select_related('office').prefetch_related('items__unit', 'items__service'),
        office=office,
        public_id=public_id
    )

    csm_base = settings.CSM_SURVEY_BASE_URL.rstrip('/')
    survey_url = f"{csm_base}/survey/t/{ticket.public_id}/"
    qr_data_uri = generate_qr_data_uri(survey_url, box_size=6)

    # Group items by unit for clean display
    items_by_unit = {}
    for item in ticket.items.all():
        unit_key = item.unit.name
        if unit_key not in items_by_unit:
            items_by_unit[unit_key] = {
                'unit': item.unit,
                'directions': item.service.directions,
                'items': [],
            }
        items_by_unit[unit_key]['items'].append(item)

    context = {
        'office': office,
        'ticket': ticket,
        'items_by_unit': items_by_unit,
        'survey_url': survey_url,
        'qr_data_uri': qr_data_uri,
    }
    return render(request, 'queueing/client_ticket.html', context)


def client_ticket_status(request, office_slug, public_id):
    """
    JSON polling endpoint for the client ticket page (polls every 10s).
    """
    office = Office.objects.filter(slug=office_slug, is_active=True).first()
    if not office:
        return JsonResponse({'error': 'Office not found'}, status=404)

    ticket = get_object_or_404(
        QueueTicket.objects.prefetch_related('items__unit', 'items__service'),
        office=office,
        public_id=public_id
    )

    items_data = []
    for item in ticket.items.all():
        status_display = item.get_status_display()
        if item.status == TicketItem.Status.SERVING:
            status_display = f"Now being served at {item.unit.name}"
        elif item.status == TicketItem.Status.CALLED:
            status_display = f"Called at {item.unit.name}"

        items_data.append({
            'service_name': item.service.name,
            'unit_name': item.unit.name,
            'status': item.status,
            'status_display': status_display,
            'directions': item.service.directions,
        })

    return JsonResponse({
        'status': ticket.status,
        'items': items_data,
        'updated_at': ticket.updated_at.strftime('%H:%M:%S'),
    })


@login_required
def office_qr_poster(request, office_id):
    """
    Printable A4 QR Poster for mounting at office entrances or PACD desk.
    Restricted to staff members.
    """
    if not request.user.is_staff:
        return HttpResponseForbidden("Only staff can access the printable QR poster.")

    office = get_object_or_404(Office, id=office_id)
    queue_url = request.build_absolute_uri(office.get_queue_url())
    qr_data_uri = generate_qr_data_uri(queue_url, box_size=10, border=3)

    context = {
        'office': office,
        'queue_url': queue_url,
        'qr_data_uri': qr_data_uri,
    }
    return render(request, 'queueing/admin_qr_poster.html', context)


# =====================================================================
# FRONT DESK (PACD)
# =====================================================================

@login_required
@permission_required('queueing.add_queueticket', raise_exception=True)
def front_desk_queue(request):
    """
    Front desk PACD issuance and today's tickets monitoring.
    Presets office from staff profile.
    """
    staff_profile = getattr(request.user, 'queueing_profile', None)
    today = timezone.localdate()

    if staff_profile and staff_profile.office:
        assigned_office = staff_profile.office
        offices = [assigned_office]
        active_office = assigned_office
    else:
        offices = Office.objects.filter(is_active=True).order_by('sort_order', 'name')
        raw_office_id = request.GET.get('office_id')
        active_office_id = None
        if raw_office_id:
            try:
                active_office_id = int(raw_office_id)
            except (ValueError, TypeError):
                active_office_id = None
        if not active_office_id and offices.exists():
            active_office_id = offices.first().id
        active_office = Office.objects.filter(id=active_office_id).first() if active_office_id else None

    newly_issued_ticket = None

    if request.method == 'POST' and active_office:
        service_ids = request.POST.getlist('service_ids')
        client_name = request.POST.get('client_name', '').strip()
        email = request.POST.get('email', '').strip()
        contact_number = request.POST.get('contact_number', '').strip()
        is_anonymous = request.POST.get('is_anonymous') in ['1', 'true', 'on', 'True']

        if not service_ids:
            messages.error(request, "Please choose at least one service.")
        else:
            services = Service.objects.filter(id__in=service_ids, is_active=True, unit__office=active_office)
            if not services.exists():
                messages.error(request, "Selected services are invalid for this office.")
            else:
                newly_issued_ticket = issue_ticket(
                    office=active_office,
                    services=services,
                    source=QueueTicket.Source.FRONT_DESK,
                    client_name=client_name,
                    email=email,
                    contact_number=contact_number,
                    is_anonymous=is_anonymous,
                    issued_by=request.user,
                )
                messages.success(request, f"Ticket #{newly_issued_ticket.queue_number} issued successfully!")

    # Today's tickets for this office, newest first
    today_tickets = QueueTicket.objects.filter(
        office=active_office,
        service_date=today
    ).prefetch_related('items__unit', 'items__service').order_by('-created_at') if active_office else []

    # Active services for the form
    available_units = Unit.objects.filter(
        office=active_office,
        is_active=True
    ).prefetch_related('services').order_by('sort_order', 'name') if active_office else []

    context = {
        'offices': offices,
        'active_office': active_office,
        'available_units': available_units,
        'today_tickets': today_tickets,
        'newly_issued_ticket': newly_issued_ticket,
    }
    return render(request, 'queueing/front_desk.html', context)


@login_required
@permission_required('queueing.add_queueticket', raise_exception=True)
def front_desk_print(request, public_id):
    """
    Thermal print slip template (58mm / 80mm).
    Automatically triggers window.print().
    """
    ticket = get_object_or_404(
        QueueTicket.objects.select_related('office').prefetch_related('items__unit', 'items__service'),
        public_id=public_id
    )

    csm_base = settings.CSM_SURVEY_BASE_URL.rstrip('/')
    survey_url = f"{csm_base}/survey/t/{ticket.public_id}/"
    qr_data_uri = generate_qr_data_uri(survey_url, box_size=5, fill_color="black")

    items_by_unit = {}
    for item in ticket.items.all():
        unit_key = item.unit.name
        if unit_key not in items_by_unit:
            items_by_unit[unit_key] = {
                'unit': item.unit,
                'directions': item.service.directions,
                'items': [],
            }
        items_by_unit[unit_key]['items'].append(item)

    context = {
        'ticket': ticket,
        'items_by_unit': items_by_unit,
        'qr_data_uri': qr_data_uri,
    }
    return render(request, 'queueing/front_desk_print.html', context)


# =====================================================================
# UNIT QUEUE SCREEN
# =====================================================================

@login_required
@permission_required('queueing.change_ticketitem', raise_exception=True)
def unit_queue(request):
    """
    Unit queue management screen.
    Shows FIFO waiting list, now serving, and done items for this unit.
    """
    staff_profile = getattr(request.user, 'queueing_profile', None)
    today = timezone.localdate()

    if staff_profile and staff_profile.unit:
        assigned_unit = staff_profile.unit
        units = [assigned_unit]
        active_unit = assigned_unit
    else:
        units = Unit.objects.filter(is_active=True).select_related('office').order_by('office__sort_order', 'name')
        raw_unit_id = request.GET.get('unit_id')
        active_unit_id = None
        if raw_unit_id:
            try:
                active_unit_id = int(raw_unit_id)
            except (ValueError, TypeError):
                active_unit_id = None
        if not active_unit_id and units.exists():
            active_unit_id = units.first().id
        active_unit = Unit.objects.filter(id=active_unit_id).first() if active_unit_id else None

    context = _get_unit_queue_context(active_unit, today)
    context['units'] = units
    context['active_unit'] = active_unit
    return render(request, 'queueing/unit_queue.html', context)


@login_required
@permission_required('queueing.change_ticketitem', raise_exception=True)
def unit_queue_partial(request):
    """
    Partial HTML endpoint for 5-second polling on the unit queue screen.
    """
    staff_profile = getattr(request.user, 'queueing_profile', None)
    today = timezone.localdate()

    if staff_profile and staff_profile.unit:
        active_unit = staff_profile.unit
    else:
        raw_unit_id = request.GET.get('unit_id')
        active_unit_id = None
        if raw_unit_id:
            try:
                active_unit_id = int(raw_unit_id)
            except (ValueError, TypeError):
                active_unit_id = None
        active_unit = Unit.objects.filter(id=active_unit_id).first() if active_unit_id else None

    context = _get_unit_queue_context(active_unit, today)
    context['active_unit'] = active_unit
    return render(request, 'queueing/unit_queue_partial.html', context)


def _get_unit_queue_context(unit, today):
    """
    Helper to fetch and categorize today's ticket items for a specific unit.
    Also identifies tickets that are currently active at another unit.
    """
    if not unit:
        return {'serving_items': [], 'waiting_items': [], 'called_items': [], 'completed_items': []}

    items = TicketItem.objects.filter(
        unit=unit,
        ticket__service_date=today
    ).select_related('ticket', 'service', 'served_by').order_by('ticket__created_at')

    # Find tickets that are CALLED or SERVING at ANY unit today to flag collisions
    active_other_items = TicketItem.objects.filter(
        ticket__service_date=today,
        status__in=[TicketItem.Status.CALLED, TicketItem.Status.SERVING]
    ).exclude(unit=unit).select_related('unit')

    # Mapping ticket_id -> active unit name
    other_busy_tickets = {item.ticket_id: item.unit.name for item in active_other_items}

    serving_items = []
    called_items = []
    waiting_items = []
    completed_items = []

    for item in items:
        # Attach collision info for template
        item.busy_at_other_unit = other_busy_tickets.get(item.ticket_id)

        if item.status == TicketItem.Status.SERVING:
            serving_items.append(item)
        elif item.status == TicketItem.Status.CALLED:
            called_items.append(item)
        elif item.status == TicketItem.Status.WAITING:
            waiting_items.append(item)
        elif item.status in [TicketItem.Status.DONE, TicketItem.Status.SKIPPED]:
            completed_items.append(item)

    return {
        'serving_items': serving_items,
        'called_items': called_items,
        'waiting_items': waiting_items,
        'completed_items': completed_items,
    }


@login_required
@permission_required('queueing.change_ticketitem', raise_exception=True)
@require_POST
def unit_action(request, item_id, action):
    """
    POST action endpoint for Unit Staff queue buttons (Call, Start, Done, Skip, Requeue).
    """
    item = get_object_or_404(TicketItem.objects.select_related('ticket', 'unit', 'service'), id=item_id)

    # Permission check: ensure staff belongs to this unit (if staff has assigned unit)
    staff_profile = getattr(request.user, 'queueing_profile', None)
    if staff_profile and staff_profile.unit and staff_profile.unit_id != item.unit_id:
        return HttpResponseForbidden("You are not assigned to this unit.")

    try:
        if action == 'call':
            call_item(item, user=request.user)
            messages.success(request, f"Called Queue #{item.ticket.queue_number} for {item.service.name}.")
        elif action == 'start':
            start_item(item, user=request.user)
            messages.success(request, f"Started serving Queue #{item.ticket.queue_number}.")
        elif action == 'done':
            complete_item(item, user=request.user)
            messages.success(request, f"Marked Queue #{item.ticket.queue_number} as Done.")
        elif action == 'skip':
            skip_item(item, user=request.user)
            messages.warning(request, f"Skipped Queue #{item.ticket.queue_number}.")
        elif action == 'requeue':
            requeue_item(item, user=request.user)
            messages.info(request, f"Returned Queue #{item.ticket.queue_number} to Waiting list.")
        else:
            messages.error(request, "Invalid action requested.")
    except Exception as e:
        messages.error(request, str(e))

    return redirect('queueing:unit_queue')


# =====================================================================
# PCT REPORT
# =====================================================================

@login_required
def pct_report(request):
    """
    Processing Cycle Time (PCT) Compliance Report.
    Filters by date range, office, and unit.
    Calculates tickets served, average wait time, average actual PCT, and % compliance.
    """
    today = timezone.localdate()
    start_date_str = request.GET.get('start_date', str(today))
    end_date_str = request.GET.get('end_date', str(today))
    raw_office_id = request.GET.get('office_id')
    raw_unit_id = request.GET.get('unit_id')

    try:
        start_date = datetime.strptime(start_date_str, '%Y-%m-%d').date()
    except (ValueError, TypeError):
        start_date = today

    try:
        end_date = datetime.strptime(end_date_str, '%Y-%m-%d').date()
    except (ValueError, TypeError):
        end_date = today

    if start_date > end_date:
        start_date, end_date = end_date, start_date

    selected_office_id = None
    if raw_office_id:
        try:
            selected_office_id = int(raw_office_id)
        except (ValueError, TypeError):
            selected_office_id = None

    selected_unit_id = None
    if raw_unit_id:
        try:
            selected_unit_id = int(raw_unit_id)
        except (ValueError, TypeError):
            selected_unit_id = None

    # If both office and unit are specified, ensure unit belongs to the office
    if selected_office_id and selected_unit_id:
        if not Unit.objects.filter(id=selected_unit_id, office_id=selected_office_id).exists():
            selected_unit_id = None

    items_qs = TicketItem.objects.filter(
        ticket__service_date__gte=start_date,
        ticket__service_date__lte=end_date,
    ).select_related('service', 'unit', 'ticket')

    if selected_office_id:
        items_qs = items_qs.filter(unit__office_id=selected_office_id)
    if selected_unit_id:
        items_qs = items_qs.filter(unit_id=selected_unit_id)

    items_list = list(items_qs)

    services_qs = Service.objects.all().select_related('unit__office').order_by(
        'unit__office__sort_order', 'unit__sort_order', 'sort_order', 'name'
    )
    if selected_office_id:
        services_qs = services_qs.filter(unit__office_id=selected_office_id)
    if selected_unit_id:
        services_qs = services_qs.filter(unit_id=selected_unit_id)

    # Compute report metrics per service
    report_rows = []
    total_served_all = 0
    total_within_target_all = 0
    total_skipped_all = 0
    total_wait_seconds_all = 0
    total_wait_count_all = 0
    total_actual_seconds_all = 0
    total_actual_count_all = 0

    for s in services_qs:
        service_items = [item for item in items_list if item.service_id == s.id]
        done_items = [item for item in service_items if item.status == TicketItem.Status.DONE]
        skipped_items = [item for item in service_items if item.status == TicketItem.Status.SKIPPED]

        served_count = len(done_items)
        skipped_count = len(skipped_items)

        # Wait times for served items
        wait_seconds_list = [
            max(0, (item.started_at - item.ticket.created_at).total_seconds())
            for item in done_items if item.started_at
        ]
        avg_wait_minutes = round(sum(wait_seconds_list) / len(wait_seconds_list) / 60, 1) if wait_seconds_list else 0

        # Actual PCT
        actual_seconds_list = [
            max(0, (item.completed_at - item.started_at).total_seconds())
            for item in done_items if item.completed_at and item.started_at
        ]
        avg_actual_minutes = round(sum(actual_seconds_list) / len(actual_seconds_list) / 60, 1) if actual_seconds_list else 0

        # Compliance: actual PCT <= snapshot target
        within_target_count = sum(
            1 for item in done_items
            if item.completed_at and item.started_at and (item.completed_at - item.started_at).total_seconds() <= (item.pct_minutes_snapshot * 60)
        )
        compliance_pct = round((within_target_count / served_count * 100), 1) if served_count > 0 else 0

        total_served_all += served_count
        total_within_target_all += within_target_count
        total_skipped_all += skipped_count
        total_wait_seconds_all += sum(wait_seconds_list)
        total_wait_count_all += len(wait_seconds_list)
        total_actual_seconds_all += sum(actual_seconds_list)
        total_actual_count_all += len(actual_seconds_list)

        if service_items or served_count > 0 or skipped_count > 0:
            report_rows.append({
                'service': s,
                'served_count': served_count,
                'avg_wait_minutes': avg_wait_minutes,
                'avg_actual_minutes': avg_actual_minutes,
                'target_pct': s.pct_minutes,
                'compliance_pct': compliance_pct,
                'skipped_count': skipped_count,
            })

    overall_compliance = round((total_within_target_all / total_served_all * 100), 1) if total_served_all > 0 else 0
    overall_avg_wait = round((total_wait_seconds_all / total_wait_count_all / 60), 1) if total_wait_count_all > 0 else 0
    overall_avg_actual = round((total_actual_seconds_all / total_actual_count_all / 60), 1) if total_actual_count_all > 0 else 0

    offices = Office.objects.filter(is_active=True).order_by('sort_order', 'name')
    units = Unit.objects.filter(is_active=True).select_related('office').order_by('office__sort_order', 'name')

    context = {
        'start_date': start_date.strftime('%Y-%m-%d'),
        'end_date': end_date.strftime('%Y-%m-%d'),
        'selected_office_id': selected_office_id,
        'selected_unit_id': selected_unit_id,
        'offices': offices,
        'units': units,
        'report_rows': report_rows,
        'total_served': total_served_all,
        'overall_compliance': overall_compliance,
        'overall_avg_wait': overall_avg_wait,
        'overall_avg_actual': overall_avg_actual,
        'total_skipped': total_skipped_all,
    }
    return render(request, 'queueing/pct_report.html', context)

