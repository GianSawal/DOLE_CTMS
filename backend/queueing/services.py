from typing import Iterable
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from .models import (
    Office,
    Service,
    QueueCounter,
    QueueTicket,
    TicketItem,
    generate_verification_code,
)


def issue_ticket(
    *,
    office: Office,
    services: Iterable[Service],
    source: str = QueueTicket.Source.SELF_SERVICE,
    client_name: str = "",
    email: str = "",
    contact_number: str = "",
    is_anonymous: bool = False,
    issued_by=None,
) -> QueueTicket:
    """
    Issues a new QueueTicket with one TicketItem per chosen service.
    Ensures sequential daily queue numbering per office and snapshots PCT targets.
    """
    services_list = list(services)
    if not services_list:
        raise ValidationError("At least one service must be selected.")

    # Validate all services are active and belong to units of this office
    for s in services_list:
        if not s.is_active:
            raise ValidationError(f"Service '{s.name}' is inactive and cannot be chosen.")
        if s.unit.office_id != office.id:
            raise ValidationError(f"Service '{s.name}' does not belong to office '{office.name}'.")

    # Prevent duplicate services on the same ticket
    service_ids = [s.id for s in services_list]
    if len(service_ids) != len(set(service_ids)):
        raise ValidationError("Duplicate services cannot be selected on the same ticket.")

    # Service date in Asia/Manila
    service_date = timezone.localdate()

    if is_anonymous:
        client_name = ""
        email = ""
        contact_number = ""

    with transaction.atomic():
        counter, _ = QueueCounter.objects.select_for_update().get_or_create(
            office=office,
            service_date=service_date,
            defaults={'last_number': 0}
        )
        counter.last_number += 1
        counter.save(update_fields=['last_number'])

        queue_number = f"{counter.last_number:03d}"
        transaction_number = f"{office.code}-{service_date:%y%m%d}-{queue_number}"
        verification_code = generate_verification_code()

        ticket = QueueTicket.objects.create(
            office=office,
            service_date=service_date,
            queue_number=queue_number,
            transaction_number=transaction_number,
            verification_code=verification_code,
            client_name=client_name.strip(),
            email=email.strip().lower(),
            contact_number=contact_number.strip(),
            is_anonymous=is_anonymous,
            source=source,
            issued_by=issued_by,
        )

        ticket_items = [
            TicketItem(
                ticket=ticket,
                service=s,
                unit=s.unit,
                pct_minutes_snapshot=s.pct_minutes,
                status=TicketItem.Status.WAITING,
            )
            for s in services_list
        ]
        TicketItem.objects.bulk_create(ticket_items)

    return ticket


def call_item(item: TicketItem, user=None) -> TicketItem:
    """
    Transition item: WAITING -> CALLED.
    Locks ticket row: ensures client is not already CALLED or SERVING at another unit.
    Rejects transition if item has already been surveyed.
    """
    with transaction.atomic():
        ticket = QueueTicket.objects.select_for_update().get(id=item.ticket_id)
        locked_item = TicketItem.objects.select_for_update().get(id=item.id)

        if locked_item.survey_submitted_at is not None:
            raise ValidationError("This item is already surveyed and frozen. Status changes are disallowed.")

        if locked_item.status != TicketItem.Status.WAITING:
            raise ValidationError(f"Cannot call item in status '{locked_item.status}'. Only WAITING items can be called.")

        # Check if client is currently CALLED or SERVING at another unit
        active_conflict = ticket.items.filter(
            status__in=[TicketItem.Status.CALLED, TicketItem.Status.SERVING]
        ).exclude(id=locked_item.id).first()

        if active_conflict:
            raise ValidationError(
                f"Client is currently {active_conflict.status.lower()} at unit '{active_conflict.unit.name}'. "
                "A client can only be called or served at one unit at a time."
            )

        locked_item.status = TicketItem.Status.CALLED
        locked_item.called_at = timezone.now()
        locked_item.served_by = user
        locked_item.save(update_fields=['status', 'called_at', 'served_by'])
        return locked_item


