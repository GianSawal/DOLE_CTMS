from django.db import models, transaction
from django.utils import timezone
from .models import (
    CsmOffice,
    CtmsCounter,
    CtmsTransaction,
    generate_claim_code,
    generate_token,
)


def personnel_display_name(user):
    """Canonical display name for a personnel account: personnel profile name, then account name, then username."""
    if not user:
        return ''
    profile = getattr(user, 'dole_personnel', None)
    if profile:
        return profile.full_name.strip()
    return user.get_full_name().strip() or user.username


def create_transaction(office, service, client_name=None, is_priority=False, source='qr', group_member_names=None):
    """
    Creates a new queue transaction atomically. Tickets enter the office's shared
    waiting queue unassigned; whoever calls the ticket from a window takes it.
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

        return CtmsTransaction.objects.create(
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
            checked_in_at=now,
            ticket_token=generate_token(16),
            survey_token=generate_token(16),
            claim_code=generate_claim_code(4),
        )


# =====================================================================
# Shared office queue: status rules, ownership, and history
# =====================================================================

_S = CtmsTransaction
ALLOWED_TRANSITIONS = {
    _S.STATUS_WAITING: {_S.STATUS_SERVING, _S.STATUS_NO_SHOW, _S.STATUS_CANCELLED},
    _S.STATUS_SERVING: {_S.STATUS_DONE, _S.STATUS_PENDING, _S.STATUS_WAITING, _S.STATUS_TRANSFERRED,
                        _S.STATUS_NO_SHOW, _S.STATUS_CANCELLED},
    _S.STATUS_TRANSFERRED: {_S.STATUS_SERVING, _S.STATUS_PENDING, _S.STATUS_WAITING, _S.STATUS_TRANSFERRED,
                            _S.STATUS_NO_SHOW, _S.STATUS_CANCELLED},
    _S.STATUS_PENDING: {_S.STATUS_SERVING, _S.STATUS_DONE, _S.STATUS_WAITING, _S.STATUS_TRANSFERRED,
                        _S.STATUS_NO_SHOW, _S.STATUS_CANCELLED},
    _S.STATUS_DONE: {_S.STATUS_SERVING},
    _S.STATUS_NO_SHOW: set(),
    _S.STATUS_CANCELLED: set(),
}
_STATUS_LABELS = dict(CtmsTransaction.STATUS_CHOICES)


def ensure_transition(tx, to_status):
    if to_status not in ALLOWED_TRANSITIONS.get(tx.status, set()):
        raise ValueError(
            f"Queue #{tx.queue_no} cannot change from {_STATUS_LABELS.get(tx.status, tx.status)} "
            f"to {_STATUS_LABELS.get(to_status, to_status)}."
        )


def ensure_handler(tx, user):
    """Only the personnel who owns a transaction may change it (system admins excepted)."""
    if not user or user.is_superuser:
        return
    if tx.assigned_to_id and tx.assigned_to_id != user.id:
        owner = personnel_display_name(tx.assigned_to)
        raise PermissionError(f"Queue #{tx.queue_no} is handled by {owner}. Only they can update it.")


def record_event(tx, event, actor=None, from_status='', from_user=None, from_counter=None, reason=''):
    """Appends an immutable assignment-history row describing a change already applied to `tx`."""
    from .models import CtmsAssignmentHistory
    return CtmsAssignmentHistory.objects.create(
        transaction=tx,
        event=event,
        from_status=from_status or '',
        to_status=tx.status,
        from_user=from_user,
        from_user_name=personnel_display_name(from_user),
        to_user=tx.assigned_to,
        to_user_name=personnel_display_name(tx.assigned_to),
        from_counter=from_counter,
        from_counter_name=from_counter.name if from_counter else '',
        to_counter=tx.counter,
        to_counter_name=tx.counter.name if tx.counter_id else '',
        actor=actor if actor and actor.is_authenticated else None,
        actor_name=personnel_display_name(actor) if actor and actor.is_authenticated else 'System',
        reason=(reason or '')[:255],
    )


def _snapshot(tx):
    return {'from_status': tx.status, 'from_user': tx.assigned_to, 'from_counter': tx.counter}


def user_window(user, office):
    """The active window `user` occupies in `office`, or None."""
    return CtmsCounter.objects.filter(
        assigned_user=user, office=office, is_active=True, archived_at__isnull=True
    ).first()


def _lock_user_window(user, office, required=True):
    window = CtmsCounter.objects.select_for_update().filter(
        assigned_user=user, office=office, is_active=True, archived_at__isnull=True
    ).first()
    if not window and required:
        raise ValueError("Take a window on the Windows page before calling clients.")
    return window


def _ensure_not_serving_another(user, office, exclude_pk=None):
    qs = CtmsTransaction.objects.filter(assigned_to=user, office=office, status=CtmsTransaction.STATUS_SERVING)
    if exclude_pk:
        qs = qs.exclude(pk=exclude_pk)
    busy = qs.first()
    if busy:
        raise ValueError(
            f"You are still serving Queue #{busy.queue_no}. Mark it Done, Pending, or return it to the queue first."
        )


def _start_service(tx, user, window, event):
    snap = _snapshot(tx)
    now = timezone.now()
    tx.status = CtmsTransaction.STATUS_SERVING
    tx.counter = window
    tx.assigned_to = user
    tx.assigned_personnel = personnel_display_name(user)[:200]
    tx.called_at = now
    if not tx.started_at:
        tx.started_at = now
    tx.save(update_fields=['status', 'counter', 'assigned_to', 'assigned_personnel', 'called_at', 'started_at'])
    record_event(tx, event, actor=user, **snap)
    return tx


def call_next_transaction(office, user):
    """
    Claims the next waiting ticket in the office's shared queue for `user` at their window:
    priority first, then first-come-first-served, regardless of the service's division.
    skip_locked keeps two windows from claiming the same ticket.
    """
    with transaction.atomic():
        window = _lock_user_window(user, office)
        _ensure_not_serving_another(user, office)
        tx = (CtmsTransaction.objects.select_for_update(skip_locked=True)
              .filter(office=office, status=CtmsTransaction.STATUS_WAITING, queue_date=timezone.localdate())
              .order_by('-is_priority', 'checked_in_at', 'id')
              .first())
        if not tx:
            return None
        from .models import CtmsAssignmentHistory
        return _start_service(tx, user, window, CtmsAssignmentHistory.EVENT_CALLED)


def call_transaction(tx, user):
    """
    Calls a specific ticket to `user`'s window:
    - waiting: claims it from the shared queue (window required)
    - serving (own): re-announces it (recall)
    - pending (own): resumes it (window required unless the client was reassigned)
    - transferred (own): starts it, at the recipient's window if they have one;
      reassigned clients are served off the TV board
    """
    from .models import CtmsAssignmentHistory

    with transaction.atomic():
        tx = CtmsTransaction.objects.select_for_update().select_related('assigned_to', 'counter').get(pk=tx.pk)
        window = _lock_user_window(user, tx.office, required=False)
        # Reassigned clients may be served without a window (also after being paused);
        # the shared queue and the caller's own paused clients need one.
        reassigned = tx.assignment_history.filter(event=CtmsAssignmentHistory.EVENT_TRANSFERRED).exists()
        needs_window = tx.status == CtmsTransaction.STATUS_WAITING or (
            tx.status == CtmsTransaction.STATUS_PENDING and not reassigned)
        if not window and needs_window:
            raise ValueError("Take a window on the Windows page before calling clients.")

        if tx.status == CtmsTransaction.STATUS_WAITING:
            _ensure_not_serving_another(user, tx.office)
            return _start_service(tx, user, window, CtmsAssignmentHistory.EVENT_CALLED)

        if tx.assigned_to_id and tx.assigned_to_id != user.id:
            where = f" at {tx.counter.name}" if tx.counter_id and tx.status == CtmsTransaction.STATUS_SERVING else ""
            raise ValueError(f"Queue #{tx.queue_no} is already with {personnel_display_name(tx.assigned_to)}{where}.")

        if tx.status == CtmsTransaction.STATUS_SERVING:
            tx.called_at = timezone.now()
            tx.counter = window or tx.counter
            tx.assigned_to = user
            tx.assigned_personnel = personnel_display_name(user)[:200]
            tx.save(update_fields=['called_at', 'counter', 'assigned_to', 'assigned_personnel'])
            return tx

        if tx.status in (CtmsTransaction.STATUS_PENDING, CtmsTransaction.STATUS_TRANSFERRED):
            _ensure_not_serving_another(user, tx.office, exclude_pk=tx.pk)
            return _start_service(tx, user, window, CtmsAssignmentHistory.EVENT_RESUMED)

        raise ValueError(f"Cannot call a transaction with status '{tx.status}'.")


def _apply(tx, to_status, event, actor, fields, reason=''):
    """Validates and saves a status change, then records it in the assignment history."""
    ensure_transition(tx, to_status)
    snap = _snapshot(tx)
    tx.status = to_status
    tx.save(update_fields=['status'] + list(fields))
    record_event(tx, event, actor=actor, reason=reason, **snap)
    return tx


def mark_pending(tx, actor=None, reason=''):
    """Pauses a transaction (e.g. waiting for requirements). It stays with its handler."""
    from .models import CtmsAssignmentHistory
    ensure_handler(tx, actor)
    return _apply(tx, CtmsTransaction.STATUS_PENDING, CtmsAssignmentHistory.EVENT_PENDING, actor, [], reason)


def mark_done(tx, staff_user):
    """Completes a transaction and unlocks the CSM survey."""
    from .models import CtmsAssignmentHistory
    ensure_handler(tx, staff_user)
    now = timezone.now()
    tx.done_at = now
    if not tx.started_at:
        tx.started_at = tx.called_at or now
    tx.served_by = staff_user
    # CSM attribution: the officer who handled the client, falling back to whoever pressed Done.
    if tx.assigned_to:
        handler_name = personnel_display_name(tx.assigned_to)
    else:
        handler_name = (tx.assigned_personnel or '').strip() or personnel_display_name(staff_user)
    tx.served_by_name = handler_name[:200]
    return _apply(tx, CtmsTransaction.STATUS_DONE, CtmsAssignmentHistory.EVENT_COMPLETED, staff_user,
                  ['done_at', 'started_at', 'served_by', 'served_by_name'])


def undo_done(tx, actor=None):
    """Reverts Done back to Serving. Refused if already surveyed."""
    from .models import CtmsAssignmentHistory
    if tx.status != CtmsTransaction.STATUS_DONE:
        raise ValueError(f"Cannot undo Done for transaction with status '{tx.status}'.")
    if tx.is_surveyed:
        raise ValueError("Cannot undo Done: CSM survey response has already been submitted.")
    ensure_handler(tx, actor)
    tx.done_at = None
    return _apply(tx, CtmsTransaction.STATUS_SERVING, CtmsAssignmentHistory.EVENT_REOPENED, actor, ['done_at'])


def mark_no_show(tx, actor=None):
    from .models import CtmsAssignmentHistory
    ensure_handler(tx, actor)
    tx.closed_at = timezone.now()
    return _apply(tx, CtmsTransaction.STATUS_NO_SHOW, CtmsAssignmentHistory.EVENT_NO_SHOW, actor, ['closed_at'])


def cancel_transaction(tx, actor=None):
    from .models import CtmsAssignmentHistory
    ensure_handler(tx, actor)
    tx.closed_at = timezone.now()
    return _apply(tx, CtmsTransaction.STATUS_CANCELLED, CtmsAssignmentHistory.EVENT_CANCELLED, actor, ['closed_at'])


def requeue_transaction(tx, actor=None):
    """Returns a transaction to the office's shared waiting queue, unassigned."""
    from .models import CtmsAssignmentHistory
    ensure_handler(tx, actor)
    tx.counter = None
    tx.assigned_to = None
    tx.assigned_personnel = None
    tx.started_at = None
    tx.called_at = None
    return _apply(tx, CtmsTransaction.STATUS_WAITING, CtmsAssignmentHistory.EVENT_REQUEUED, actor,
                  ['counter', 'assigned_to', 'assigned_personnel', 'started_at', 'called_at'])


