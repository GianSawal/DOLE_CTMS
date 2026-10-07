import secrets
from django.db import models, transaction
from django.utils import timezone
from .models import (
    CsmDivision,
    CsmOffice,
    CsmService,
    CsmResponse,
    CtmsCounter,
    CtmsEmployee,
    CtmsServiceDefaultOfficer,
    CtmsTransaction,
    DolePersonnel,
    generate_claim_code,
    generate_token,
)

SERVICE_DEFAULT_OFFICERS = {
    'tupad': 'CAMILLE SANTOS',
    'spes': 'ARVIE ANGAT',
    'alien employment': 'ADRIANNE MAE DIMALANTA',
    'aep': 'ADRIANNE MAE DIMALANTA',
    'livelihood': 'CAMILLE SANTOS',
    'cshp': 'CHARLIE BARROZO',
    'rule 1020': 'WILSON DAYRIT',
    'sena': 'RAYMOND GONZALES',
    'single entry': 'RAYMOND GONZALES',
    'labor inspection': 'JESSICA TRISHIA GONZALES',
    'general labor': 'ROY OCAMPO',
}

UNIVERSAL_DIVISION_NAMES = {
    'FRONT DESK', 'FRONTDESK',
    'WINDOW 1', 'WINDOW 2', 'WINDOW 3', 'WINDOW 4', 'WINDOW 5',
    'WINDOW 6', 'WINDOW 7', 'WINDOW 8', 'WINDOW 9', 'WINDOW 10',
    'WINDOW1', 'WINDOW2', 'WINDOW3', 'WINDOW4', 'WINDOW5',
    'WINDOW6', 'WINDOW7', 'WINDOW8', 'WINDOW9', 'WINDOW10',
}

def is_universal_division_name(name):
    """
    Returns True if the division or counter name corresponds to a universal queue line
    (Front Desk or Window 1-10) that can access and serve all services across all divisions.
    """
    if not name:
        return False
    clean = str(name).strip().upper()
    norm = clean.replace(' ', '')
    if clean in UNIVERSAL_DIVISION_NAMES or norm in UNIVERSAL_DIVISION_NAMES:
        return True
    if clean.startswith('WINDOW ') or norm.startswith('WINDOW'):
        suffix = norm.replace('WINDOW', '').strip()
        if suffix.isdigit() and 1 <= int(suffix) <= 10:
            return True
    return False


DIVISION_OFFICER_POOLS = {
    'TSSD 2': [
        'CAMILLE SANTOS',
        'ARVIE ANGAT',
        'ADRIANNE MAE DIMALANTA',
        'MARIE ELAINE ADRIANO',
        'ANNA DESIREE BALUYUT',
        'IVAN MOREL BANTOTO',
        'KARISSA BOGNOT',
        'PATRICIA MARIE EDEJER',
    ],
    'TSSD 1': [
        'RAYMOND GONZALES',
        'CHARLIE BARROZO',
        'WILSON DAYRIT',
        'PETER JUSTINE AGUILAR',
        'KURT WILLIAM CHAN',
        'FLOYD ERICSON DE GUZMAN',
        'BRENN JOHN GALANG',
    ],
}

