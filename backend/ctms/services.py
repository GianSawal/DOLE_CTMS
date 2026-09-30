import secrets
from django.db import models, transaction
from django.utils import timezone
from .models import (
    CsmDivision,
    CsmOffice,
    CsmService,
    CsmResponse,
    CtmsCounter,
    CtmsTransaction,
    generate_claim_code,
    generate_token,
)

def create_transaction(office, service, client_name=None, is_priority=False, source='qr'):
    """
    Creates a new queue transaction atomically.
    Generates queue_seq restartable daily per office, transaction_no, queue_no,
    ticket_token, survey_token, and claim_code.
    """
    if not office.is_active:
        raise ValueError("Office is inactive.")
    if not service.is_active:
        raise ValueError("Service is inactive.")

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

        tx = CtmsTransaction.objects.create(
            transaction_no=tx_no,
            office=office,
            service=service,
            queue_date=local_date,
            queue_seq=next_seq,
            queue_no=queue_no,
            is_priority=bool(is_priority),
            client_name=client_name.strip() if client_name else None,
            status=CtmsTransaction.STATUS_WAITING,
            source=source,
            checked_in_at=now,
            ticket_token=ticket_token,
            survey_token=survey_token,
            claim_code=claim_code,
        )
        return tx


def assign_personnel_to_transaction(tx, personnel):
    """Staff assigns a designated officer / personnel to a transaction."""
    tx.assigned_personnel = (personnel or "").strip()
    tx.save(update_fields=['assigned_personnel'])
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
            if division:
                waiting_qs = waiting_qs.filter(service__division=division)

        waiting_qs = waiting_qs.order_by('-is_priority', 'checked_in_at')

        tx = waiting_qs.first()
        if not tx:
            return None

        if personnel:
            tx.assigned_personnel = str(personnel).strip()

        if not tx.assigned_personnel:
            raise ValueError(f"Cannot call queue #{tx.queue_no}: A personnel must be assigned before calling.")

        now = timezone.now()
        tx.status = CtmsTransaction.STATUS_SERVING
        tx.counter = counter
        tx.called_at = now
        tx.save(update_fields=['status', 'counter', 'called_at', 'assigned_personnel'])
        return tx


def call_specific_transaction(tx, counter, personnel=None):
    """Staff calls, recalls, or resumes a specific transaction."""
    if tx.status not in (CtmsTransaction.STATUS_WAITING, CtmsTransaction.STATUS_SERVING, CtmsTransaction.STATUS_PENDING):
        raise ValueError(f"Cannot call a transaction with status '{tx.status}'.")

    if personnel:
        tx.assigned_personnel = str(personnel).strip()

    if not tx.assigned_personnel:
        raise ValueError(f"Cannot call queue #{tx.queue_no}: A personnel must be assigned before calling.")

    now = timezone.now()
    tx.status = CtmsTransaction.STATUS_SERVING
    tx.counter = counter
    tx.called_at = now
    tx.save(update_fields=['status', 'counter', 'called_at', 'assigned_personnel'])
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
    tx.served_by = staff_user
    tx.save(update_fields=['status', 'done_at', 'served_by'])
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
    tx.save(update_fields=['status', 'counter'])
    return tx