def transfer_recipients(office, exclude_users=()):
    """Active staff of `office` who can receive a transferred client (system admins excluded)."""
    from django.contrib.auth import get_user_model
    User = get_user_model()
    return (User.objects.filter(is_active=True, is_staff=True, is_superuser=False, staff_offices__office=office)
            .exclude(pk__in=[u.pk for u in exclude_users if u])
            .select_related('dole_personnel', 'occupied_window')
            .distinct()
            .order_by('first_name', 'last_name', 'username'))


def transfer_transaction(tx, actor, to_user, reason=''):
    """
    Hands a client to another personnel in the same office. The ticket leaves the
    current handler's lists at once, waits in the recipient's My Clients as
    'transferred' until they start it, and the change is recorded in history.
    """
    from .models import CtmsAssignmentHistory, CtmsNotification

    with transaction.atomic():
        tx = (CtmsTransaction.objects.select_for_update()
              .select_related('office', 'service', 'assigned_to', 'counter').get(pk=tx.pk))
        ensure_handler(tx, actor)
        if not to_user:
            raise ValueError("Choose who will take over this client.")
        if to_user.pk == tx.assigned_to_id or (not tx.assigned_to_id and actor and to_user.pk == actor.pk):
            raise ValueError("This client is already yours. Choose another personnel.")
        if not transfer_recipients(tx.office).filter(pk=to_user.pk).exists():
            raise ValueError(f"{personnel_display_name(to_user)} is not active staff of {tx.office.name}.")
        ensure_transition(tx, CtmsTransaction.STATUS_TRANSFERRED)

        snap = _snapshot(tx)
        tx.status = CtmsTransaction.STATUS_TRANSFERRED
        tx.assigned_to = to_user
        tx.assigned_personnel = personnel_display_name(to_user)[:200]
        tx.counter = None  # the client is no longer at the previous handler's window
        tx.save(update_fields=['status', 'assigned_to', 'assigned_personnel', 'counter'])
        record_event(tx, CtmsAssignmentHistory.EVENT_TRANSFERRED, actor=actor, reason=reason, **snap)

        sender = personnel_display_name(snap['from_user'] or actor) or 'A colleague'
        service_name = tx.service.name if tx.service_id else 'Service'
        note = f" Note: {reason.strip()}" if reason and reason.strip() else ""
        CtmsNotification.objects.create(
            recipient=to_user,
            transaction=tx,
            notification_type='REASSIGNMENT',
            title=f"Client Transferred to You: Queue #{tx.queue_no}",
            message=f"{sender} transferred Queue #{tx.queue_no} ({service_name}) to you. Start it from My Clients.{note}",
            queue_no=tx.queue_no,
            service_name=service_name,
            assigned_at=timezone.now(),
        )
        return tx