def find_personnel_by_name_or_id(name_or_id, office=None):
    """
    Finds a DolePersonnel or CtmsEmployee record by employee_id, username, or full_name.
    Prioritizes personnel assigned to `office` when specified.
    """
    if not name_or_id:
        return None

    clean_str = str(name_or_id).strip()
    if not clean_str:
        return None

    clean_lower = clean_str.lower()

    # 1. Search in target office first (DolePersonnel)
    if office:
        target_office_id = getattr(office, 'id', office)
        p = DolePersonnel.objects.filter(office_id=target_office_id, employee_id__iexact=clean_str).first()
        if p:
            return p
        for cand in DolePersonnel.objects.filter(office_id=target_office_id).select_related('office').prefetch_related('divisions'):
            c_full = cand.full_name.strip().lower()
            c_simple = f"{cand.first_name} {cand.last_name}".strip().lower()
            if clean_lower in (c_full, c_simple) or c_full in clean_lower:
                return cand

        # Search in target office (CtmsEmployee)
        emp = CtmsEmployee.objects.filter(
            models.Q(office_id=target_office_id) & (
                models.Q(employee_id__iexact=clean_str) |
                models.Q(user__username__iexact=clean_str)
            )
        ).first()
        if emp:
            return emp
        for cand in CtmsEmployee.objects.filter(office_id=target_office_id).select_related('office').prefetch_related('divisions'):
            c_full = cand.full_name.strip().lower()
            c_simple = f"{cand.first_name} {cand.last_name}".strip().lower()
            if clean_lower in (c_full, c_simple) or c_full in clean_lower:
                return cand

    # 2. Search globally across all offices (DolePersonnel)
    p = DolePersonnel.objects.filter(employee_id__iexact=clean_str).select_related('office').first()
    if p:
        return p
    for cand in DolePersonnel.objects.all().select_related('office').prefetch_related('divisions'):
        c_full = cand.full_name.strip().lower()
        c_simple = f"{cand.first_name} {cand.last_name}".strip().lower()
        if clean_lower in (c_full, c_simple) or c_full in clean_lower:
            return cand

    # 3. Search globally across all offices (CtmsEmployee)
    emp = CtmsEmployee.objects.filter(
        models.Q(employee_id__iexact=clean_str) |
        models.Q(user__username__iexact=clean_str)
    ).select_related('office').first()
    if emp:
        return emp
    for cand in CtmsEmployee.objects.all().select_related('office').prefetch_related('divisions'):
        c_full = cand.full_name.strip().lower()
        c_simple = f"{cand.first_name} {cand.last_name}".strip().lower()
        if clean_lower in (c_full, c_simple) or c_full in clean_lower:
            return cand

    return None


def validate_personnel_office_assignment(office, personnel_name_or_id):
    """
    Enforces office restriction:
    Personnel or employees assigned to a specific office should only be eligible
    for queue assignments within that same office.
    Personnel from other offices must not appear in the list of available personnel
    and must not be assignable to queues outside their assigned office.
    """
    if not office or not personnel_name_or_id:
        return True, None

    personnel = find_personnel_by_name_or_id(personnel_name_or_id, office=office)
    if personnel and personnel.office:
        p_office_id = getattr(personnel.office, 'id', personnel.office_id)
        target_office_id = getattr(office, 'id', office)
        if p_office_id != target_office_id:
            p_office_name = getattr(personnel.office, 'name', 'another office')
            target_office_name = getattr(office, 'name', 'this office')
            return False, (
                f"Cannot assign {personnel.full_name}: Personnel is assigned to {p_office_name} "
                f"and cannot be assigned to queues at {target_office_name}."
            )

    return True, None