def start_item(item: TicketItem, user=None) -> TicketItem:
    """
    Transition item: CALLED -> SERVING.
    Stamps started_at and served_by.
    """
    with transaction.atomic():
        ticket = QueueTicket.objects.select_for_update().get(id=item.ticket_id)
        locked_item = TicketItem.objects.select_for_update().get(id=item.id)

        if locked_item.survey_submitted_at is not None:
            raise ValidationError("This item is already surveyed and frozen. Status changes are disallowed.")

        if locked_item.status != TicketItem.Status.CALLED:
            raise ValidationError(f"Cannot start item in status '{locked_item.status}'. Only CALLED items can be started.")

        # Ensure no other item on ticket is SERVING
        other_serving = ticket.items.filter(status=TicketItem.Status.SERVING).exclude(id=locked_item.id).first()
        if other_serving:
            raise ValidationError(
                f"Client is currently being served at unit '{other_serving.unit.name}'. "
                "Only one service can be actively served at a time."
            )

        locked_item.status = TicketItem.Status.SERVING
        locked_item.started_at = timezone.now()
        locked_item.served_by = user or locked_item.served_by
        locked_item.save(update_fields=['status', 'started_at', 'served_by'])
        return locked_item


def complete_item(item: TicketItem, user=None) -> TicketItem:
    """
    Transition item: SERVING -> DONE (or CALLED -> DONE if served directly).
    Stamps completed_at.
    """
    with transaction.atomic():
        locked_item = TicketItem.objects.select_for_update().get(id=item.id)

        if locked_item.survey_submitted_at is not None:
            raise ValidationError("This item is already surveyed and frozen. Status changes are disallowed.")

        if locked_item.status != TicketItem.Status.SERVING:
            raise ValidationError(f"Cannot complete item in status '{locked_item.status}'. Only SERVING items can be marked Done.")

        now = timezone.now()
        if not locked_item.started_at:
            locked_item.started_at = locked_item.called_at or now

        locked_item.status = TicketItem.Status.DONE
        locked_item.completed_at = now
        locked_item.served_by = user or locked_item.served_by
        locked_item.save(update_fields=['status', 'completed_at', 'started_at', 'served_by'])
        return locked_item


def skip_item(item: TicketItem, user=None) -> TicketItem:
    """
    Transition item: WAITING or CALLED -> SKIPPED.
    """
    with transaction.atomic():
        locked_item = TicketItem.objects.select_for_update().get(id=item.id)

        if locked_item.survey_submitted_at is not None:
            raise ValidationError("This item is already surveyed and frozen. Status changes are disallowed.")

        if locked_item.status not in [TicketItem.Status.WAITING, TicketItem.Status.CALLED]:
            raise ValidationError(f"Cannot skip item in status '{locked_item.status}'. Only WAITING or CALLED items can be skipped.")

        locked_item.status = TicketItem.Status.SKIPPED
        locked_item.served_by = user or locked_item.served_by
        locked_item.save(update_fields=['status', 'served_by'])
        return locked_item


def requeue_item(item: TicketItem, user=None) -> TicketItem:
    """
    Transition item: CALLED -> WAITING (recall/requeue).
    """
    with transaction.atomic():
        locked_item = TicketItem.objects.select_for_update().get(id=item.id)

        if locked_item.survey_submitted_at is not None:
            raise ValidationError("This item is already surveyed and frozen. Status changes are disallowed.")

        if locked_item.status != TicketItem.Status.CALLED:
            raise ValidationError(f"Cannot requeue item in status '{locked_item.status}'. Only CALLED items can be requeued.")

        locked_item.status = TicketItem.Status.WAITING
        locked_item.called_at = None
        locked_item.served_by = None
        locked_item.save(update_fields=['status', 'called_at', 'served_by'])
        return locked_item