# =====================================================================
# Windows (office-scoped service windows, stored in ctms_counter)
# =====================================================================

WINDOW_BUSY_STATUSES = (CtmsTransaction.STATUS_SERVING, CtmsTransaction.STATUS_TRANSFERRED)


def office_windows(office, include_archived=False):
    qs = CtmsCounter.objects.filter(office=office)
    if not include_archived:
        qs = qs.filter(archived_at__isnull=True)
    return qs.select_related('office', 'assigned_user', 'assigned_user__dole_personnel').order_by('sort_order', 'name', 'id')


def _window_has_active_client(window):
    return CtmsTransaction.objects.filter(counter=window, status__in=WINDOW_BUSY_STATUSES).exists()


def create_window(office, name):
    """Creates a window, or restores an archived one with the same name in this office."""
    clean = (name or '').strip()
    if not clean:
        raise ValueError("Window name is required.")
    if len(clean) > 50:
        raise ValueError("Window name must be 50 characters or fewer.")

    with transaction.atomic():
        existing = CtmsCounter.objects.select_for_update().filter(office=office, name__iexact=clean).first()
        if existing and existing.archived_at is None:
            raise ValueError(f"A window named '{existing.name}' already exists in this office.")

        next_order = (CtmsCounter.objects.filter(office=office, archived_at__isnull=True)
                      .aggregate(m=models.Max('sort_order'))['m'] or 0) + 1
        if existing:
            existing.name = clean
            existing.archived_at = None
            existing.is_active = True
            existing.assigned_user = None
            existing.assigned_at = None
            existing.sort_order = next_order
            existing.save()
            return existing
        return CtmsCounter.objects.create(office=office, name=clean, is_active=True, sort_order=next_order)