def get_default_officer_for_service(service, office=None):
    """
    Automatically determines the default officer based on the service selected by the client.
    Strictly filters candidates by the client's registered office:
    Personnel from other offices must not appear as available or default personnel for that queue.
    1. Checks explicitly assigned personnel configured for this specific service belonging to `office`.
    2. Checks database overrides in CtmsServiceDefaultOfficer for this office.
    3. Randomly selects an active, available officer belonging to the service's division within `office`.
    4. Falls back to randomized division officer pools or service keyword mappings ONLY if belonging to `office`
       (or in test/mock environments where no registered personnel exist).
    """
    if not service:
        return None

    # 1. Primary: Check explicitly assigned personnel configured for this specific service
    try:
        if office:
            assigned_qs = service.assigned_personnel.filter(is_active=True, office=office)
        else:
            assigned_qs = service.assigned_personnel.filter(is_active=True)

        assigned_candidates = [p.full_name.strip() for p in assigned_qs]
        if assigned_candidates:
            active_clean = set()
            if office:
                active_officers = CtmsTransaction.objects.filter(
                    office=office,
                    status__in=[
                        CtmsTransaction.STATUS_WAITING,
                        CtmsTransaction.STATUS_SERVING,
                        CtmsTransaction.STATUS_PENDING,
                    ]
                ).exclude(assigned_personnel__isnull=True).exclude(assigned_personnel='').values_list('assigned_personnel', flat=True)
                active_clean = {o.strip().lower() for o in active_officers}
            available = [c for c in assigned_candidates if c.strip().lower() not in active_clean]
            pool = available if available else assigned_candidates
            import random
            return random.choice(pool)
    except Exception:
        pass

    # 2. Database override in CtmsServiceDefaultOfficer (for services without assigned personnel)
    try:
        db_override = None
        if office:
            db_override = CtmsServiceDefaultOfficer.objects.filter(service=service, office=office).first()
            if not db_override:
                cand = CtmsServiceDefaultOfficer.objects.filter(service=service, office__isnull=True).first()
                if cand and cand.officer_name:
                    is_valid, _ = validate_personnel_office_assignment(office, cand.officer_name.strip())
                    if is_valid:
                        db_override = cand
        else:
            db_override = CtmsServiceDefaultOfficer.objects.filter(service=service).first()

        if db_override and db_override.officer_name:
            return db_override.officer_name.strip()
    except Exception:
        pass

    # 3. Random selection from active DolePersonnel in that division
    div = getattr(service, 'division', None)
    if div and div.name:
        div_name = div.name.strip()
        div_clean = div_name.replace(' ', '').upper()
        personnel_qs = DolePersonnel.objects.filter(is_active=True)
        if office:
            personnel_qs = personnel_qs.filter(office=office)

        candidates = []
        for p in personnel_qs.prefetch_related('divisions'):
            p_divs = [d.name.replace(' ', '').upper() for d in p.divisions.all()]
            if div_clean in p_divs or 'ALL' in p_divs or any(is_universal_division_name(d.name) for d in p.divisions.all()):
                candidates.append(p.full_name.strip())

        if candidates:
            # Prioritize available officers (not currently handling an active client)
            active_clean = set()
            if office:
                active_officers = CtmsTransaction.objects.filter(
                    office=office,
                    status__in=[
                        CtmsTransaction.STATUS_WAITING,
                        CtmsTransaction.STATUS_SERVING,
                        CtmsTransaction.STATUS_PENDING,
                    ]
                ).exclude(assigned_personnel__isnull=True).exclude(assigned_personnel='').values_list('assigned_personnel', flat=True)
                active_clean = {o.strip().lower() for o in active_officers}

            available = [c for c in candidates if c.strip().lower() not in active_clean]
            pool = available if available else candidates
            import random
            return random.choice(pool)

        # Division fallback pool
        fallback_pool = DIVISION_OFFICER_POOLS.get(div_name) or DIVISION_OFFICER_POOLS.get(div_clean)
        if fallback_pool:
            if office:
                has_any_personnel = DolePersonnel.objects.filter(is_active=True).exists()
                valid_pool = []
                for officer_name in fallback_pool:
                    is_valid, _ = validate_personnel_office_assignment(office, officer_name)
                    if is_valid:
                        if has_any_personnel:
                            cand_p = find_personnel_by_name_or_id(officer_name, office=office)
                            if cand_p and getattr(cand_p, 'office_id', None) == getattr(office, 'id', office):
                                valid_pool.append(officer_name)
                        else:
                            # Test/mock environments where no DolePersonnel records exist
                            valid_pool.append(officer_name)
                if valid_pool:
                    import random
                    return random.choice(valid_pool)
            else:
                import random
                return random.choice(fallback_pool)

    # 4. Service-specific keyword mapping fallback
    s_name = (getattr(service, 'name', '') or '').lower()
    for kw, officer in SERVICE_DEFAULT_OFFICERS.items():
        if kw in s_name:
            if office:
                is_valid, _ = validate_personnel_office_assignment(office, officer)
                if is_valid:
                    has_any_personnel = DolePersonnel.objects.filter(is_active=True).exists()
                    if has_any_personnel:
                        cand_p = find_personnel_by_name_or_id(officer, office=office)
                        if cand_p and getattr(cand_p, 'office_id', None) == getattr(office, 'id', office):
                            return officer
                    else:
                        return officer
            else:
                return officer

    return None


