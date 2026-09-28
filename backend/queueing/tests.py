from datetime import timedelta
from django.test import TestCase, Client, override_settings
from django.contrib.auth.models import User, Permission
from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import ValidationError
from django.utils import timezone
from django.db import connection

from .models import (
    Office,
    Unit,
    Service,
    QueueCounter,
    QueueTicket,
    TicketItem,
    StaffProfile,
    VERIFICATION_CODE_ALPHABET,
)
from .services import (
    issue_ticket,
    call_item,
    start_item,
    complete_item,
    skip_item,
    requeue_item,
)


class QueueingCoreTestCase(TestCase):
    def setUp(self):
        self.client = Client()

        # Retrieve seeded Offices
        self.ro3 = Office.objects.get(code="RO3")
        self.bul = Office.objects.get(code="BUL")

        # Retrieve seeded Units
        self.unit_lrls = Unit.objects.get(office=self.ro3, code="LRLS")
        self.unit_ew = Unit.objects.get(office=self.ro3, code="EW")
        self.unit_bul_ew = Unit.objects.get(office=self.bul, code="EW")

        # Services
        self.srv_labor = Service.objects.get(unit=self.unit_lrls, name="Labor Rights Query")
        self.srv_tupad = Service.objects.get(unit=self.unit_ew, name="TUPAD Program")
        self.srv_inactive = Service.objects.create(unit=self.unit_lrls, name="Inactive Svc", pct_minutes=20, is_active=False)
        self.srv_bul_tupad = Service.objects.get(unit=self.unit_bul_ew, name="TUPAD Program")

        # Users
        self.pacd_user = User.objects.create_user(username="pacd_staff", password="password123")
        self.unit_user = User.objects.create_user(username="unit_staff", password="password123")
        self.other_unit_user = User.objects.create_user(username="other_staff", password="password123")
        self.regular_user = User.objects.create_user(username="regular_user", password="password123")

        # Staff Profiles
        StaffProfile.objects.create(user=self.pacd_user, office=self.ro3, unit=None)
        StaffProfile.objects.create(user=self.unit_user, office=self.ro3, unit=self.unit_lrls)
        StaffProfile.objects.create(user=self.other_unit_user, office=self.ro3, unit=self.unit_ew)

        # Permissions
        ticket_ct = ContentType.objects.get_for_model(QueueTicket)
        item_ct = ContentType.objects.get_for_model(TicketItem)

        add_ticket = Permission.objects.get(content_type=ticket_ct, codename='add_queueticket')
        view_ticket = Permission.objects.get(content_type=ticket_ct, codename='view_queueticket')
        change_item = Permission.objects.get(content_type=item_ct, codename='change_ticketitem')
        view_item = Permission.objects.get(content_type=item_ct, codename='view_ticketitem')

        self.pacd_user.user_permissions.add(add_ticket, view_ticket)
        self.unit_user.user_permissions.add(change_item, view_item)
        self.other_unit_user.user_permissions.add(change_item, view_item)

    # -----------------------------------------------------------------
    # 1. Numbering, Independence, and Verification Code
    # -----------------------------------------------------------------
    def test_numbering_sequential_per_office_resets_next_day(self):
        today = timezone.localdate()
        yesterday = today - timedelta(days=1)

        # Counter from yesterday for RO3
        QueueCounter.objects.create(office=self.ro3, service_date=yesterday, last_number=42)

        # Issue tickets today for RO3
        t1 = issue_ticket(office=self.ro3, services=[self.srv_labor])
        t2 = issue_ticket(office=self.ro3, services=[self.srv_tupad])

        self.assertEqual(t1.queue_number, "001")
        self.assertEqual(t2.queue_number, "002")
        today_yymmdd = today.strftime('%y%m%d')
        self.assertEqual(t1.transaction_number, f"RO3-{today_yymmdd}-001")
        self.assertEqual(t2.transaction_number, f"RO3-{today_yymmdd}-002")

        # Independent office (BUL) starts at 001
        t_bul = issue_ticket(office=self.bul, services=[self.srv_bul_tupad])
        self.assertEqual(t_bul.queue_number, "001")
        self.assertEqual(t_bul.transaction_number, f"BUL-{today_yymmdd}-001")

        # Verification code format
        for code in [t1.verification_code, t2.verification_code, t_bul.verification_code]:
            self.assertEqual(len(code), 4)
            self.assertTrue(all(c in VERIFICATION_CODE_ALPHABET for c in code))
            # No ambiguous characters: 0, O, 1, I, L
            for bad_char in ['0', 'O', '1', 'I', 'L']:
                self.assertNotIn(bad_char, code)

    # -----------------------------------------------------------------
    # 2. issue_ticket validations & snapshots
    # -----------------------------------------------------------------
    def test_issue_ticket_snapshots_and_validations(self):
        # Multiple services across two units on one ticket
        ticket = issue_ticket(
            office=self.ro3,
            services=[self.srv_labor, self.srv_tupad],
            client_name="Maria Santos",
            email="maria@example.com",
            contact_number="09181234567"
        )
        self.assertEqual(ticket.items.count(), 2)

        item_labor = ticket.items.get(service=self.srv_labor)
        item_tupad = ticket.items.get(service=self.srv_tupad)

        self.assertEqual(item_labor.unit, self.unit_lrls)
        self.assertEqual(item_labor.pct_minutes_snapshot, 15)
        self.assertEqual(item_tupad.unit, self.unit_ew)
        self.assertEqual(item_tupad.pct_minutes_snapshot, 30)

        # Later change in Service.pct_minutes must NOT alter existing snapshots!
        self.srv_labor.pct_minutes = 99
        self.srv_labor.save()
        item_labor.refresh_from_db()
        self.assertEqual(item_labor.pct_minutes_snapshot, 15)

        # Empty services rejected
        with self.assertRaises(ValidationError):
            issue_ticket(office=self.ro3, services=[])

        # Inactive service rejected
        with self.assertRaises(ValidationError):
            issue_ticket(office=self.ro3, services=[self.srv_inactive])

        # Service from another office rejected
        with self.assertRaises(ValidationError):
            issue_ticket(office=self.ro3, services=[self.srv_bul_tupad])

    def test_anonymous_ticket_blanks_all_personal_data(self):
        ticket = issue_ticket(
            office=self.ro3,
            services=[self.srv_labor],
            client_name="Confidential Name",
            email="secret@example.com",
            contact_number="09187654321",
            is_anonymous=True,
        )
        self.assertTrue(ticket.is_anonymous)
        self.assertEqual(ticket.client_name, "")
        self.assertEqual(ticket.email, "")
        self.assertEqual(ticket.contact_number, "")

    # -----------------------------------------------------------------
    # 3. Transitions, Timestamps, and Single-Active-Service Constraint
    # -----------------------------------------------------------------
    def test_transitions_and_single_active_service_constraint(self):
        ticket = issue_ticket(office=self.ro3, services=[self.srv_labor, self.srv_tupad])
        item_labor = ticket.items.get(service=self.srv_labor)
        item_tupad = ticket.items.get(service=self.srv_tupad)

        # Both start WAITING
        self.assertEqual(ticket.status, 'WAITING')

        # Staff at LRLS calls labor query
        call_item(item_labor, user=self.unit_user)
        item_labor.refresh_from_db()
        self.assertEqual(item_labor.status, TicketItem.Status.CALLED)
        self.assertIsNotNone(item_labor.called_at)
        self.assertEqual(item_labor.served_by, self.unit_user)
        self.assertEqual(ticket.status, 'IN_PROGRESS')

        # Staff at EW attempts to call tupad query at the same time:
        # A ticket cannot be CALLED or SERVING at two units simultaneously!
        with self.assertRaises(ValidationError):
            call_item(item_tupad, user=self.other_unit_user)

        # LRLS starts serving labor query
        start_item(item_labor, user=self.unit_user)
        item_labor.refresh_from_db()
        self.assertEqual(item_labor.status, TicketItem.Status.SERVING)
        self.assertIsNotNone(item_labor.started_at)

        # Still cannot call tupad while labor is SERVING
        with self.assertRaises(ValidationError):
            call_item(item_tupad, user=self.other_unit_user)

        # LRLS finishes labor query
        complete_item(item_labor, user=self.unit_user)
        item_labor.refresh_from_db()
        self.assertEqual(item_labor.status, TicketItem.Status.DONE)
        self.assertIsNotNone(item_labor.completed_at)

        # Now EW can call tupad!
        call_item(item_tupad, user=self.other_unit_user)
        item_tupad.refresh_from_db()
        self.assertEqual(item_tupad.status, TicketItem.Status.CALLED)

        # Test Requeue
        requeue_item(item_tupad, user=self.other_unit_user)
        item_tupad.refresh_from_db()
        self.assertEqual(item_tupad.status, TicketItem.Status.WAITING)

        # Test Skip
        skip_item(item_tupad, user=self.other_unit_user)
        item_tupad.refresh_from_db()
        self.assertEqual(item_tupad.status, TicketItem.Status.SKIPPED)

        # All items are DONE or SKIPPED -> ticket status is COMPLETED
        self.assertEqual(ticket.status, 'COMPLETED')

    def test_item_frozen_when_survey_submitted(self):
        ticket = issue_ticket(office=self.ro3, services=[self.srv_labor])
        item = ticket.items.get(service=self.srv_labor)

        call_item(item, user=self.unit_user)
        start_item(item, user=self.unit_user)
        complete_item(item, user=self.unit_user)
        item.refresh_from_db()

        # Simulate CSM claiming the survey
        item.survey_submitted_at = timezone.now()
        item.save()

        # Attempting any status change must be rejected!
        with self.assertRaises(ValidationError):
            call_item(item, user=self.unit_user)

        with self.assertRaises(ValidationError):
            skip_item(item, user=self.unit_user)

    # -----------------------------------------------------------------
    # 4. Wait time, Actual PCT, and is_over_pct calculations
    # -----------------------------------------------------------------
    def test_pct_and_wait_time_calculations(self):
        ticket = issue_ticket(office=self.ro3, services=[self.srv_labor])
        item = ticket.items.get(service=self.srv_labor)

        now = timezone.now()
        ticket.created_at = now - timedelta(minutes=20)
        ticket.save()

        item.started_at = now - timedelta(minutes=10)
        item.completed_at = now
        item.save()

        # Wait time: 20 - 10 = 10 minutes
        self.assertAlmostEqual(item.wait_time_minutes, 10.0, places=1)
        # Actual PCT: 10 minutes
        self.assertAlmostEqual(item.actual_pct_minutes, 10.0, places=1)
        # Snapshot target is 15 min, actual is 10 min -> not over PCT
        self.assertFalse(item.is_over_pct)

        # If actual PCT exceeds snapshot target (e.g. 25 minutes > 15 minutes)
        item.started_at = now - timedelta(minutes=25)
        item.save()
        self.assertTrue(item.is_over_pct)

    # -----------------------------------------------------------------
    # 5. Slug-Scoped Client Flow Web Views & QR Poster
    # -----------------------------------------------------------------
    def test_office_get_queue_url(self):
        self.assertEqual(self.ro3.get_queue_url(), "/q/ro3/")
        self.assertEqual(self.bul.get_queue_url(), "/q/bulacan/")

    def test_slug_scoped_services_display_and_isolation(self):
        # Create a unique service in Bulacan to verify cross-office isolation
        Service.objects.create(unit=self.unit_bul_ew, name="Bulacan Special Assistance", pct_minutes=25)

        # /q/ro3/ lists only RO3's active services; Bulacan service must NOT appear
        res_ro3 = self.client.get('/q/ro3/')
        self.assertEqual(res_ro3.status_code, 200)
        self.assertContains(res_ro3, "DOLE Regional Office III")
        self.assertContains(res_ro3, "Labor Rights Query")
        self.assertContains(res_ro3, "TUPAD Program")
        self.assertNotContains(res_ro3, "Bulacan Special Assistance")

        # /q/bulacan/ lists Bulacan services and does NOT have an office dropdown
        res_bul = self.client.get('/q/bulacan/')
        self.assertEqual(res_bul.status_code, 200)
        self.assertContains(res_bul, "DOLE Bulacan Provincial Office")
        self.assertContains(res_bul, "Bulacan Special Assistance")
        self.assertNotContains(res_bul, "<select name=\"office_id\"")

    def test_unknown_or_inactive_slug_returns_404_friendly_page(self):
        # Unknown slug
        res = self.client.get('/q/nonexistent-office/')
        self.assertEqual(res.status_code, 404)
        self.assertContains(res, "This link is no longer active, please ask the PACD / front desk.", status_code=404)

        # Inactive office slug
        self.bul.is_active = False
        self.bul.save()
        res_inactive = self.client.get('/q/bulacan/')
        self.assertEqual(res_inactive.status_code, 404)
        self.assertContains(res_inactive, "This link is no longer active", status_code=404)
        self.bul.is_active = True
        self.bul.save()

    def test_queue_default_office_slug_redirection_and_notice(self):
        # When QUEUE_DEFAULT_OFFICE_SLUG is not set: shows scan notice page
        with override_settings(QUEUE_DEFAULT_OFFICE_SLUG=None):
            res = self.client.get('/queue/')
            self.assertEqual(res.status_code, 200)
            self.assertContains(res, "Please scan the QR code posted at the office.")
            self.assertNotContains(res, "<select")

        # When QUEUE_DEFAULT_OFFICE_SLUG is set: redirects to that slug
        with override_settings(QUEUE_DEFAULT_OFFICE_SLUG="ro3"):
            res = self.client.get('/queue/')
            self.assertRedirects(res, '/q/ro3/')

            res_root = self.client.get('/')
            self.assertRedirects(res_root, '/q/ro3/')

    def test_step2_session_validation_and_redirection(self):
        # Direct access to step 2 without session redirects to step 1
        res = self.client.get('/q/ro3/details/')
        self.assertRedirects(res, '/q/ro3/')

        # Accessing step 2 with another office's session redirects to step 1
        session = self.client.session
        session['queue_wizard_bulacan'] = {'office_slug': 'bulacan', 'service_ids': [self.srv_bul_tupad.id]}
        session.save()

        res_wrong_office = self.client.get('/q/ro3/details/')
        self.assertRedirects(res_wrong_office, '/q/ro3/')

    def test_slug_submit_ticket_and_ticket_page(self):
        # Step 1: POST selections
        res = self.client.post('/q/ro3/', {
            'service_ids': [self.srv_labor.id, self.srv_tupad.id],
        })
        self.assertRedirects(res, '/q/ro3/details/')

        # Step 2: GET displays selections
        res_step2 = self.client.get('/q/ro3/details/')
        self.assertEqual(res_step2.status_code, 200)
        self.assertContains(res_step2, "Labor Rights Query")
        self.assertContains(res_step2, "TUPAD Program")
        self.assertContains(res_step2, "DOLE Regional Office III")

        # Submit: POST creates SELF_SERVICE ticket and clears session
        res_submit = self.client.post('/q/ro3/submit/', {
            'client_name': 'Juan Dela Cruz',
            'contact_number': '09171234567',
            'email': 'juan@example.com',
        })
        ticket = QueueTicket.objects.latest('created_at')
        self.assertRedirects(res_submit, f'/q/ro3/t/{ticket.public_id}/')
        self.assertEqual(ticket.source, QueueTicket.Source.SELF_SERVICE)
        self.assertEqual(ticket.office, self.ro3)
        self.assertNotIn('queue_wizard_ro3', self.client.session)

        # Refreshing / submitting again without session redirects to step 1 (no duplicate ticket)
        res_refresh = self.client.post('/q/ro3/submit/', {})
        self.assertRedirects(res_refresh, '/q/ro3/')

        # Ticket page displays directions, services, QR, and fallback codes
        ticket_res = self.client.get(f'/q/ro3/t/{ticket.public_id}/')
        self.assertEqual(ticket_res.status_code, 200)
        self.assertContains(ticket_res, ticket.queue_number)
        self.assertContains(ticket_res, ticket.transaction_number)
        self.assertContains(ticket_res, ticket.verification_code)
        self.assertContains(ticket_res, "2nd floor, right side")
        self.assertContains(ticket_res, "data:image/png;base64,")

    def test_reject_service_from_different_office_in_slug_flow(self):
        # Attempting to post a Bulacan service ID through /q/ro3/ is rejected
        res = self.client.post('/q/ro3/', {
            'service_ids': [self.srv_bul_tupad.id],
        })
        self.assertRedirects(res, '/q/ro3/')
        self.assertNotIn('queue_wizard_ro3', self.client.session)

    def test_qr_poster_view_access_control_and_rendering(self):
        # Anonymous user denied (redirects to login)
        res = self.client.get(f'/staff/office/{self.ro3.id}/qr-poster/')
        self.assertEqual(res.status_code, 302)

        # Non-staff authenticated user denied (403)
        self.client.force_login(self.regular_user)
        res_non_staff = self.client.get(f'/staff/office/{self.ro3.id}/qr-poster/')
        self.assertEqual(res_non_staff.status_code, 403)

        # Staff user succeeds
        self.pacd_user.is_staff = True
        self.pacd_user.save()
        self.client.force_login(self.pacd_user)
        res_staff = self.client.get(f'/staff/office/{self.ro3.id}/qr-poster/')
        self.assertEqual(res_staff.status_code, 200)
        self.assertContains(res_staff, "DOLE Regional Office III")
        self.assertContains(res_staff, "Scan to get your queue number")
        self.assertContains(res_staff, "/q/ro3/")
        self.assertContains(res_staff, "data:image/png;base64,")

    # -----------------------------------------------------------------
    # 6. Front Desk (PACD) View & Thermal Print
    # -----------------------------------------------------------------
    def test_front_desk_access_and_print(self):
        # Unauthenticated redirects to login
        res = self.client.get('/front-desk/queue/')
        self.assertEqual(res.status_code, 302)

        # Regular user without permission gets 403
        self.client.force_login(self.regular_user)
        res = self.client.get('/front-desk/queue/')
        self.assertEqual(res.status_code, 403)

        # PACD staff with permission succeeds
        self.client.force_login(self.pacd_user)
        res = self.client.get('/front-desk/queue/')
        self.assertEqual(res.status_code, 200)
        self.assertContains(res, "Public Assistance and Complaints Desk")

        # Issue ticket from PACD
        res = self.client.post('/front-desk/queue/', {
            'service_ids': [self.srv_labor.id],
            'client_name': 'Desk Walkin',
        })
        self.assertEqual(res.status_code, 200)
        ticket = QueueTicket.objects.filter(source=QueueTicket.Source.FRONT_DESK).latest('created_at')
        self.assertEqual(ticket.issued_by, self.pacd_user)
        self.assertEqual(ticket.office, self.ro3)

        # Thermal print slip renders properly
        print_res = self.client.get(f'/front-desk/print/{ticket.public_id}/')
        self.assertEqual(print_res.status_code, 200)
        self.assertContains(print_res, ticket.queue_number)
        self.assertContains(print_res, ticket.verification_code)
        self.assertContains(print_res, "window.print()")

    # -----------------------------------------------------------------
    # 7. Unit Queue Screen & Scoping
    # -----------------------------------------------------------------
    def test_unit_queue_access_and_scoping(self):
        # Without permission -> 403
        self.client.force_login(self.regular_user)
        res = self.client.get('/unit/queue/')
        self.assertEqual(res.status_code, 403)

        # Unit staff for LRLS logs in
        self.client.force_login(self.unit_user)
        res = self.client.get('/unit/queue/')
        self.assertEqual(res.status_code, 200)
        self.assertContains(res, "Unit Queue Board: <span style=\"color: var(--dole-blue);\">TSSD-LRLS</span>")

        # Issue a ticket with services for both LRLS and EW
        ticket = issue_ticket(office=self.ro3, services=[self.srv_labor, self.srv_tupad])
        res = self.client.get('/unit/queue/')
        self.assertContains(res, ticket.queue_number)
        self.assertContains(res, "Labor Rights Query")
        # LRLS board must only show items for LRLS, not EW!
        self.assertNotContains(res, "TSSD-EW (BUL-EW)")

    # -----------------------------------------------------------------
    # 8. Database View: csm_survey_eligibility
    # -----------------------------------------------------------------
    def test_csm_survey_eligibility_view(self):
        now = timezone.now()

        # Ticket with 3 services
        ticket = issue_ticket(office=self.ro3, services=[self.srv_labor, self.srv_tupad])
        item_done = ticket.items.get(service=self.srv_labor)
        item_waiting = ticket.items.get(service=self.srv_tupad)

        # 1. Waiting item: not eligible
        # 2. Done item within 3 days: eligible
        call_item(item_done, user=self.unit_user)
        start_item(item_done, user=self.unit_user)
        complete_item(item_done, user=self.unit_user)
        item_done.refresh_from_db()

        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT ticket_item_id, item_status, is_eligible FROM csm_survey_eligibility WHERE ticket_item_id = %s",
                [item_done.id]
            )
            row_done = cursor.fetchone()
            self.assertIsNotNone(row_done)
            self.assertEqual(row_done[1], 'DONE')
            self.assertEqual(bool(row_done[2]), True)

            cursor.execute(
                "SELECT ticket_item_id, item_status, is_eligible FROM csm_survey_eligibility WHERE ticket_item_id = %s",
                [item_waiting.id]
            )
            row_waiting = cursor.fetchone()
            self.assertIsNotNone(row_waiting)
            self.assertEqual(row_waiting[1], 'WAITING')
            self.assertEqual(bool(row_waiting[2]), False)

            # 3. Already surveyed item: not eligible
            item_done.survey_submitted_at = now
            item_done.save()

            cursor.execute(
                "SELECT ticket_item_id, is_eligible FROM csm_survey_eligibility WHERE ticket_item_id = %s",
                [item_done.id]
            )
            row_surveyed = cursor.fetchone()
            self.assertEqual(bool(row_surveyed[1]), False)

            # 4. Expired item (completed 4 days ago): not eligible
            item_done.survey_submitted_at = None
            item_done.completed_at = now - timedelta(days=4)
            item_done.save()

            cursor.execute(
                "SELECT ticket_item_id, is_eligible FROM csm_survey_eligibility WHERE ticket_item_id = %s",
                [item_done.id]
            )
            row_expired = cursor.fetchone()
            self.assertEqual(bool(row_expired[1]), False)

    # -----------------------------------------------------------------
    # 7. PCT Compliance Report View & QR Utilities
    # -----------------------------------------------------------------
    def test_pct_report_view_and_calculations(self):
        from .qr import generate_qr_data_uri, generate_qr_bytes

        # Must require login
        res_anon = self.client.get('/reports/pct/')
        self.assertEqual(res_anon.status_code, 302)

        # Authenticated access
        self.client.force_login(self.pacd_user)
        res = self.client.get('/reports/pct/')
        self.assertEqual(res.status_code, 200)
        self.assertContains(res, "Processing Cycle Time (PCT) Compliance Report")

        # Create a completed transaction today
        ticket = issue_ticket(office=self.ro3, services=[self.srv_labor])
        item = ticket.items.first()
        call_item(item, user=self.unit_user)
        start_item(item, user=self.unit_user)
        complete_item(item, user=self.unit_user)

        # Filter by today's date and office
        res_filtered = self.client.get(f'/reports/pct/?office_id={self.ro3.id}&unit_id={self.unit_lrls.id}')
        self.assertEqual(res_filtered.status_code, 200)
        self.assertContains(res_filtered, "Labor Rights Query")

        # Edge case: non-integer / malformed params must not cause 500 error
        res_malformed = self.client.get('/reports/pct/?office_id=invalid&unit_id=also_bad&start_date=wrong&end_date=bad')
        self.assertEqual(res_malformed.status_code, 200)

        # Edge case: inverted dates
        res_inverted = self.client.get('/reports/pct/?start_date=2026-12-31&end_date=2026-01-01')
        self.assertEqual(res_inverted.status_code, 200)

    def test_qr_utilities(self):
        from .qr import generate_qr_data_uri, generate_qr_bytes

        # Empty / None handling
        self.assertEqual(generate_qr_data_uri(''), '')
        self.assertEqual(generate_qr_data_uri(None), '')
        self.assertEqual(generate_qr_bytes(''), b'')
        self.assertEqual(generate_qr_bytes(None), b'')

        # Valid payload
        uri = generate_qr_data_uri("https://example.com/test", fill_color="#0305ba")
        self.assertTrue(uri.startswith("data:image/png;base64,"))

        # Binary output
        raw = generate_qr_bytes("https://example.com/test", fill_color="black")
        self.assertEqual(raw[:8], b'\x89PNG\r\n\x1a\n')