def update_window(window, name=None, sort_order=None, is_active=None):
    with transaction.atomic():
        window = CtmsCounter.objects.select_for_update().get(pk=window.pk)
        if window.archived_at:
            raise ValueError("Archived windows cannot be edited.")

        if name is not None:
            clean = name.strip()
            if not clean:
                raise ValueError("Window name is required.")
            if len(clean) > 50:
                raise ValueError("Window name must be 50 characters or fewer.")
            clash = CtmsCounter.objects.filter(office=window.office, name__iexact=clean).exclude(pk=window.pk).first()
            if clash:
                state = "an archived window" if clash.archived_at else "another window"
                raise ValueError(f"The name '{clean}' is already used by {state} in this office.")
            window.name = clean

        if sort_order is not None:
            window.sort_order = max(0, int(sort_order))

        if is_active is not None and bool(is_active) != window.is_active:
            if not is_active:
                if _window_has_active_client(window):
                    raise ValueError("Finish or return the client at this window before deactivating it.")
                window.assigned_user = None
                window.assigned_at = None
            window.is_active = bool(is_active)

        window.save()
        return window


def archive_window(window):
    """Soft-deletes a window so historical transactions keep pointing at it."""
    with transaction.atomic():
        window = CtmsCounter.objects.select_for_update().get(pk=window.pk)
        if window.archived_at:
            return window
        if _window_has_active_client(window):
            raise ValueError("Finish or return the client at this window before archiving it.")
        window.assigned_user = None
        window.assigned_at = None
        window.is_active = False
        window.archived_at = timezone.now()
        window.save()
        return window