def create_transaction(office, service, client_name=None, is_priority=False, source='qr', group_member_names=None, assigned_personnel=None):
    """
    Creates a new queue transaction atomically.
    Automatically assigns a default personnel member based on personnel associated with the specific service.
    Generates queue_seq restartable daily per office, transaction_no, queue_no,
    ticket_token, survey_token, and claim_code.
    """
    if not office.is_active:
        raise ValueError("Office is inactive.")
    if not service.is_active:
        raise ValueError("Service is inactive.")

    # Clean up group_member_names: strip whitespace, filter out empty strings
    cleaned_member_names = None
    if group_member_names and isinstance(group_member_names, list):
        cleaned_member_names = [name.strip() for name in group_member_names if name and name.strip()]
        if not cleaned_member_names:
            cleaned_member_names = None

    with transaction.atomic():
        # Lock office row if managed/available
        try:
            CsmOffice.objects.select_for_update().filter(pk=office.pk).first()
        except Exception:
            pass

        now = timezone.now()
        local_date = timezone.localdate(now)
        yymmdd = local_date.strftime('%y%m%d')

        # Find max seq for today in this office
        max_seq = CtmsTransaction.objects.filter(
            office=office,
            queue_date=local_date
        ).aggregate(max_seq=models.Max('queue_seq'))['max_seq'] or 0

        next_seq = max_seq + 1
        tx_no = f"{office.code.strip().upper()}-{yymmdd}-{next_seq:04d}"
        
        # Priority flag formatting
        if is_priority:
            queue_no = f"P-{next_seq:03d}"
        else:
            queue_no = f"{next_seq:03d}"

        # Ensure unique tokens
        ticket_token = generate_token(16)
        survey_token = generate_token(16)
        claim_code = generate_claim_code(4)

        # Automatically assign default personnel member based on the service selected
        if not assigned_personnel:
            assigned_personnel = get_default_officer_for_service(service, office=office)
        else:
            # If explicitly provided, validate eligibility for this office
            is_valid, _ = validate_personnel_office_assignment(office, str(assigned_personnel).strip())
            if not is_valid:
                assigned_personnel = get_default_officer_for_service(service, office=office)

        tx = CtmsTransaction.objects.create(
            transaction_no=tx_no,
            office=office,
            service=service,
            queue_date=local_date,
            queue_seq=next_seq,
            queue_no=queue_no,
            is_priority=bool(is_priority),
            client_name=client_name.strip() if client_name else None,
            group_member_names=cleaned_member_names,
            status=CtmsTransaction.STATUS_WAITING,
            source=source,
            assigned_personnel=assigned_personnel,
            checked_in_at=now,
            ticket_token=ticket_token,
            survey_token=survey_token,
            claim_code=claim_code,
        )

        if tx.assigned_personnel:
            notify_assigned_personnel(tx, is_reassignment=False)

        return tx


def notify_assigned_personnel(tx, is_reassignment=False, previous_officer=None, is_manual_reminder=False, caller_user=None):
    """
    Creates real-time notifications for the personnel member linked to the assigned officer.
    Alerts them with queue number, requested service, and assignment time.
    Returns (True, message) on success or (False, error_message) on failure.
    """
    if not tx or not tx.assigned_personnel:
        return False, "No personnel assigned to this transaction."

    clean = str(tx.assigned_personnel).strip().lower()

    personnel = find_personnel_by_name_or_id(tx.assigned_personnel, office=tx.office)
    if not personnel:
        qs = DolePersonnel.objects.filter(is_active=True).select_related('user')
        if tx.office:
            qs = qs.filter(office=tx.office)
        for p in qs:
            if p.employee_id.strip().lower() == clean or p.full_name.strip().lower() == clean:
                personnel = p
                break

    recipient_user = None
    if personnel and personnel.user:
        recipient_user = personnel.user
    else:
        # Check by username or full name match on User model
        from django.contrib.auth import get_user_model
        User = get_user_model()
        user_match = User.objects.filter(
            models.Q(username__iexact=clean) |
            (models.Q(dole_personnel=personnel) if personnel else models.Q())
        ).first()
        if not user_match:
            parts = clean.split()
            if len(parts) >= 2:
                user_match = User.objects.filter(first_name__iexact=parts[0], last_name__iexact=parts[-1]).first()
        if user_match:
            recipient_user = user_match

    if not recipient_user:
        return False, f"Officer '{tx.assigned_personnel}' does not have a linked user account to receive online notifications."

    service_name = tx.service.name if tx.service else 'Service'

    if is_manual_reminder:
        action_type = 'REMINDER'
        caller_name = (
            f"{caller_user.get_full_name() or caller_user.username}"
            if caller_user and caller_user.is_authenticated
            else "Queue Dispatcher"
        )
        title = f"Queue Reminder: Queue #{tx.queue_no}"
        message = (
            f"Reminder from {caller_name}: Client Queue #{tx.queue_no} ({service_name}) is waiting in your queue."
        )
    elif is_reassignment:
        action_type = 'REASSIGNMENT'
        title = f"Client Reassigned: Queue #{tx.queue_no}"
        message = (
            f"Queue #{tx.queue_no} ({service_name}) was reassigned to you (previously {previous_officer})."
            if previous_officer
            else f"Queue #{tx.queue_no} ({service_name}) was reassigned to you."
        )
    else:
        action_type = 'ASSIGNMENT'
        title = f"New Client Assigned: Queue #{tx.queue_no}"
        message = f"Queue #{tx.queue_no} ({service_name}) was added to your queue."

    try:
        from .models import CtmsNotification
        CtmsNotification.objects.create(
            recipient=recipient_user,
            transaction=tx,
            notification_type=action_type,
            title=title,
            message=message,
            queue_no=tx.queue_no,
            service_name=service_name,
            assigned_at=timezone.now(),
        )
        return True, f"Notification sent to {tx.assigned_personnel} successfully."
    except Exception as e:
        print(f"Warning: Failed to create assignment notification: {e}")
        return False, f"Failed to send notification: {str(e)}"


def assign_personnel_to_transaction(tx, personnel):
    """Staff assigns a designated officer / personnel to a transaction."""
    clean_personnel = (personnel or "").strip()
    if clean_personnel and tx.office:
        valid_off, err_off = validate_personnel_office_assignment(tx.office, clean_personnel)
        if not valid_off:
            raise ValueError(err_off)

    old_officer = tx.assigned_personnel
    tx.assigned_personnel = clean_personnel
    tx.save(update_fields=['assigned_personnel'])
    if tx.assigned_personnel:
        is_reassign = bool(old_officer and old_officer.strip().lower() != tx.assigned_personnel.lower())
        notify_assigned_personnel(tx, is_reassignment=is_reassign, previous_officer=old_officer)
    return tx


def call_next_transaction(office, counter, personnel=None):
    """
    Finds the next waiting client: priority clients first, then FIFO by checked_in_at.
    If counter corresponds to a division, only clients for that division are selected.
    Uses select_for_update(skip_locked=True) to prevent concurrency race conditions.
    """
    with transaction.atomic():
        waiting_qs = CtmsTransaction.objects.select_for_update(skip_locked=True).filter(
            office=office,
            status=CtmsTransaction.STATUS_WAITING
        )

        if counter:
            division = CsmDivision.objects.filter(name=counter.name).first()
            if division and not is_universal_division_name(counter.name):
                waiting_qs = waiting_qs.filter(service__division=division)

        waiting_qs = waiting_qs.order_by('-is_priority', 'checked_in_at')

        tx = waiting_qs.first()
        if not tx:
            return None

        if personnel:
            clean_p = str(personnel).strip()
            if clean_p and office:
                valid_off, err_off = validate_personnel_office_assignment(office, clean_p)
                if not valid_off:
                    raise ValueError(err_off)
            tx.assigned_personnel = clean_p

        if not tx.assigned_personnel:
            raise ValueError(f"Cannot call queue #{tx.queue_no}: A personnel must be assigned before calling.")

        assigned_counter = counter
        # If counter was not specified, automatically match to transaction's division counter
        if not assigned_counter and tx.service and tx.service.division:
            assigned_counter = CtmsCounter.objects.filter(
                office=office,
                name__iexact=tx.service.division.name.strip(),
                is_active=True
            ).first()
        if not assigned_counter:
            assigned_counter = CtmsCounter.objects.filter(office=office, is_active=True).first()

        now = timezone.now()
        tx.status = CtmsTransaction.STATUS_SERVING
        tx.counter = assigned_counter
        tx.called_at = now
        if not tx.started_at:
            tx.started_at = now
        tx.save(update_fields=['status', 'counter', 'called_at', 'started_at', 'assigned_personnel'])
        return tx