def assign_window(window, user):
    """
    Puts `user` at `window`. A user may hold one window and a window one user;
    the unique assigned_user column backs this up against concurrent requests.
    """
    from django.db import IntegrityError

    try:
        with transaction.atomic():
            window = CtmsCounter.objects.select_for_update().select_related('assigned_user').get(pk=window.pk)
            if window.archived_at or not window.is_active:
                raise ValueError(f"{window.name} is not active.")
            if window.assigned_user_id == user.id:
                return window
            if window.assigned_user_id:
                occupant = personnel_display_name(window.assigned_user)
                raise ValueError(f"{window.name} is already occupied by {occupant}.")

            current = CtmsCounter.objects.select_for_update().filter(assigned_user=user).first()
            if current:
                raise ValueError(f"You are already assigned to {current.name}. Release it before taking another window.")

            window.assigned_user = user
            window.assigned_at = timezone.now()
            window.save(update_fields=['assigned_user', 'assigned_at'])
            return window
    except IntegrityError:
        raise ValueError("This window or your account was just assigned elsewhere. Please refresh and try again.")


def release_window(window):
    """Frees the window. Returns the user who was released (or None)."""
    with transaction.atomic():
        window = CtmsCounter.objects.select_for_update().select_related('assigned_user').get(pk=window.pk)
        previous = window.assigned_user
        if not previous:
            raise ValueError(f"{window.name} is not occupied.")
        window.assigned_user = None
        window.assigned_at = None
        window.save(update_fields=['assigned_user', 'assigned_at'])
        return previous