def call_specific_transaction(tx, counter=None, personnel=None):
    """Staff calls, recalls, or resumes a specific transaction."""
    if tx.status not in (CtmsTransaction.STATUS_WAITING, CtmsTransaction.STATUS_SERVING, CtmsTransaction.STATUS_PENDING):
        raise ValueError(f"Cannot call a transaction with status '{tx.status}'.")

    if personnel:
        clean_p = str(personnel).strip()
        if clean_p and tx.office:
            valid_off, err_off = validate_personnel_office_assignment(tx.office, clean_p)
            if not valid_off:
                raise ValueError(err_off)
        tx.assigned_personnel = clean_p

    if not tx.assigned_personnel:
        raise ValueError(f"Cannot call queue #{tx.queue_no}: A personnel must be assigned before calling.")

    assigned_counter = counter
    # Route to ticket's division counter if counter was omitted,
    # or if counter belongs to a different division while a matching division counter exists
    if tx.service and tx.service.division:
        div_counter = CtmsCounter.objects.filter(
            office=tx.office,
            name__iexact=tx.service.division.name.strip(),
            is_active=True
        ).first()
        if div_counter:
            if not assigned_counter:
                assigned_counter = div_counter
            elif (
                assigned_counter.name != div_counter.name
                and CsmDivision.objects.filter(name__iexact=assigned_counter.name).exists()
                and not is_universal_division_name(assigned_counter.name)
            ):
                # The passed counter belongs to another division (e.g. IMSD instead of TSSD 1)
                assigned_counter = div_counter

    if not assigned_counter:
        assigned_counter = CtmsCounter.objects.filter(office=tx.office, is_active=True).first()

    now = timezone.now()
    tx.status = CtmsTransaction.STATUS_SERVING
    tx.counter = assigned_counter
    tx.called_at = now
    if not tx.started_at:
        tx.started_at = now
    tx.save(update_fields=['status', 'counter', 'called_at', 'started_at', 'assigned_personnel'])
    return tx


def mark_pending(tx):
    """Staff moves a serving or waiting transaction to the Pending line (e.g. multi-day services)."""
    if tx.status not in (CtmsTransaction.STATUS_SERVING, CtmsTransaction.STATUS_WAITING):
        raise ValueError(f"Cannot mark transaction with status '{tx.status}' as Pending.")

    tx.status = CtmsTransaction.STATUS_PENDING
    tx.save(update_fields=['status'])
    return tx


def mark_done(tx, staff_user):
    """Staff marks a serving or pending transaction as Done."""
    if tx.status not in (CtmsTransaction.STATUS_SERVING, CtmsTransaction.STATUS_PENDING):
        raise ValueError(f"Cannot mark transaction '{tx.status}' as Done. Must be serving or pending.")

    now = timezone.now()
    tx.status = CtmsTransaction.STATUS_DONE
    tx.done_at = now
    if not tx.started_at:
        tx.started_at = tx.called_at or now
    tx.served_by = staff_user
    tx.save(update_fields=['status', 'done_at', 'started_at', 'served_by'])
    return tx


def undo_done(tx):
    """Staff reverts Done back to Serving. Refused if already surveyed."""
    if tx.status != CtmsTransaction.STATUS_DONE:
        raise ValueError(f"Cannot undo Done for transaction with status '{tx.status}'.")

    if tx.is_surveyed:
        raise ValueError("Cannot undo Done: CSM survey response has already been submitted.")

    tx.status = CtmsTransaction.STATUS_SERVING
    tx.done_at = None
    tx.save(update_fields=['status', 'done_at'])
    return tx


def mark_no_show(tx):
    """Staff marks transaction as No-Show."""
    if tx.status not in (CtmsTransaction.STATUS_WAITING, CtmsTransaction.STATUS_SERVING, CtmsTransaction.STATUS_PENDING):
        raise ValueError(f"Cannot mark transaction with status '{tx.status}' as no-show.")

    tx.status = CtmsTransaction.STATUS_NO_SHOW
    tx.closed_at = timezone.now()
    tx.save(update_fields=['status', 'closed_at'])
    return tx


def cancel_transaction(tx):
    """Staff or client cancels transaction."""
    if tx.status not in (CtmsTransaction.STATUS_WAITING, CtmsTransaction.STATUS_SERVING, CtmsTransaction.STATUS_PENDING):
        raise ValueError(f"Cannot cancel transaction with status '{tx.status}'.")

    tx.status = CtmsTransaction.STATUS_CANCELLED
    tx.closed_at = timezone.now()
    tx.save(update_fields=['status', 'closed_at'])
    return tx


def requeue_transaction(tx):
    """Return serving or pending transaction back to waiting queue."""
    if tx.status not in (CtmsTransaction.STATUS_SERVING, CtmsTransaction.STATUS_PENDING):
        raise ValueError(f"Cannot requeue transaction with status '{tx.status}'.")

    tx.status = CtmsTransaction.STATUS_WAITING
    tx.counter = None
    tx.started_at = None
    tx.called_at = None
    tx.save(update_fields=['status', 'counter', 'started_at', 'called_at'])
    return tx
