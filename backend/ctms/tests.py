from datetime import timedelta
from django.core.cache import cache
from unittest import mock

from django.test import TestCase, override_settings
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework import status

from .models import (
    CsmDivision,
    CsmOffice,
    CsmService,
    CsmResponse,
    CtmsCounter,
    CtmsStaffOffice,
    CtmsTransaction,
    DolePersonnel,
    DolePosition,
    CtmsAuditLog,
    CtmsNotification,
    CtmsOfficeQrConfig,
    CtmsDisplayConfig,
    CtmsAssignmentHistory,
    CtmsOfficeProfile,
    CtmsCallAnnouncement,
)
from .services import (
    create_transaction,
    call_next_transaction,
    call_transaction,
    mark_done,
    undo_done,
    requeue_transaction,
    cancel_transaction,
    current_office_code_period,
    mark_pending,
    transfer_transaction,
)
from .serializers import StaffTransactionSerializer

User = get_user_model()

class CsmTablesTestCase(TestCase):
    """Creates the CSM-owned (unmanaged) tables that the test database does not migrate."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        from django.db import connection
        with connection.cursor() as cursor:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS csm_office (
                    id integer PRIMARY KEY AUTOINCREMENT,
                    name varchar(200) NOT NULL UNIQUE,
                    code varchar(10) NOT NULL UNIQUE,
                    is_active bool NOT NULL,
                    qr_issued_at datetime NULL
                );
            """)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS csm_service (
                    id integer PRIMARY KEY AUTOINCREMENT,
                    name varchar(200) NOT NULL UNIQUE,
                    is_active bool NOT NULL,
                    sort_order smallint unsigned NOT NULL,
                    division_id bigint NULL
                );
            """)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS csm_division (
                    id integer PRIMARY KEY AUTOINCREMENT,
                    name varchar(100) NOT NULL UNIQUE
                );
            """)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS csm_csmresponse (
                    id integer PRIMARY KEY AUTOINCREMENT,
                    ctms_transaction_id bigint NULL UNIQUE,
                    created_at datetime NOT NULL
                );
            """)

    @classmethod
    def tearDownClass(cls):
        from django.db import connection
        with connection.cursor() as cursor:
            cursor.execute("DROP TABLE IF EXISTS csm_csmresponse;")
            cursor.execute("DROP TABLE IF EXISTS csm_service;")
            cursor.execute("DROP TABLE IF EXISTS csm_office;")
            cursor.execute("DROP TABLE IF EXISTS csm_division;")
        super().tearDownClass()


class CtmsCoreTestCase(CsmTablesTestCase):
    def setUp(self):
        cache.clear()  # public check-in throttle counts must not leak between tests
        self.client = APIClient()
        self.office = CsmOffice.objects.create(name="DOLE Pampanga Field Office", code="CRK", is_active=True)
        self.service = CsmService.objects.create(name="SEnA Assistance", is_active=True, sort_order=1)
        self.counter1 = CtmsCounter.objects.create(office=self.office, name="Window 1", is_active=True)
        self.counter2 = CtmsCounter.objects.create(office=self.office, name="Window 2", is_active=True)
        
        self.staff_user = User.objects.create_user(username="teststaff", password="password123", is_staff=True)
        CtmsStaffOffice.objects.create(user=self.staff_user, office=self.office)
        self.counter1.assigned_user = self.staff_user
        self.counter1.save()

    def test_transaction_numbering_and_tokens(self):
        tx = create_transaction(self.office, self.service, client_name="Juan Dela Cruz", is_priority=False)
        today_yymmdd = timezone.localdate().strftime('%y%m%d')

        self.assertEqual(tx.transaction_no, f"CRK-{today_yymmdd}-0001")
        self.assertEqual(tx.queue_no, "001")
        self.assertEqual(len(tx.claim_code), 4)
        self.assertTrue(tx.ticket_token)
        self.assertTrue(tx.survey_token)
        self.assertNotEqual(tx.ticket_token, tx.survey_token)
        self.assertEqual(tx.status, 'waiting')

    def test_priority_lane_ordering(self):
        # Create regular client first
        tx_regular = create_transaction(self.office, self.service, client_name="Regular Client", is_priority=False)
        # Create priority client second
        tx_priority = create_transaction(self.office, self.service, client_name="Senior Client", is_priority=True)

        self.assertEqual(tx_priority.queue_no, "P-002")

        # Staff calls next -> Priority client must be called first despite checking in later!
        called = call_next_transaction(self.office, self.staff_user)
        self.assertIsNotNone(called)
        self.assertEqual(called.id, tx_priority.id)
        self.assertEqual(called.status, 'serving')
        self.assertEqual(called.counter, self.counter1)
        mark_done(called, self.staff_user)

        # Second call -> Regular client called
        called_second = call_next_transaction(self.office, self.staff_user)
        self.assertEqual(called_second.id, tx_regular.id)

    def test_done_and_survey_hand_off(self):
        tx = create_transaction(self.office, self.service, is_priority=False)
        call_next_transaction(self.office, self.staff_user)
        tx.refresh_from_db()

        # Mark done
        mark_done(tx, self.staff_user)
        tx.refresh_from_db()
        self.assertEqual(tx.status, 'done')
        self.assertIsNotNone(tx.done_at)
        self.assertTrue(tx.survey_url)

        # Before survey, undo done is permitted
        undo_done(tx)
        tx.refresh_from_db()
        self.assertEqual(tx.status, 'serving')
        self.assertIsNone(tx.done_at)

        # Mark done again and simulate CSM survey completed
        mark_done(tx, self.staff_user)
        CsmResponse.objects.create(ctms_transaction_id=tx.id)
        tx.refresh_from_db()

        self.assertTrue(tx.is_surveyed)
        self.assertIsNone(tx.survey_url) # Unlocked button hides once already surveyed

        # Undo done must now be refused!
        with self.assertRaises(ValueError):
            undo_done(tx)

    def test_display_board_never_leaks_client_names(self):
        create_transaction(self.office, self.service, client_name="Confidential Name", is_priority=False)
        res = self.client.get(f"/api/public/display/{self.office.id}/")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        
        content = res.content.decode('utf-8')
        self.assertNotIn("Confidential Name", content)
        self.assertIn("001", content)

    def test_first_time_login_password_change(self):
        admin_user = User.objects.create_superuser(username="admin_sec", password="adminpassword")

        # Admin creates a new account (credentials + personnel profile in one step)
        self.client.force_authenticate(user=admin_user)
        res_create = self.client.post("/api/staff/users/", data={
            "username": "EMP-9999",
            "employee_id": "EMP-9999",
            "first_name": "Pedro",
            "last_name": "Penduko",
            "office": self.office.id,
            "password": "EMP-9999",
        }, format='json')
        self.assertEqual(res_create.status_code, status.HTTP_201_CREATED)

        emp = DolePersonnel.objects.get(employee_id="EMP-9999")
        self.assertTrue(emp.must_change_password)

        # Login as new employee
        self.client.logout()
        res_login = self.client.post("/api/staff/auth/login/", data={
            "username": "EMP-9999",
            "password": "EMP-9999",
        }, format='json', HTTP_HOST='localhost')
        self.assertEqual(res_login.status_code, status.HTTP_200_OK)
        self.assertTrue(res_login.data["user"]["must_change_password"])

        # Change password via endpoint
        token = res_login.data["access"]
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')

        # Reusing same password should fail
        res_same = self.client.post("/api/staff/auth/change-password/", data={
            "current_password": "EMP-9999",
            "new_password": "EMP-9999",
            "confirm_password": "EMP-9999",
        }, format='json')
        self.assertEqual(res_same.status_code, status.HTTP_400_BAD_REQUEST)

        # Set new valid password
        res_change = self.client.post("/api/staff/auth/change-password/", data={
            "current_password": "EMP-9999",
            "new_password": "SecurePassword2026!",
            "confirm_password": "SecurePassword2026!",
        }, format='json')
        self.assertEqual(res_change.status_code, status.HTTP_200_OK)
        self.assertFalse(res_change.data["must_change_password"])

        emp.refresh_from_db()
        self.assertFalse(emp.must_change_password)

        # Check me endpoint now returns must_change_password = False
        res_me = self.client.get("/api/staff/auth/me/")
        self.assertEqual(res_me.status_code, status.HTTP_200_OK)
        self.assertFalse(res_me.data["must_change_password"])

    def test_transactions_list_division_and_assigned_personnel(self):
        div_tssd1 = CsmDivision.objects.create(name="TSSD 1")
        div_imsd = CsmDivision.objects.create(name="IMSD")

        srv1 = CsmService.objects.create(name="Labor Standards", division=div_tssd1, is_active=True, sort_order=10)
        srv2 = CsmService.objects.create(name="Records Management", division=div_imsd, is_active=True, sort_order=11)

        tx1 = create_transaction(self.office, srv1, client_name="Maria Santos", is_priority=False)
        tx1.assigned_personnel = "Officer Pedro"
        tx1.save()

        tx2 = create_transaction(self.office, srv2, client_name="Carlos Reyes", is_priority=False)
        tx2.assigned_personnel = "Officer Ana"
        tx2.save()

        self.client.force_authenticate(user=self.staff_user)

        # 1. Fetch transactions list and verify division_name & assigned_personnel are present
        res = self.client.get("/api/staff/transactions/")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        tx1_data = next((t for t in res.data if t["id"] == tx1.id), None)
        self.assertIsNotNone(tx1_data)
        self.assertEqual(tx1_data["division_name"], "TSSD 1")
        self.assertEqual(tx1_data["assigned_personnel"], "Officer Pedro")

        # 2. Filter by division name
        res_filter = self.client.get("/api/staff/transactions/?division=TSSD 1")
        self.assertEqual(res_filter.status_code, status.HTTP_200_OK)
        ids = [t["id"] for t in res_filter.data]
        self.assertIn(tx1.id, ids)
        self.assertNotIn(tx2.id, ids)

        # 3. Filter by personnel name
        res_psn = self.client.get("/api/staff/transactions/?personnel=Pedro")
        self.assertEqual(res_psn.status_code, status.HTTP_200_OK)
        ids_psn = [t["id"] for t in res_psn.data]
        self.assertIn(tx1.id, ids_psn)
        self.assertNotIn(tx2.id, ids_psn)

        # 4. Search query (q) matching assigned personnel
        res_q = self.client.get("/api/staff/transactions/?q=Pedro")
        self.assertEqual(res_q.status_code, status.HTTP_200_OK)
        ids_q = [t["id"] for t in res_q.data]
        self.assertIn(tx1.id, ids_q)
        self.assertNotIn(tx2.id, ids_q)

    def test_audit_log_endpoint_and_logging(self):
        from .models import CtmsAuditLog, log_audit_event
        # 1. Non-admin (staff) cannot view audit logs
        self.client.force_authenticate(user=self.staff_user)
        res = self.client.get("/api/staff/audit-logs/")
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

        # 2. Admin can access audit logs
        admin_user = User.objects.create_superuser(username="admin_audit", password="password123", email="admin@dole.gov.ph")
        self.client.force_authenticate(user=admin_user)
        res_admin = self.client.get("/api/staff/audit-logs/")
        self.assertEqual(res_admin.status_code, status.HTTP_200_OK)
        self.assertIn("results", res_admin.data)
        self.assertIn("category_counts", res_admin.data)

        # 3. Test logging an event
        log = log_audit_event(
            action='TEST_ACTION',
            category=CtmsAuditLog.CATEGORY_CONFIG,
            actor=admin_user,
            target_type='Config',
            target_repr='Test Config Target',
            office=self.office,
            description='Test audit event description',
            details={'test_key': 'test_val'}
        )
        self.assertIsNotNone(log)
        self.assertEqual(log.action, 'TEST_ACTION')

        # 4. Verify filtered retrieval
        res_filter = self.client.get("/api/staff/audit-logs/?action=TEST_ACTION")
        self.assertEqual(res_filter.status_code, status.HTTP_200_OK)
        self.assertEqual(res_filter.data['total_count'], 1)
        self.assertEqual(res_filter.data['results'][0]['action'], 'TEST_ACTION')

    def test_group_registration_with_member_names(self):
        # 1. Test public check-in endpoint with a group of 8 members
        members_8 = [
            "Juan Dela Cruz", "Maria Santos", "Pedro Penduko", "Ana Reyes",
            "Carlos Garcia", "Elena Bautista", "Ramon Ramos", "Teresa Cruz"
        ]
        res_pub = self.client.post("/api/public/checkin/", {
            "office": self.office.id,
            "service": self.service.id,
            "client_name": "Juan Dela Cruz (Group of 8)",
            "is_priority": False,
            "group_member_names": members_8,
        })
        self.assertEqual(res_pub.status_code, status.HTTP_201_CREATED)
        tx_id = res_pub.data['transaction_no']
        tx = CtmsTransaction.objects.get(transaction_no=tx_id)
        self.assertEqual(len(tx.group_member_names), 8)
        self.assertEqual(tx.group_member_names, members_8)

        # 2. Test staff walkin endpoint with group members
        self.client.force_authenticate(user=self.staff_user)
        members_3 = ["Alice Bob", "Charlie Dave", "Eve Frank"]
        res_walkin = self.client.post("/api/staff/transactions/walkin/", {
            "office": self.office.id,
            "service": self.service.id,
            "client_name": "Alice Bob (Group of 3)",
            "is_priority": False,
            "group_member_names": members_3,
        })
        self.assertEqual(res_walkin.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res_walkin.data['group_member_names'], members_3)

        # 3. Test searching transactions by a member name in staff history
        res_search = self.client.get(f"/api/staff/transactions/?office={self.office.id}&q=Teresa")
        self.assertEqual(res_search.status_code, status.HTTP_200_OK)
        self.assertTrue(any(t['transaction_no'] == tx.transaction_no for t in res_search.data))

    def test_delete_waiting_ticket_action(self):
        """
        Verify that staff can delete a ticket from the waiting line.
        """
        staff_client = APIClient()
        staff_client.force_authenticate(user=self.staff_user)

        tx = create_transaction(self.office, self.service, client_name="Wrong Client")
        tx_id = tx.id
        self.assertEqual(tx.status, CtmsTransaction.STATUS_WAITING)

        # Delete transaction from waiting line
        res_del = staff_client.post(f"/api/staff/transactions/{tx_id}/delete/")
        self.assertEqual(res_del.status_code, status.HTTP_200_OK)
        self.assertTrue(res_del.data.get('deleted'))

        # Verify transaction is permanently deleted from database
        self.assertFalse(CtmsTransaction.objects.filter(id=tx_id).exists())

        # Verify audit log recorded the deletion
        audit = CtmsAuditLog.objects.filter(action='DELETE_TICKET', target_id=str(tx_id)).first()
        self.assertIsNotNone(audit)
        self.assertIn("Deleted Queue", audit.description)

    def test_delete_ongoing_ticket_but_not_finished_one(self):
        staff_client = APIClient()
        staff_client.force_authenticate(user=self.staff_user)

        serving = create_transaction(self.office, self.service, client_name="Duplicate")
        CtmsTransaction.objects.filter(pk=serving.pk).update(status=CtmsTransaction.STATUS_SERVING)
        res = staff_client.post(f"/api/staff/transactions/{serving.id}/delete/")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertFalse(CtmsTransaction.objects.filter(id=serving.id).exists())

        done = create_transaction(self.office, self.service, client_name="Finished")
        CtmsTransaction.objects.filter(pk=done.pk).update(status=CtmsTransaction.STATUS_DONE)
        res = staff_client.post(f"/api/staff/transactions/{done.id}/delete/")
        self.assertEqual(res.status_code, status.HTTP_409_CONFLICT)
        self.assertTrue(CtmsTransaction.objects.filter(id=done.id).exists())

    def test_transaction_start_and_done_date_saving(self):
        """
        Verify that:
        1. When a transaction starts serving, started_at is stamped with current date/time.
        2. When a transaction is completed, done_at is stamped with current date/time.
        3. Serializers correctly expose started_at, done_at, and duration calculations.
        4. Undo done clears done_at while preserving started_at.
        5. Requeueing resets started_at back to None.
        """
        tx = create_transaction(self.office, self.service, is_priority=False, client_name="Juan Dela Cruz")
        self.assertIsNone(tx.started_at)
        self.assertIsNone(tx.done_at)

        # 1. Calling transaction sets started_at
        call_transaction(tx, self.staff_user)
        tx.refresh_from_db()
        self.assertEqual(tx.status, 'serving')
        self.assertIsNotNone(tx.started_at)
        self.assertIsNotNone(tx.called_at)
        self.assertEqual(tx.started_at, tx.called_at)
        orig_started_at = tx.started_at

        # 2. Recalling transaction does not overwrite original started_at
        call_transaction(tx, self.staff_user)
        tx.refresh_from_db()
        self.assertEqual(tx.started_at, orig_started_at)

        # 3. Staff serializer output verification
        data = StaffTransactionSerializer(tx).data
        self.assertIn('started_at', data)
        self.assertIn('done_at', data)
        self.assertIsNotNone(data['started_at'])
        self.assertIsNone(data['done_at'])
        self.assertIsNone(data['service_duration_seconds'])

        # 4. Mark Done records done_at
        mark_done(tx, self.staff_user)
        tx.refresh_from_db()
        self.assertEqual(tx.status, 'done')
        self.assertIsNotNone(tx.done_at)
        self.assertGreaterEqual(tx.done_at, tx.started_at)

        data_done = StaffTransactionSerializer(tx).data
        self.assertIsNotNone(data_done['done_at'])
        self.assertIsNotNone(data_done['service_duration_seconds'])
        self.assertIsNotNone(data_done['service_duration_display'])

        # 5. Undo Done clears done_at but preserves started_at
        undo_done(tx)
        tx.refresh_from_db()
        self.assertEqual(tx.status, 'serving')
        self.assertIsNone(tx.done_at)
        self.assertEqual(tx.started_at, orig_started_at)

        # 6. Requeue clears started_at
        requeue_transaction(tx)
        tx.refresh_from_db()
        self.assertEqual(tx.status, 'waiting')
        self.assertIsNone(tx.started_at)

    def test_qr_code_enable_disable_and_office_hours_blocking(self):
        # 1. By default, office QR code is enabled
        res_public = self.client.get(f'/api/public/offices/{self.office.id}/')
        self.assertEqual(res_public.status_code, 200)
        self.assertTrue(res_public.data['is_qr_enabled'])

        # Staff gets QR config
        self.client.force_authenticate(user=self.staff_user)
        res_cfg = self.client.get(f'/api/staff/qr-config/?office={self.office.id}')
        self.assertEqual(res_cfg.status_code, 200)
        self.assertTrue(res_cfg.data['is_qr_enabled'])

        # Checkin works normally when enabled
        self.client.force_authenticate(user=None)
        res_checkin = self.client.post('/api/public/checkin/', {
            'office': self.office.id,
            'service': self.service.id,
            'client_name': 'Test Citizen'
        }, format='json')
        self.assertEqual(res_checkin.status_code, 201)
        self.assertIn('ticket_token', res_checkin.data)

        # 2. Staff toggles QR code OFF (beyond office hours)
        self.client.force_authenticate(user=self.staff_user)
        custom_msg = "Office is closed. Registration is only open 8am-5pm."
        res_toggle_off = self.client.post('/api/staff/qr-config/toggle/', {
            'office_id': self.office.id,
            'is_qr_enabled': False,
            'disabled_message': custom_msg,
        }, format='json')
        self.assertEqual(res_toggle_off.status_code, 200)
        self.assertFalse(res_toggle_off.data['is_qr_enabled'])
        self.assertEqual(res_toggle_off.data['disabled_message'], custom_msg)

        # Verify audit log was recorded
        audit = CtmsAuditLog.objects.filter(action='DISABLE_QR').latest('timestamp')
        self.assertEqual(audit.actor, self.staff_user)
        self.assertEqual(audit.details.get('office_id'), self.office.id)

        # 3. Public Office Detail reflects disabled state
        self.client.force_authenticate(user=None)
        res_public_closed = self.client.get(f'/api/public/offices/{self.office.id}/')
        self.assertEqual(res_public_closed.status_code, 200)
        self.assertFalse(res_public_closed.data['is_qr_enabled'])
        self.assertEqual(res_public_closed.data['disabled_message'], custom_msg)

        # 4. Public Checkin is BLOCKED with 403 Forbidden and code 'QR_DISABLED'
        res_checkin_blocked = self.client.post('/api/public/checkin/', {
            'office': self.office.id,
            'service': self.service.id,
            'client_name': 'Late Citizen'
        }, format='json')
        self.assertEqual(res_checkin_blocked.status_code, 403)
        self.assertEqual(res_checkin_blocked.data['code'], 'QR_DISABLED')
        self.assertEqual(res_checkin_blocked.data['message'], custom_msg)

        # 5. Staff walk-in registration at counter is NOT blocked
        self.client.force_authenticate(user=self.staff_user)
        res_walkin = self.client.post('/api/staff/transactions/walkin/', {
            'office': self.office.id,
            'service': self.service.id,
            'client_name': 'Emergency Walk-in'
        }, format='json')
        self.assertEqual(res_walkin.status_code, 201)

        # 6. Re-enabling QR code restores public check-in
        res_toggle_on = self.client.post('/api/staff/qr-config/toggle/', {
            'office_id': self.office.id,
            'is_qr_enabled': True,
        }, format='json')
        self.assertEqual(res_toggle_on.status_code, 200)
        self.assertTrue(res_toggle_on.data['is_qr_enabled'])

        # Audit log for re-enable
        audit_enable = CtmsAuditLog.objects.filter(action='ENABLE_QR').latest('timestamp')
        self.assertEqual(audit_enable.actor, self.staff_user)

        self.client.force_authenticate(user=None)
        res_checkin_open = self.client.post('/api/public/checkin/', {
            'office': self.office.id,
            'service': self.service.id,
            'client_name': 'Next Day Citizen'
        }, format='json')
        self.assertEqual(res_checkin_open.status_code, 201)

        # 7. Unauthorized staff cannot toggle
        unauthorized_user = User.objects.create_user(username="otherstaff", password="password123", is_staff=True)
        self.client.force_authenticate(user=unauthorized_user)
        res_unauthorized = self.client.post('/api/staff/qr-config/toggle/', {
            'office_id': self.office.id,
            'is_qr_enabled': False,
        }, format='json')
        self.assertEqual(res_unauthorized.status_code, 403)

    @override_settings(CSM_SURVEY_BASE_URL='http://ctms.dolero3.lan:5173')  # the wrong live value must not matter
    def test_ticket_links_to_its_office_csm_survey(self):
        aurora = CsmOffice.objects.create(id=6, name="Aurora Field Office", code="AUR", is_active=True)
        bataan = CsmOffice.objects.create(id=7, name="Bataan Field Office", code="BAT", is_active=True)
        regional = CsmOffice.objects.create(id=18, name="DOLE Regional Office III", code="RO3", is_active=True)
        for office, url in ((aurora, 'http://csm.dolero3.lan/survey/office/6'),
                            (bataan, 'http://csm.dolero3.lan/survey/office/7'),
                            (regional, 'http://csm.dolero3.lan/survey/office/18')):
            tx = create_transaction(office, self.service, client_name='Juan')
            ticket = self.client.get(f'/api/public/tickets/{tx.ticket_token}/').data
            self.assertEqual(ticket['office_survey_url'], url)

        # A finished ticket's own survey link uses the same CSM address
        done_tx = create_transaction(self.office, self.service, client_name='Maria')
        mark_done(call_transaction(done_tx, self.staff_user), self.staff_user)
        ticket = self.client.get(f'/api/public/tickets/{done_tx.ticket_token}/').data
        self.assertEqual(ticket['survey_url'], f'http://csm.dolero3.lan/survey/t/{done_tx.survey_token}')

    def test_staff_login_ignores_username_capitals_but_not_password(self):
        User.objects.create_user(username="DOLE-ADMIN", password="S3cret!pass", is_staff=True)

        def login(username, password):
            return self.client.post('/api/staff/auth/login/', {'username': username, 'password': password}, format='json')

        for typed in ("DOLE-ADMIN", "dole-admin", "Dole-Admin", "  dole-admin "):
            res = login(typed, "S3cret!pass")
            self.assertEqual(res.status_code, 200, typed)
            self.assertEqual(res.data['user']['username'], "DOLE-ADMIN")
            cache.clear()  # stay under the 5-per-minute sign-in limit
        # The password is still case-sensitive, and unknown users are refused
        self.assertEqual(login("dole-admin", "s3cret!pass").status_code, 401)
        self.assertEqual(login("nobody", "S3cret!pass").status_code, 401)
        # The audit log records the real account
        self.assertEqual(CtmsAuditLog.objects.filter(action='LOGIN').latest('timestamp').target_repr, "User 'DOLE-ADMIN'")

    def test_login_picks_the_exact_account_when_two_differ_only_by_capitals(self):
        User.objects.create_user(username="ana", password="lower-pass", is_staff=True)
        User.objects.create_user(username="ANA", password="upper-pass", is_staff=True)
        res = self.client.post('/api/staff/auth/login/', {'username': 'ANA', 'password': 'upper-pass'}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['user']['username'], "ANA")

    def test_public_individual_checkin_needs_a_name_or_anonymous(self):
        def checkin(**extra):
            return self.client.post('/api/public/checkin/', {
                'office': self.office.id, 'service': self.service.id, **extra}, format='json')

        # Blank, missing, or null name: a clear message, never "may not be null"
        for extra in ({}, {'client_name': ''}, {'client_name': '   '}, {'client_name': None}):
            res = checkin(**extra)
            self.assertEqual(res.status_code, 400, extra)
            self.assertEqual(res.data['code'], 'NAME_REQUIRED')
            self.assertIn('Anonymous', res.data['detail'])

        self.assertEqual(checkin(client_name='Juan Dela Cruz').status_code, 201)
        self.assertEqual(checkin(client_name='Anonymous').status_code, 201)
        # Groups always carry a representative name in client_name, plus the members
        self.assertEqual(checkin(client_name='Anonymous (Group of 2)', group_member_names=['A', 'B']).status_code, 201)

        # Staff walk-ins may still leave the name blank
        self.client.force_authenticate(user=self.staff_user)
        res_walkin = self.client.post('/api/staff/transactions/walkin/', {
            'office': self.office.id, 'service': self.service.id, 'client_name': ''}, format='json')
        self.assertEqual(res_walkin.status_code, 201)

    def test_other_service_requires_a_concern_note(self):
        other = CsmService.objects.create(name="Other Services (IMSD)", is_active=True, sort_order=99)

        # The public office page flags which services need a concern note
        pub = self.client.get(f'/api/public/offices/{self.office.id}/').data
        flags = {s['id']: s['requires_concern'] for s in pub['services']}
        self.assertTrue(flags[other.id])
        self.assertFalse(flags[self.service.id])

        # An ordinary service never needs one
        res_ok = self.client.post('/api/public/checkin/', {
            'office': self.office.id, 'service': self.service.id, 'client_name': 'Juan',
        }, format='json')
        self.assertEqual(res_ok.status_code, 201)

        # "Other..." without a concern note is rejected
        res_missing = self.client.post('/api/public/checkin/', {
            'office': self.office.id, 'service': other.id, 'client_name': 'Maria',
        }, format='json')
        self.assertEqual(res_missing.status_code, 400)
        self.assertIn('concern_note', res_missing.data)

        # Blank/whitespace-only is rejected too
        res_blank = self.client.post('/api/public/checkin/', {
            'office': self.office.id, 'service': other.id, 'client_name': 'Maria', 'concern_note': '   ',
        }, format='json')
        self.assertEqual(res_blank.status_code, 400)

        # With a concern note, it succeeds and staff can see what was typed
        res_created = self.client.post('/api/public/checkin/', {
            'office': self.office.id, 'service': other.id, 'client_name': 'Maria',
            'concern_note': 'Asking about unpaid last pay from a previous employer',
        }, format='json')
        self.assertEqual(res_created.status_code, 201)

        self.client.force_authenticate(user=self.staff_user)
        queue = self.client.get('/api/staff/queue/').data
        waiting = {tx['client_name']: tx['concern_note'] for tx in queue['waiting']}
        self.assertEqual(waiting['Maria'], 'Asking about unpaid last pay from a previous employer')
        self.assertEqual(waiting['Juan'], '')

        # Staff creating a walk-in for an "Other..." service also needs the note
        res_walkin_missing = self.client.post('/api/staff/transactions/walkin/', {
            'office': self.office.id, 'service': other.id, 'client_name': 'Ben',
        }, format='json')
        self.assertEqual(res_walkin_missing.status_code, 400)
        res_walkin_ok = self.client.post('/api/staff/transactions/walkin/', {
            'office': self.office.id, 'service': other.id, 'client_name': 'Ben', 'concern_note': 'OSH complaint',
        }, format='json')
        self.assertEqual(res_walkin_ok.status_code, 201)

    def test_hourly_office_code_blocks_off_site_checkin(self):
        def checkin(code=None):
            body = {'office': self.office.id, 'service': self.service.id, 'client_name': 'Citizen'}
            if code is not None:
                body['office_code'] = code
            return self.client.post('/api/public/checkin/', body, format='json')

        # Off by default: no code needed, none generated
        self.client.force_authenticate(user=self.staff_user)
        cfg = self.client.get(f'/api/staff/qr-config/?office={self.office.id}').data
        self.assertFalse(cfg['requires_office_code'])
        self.assertIsNone(cfg['office_code'])
        display_key = cfg['display_key']
        self.assertTrue(display_key)

        # Staff turns it on and sees this hour's 4-digit code and when it changes
        res_on = self.client.post('/api/staff/qr-config/office-code/', {
            'office_id': self.office.id, 'requires_office_code': True}, format='json')
        self.assertEqual(res_on.status_code, 200)
        self.assertTrue(res_on.data['requires_office_code'])
        code = res_on.data['office_code']
        self.assertRegex(code, r'^\d{4}$')
        self.assertEqual(
            res_on.data['office_code_valid_until'],
            (current_office_code_period() + timedelta(hours=1)).isoformat())
        self.assertTrue(CtmsAuditLog.objects.filter(action='ENABLE_OFFICE_CODE').exists())
        self.assertNotIn(code, str(CtmsAuditLog.objects.filter(action='ENABLE_OFFICE_CODE').values()))

        # Public office page says a code is needed but never reveals it
        self.client.force_authenticate(user=None)
        pub = self.client.get(f'/api/public/offices/{self.office.id}/').data
        self.assertTrue(pub['requires_office_code'])
        self.assertNotIn(code, str(pub))

        # Missing or wrong code is refused; the right code works
        self.assertEqual(checkin().data['code'], 'OFFICE_CODE_INVALID')
        wrong = '0000' if code != '0000' else '1111'
        self.assertEqual(checkin(wrong).status_code, 403)
        self.assertEqual(checkin(f' {code} ').status_code, 201)

        # TV board shows the code only with the office's secret display key
        board = self.client.get(f'/api/public/display/{self.office.id}/').data
        self.assertIsNone(board['check_in_code'])
        board = self.client.get(f'/api/public/display/{self.office.id}/?key=wrong').data
        self.assertIsNone(board['check_in_code'])
        board = self.client.get(f'/api/public/display/{self.office.id}/?key={display_key}').data
        self.assertEqual(board['check_in_code'], code)

        cache.clear()  # reset the check-in throttle for the second half
        hour = current_office_code_period()

        def at(delta):
            return mock.patch('django.utils.timezone.now', return_value=hour + delta)

        # On the next hour a new code is made; last hour's code still works for 10 minutes
        with at(timedelta(hours=1, minutes=5)):
            self.assertEqual(checkin(code).status_code, 201)
            next_code = CtmsOfficeQrConfig.objects.get(office=self.office).office_code
            self.assertNotEqual(next_code, code)
            self.assertEqual(checkin(next_code).status_code, 201)
        with at(timedelta(hours=1, minutes=11)):
            self.assertEqual(checkin(code).status_code, 403)

        # After hours with no activity, the stale code gets no grace period
        with at(timedelta(hours=3, minutes=1)):
            self.assertEqual(checkin(next_code).status_code, 403)

        # "New code" replaces the current code immediately, with no grace period
        self.client.force_authenticate(user=self.staff_user)
        new_code = self.client.get(f'/api/staff/qr-config/?office={self.office.id}').data['office_code']
        res_regen = self.client.post('/api/staff/qr-config/office-code/', {
            'office_id': self.office.id, 'regenerate': True}, format='json')
        self.assertNotEqual(res_regen.data['office_code'], new_code)
        self.client.force_authenticate(user=None)
        self.assertEqual(checkin(new_code).status_code, 403)
        self.assertEqual(checkin(res_regen.data['office_code']).status_code, 201)

        # A new TV link retires the old one
        self.client.force_authenticate(user=self.staff_user)
        res_key = self.client.post('/api/staff/qr-config/office-code/', {
            'office_id': self.office.id, 'regenerate_display_key': True}, format='json')
        self.assertNotEqual(res_key.data['display_key'], display_key)
        self.client.force_authenticate(user=None)
        board = self.client.get(f'/api/public/display/{self.office.id}/?key={display_key}').data
        self.assertIsNone(board['check_in_code'])

        # Staff from another office cannot change it
        outsider = User.objects.create_user(username="outsider", password="password123", is_staff=True)
        self.client.force_authenticate(user=outsider)
        res_forbidden = self.client.post('/api/staff/qr-config/office-code/', {
            'office_id': self.office.id, 'requires_office_code': False}, format='json')
        self.assertEqual(res_forbidden.status_code, 403)

        # Turning it off restores code-free check-in; walk-ins never need it
        self.client.force_authenticate(user=self.staff_user)
        self.client.post('/api/staff/qr-config/office-code/', {
            'office_id': self.office.id, 'requires_office_code': False}, format='json')
        self.client.force_authenticate(user=None)
        self.assertEqual(checkin().status_code, 201)

    def test_position_management_api(self):
        """Test listing, adding, and deleting positions by admin."""
        admin_user = User.objects.create_superuser(username="adminpos", password="password123")
        self.client.force_authenticate(user=admin_user)

        # 1. Listing positions automatically seeds standard positions
        res_list = self.client.get("/api/staff/positions/")
        self.assertEqual(res_list.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(len(res_list.data), 42)
        titles = [p['title'] for p in res_list.data]
        self.assertIn("Accountant II", titles)
        self.assertIn("Director", titles)

        # 2. Add a new custom position
        new_pos_title = "Senior Labor Relations Arbiter"
        res_create = self.client.post("/api/staff/positions/", {"title": new_pos_title})
        self.assertEqual(res_create.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res_create.data["title"], new_pos_title)
        self.assertTrue(res_create.data["is_custom"])
        pos_id = res_create.data["id"]

        # 3. Duplicate position rejected
        res_dup = self.client.post("/api/staff/positions/", {"title": new_pos_title.lower()})
        self.assertEqual(res_dup.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("already exists", res_dup.data["detail"])

        # 4. Cannot delete standard position
        standard_pos = DolePosition.objects.filter(is_custom=False).first()
        res_del_std = self.client.delete(f"/api/staff/positions/{standard_pos.id}/")
        self.assertEqual(res_del_std.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Standard DOLE positions cannot be deleted", res_del_std.data["detail"])

        # 5. Delete custom position succeeds when not assigned to personnel
        res_del_custom = self.client.delete(f"/api/staff/positions/{pos_id}/")
        self.assertEqual(res_del_custom.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(DolePosition.objects.filter(id=pos_id).exists())


class SeedOfficeStaffTestCase(CsmTablesTestCase):
    """seed_office_staff runs on every container start and must not clobber existing accounts."""

    def setUp(self):
        CsmOffice.objects.create(name="Clark Satellite Office", code="CRK", is_active=True)

    def test_existing_staff_password_and_status_are_preserved(self):
        from django.core.management import call_command

        call_command('seed_office_staff', verbosity=0)
        user = User.objects.get(username='staff_crk')
        self.assertTrue(user.check_password('staff123'))

        user.set_password('changed-by-admin')
        user.is_active = False
        user.save()

        call_command('seed_office_staff', verbosity=0)
        user.refresh_from_db()
        self.assertTrue(user.check_password('changed-by-admin'))
        self.assertFalse(user.is_active)

    def test_reset_passwords_flag_restores_defaults(self):
        from django.core.management import call_command

        call_command('seed_office_staff', verbosity=0)
        user = User.objects.get(username='staff_crk')
        user.set_password('changed-by-admin')
        user.is_active = False
        user.save()

        call_command('seed_office_staff', reset_passwords=True, verbosity=0)
        user.refresh_from_db()
        self.assertTrue(user.check_password('staff123'))
        self.assertTrue(user.is_active)


class Stage1DataFoundationTestCase(CsmTablesTestCase):
    """Stage 1: new ownership/window/history columns and the backfill migration."""

    def setUp(self):
        self.ro3 = CsmOffice.objects.create(name="DOLE Regional Office III", code="RO3", is_active=True)
        self.bataan = CsmOffice.objects.create(name="Bataan Field Office", code="BAT", is_active=True)
        self.service = CsmService.objects.create(name="SEnA Assistance", is_active=True, sort_order=1)
        self.officer = User.objects.create_user(username="JUAN_CRUZ", password="pw", is_staff=True)
        DolePersonnel.objects.create(
            user=self.officer, employee_id="EMP-001", first_name="Juan", last_name="Cruz", office=self.bataan
        )

    def _backfill(self):
        import importlib
        from django.apps import apps
        from types import SimpleNamespace
        from django.db import connection
        backfill = importlib.import_module('ctms.migrations.0019_stage1_backfill')
        editor = SimpleNamespace(connection=connection)
        backfill.backfill_office_profiles(apps, editor)
        backfill.backfill_transactions(apps, editor)

    def _tx(self, **kwargs):
        tx = create_transaction(self.bataan, self.service)
        CtmsTransaction.objects.filter(pk=tx.pk).update(**kwargs)
        tx.refresh_from_db()
        return tx

    def test_backfill_sets_office_types(self):
        from .models import CtmsOfficeProfile
        self._backfill()
        self.assertEqual(CtmsOfficeProfile.objects.get(office=self.ro3).office_type, CtmsOfficeProfile.TYPE_REGIONAL)
        self.assertEqual(CtmsOfficeProfile.objects.get(office=self.bataan).office_type, CtmsOfficeProfile.TYPE_PROVINCIAL)

    def test_backfill_links_legacy_handler_names_to_accounts(self):
        matched = self._tx(assigned_personnel="juan cruz", assigned_to=None)
        unmatched = self._tx(assigned_personnel="Somebody Unknown", assigned_to=None)
        self._backfill()
        matched.refresh_from_db()
        unmatched.refresh_from_db()
        self.assertEqual(matched.assigned_to, self.officer)
        self.assertIsNone(unmatched.assigned_to)
        self.assertEqual(unmatched.assigned_personnel, "Somebody Unknown")

    def test_backfill_sets_csm_attribution_name_for_done_transactions(self):
        done = self._tx(assigned_personnel="EMP-001", assigned_to=None, status=CtmsTransaction.STATUS_DONE)
        self._backfill()
        done.refresh_from_db()
        self.assertEqual(done.served_by_name, "Juan Cruz")

    def test_window_holds_one_occupant_and_user_holds_one_window(self):
        from django.db import IntegrityError, transaction as db_tx
        w1 = CtmsCounter.objects.create(office=self.bataan, name="Window 1", assigned_user=self.officer)
        w2 = CtmsCounter.objects.create(office=self.bataan, name="Window 2")
        w2.assigned_user = self.officer
        with self.assertRaises(IntegrityError), db_tx.atomic():
            w2.save()
        self.assertEqual(User.objects.get(pk=self.officer.pk).occupied_window, w1)

    def test_call_and_done_record_owner_and_csm_name(self):
        tx = create_transaction(self.bataan, self.service)
        CtmsCounter.objects.create(office=self.bataan, name="Window 1", assigned_user=self.officer)
        call_transaction(tx, self.officer)
        tx.refresh_from_db()
        self.assertEqual(tx.assigned_to, self.officer)
        self.assertEqual(tx.assigned_personnel, "Juan Cruz")

        mark_done(tx, self.officer)
        tx.refresh_from_db()
        self.assertEqual(tx.served_by, self.officer)
        self.assertEqual(tx.served_by_name, "Juan Cruz")

class Stage2WindowsTestCase(CsmTablesTestCase):
    """Stage 2: office-scoped windows with self-assignment."""

    def setUp(self):
        self.bataan = CsmOffice.objects.create(name="Bataan Field Office", code="BAT", is_active=True)
        self.pampanga = CsmOffice.objects.create(name="Pampanga Field Office", code="PAM", is_active=True)
        self.service = CsmService.objects.create(name="SEnA Assistance", is_active=True, sort_order=1)
        self.ana = self._staff("ana", self.bataan)
        self.ben = self._staff("ben", self.bataan)
        self.pam_staff = self._staff("pamstaff", self.pampanga)
        self.client = APIClient()

    def _staff(self, username, office):
        user = User.objects.create_user(username=username, password="pw", is_staff=True)
        CtmsStaffOffice.objects.create(user=user, office=office)
        return user

    def _as(self, user):
        self.client.force_authenticate(user=user)
        return self.client

    def _create(self, name, office=None, user=None, description=None):
        body = {'office': (office or self.bataan).id, 'name': name}
        if description is not None:
            body['description'] = description
        return self._as(user or self.ana).post('/api/staff/windows/', body, format='json')

    def test_window_description_is_optional_and_shown_and_editable(self):
        res = self._create("Window 1", description="Labor inspection and SEnA cases")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['description'], "Labor inspection and SEnA cases")
        w1 = res.data['id']

        # Optional: omitting it leaves it blank, never required
        res_no_desc = self._create("Window 2")
        self.assertEqual(res_no_desc.status_code, 201)
        self.assertEqual(res_no_desc.data['description'], '')

        # Shown on the window list
        listed = {w['id']: w['description'] for w in self._as(self.ana).get('/api/staff/windows/').data['windows']}
        self.assertEqual(listed[w1], "Labor inspection and SEnA cases")

        # Editable without renaming, and clearable
        res_edit = self._as(self.ana).patch(f'/api/staff/windows/{w1}/', {'description': 'OSH concerns'}, format='json')
        self.assertEqual(res_edit.status_code, 200)
        self.assertEqual(res_edit.data['name'], 'Window 1')
        self.assertEqual(res_edit.data['description'], 'OSH concerns')
        res_clear = self._as(self.ana).patch(f'/api/staff/windows/{w1}/', {'description': ''}, format='json')
        self.assertEqual(res_clear.data['description'], '')

        # Too long is rejected
        res_long = self._as(self.ana).patch(f'/api/staff/windows/{w1}/', {'description': 'x' * 121}, format='json')
        self.assertEqual(res_long.status_code, 400)

    def test_staff_create_windows_for_their_own_office_only(self):
        self.assertEqual(self._create("Window 1").status_code, 201)
        self.assertEqual(self._create("Window 1").status_code, 400)  # duplicate
        self.assertEqual(self._create("Window 1", office=self.pampanga).status_code, 403)

        listed = self._as(self.pam_staff).get('/api/staff/windows/').data['windows']
        self.assertEqual(listed, [])

    def test_assign_myself_rules(self):
        w1 = self._create("Window 1").data['id']
        w2 = self._create("Window 2").data['id']

        self.assertEqual(self._as(self.ana).post(f'/api/staff/windows/{w1}/assign-me/').status_code, 200)
        # Window already occupied by Ana
        res = self._as(self.ben).post(f'/api/staff/windows/{w1}/assign-me/')
        self.assertEqual(res.status_code, 409)
        # Ana must release Window 1 before taking Window 2
        res = self._as(self.ana).post(f'/api/staff/windows/{w2}/assign-me/')
        self.assertEqual(res.status_code, 409)
        self.assertIn("Release it", res.data['detail'])
        # Other offices cannot even see the window
        self.assertEqual(self._as(self.pam_staff).post(f'/api/staff/windows/{w1}/assign-me/').status_code, 404)

        self.assertEqual(self._as(self.ana).post(f'/api/staff/windows/{w1}/release/').status_code, 200)
        self.assertEqual(self._as(self.ana).post(f'/api/staff/windows/{w2}/assign-me/').status_code, 200)
        me = self._as(self.ana).get('/api/staff/auth/me/').data
        self.assertEqual(me['occupied_window']['id'], w2)

    def test_inactive_window_cannot_be_taken_and_deactivation_releases(self):
        w1 = self._create("Window 1").data['id']
        self._as(self.ana).post(f'/api/staff/windows/{w1}/assign-me/')
        res = self._as(self.ben).patch(f'/api/staff/windows/{w1}/', {'is_active': False}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertIsNone(res.data['assigned_user'])
        self.assertEqual(self._as(self.ben).post(f'/api/staff/windows/{w1}/assign-me/').status_code, 409)

    def test_archive_keeps_history_and_blocks_busy_windows(self):
        w1 = self._create("Window 1").data['id']
        window = CtmsCounter.objects.get(pk=w1)
        self._as(self.ana).post(f'/api/staff/windows/{w1}/assign-me/')
        tx = call_transaction(create_transaction(self.bataan, self.service), self.ana)

        self.assertEqual(self._as(self.ana).delete(f'/api/staff/windows/{w1}/').status_code, 400)
        mark_done(tx, self.ana)
        self.assertEqual(self._as(self.ana).delete(f'/api/staff/windows/{w1}/').status_code, 204)

        window.refresh_from_db()
        tx.refresh_from_db()
        self.assertIsNotNone(window.archived_at)
        self.assertEqual(tx.counter, window)
        self.assertEqual(self._as(self.ana).get('/api/staff/windows/').data['windows'], [])
        # The deleted window keeps its name for history; the name can be used again for a new window
        res = self._create("Window 1")
        self.assertEqual(res.status_code, 201)
        self.assertNotEqual(res.data['id'], w1)
        window.refresh_from_db()
        self.assertIsNotNone(window.archived_at)
        self.assertEqual(tx.counter.name, "Window 1")

    def test_deleted_window_names_can_be_reused_again_and_again(self):
        # Delete and re-add "TSSD1" several times
        for _ in range(3):
            wid = self._create("TSSD1").data['id']
            self.assertEqual(self._as(self.ana).delete(f'/api/staff/windows/{wid}/').status_code, 204)
        # Rename another window to a deleted window's name
        w2 = self._create("Window 2").data['id']
        res = self._as(self.ana).patch(f'/api/staff/windows/{w2}/', {'name': 'TSSD1'}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['name'], 'TSSD1')
        # Two current windows still can't share a name in one office
        self.assertEqual(self._create("tssd1").status_code, 400)
        # ...but another office can use it
        self.assertEqual(self._create("TSSD1", office=self.pampanga, user=self.pam_staff).status_code, 201)

    def test_queue_lists_office_windows_instead_of_division_counters(self):
        self._create("Window 1")
        CsmDivision.objects.create(name="TSSD 1")
        data = self._as(self.ana).get(f'/api/staff/queue/?office={self.bataan.id}').data
        self.assertEqual([c['name'] for c in data['counters']], ["Window 1"])
        self.assertFalse(CtmsCounter.objects.filter(office=self.bataan, name="TSSD 1").exists())

    def test_window_card_shows_current_client(self):
        w1 = self._create("Window 1").data['id']
        self._as(self.ana).post(f'/api/staff/windows/{w1}/assign-me/')
        tx = create_transaction(self.bataan, self.service)
        call_transaction(tx, self.ana)
        card = self._as(self.ana).get('/api/staff/windows/').data['windows'][0]
        self.assertEqual(card['current_client']['queue_no'], tx.queue_no)


class Stage3SharedQueueTestCase(CsmTablesTestCase):
    """Stage 3: one shared queue per office, called from windows, owned by the caller."""

    def setUp(self):
        self.bataan = CsmOffice.objects.create(name="Bataan Field Office", code="BAT", is_active=True)
        self.pampanga = CsmOffice.objects.create(name="Pampanga Field Office", code="PAM", is_active=True)
        self.tssd1 = CsmDivision.objects.create(name="TSSD 1")
        self.tssd2 = CsmDivision.objects.create(name="TSSD 2")
        self.svc_tssd1 = CsmService.objects.create(name="Rule 1020", division=self.tssd1, is_active=True, sort_order=1)
        self.svc_tssd2 = CsmService.objects.create(name="TUPAD", division=self.tssd2, is_active=True, sort_order=2)

        self.ana = self._staff("ana", self.bataan, window="Window 1")
        self.ben = self._staff("ben", self.bataan, window="Window 2")
        self.pam = self._staff("pam", self.pampanga, window="Window 1")
        self.client = APIClient()

    def _staff(self, username, office, window=None):
        user = User.objects.create_user(username=username, password="pw", is_staff=True)
        CtmsStaffOffice.objects.create(user=user, office=office)
        if window:
            CtmsCounter.objects.create(office=office, name=window, assigned_user=user)
        return user

    def _as(self, user):
        self.client.force_authenticate(user=user)
        return self.client

    def _call_next(self, user, office=None):
        return self._as(user).post('/api/staff/call-next/', {'office': (office or self.bataan).id}, format='json')

    def test_checkin_leaves_ticket_unassigned(self):
        tx = create_transaction(self.bataan, self.svc_tssd1)
        self.assertIsNone(tx.assigned_to)
        self.assertFalse(tx.assigned_personnel)
        self.assertFalse(CtmsNotification.objects.exists())

    def test_division_does_not_restrict_queue_or_calling(self):
        tx = create_transaction(self.bataan, self.svc_tssd1)
        # Any window sees and calls a ticket whatever its service division
        waiting = self._as(self.ana).get(f'/api/staff/queue/?office={self.bataan.id}').data['waiting']
        self.assertEqual([w['id'] for w in waiting], [tx.id])
        res = self._call_next(self.ana)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['id'], tx.id)
        self.assertEqual(res.data['counter_name'], "Window 1")
        self.assertEqual(res.data['assigned_to'], self.ana.id)

    def test_calling_requires_a_window(self):
        CtmsCounter.objects.filter(assigned_user=self.ben).update(assigned_user=None)
        create_transaction(self.bataan, self.svc_tssd1)
        res = self._call_next(self.ben)
        self.assertEqual(res.status_code, 409)
        self.assertIn("Windows page", res.data['detail'])

    def test_office_isolation(self):
        tx = create_transaction(self.bataan, self.svc_tssd1)
        self.assertEqual(self._call_next(self.pam, office=self.bataan).status_code, 403)
        self.assertEqual(self._as(self.pam).post(f'/api/staff/transactions/{tx.id}/call/').status_code, 403)
        self.assertEqual(self._call_next(self.pam, office=self.pampanga).status_code, 204)

    def test_a_ticket_has_one_caller(self):
        tx = create_transaction(self.bataan, self.svc_tssd1)
        self.assertEqual(self._as(self.ana).post(f'/api/staff/transactions/{tx.id}/call/').status_code, 200)
        res = self._as(self.ben).post(f'/api/staff/transactions/{tx.id}/call/')
        self.assertEqual(res.status_code, 409)
        self.assertIn("already with", res.data['detail'])
        # call-next skips it too
        self.assertEqual(self._call_next(self.ben).status_code, 204)

    def test_one_active_client_per_person(self):
        create_transaction(self.bataan, self.svc_tssd1)
        create_transaction(self.bataan, self.svc_tssd2)
        self.assertEqual(self._call_next(self.ana).status_code, 200)
        res = self._call_next(self.ana)
        self.assertEqual(res.status_code, 409)
        self.assertIn("still serving", res.data['detail'])

    def test_only_the_handler_can_update_a_ticket(self):
        tx = create_transaction(self.bataan, self.svc_tssd1)
        self._as(self.ana).post(f'/api/staff/transactions/{tx.id}/call/')
        for action in ('done', 'pending', 'requeue', 'no-show'):
            self.assertEqual(self._as(self.ben).post(f'/api/staff/transactions/{tx.id}/{action}/').status_code, 403, action)
        self.assertEqual(self._as(self.ana).post(f'/api/staff/transactions/{tx.id}/done/').status_code, 200)

    def test_pending_resume_done_history(self):
        from .models import CtmsAssignmentHistory
        tx = create_transaction(self.bataan, self.svc_tssd1)
        self._as(self.ana)
        self.client.post(f'/api/staff/transactions/{tx.id}/call/')
        self.client.post(f'/api/staff/transactions/{tx.id}/pending/', {'reason': 'Missing ID'}, format='json')
        # Pending stays with Ana and is hidden from Ben's queue view
        ben_pending = self._as(self.ben).get(f'/api/staff/queue/?office={self.bataan.id}').data['pending']
        self.assertEqual(ben_pending, [])
        self._as(self.ana).post(f'/api/staff/transactions/{tx.id}/call/')
        self.client.post(f'/api/staff/transactions/{tx.id}/done/')

        events = list(CtmsAssignmentHistory.objects.filter(transaction=tx).values_list('event', 'from_status', 'to_status'))
        self.assertEqual(events, [
            ('CALLED', 'waiting', 'serving'),
            ('PENDING', 'serving', 'pending'),
            ('RESUMED', 'pending', 'serving'),
            ('COMPLETED', 'serving', 'done'),
        ])
        self.assertEqual(CtmsAssignmentHistory.objects.filter(transaction=tx, event='PENDING').get().reason, 'Missing ID')

    def test_requeue_returns_ticket_unassigned(self):
        tx = create_transaction(self.bataan, self.svc_tssd1)
        self._as(self.ana).post(f'/api/staff/transactions/{tx.id}/call/')
        self.client.post(f'/api/staff/transactions/{tx.id}/requeue/')
        tx.refresh_from_db()
        self.assertEqual(tx.status, 'waiting')
        self.assertIsNone(tx.assigned_to)
        self.assertIsNone(tx.counter)
        self.assertEqual(self._call_next(self.ben).data['id'], tx.id)

    def test_invalid_transitions_are_rejected(self):
        tx = create_transaction(self.bataan, self.svc_tssd1)
        res = self._as(self.ana).post(f'/api/staff/transactions/{tx.id}/done/')
        self.assertEqual(res.status_code, 409)
        self.assertIn("cannot change from Waiting to Done", res.data['detail'])

    def test_finished_tickets_cannot_be_deleted(self):
        tx = create_transaction(self.bataan, self.svc_tssd1)
        self._as(self.ana).post(f'/api/staff/transactions/{tx.id}/call/')
        self._as(self.ana).post(f'/api/staff/transactions/{tx.id}/done/')
        self.assertEqual(self.client.post(f'/api/staff/transactions/{tx.id}/delete/').status_code, 409)


class Stage4MyClientsAndTransferTestCase(CsmTablesTestCase):
    """Stage 4: personal workload tabs and clean hand-offs between personnel."""

    def setUp(self):
        self.bataan = CsmOffice.objects.create(name="Bataan Field Office", code="BAT", is_active=True)
        self.pampanga = CsmOffice.objects.create(name="Pampanga Field Office", code="PAM", is_active=True)
        self.service = CsmService.objects.create(name="SEnA Assistance", is_active=True, sort_order=1)
        self.ana = self._staff("ana", self.bataan, "Window 1")
        self.ben = self._staff("ben", self.bataan, "Window 2")
        self.pam = self._staff("pam", self.pampanga, "Window 1")
        self.client = APIClient()

    def _staff(self, username, office, window):
        user = User.objects.create_user(username=username, password="pw", is_staff=True, first_name=username.title())
        CtmsStaffOffice.objects.create(user=user, office=office)
        CtmsCounter.objects.create(office=office, name=window, assigned_user=user)
        return user

    def _as(self, user):
        self.client.force_authenticate(user=user)
        return self.client

    def _served_by_ana(self):
        tx = create_transaction(self.bataan, self.service)
        return call_transaction(tx, self.ana)

    def _tab(self, user, tab):
        return self._as(user).get(f'/api/staff/my-clients/?tab={tab}').data

    def _transfer(self, tx, by, to, reason=''):
        return self._as(by).post(f'/api/staff/transactions/{tx.id}/transfer/', {'to_user': to.id, 'reason': reason}, format='json')

    def test_tabs_reflect_the_callers_work(self):
        from .services import mark_pending
        paused = self._served_by_ana()
        mark_pending(paused, actor=self.ana)
        finished = self._served_by_ana()
        mark_done(finished, self.ana)
        current = self._served_by_ana()

        data = self._tab(self.ana, 'ongoing')
        self.assertEqual([r['id'] for r in data['results']], [current.id])
        self.assertEqual(data['counts'], {'ongoing': 1, 'pending': 1, 'done': 1})
        self.assertEqual([r['id'] for r in self._tab(self.ana, 'pending')['results']], [paused.id])
        self.assertEqual([r['id'] for r in self._tab(self.ana, 'done')['results']], [finished.id])
        self.assertEqual(self._tab(self.ben, 'ongoing')['counts'], {'ongoing': 0, 'pending': 0, 'done': 0})

    def test_transfer_moves_ownership_cleanly(self):
        tx = self._served_by_ana()
        res = self._transfer(tx, self.ana, self.ben, reason="Needs OSH specialist")
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['status'], 'transferred')
        self.assertIsNone(res.data['counter'])

        # Gone from Ana's active lists, waiting in Ben's Ongoing as not-started
        self.assertEqual(self._tab(self.ana, 'ongoing')['results'], [])
        ben_ongoing = self._tab(self.ben, 'ongoing')['results']
        self.assertEqual([(r['id'], r['status']) for r in ben_ongoing], [(tx.id, 'transferred')])

        # Ben is notified
        note = CtmsNotification.objects.get(recipient=self.ben)
        self.assertEqual(note.notification_type, 'REASSIGNMENT')
        self.assertIn("Needs OSH specialist", note.message)

        # Ana can no longer change it
        for action in ('done', 'pending', 'requeue'):
            self.assertEqual(self._as(self.ana).post(f'/api/staff/transactions/{tx.id}/{action}/').status_code, 403, action)
        self.assertEqual(self._transfer(tx, self.ana, self.ana).status_code, 403)

        # Ben starts it at his window, then completes it: CSM credits Ben
        res = self._as(self.ben).post(f'/api/staff/transactions/{tx.id}/call/')
        self.assertEqual(res.data['status'], 'serving')
        self.assertEqual(res.data['counter_name'], 'Window 2')
        self._as(self.ben).post(f'/api/staff/transactions/{tx.id}/done/')
        tx.refresh_from_db()
        self.assertEqual(tx.served_by_name, 'Ben')

        history = self._as(self.ben).get(f'/api/staff/transactions/{tx.id}/history/').data['events']
        self.assertEqual([e['event'] for e in history], ['CALLED', 'TRANSFERRED', 'RESUMED', 'COMPLETED'])
        transfer = history[1]
        self.assertEqual((transfer['from_user_name'], transfer['to_user_name']), ('Ana', 'Ben'))
        self.assertEqual(transfer['from_counter_name'], 'Window 1')
        self.assertEqual(transfer['reason'], 'Needs OSH specialist')

    def test_transfer_frees_the_window_for_the_next_client(self):
        tx = self._served_by_ana()
        self._transfer(tx, self.ana, self.ben)
        create_transaction(self.bataan, self.service)
        res = self._as(self.ana).post('/api/staff/call-next/', {'office': self.bataan.id}, format='json')
        self.assertEqual(res.status_code, 200)

    def test_recipients_are_same_office_staff_only(self):
        tx = self._served_by_ana()
        admin = User.objects.create_superuser(username="sysadmin", password="pw")
        CtmsStaffOffice.objects.create(user=admin, office=self.bataan)
        names = [r['name'] for r in self._as(self.ana).get(f'/api/staff/transactions/{tx.id}/transfer-recipients/').data]
        self.assertEqual(names, ['Ben'])
        res = self._transfer(tx, self.ana, self.pam)
        self.assertEqual(res.status_code, 409)
        self.assertIn("not active staff", res.data['detail'])

    def test_pending_client_can_be_transferred(self):
        from .services import mark_pending
        tx = self._served_by_ana()
        mark_pending(tx, actor=self.ana)
        self.assertEqual(self._transfer(tx, self.ana, self.ben).status_code, 200)
        self.assertEqual(self._tab(self.ana, 'pending')['results'], [])

    def test_recipient_without_window_can_serve_transferred_client(self):
        tx = self._served_by_ana()
        CtmsCounter.objects.filter(assigned_user=self.ben).update(assigned_user=None)
        self._transfer(tx, self.ana, self.ben)

        res = self._as(self.ben).post(f'/api/staff/transactions/{tx.id}/call/')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['status'], 'serving')
        self.assertIsNone(res.data['counter'])
        self.assertTrue(res.data['was_transferred'])
        self.assertEqual(res.data['assigned_to'], self.ben.id)
        self.assertEqual(self._as(self.ben).post(f'/api/staff/transactions/{tx.id}/done/').status_code, 200)

        # The shared queue and paused clients still need a window
        waiting = create_transaction(self.bataan, self.service)
        res = self._as(self.ben).post(f'/api/staff/transactions/{waiting.id}/call/')
        self.assertEqual(res.status_code, 409)
        self.assertIn("Windows page", res.data['detail'])

    def test_recipient_with_window_serves_at_it(self):
        tx = self._served_by_ana()
        self._transfer(tx, self.ana, self.ben)
        res = self._as(self.ben).post(f'/api/staff/transactions/{tx.id}/call/')
        self.assertEqual(res.data['counter_name'], 'Window 2')

    def test_transferred_client_can_be_paused_and_resumed_without_window(self):
        tx = self._served_by_ana()
        CtmsCounter.objects.filter(assigned_user=self.ben).update(assigned_user=None)
        self._transfer(tx, self.ana, self.ben)

        res = self._as(self.ben).post(f'/api/staff/transactions/{tx.id}/pending/', {'reason': 'Waiting for documents'}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['status'], 'pending')
        self.assertEqual([r['id'] for r in self._tab(self.ben, 'pending')['results']], [tx.id])
        self.assertEqual(self._tab(self.ben, 'ongoing')['results'], [])

        res = self._as(self.ben).post(f'/api/staff/transactions/{tx.id}/call/')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['status'], 'serving')

    def test_latest_note_is_shown_on_the_client(self):
        tx = self._served_by_ana()
        self._transfer(tx, self.ana, self.ben, reason="Needs OSH specialist")
        row = self._tab(self.ben, 'ongoing')['results'][0]
        self.assertEqual(row['latest_note'], {**row['latest_note'], 'kind': 'reassign', 'text': "Needs OSH specialist", 'by': "Ana"})

        self._as(self.ben).post(f'/api/staff/transactions/{tx.id}/pending/', {'reason': 'Waiting for permit copy'}, format='json')
        row = self._tab(self.ben, 'pending')['results'][0]
        self.assertEqual((row['latest_note']['kind'], row['latest_note']['text']), ('pending', 'Waiting for permit copy'))

    def test_done_remarks_are_saved_and_shown(self):
        tx = self._served_by_ana()
        res = self._as(self.ana).post(f'/api/staff/transactions/{tx.id}/done/',
                                      {'reason': '  Assisted in filing the SEnA request  '}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['status'], 'done')
        self.assertEqual((res.data['latest_note']['kind'], res.data['latest_note']['text'], res.data['latest_note']['by']),
                         ('done', 'Assisted in filing the SEnA request', 'Ana'))

        # Shown on the client in My Clients > Done, kept in the history, and in the audit log
        row = self._tab(self.ana, 'done')['results'][0]
        self.assertEqual(row['latest_note']['text'], 'Assisted in filing the SEnA request')
        history = self._as(self.ana).get(f'/api/staff/transactions/{tx.id}/history/').data
        self.assertIn('Assisted in filing the SEnA request', str(history))
        audit = CtmsAuditLog.objects.filter(action='COMPLETE_SERVICE').latest('timestamp')
        self.assertEqual(audit.details.get('remarks'), 'Assisted in filing the SEnA request')

        # After Undo Done the client is being served again, so the Done remarks no longer show
        self._as(self.ana).post(f'/api/staff/transactions/{tx.id}/undo-done/')
        tx.refresh_from_db()
        self.assertIsNone(StaffTransactionSerializer(tx).data['latest_note'])

    def test_done_without_remarks_still_works(self):
        tx = self._served_by_ana()
        res = self._as(self.ana).post(f'/api/staff/transactions/{tx.id}/done/')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['status'], 'done')
        self.assertIsNone(res.data['latest_note'])

    def test_waiting_ticket_cannot_be_transferred(self):
        tx = create_transaction(self.bataan, self.service)
        res = self._transfer(tx, self.ana, self.ben)
        self.assertEqual(res.status_code, 409)


class Stage5DisplayBoardTestCase(CsmTablesTestCase):
    """Stage 5: the TV board renders exactly the office's active windows."""

    def setUp(self):
        self.bataan = CsmOffice.objects.create(name="Bataan Field Office", code="BAT", is_active=True)
        self.pampanga = CsmOffice.objects.create(name="Pampanga Field Office", code="PAM", is_active=True)
        self.service = CsmService.objects.create(name="SEnA Assistance", is_active=True, sort_order=1)
        self.ana = User.objects.create_user(username="ana", password="pw", is_staff=True, first_name="Ana", last_name="Reyes")
        CtmsStaffOffice.objects.create(user=self.ana, office=self.bataan)
        self.windows = [CtmsCounter.objects.create(office=self.bataan, name=f"Window {i}", sort_order=i) for i in range(1, 5)]
        self.windows[0].assigned_user = self.ana
        self.windows[0].save()
        CtmsCounter.objects.create(office=self.pampanga, name="Pampanga Window", sort_order=1)
        self.client = APIClient()

    def _board(self, office=None):
        return self.client.get(f"/api/public/display/{(office or self.bataan).id}/").data

    def test_four_windows_four_cards_in_order(self):
        names = [w['name'] for w in self._board()['windows']]
        self.assertEqual(names, ["Window 1", "Window 2", "Window 3", "Window 4"])

    def test_cards_show_window_description(self):
        from .services import create_window, update_window
        create_window(self.bataan, "Window 5", "Labor inspection and SEnA cases")
        update_window(self.windows[1], description="OSH concerns")
        cards = {w['name']: w['description'] for w in self._board()['windows']}
        self.assertEqual(cards["Window 5"], "Labor inspection and SEnA cases")
        self.assertEqual(cards["Window 2"], "OSH concerns")
        self.assertEqual(cards["Window 1"], "")

    def test_cards_follow_window_changes(self):
        from .services import create_window, archive_window, update_window
        create_window(self.bataan, "Window 5")
        archive_window(self.windows[3])
        update_window(self.windows[2], is_active=False)
        names = [w['name'] for w in self._board()['windows']]
        self.assertEqual(names, ["Window 1", "Window 2", "Window 5"])

    def test_card_shows_called_client_without_name(self):
        tx = create_transaction(self.bataan, self.service, client_name="Confidential Name")
        call_transaction(tx, self.ana)
        board = self._board()
        card = board['windows'][0]
        self.assertEqual(card['current']['queue_no'], tx.queue_no)
        self.assertEqual(card['current']['personnel'], "Ana Reyes")
        self.assertEqual(card['personnel_name'], "Ana Reyes")
        self.assertIsNone(board['windows'][1]['current'])
        self.assertEqual(board['latest_called_counter'], "Window 1")
        self.assertNotIn("Confidential Name", str(board))

    def test_no_other_office_data(self):
        create_transaction(self.pampanga, self.service)
        board = self._board()
        self.assertNotIn("Pampanga Window", [w['name'] for w in board['windows']])
        self.assertEqual(board['next'], [])

    def _ben_without_window(self):
        ben = User.objects.create_user(username="ben", password="pw", is_staff=True, first_name="Ben", last_name="Cruz")
        CtmsStaffOffice.objects.create(user=ben, office=self.bataan)
        return ben

    def test_reassigned_client_leaves_the_tv(self):
        from .services import transfer_transaction
        ben = self._ben_without_window()
        tx = call_transaction(create_transaction(self.bataan, self.service), self.ana)
        transfer_transaction(tx, self.ana, ben)
        self.assertEqual(self._board()['windows'][0]['clients'], [])

        call_transaction(tx, ben)  # Ben has no window
        board = self._board()
        self.assertTrue(all(c['clients'] == [] for c in board['windows']))
        self.assertIsNone(board['latest_called_queue_no'])
        self.assertEqual(len(board['windows']), 4)

        # Window 1 is free for Ana's next client, which shows normally
        nxt = call_transaction(create_transaction(self.bataan, self.service), self.ana)
        card = self._board()['windows'][0]
        self.assertEqual([c['queue_no'] for c in card['clients']], [nxt.queue_no])

    def test_reassigned_client_served_at_recipient_window_stays_off_tv(self):
        from .services import transfer_transaction
        ben = self._ben_without_window()
        CtmsCounter.objects.filter(pk=self.windows[1].pk).update(assigned_user=ben)
        tx = call_transaction(create_transaction(self.bataan, self.service), self.ana)
        transfer_transaction(tx, self.ana, ben)
        started = call_transaction(tx, ben)
        self.assertEqual(started.counter, self.windows[1])
        self.assertEqual(self._board()['windows'][1]['clients'], [])

    def test_next_in_line_is_priority_then_fifo(self):
        create_transaction(self.bataan, self.service)
        create_transaction(self.bataan, self.service, is_priority=True)
        self.assertEqual(self._board()['next'], ["P-002", "001"])


class Stage6UnifiedAccountsTestCase(CsmTablesTestCase):
    """Stage 6: one account = login + personnel profile; role and office type gate admin features."""

    def setUp(self):
        from .models import CtmsOfficeProfile
        self.ro3 = CsmOffice.objects.create(name="DOLE Regional Office III", code="RO3", is_active=True)
        self.bataan = CsmOffice.objects.create(name="Bataan Field Office", code="BAT", is_active=True)
        CtmsOfficeProfile.objects.create(office=self.ro3, office_type=CtmsOfficeProfile.TYPE_REGIONAL)
        CtmsOfficeProfile.objects.create(office=self.bataan, office_type=CtmsOfficeProfile.TYPE_PROVINCIAL)
        self.service = CsmService.objects.create(name="SEnA Assistance", is_active=True, sort_order=1)

        self.regional_admin = self._account("kim", self.ro3, role='ADMIN')
        self.regional_staff = self._account("ro3staff", self.ro3)
        self.provincial_admin_role = self._account("batadmin", self.bataan, role='ADMIN')
        self.provincial_staff = self._account("batstaff", self.bataan)
        self.sysadmin = User.objects.create_superuser(username="sysadmin", password="pw")
        self.client = APIClient()

    def _account(self, username, office, role='PERSONNEL'):
        user = User.objects.create_user(username=username, password="pw", is_staff=True,
                                        first_name=username.title(), last_name="Test")
        CtmsStaffOffice.objects.create(user=user, office=office)
        DolePersonnel.objects.create(user=user, employee_id=username.upper(), first_name=username.title(),
                                     last_name="Test", office=office, role=role)
        return user

    def _as(self, user):
        self.client.force_authenticate(user=user)
        return self.client

    def _payload(self, **overrides):
        data = {
            "username": "newperson", "password": "secret123", "confirm_password": "secret123",
            "email": "new@dole.gov.ph", "first_name": "Nora", "middle_name": "P", "last_name": "Cruz",
            "employee_id": "EMP-777", "position": "Labor and Employment Officer I",
            "office": self.bataan.id, "role": "PERSONNEL",
        }
        data.update(overrides)
        return data

    def test_create_account_with_personnel_profile_in_one_step(self):
        res = self._as(self.regional_admin).post('/api/staff/users/', self._payload(), format='json')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['full_name'], "Nora P Cruz")
        self.assertEqual(res.data['office_code'], "BAT")
        self.assertEqual(res.data['position'], "Labor and Employment Officer I")
        user = User.objects.get(username="newperson")
        profile = user.dole_personnel
        self.assertEqual((profile.employee_id, profile.office, profile.role), ("EMP-777", self.bataan, 'PERSONNEL'))
        self.assertTrue(profile.must_change_password)
        self.assertEqual(list(user.staff_offices.values_list('office__code', flat=True)), ["BAT"])
        self.assertTrue(user.check_password("secret123"))

    def test_create_validation(self):
        c = self._as(self.regional_admin)
        self.assertEqual(c.post('/api/staff/users/', self._payload(confirm_password="nope"), format='json').status_code, 400)
        self.assertEqual(c.post('/api/staff/users/', self._payload(username="KIM"), format='json').status_code, 400)
        self.assertEqual(c.post('/api/staff/users/', self._payload(employee_id="KIM"), format='json').status_code, 400)
        res = c.post('/api/staff/users/', self._payload(role="ADMIN"), format='json')
        self.assertEqual(res.status_code, 400)
        self.assertIn("regional office", res.data['detail'])

    def test_edit_updates_account_and_profile_together(self):
        res = self._as(self.regional_admin).patch(f'/api/staff/users/{self.regional_staff.id}/', {
            "first_name": "Rosa", "position": "Planning Officer II", "role": "ADMIN",
        }, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.regional_staff.refresh_from_db()
        self.assertEqual(self.regional_staff.first_name, "Rosa")
        self.assertEqual(self.regional_staff.dole_personnel.first_name, "Rosa")
        self.assertEqual(self.regional_staff.dole_personnel.role, "ADMIN")
        self.assertTrue(res.data['is_regional_admin'])

    def test_office_change_moves_assignment_and_is_blocked_by_active_clients(self):
        res = self._as(self.regional_admin).patch(f'/api/staff/users/{self.provincial_staff.id}/', {"office": self.ro3.id}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(list(self.provincial_staff.staff_offices.values_list('office__code', flat=True)), ["RO3"])

        CtmsCounter.objects.create(office=self.ro3, name="Window 1", assigned_user=self.provincial_staff)
        call_transaction(create_transaction(self.ro3, self.service), self.provincial_staff)
        res = self.client.patch(f'/api/staff/users/{self.provincial_staff.id}/', {"office": self.bataan.id}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertIn("Reassign", res.data['detail'])
        res = self.client.post(f'/api/staff/users/{self.provincial_staff.id}/toggle-active/')
        self.assertEqual(res.status_code, 400)

    def test_accounts_with_history_are_deactivated_not_deleted(self):
        CtmsCounter.objects.create(office=self.bataan, name="Window 1", assigned_user=self.provincial_staff)
        mark_done(call_transaction(create_transaction(self.bataan, self.service), self.provincial_staff), self.provincial_staff)
        res = self._as(self.regional_admin).delete(f'/api/staff/users/{self.provincial_staff.id}/')
        self.assertEqual(res.status_code, 409)
        res = self.client.post(f'/api/staff/users/{self.provincial_staff.id}/toggle-active/')
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.data['is_active'])

    def test_provincial_accounts_cannot_use_admin_features(self):
        for user in (self.provincial_staff, self.provincial_admin_role, self.regional_staff):
            c = self._as(user)
            self.assertEqual(c.get('/api/staff/users/').status_code, 403, user.username)
            self.assertEqual(c.get('/api/staff/reports/summary/').status_code, 403, user.username)
            self.assertEqual(c.get('/api/staff/audit-logs/').status_code, 403, user.username)
            self.assertEqual(c.post('/api/staff/positions/', {'title': 'X'}, format='json').status_code, 403, user.username)
            # Operational features remain available
            self.assertEqual(c.get('/api/staff/queue/').status_code, 200, user.username)
            self.assertEqual(c.get('/api/staff/services/').status_code, 200, user.username)

    def test_regional_admin_has_oversight(self):
        c = self._as(self.regional_admin)
        self.assertEqual(c.get('/api/staff/reports/summary/').status_code, 200)
        self.assertEqual(c.get('/api/staff/audit-logs/').status_code, 200)
        create_transaction(self.bataan, self.service)
        listed = c.get(f'/api/staff/transactions/?office={self.bataan.id}').data
        rows = listed.get('results', listed) if isinstance(listed, dict) else listed
        self.assertEqual(len(rows), 1)
        users = [u['username'] for u in c.get('/api/staff/users/').data]
        self.assertIn("batstaff", users)
        self.assertNotIn("sysadmin", users)

    def test_session_payload_describes_access(self):
        me = self._as(self.provincial_staff).get('/api/staff/auth/me/').data
        self.assertEqual(me['office_type'], 'PROVINCIAL')
        self.assertFalse(me['permissions']['manage_users'])
        self.assertEqual([o['code'] for o in me['oversight_offices']], ['BAT'])
        me = self._as(self.regional_admin).get('/api/staff/auth/me/').data
        self.assertTrue(me['is_regional_admin'])
        self.assertTrue(me['permissions']['view_reports'])
        self.assertEqual(len(me['oversight_offices']), 2)

    def test_staff_cannot_grant_themselves_offices_or_windows(self):
        c = self._as(self.provincial_staff)
        res = c.post('/api/staff/staff-offices/', {'user': self.provincial_staff.id, 'office': self.ro3.id}, format='json')
        self.assertEqual(res.status_code, 403)
        res = c.post('/api/staff/counters/', {'office': self.bataan.id, 'name': 'Sneaky'}, format='json')
        self.assertEqual(res.status_code, 405)

    def test_set_system_admin_command(self):
        from django.core.management import call_command
        from io import StringIO
        stray = User.objects.create_superuser(username="oldadmin", password="pw")
        regional_super = self._account("kimsuper", self.ro3)
        regional_super.is_superuser = True
        regional_super.save()

        call_command('set_system_admin', 'sysadmin', stdout=StringIO())  # dry run
        self.assertTrue(User.objects.get(username="oldadmin").is_superuser)

        call_command('set_system_admin', 'sysadmin', '--apply', stdout=StringIO())
        self.assertEqual(list(User.objects.filter(is_superuser=True).values_list('username', flat=True)), ["sysadmin"])
        stray.refresh_from_db()
        self.assertFalse(stray.is_active)
        self.assertEqual(DolePersonnel.objects.get(user=regional_super).role, 'ADMIN')


class Stage7DivisionsAndCatalogTestCase(CsmTablesTestCase):
    """Stage 7: TSSD 1, TSSD 2 and IMSD are the only divisions; they only tag services."""

    def setUp(self):
        from .models import CtmsOfficeProfile
        self.ro3 = CsmOffice.objects.create(name="DOLE Regional Office III", code="RO3", is_active=True)
        CtmsOfficeProfile.objects.create(office=self.ro3, office_type=CtmsOfficeProfile.TYPE_REGIONAL)
        self.tssd1 = CsmDivision.objects.create(name="TSSD 1")
        self.tssd2 = CsmDivision.objects.create(name="TSSD 2")
        self.imsd = CsmDivision.objects.create(name="IMSD")
        self.malsu = CsmDivision.objects.create(name="MALSU")
        self.service = CsmService.objects.create(name="Sugar Workers' Death Benefit", is_active=True, sort_order=1)

        self.admin = User.objects.create_user(username="kim", password="pw", is_staff=True)
        CtmsStaffOffice.objects.create(user=self.admin, office=self.ro3)
        DolePersonnel.objects.create(user=self.admin, employee_id="KIM", first_name="Kim", last_name="D",
                                     office=self.ro3, role='ADMIN')
        self.staff = User.objects.create_user(username="ro3staff", password="pw", is_staff=True)
        CtmsStaffOffice.objects.create(user=self.staff, office=self.ro3)
        self.client = APIClient()

    def test_divisions_endpoint_lists_only_canonical_and_creates_nothing(self):
        self.client.force_authenticate(user=self.staff)
        names = [d['name'] for d in self.client.get('/api/staff/divisions/').data]
        self.assertEqual(names, ["TSSD 1", "TSSD 2", "IMSD"])
        self.assertFalse(CsmDivision.objects.filter(name__startswith="Window").exists())

    def test_regional_admin_tags_service_division(self):
        self.client.force_authenticate(user=self.admin)
        url = f'/api/staff/services/{self.service.id}/'
        res = self.client.patch(url, {'division': self.tssd2.id}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['division_name'], "TSSD 2")
        self.assertEqual(self.client.patch(url, {'division': self.malsu.id}, format='json').status_code, 400)
        self.assertEqual(self.client.patch(url, {'division': None}, format='json').data['division'], None)
        # Only the division tag can change
        self.client.patch(url, {'name': 'Renamed', 'is_active': False}, format='json')
        self.service.refresh_from_db()
        self.assertEqual((self.service.name, self.service.is_active), ("Sugar Workers' Death Benefit", True))

    def test_staff_can_read_catalog_but_not_tag(self):
        self.client.force_authenticate(user=self.staff)
        self.assertEqual(self.client.get('/api/staff/services/').status_code, 200)
        summary = self.client.get('/api/staff/services/summary/').data
        self.assertEqual(summary['untagged_services'], 1)
        res = self.client.patch(f'/api/staff/services/{self.service.id}/', {'division': self.tssd1.id}, format='json')
        self.assertEqual(res.status_code, 403)


class SecurityHardeningTestCase(CsmTablesTestCase):
    """Fixes from the security review (VAPT)."""

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.office = CsmOffice.objects.create(name="Bataan Field Office", code="BAT", is_active=True)
        self.service = CsmService.objects.create(name="SEnA Assistance", is_active=True, sort_order=1)
        self.staff = User.objects.create_user(username="ana", password="Correct-Pass-1", is_staff=True)
        CtmsStaffOffice.objects.create(user=self.staff, office=self.office)

    def _login(self, username, password, ip):
        # A different (fake) X-Forwarded-For each time: the per-address limit is bypassable,
        # the per-account limit must still hold.
        return self.client.post('/api/staff/auth/login/', {'username': username, 'password': password},
                                format='json', HTTP_X_FORWARDED_FOR=ip)

    def test_unsafe_public_endpoints_are_gone(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        evil = SimpleUploadedFile("poc.html", b"<script>alert(1)</script>", content_type="video/mp4")
        self.assertEqual(self.client.post(f'/api/public/display-video-upload/{self.office.id}/', {'video_file': evil}).status_code, 404)
        self.assertEqual(self.client.get('/api/public/folder-videos/', {'folder': 'C:/'}).status_code, 404)
        self.assertEqual(self.client.get('/api/public/stream-video/', {'file': 'C:/x.mp4'}).status_code, 404)

    def test_staff_upload_accepts_videos_only(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        self.client.force_authenticate(user=self.staff)
        bad = [
            SimpleUploadedFile("poc.html", b"<script>alert(1)</script>"),
            SimpleUploadedFile("poc.mp4", b"<script>alert(1)</script>"),   # video name, not a video
            SimpleUploadedFile("pic.svg", b"<svg onload=alert(1)>"),
        ]
        for f in bad:
            res = self.client.post('/api/staff/display-video/', {'office': self.office.id, 'video_file': f}, format='multipart')
            self.assertEqual(res.status_code, 400, f.name)
        mp4 = SimpleUploadedFile("arta.mp4", b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 64)
        res = self.client.post('/api/staff/display-video/', {'office': self.office.id, 'video_file': mp4}, format='multipart')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertTrue(res.data['arta_video_url'].endswith('.mp4'))
        CtmsDisplayConfig.objects.get(office=self.office).video_file.delete(save=False)

    def test_account_locks_after_repeated_wrong_passwords_even_with_spoofed_addresses(self):
        for i in range(10):
            self.assertEqual(self._login("ana", "wrong", f"10.9.9.{i}").status_code, 401)
        locked = self._login("ana", "Correct-Pass-1", "10.9.9.200")
        self.assertEqual(locked.status_code, 429)
        self.assertEqual(locked.data['code'], 'ACCOUNT_LOCKED')
        # Typing the username in other capitals doesn't get around it
        self.assertEqual(self._login("ANA", "Correct-Pass-1", "10.9.9.201").status_code, 429)
        # Other accounts are unaffected
        User.objects.create_user(username="ben", password="Ben-Pass-1", is_staff=True)
        self.assertEqual(self._login("ben", "Ben-Pass-1", "10.9.9.202").status_code, 200)

    def test_correct_password_resets_the_failure_count(self):
        for i in range(9):
            self._login("ana", "wrong", f"10.8.8.{i}")
        self.assertEqual(self._login("ana", "Correct-Pass-1", "10.8.8.100").status_code, 200)
        for i in range(9):
            self._login("ana", "wrong", f"10.8.9.{i}")
        self.assertEqual(self._login("ana", "Correct-Pass-1", "10.8.9.100").status_code, 200)

    def test_django_admin_login_also_counts_toward_the_lock(self):
        admin = User.objects.create_superuser(username="root", password="Root-Pass-1")
        for _ in range(10):
            self.client.post('/django-admin/login/', {'username': 'root', 'password': 'wrong'})
        res = self.client.post('/django-admin/login/', {'username': 'root', 'password': 'Root-Pass-1'})
        self.assertEqual(res.status_code, 200)  # stays on the login page: not signed in
        self.assertNotIn('_auth_user_id', self.client.session)
        self.assertTrue(admin.is_active)

    def test_guessing_the_check_in_code_replaces_it(self):
        from .services import get_or_rotate_office_code
        config = CtmsOfficeQrConfig.objects.create(office=self.office, requires_office_code=True)
        code = get_or_rotate_office_code(config)
        wrong = '0000' if code != '0000' else '1111'
        for i in range(30):
            self.client.post('/api/public/checkin/', {'office': self.office.id, 'service': self.service.id,
                                                       'client_name': 'Guesser', 'office_code': wrong},
                             format='json', HTTP_X_FORWARDED_FOR=f"10.7.7.{i}")
        config.refresh_from_db()
        self.assertNotEqual(config.office_code, code)

    def test_logout_revokes_the_refresh_token(self):
        tokens = self._login("ana", "Correct-Pass-1", "10.6.6.1").data
        self.assertEqual(self.client.post('/api/staff/auth/refresh/', {'refresh': tokens['refresh']}, format='json').status_code, 200)
        fresh = self._login("ana", "Correct-Pass-1", "10.6.6.2").data
        self.assertEqual(self.client.post('/api/staff/auth/logout/', {'refresh': fresh['refresh']}, format='json').status_code, 205)
        self.assertEqual(self.client.post('/api/staff/auth/refresh/', {'refresh': fresh['refresh']}, format='json').status_code, 401)
        # Logging out twice, or with junk, is harmless
        self.assertEqual(self.client.post('/api/staff/auth/logout/', {'refresh': 'junk'}, format='json').status_code, 205)

    def test_public_checkin_does_not_leak_internal_errors(self):
        with mock.patch('ctms.services.create_transaction', side_effect=RuntimeError("DB path C:/secret/db")):
            res = self.client.post('/api/public/checkin/', {'office': self.office.id, 'service': self.service.id,
                                                             'client_name': 'Juan'}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertNotIn('secret', str(res.data))


class ProjectReviewBugFixesTestCase(CsmTablesTestCase):
    """Bugs found in the full project review."""

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.office = CsmOffice.objects.create(name="Bataan Field Office", code="BAT", is_active=True)
        self.service = CsmService.objects.create(name="Single Entry Approach (SEnA)", is_active=True, sort_order=1)
        self.ana = User.objects.create_user(username="ana", password="Ana-Pass-1", is_staff=True, first_name="Ana")
        self.ben = User.objects.create_user(username="ben", password="Ben-Pass-1", is_staff=True, first_name="Ben")
        for user, window in ((self.ana, "Window 1"), (self.ben, "Window 2")):
            CtmsStaffOffice.objects.create(user=user, office=self.office)
            CtmsCounter.objects.create(office=self.office, name=window, is_active=True, assigned_user=user)

    def test_stale_cancel_cannot_overwrite_a_ticket_another_window_just_called(self):
        tx = create_transaction(self.office, self.service, client_name="Juan")
        stale = CtmsTransaction.objects.get(pk=tx.pk)          # loaded while still waiting
        call_transaction(tx, self.ben)                          # Ben's window calls it meanwhile
        with self.assertRaisesMessage(ValueError, "just updated by someone else"):
            cancel_transaction(stale, actor=self.ana)
        tx.refresh_from_db()
        self.assertEqual(tx.status, 'serving')

    def test_return_to_queue_history_keeps_who_and_which_window(self):
        tx = call_transaction(create_transaction(self.office, self.service, client_name="Juan"), self.ana)
        requeue_transaction(tx, actor=self.ana)
        event = CtmsAssignmentHistory.objects.filter(transaction=tx, event='REQUEUED').get()
        self.assertEqual(event.from_user, self.ana)
        self.assertEqual(event.from_counter_name, "Window 1")
        self.assertEqual(event.from_status, 'serving')

    def test_undo_done_refused_while_serving_another_client(self):
        first = call_transaction(create_transaction(self.office, self.service, client_name="A"), self.ana)
        mark_done(first, self.ana)
        call_transaction(create_transaction(self.office, self.service, client_name="B"), self.ana)
        with self.assertRaisesMessage(ValueError, "still serving"):
            undo_done(CtmsTransaction.objects.get(pk=first.pk), actor=self.ana)

    def test_report_wait_time_counts_to_the_first_call_not_recalls(self):
        admin = User.objects.create_superuser(username="root", password="Root-Pass-1")
        tx = create_transaction(self.office, self.service, client_name="Juan")
        t0 = tx.checked_in_at
        CtmsTransaction.objects.filter(pk=tx.pk).update(
            status='done', started_at=t0 + timedelta(minutes=10), called_at=t0 + timedelta(hours=5),
            done_at=t0 + timedelta(hours=5, minutes=5))
        self.client.force_authenticate(user=admin)
        data = self.client.get('/api/staff/reports/summary/', {'office': self.office.id}).data
        self.assertEqual(data['avg_wait_min'], 10.0)

    def test_bad_filter_values_are_400_not_server_errors(self):
        admin = User.objects.create_superuser(username="root", password="Root-Pass-1")
        self.client.force_authenticate(user=admin)
        self.assertEqual(self.client.get('/api/staff/transactions/', {'date_from': 'yesterday'}).status_code, 400)
        self.assertEqual(self.client.get('/api/staff/transactions/', {'limit': 'abc'}).status_code, 200)
        self.assertEqual(self.client.get('/api/staff/transactions/', {'limit': '-5'}).status_code, 200)
        self.assertEqual(self.client.get('/api/staff/reports/summary/', {'date_to': '2026-13-45'}).status_code, 400)
        self.assertEqual(self.client.get('/api/staff/audit-logs/', {'office': 'x', 'page': 'y'}).status_code, 200)

    def test_transactions_search_finds_service_name_and_survey_code(self):
        tx = create_transaction(self.office, self.service, client_name="Juan")
        other = CsmService.objects.create(name="Registration of Union", is_active=True, sort_order=2)
        create_transaction(self.office, other, client_name="Maria")
        self.client.force_authenticate(user=self.ana)
        by_service = self.client.get('/api/staff/transactions/', {'q': 'SEnA'}).data
        self.assertEqual([r['id'] for r in by_service], [tx.id])
        by_code = self.client.get('/api/staff/transactions/', {'q': tx.claim_code}).data
        self.assertIn(tx.id, [r['id'] for r in by_code])

    def test_transactions_list_values_match_per_row_lookups(self):
        tx = call_transaction(create_transaction(self.office, self.service, client_name="Juan"), self.ana)
        mark_done(tx, self.ana, reason="Filed the SEnA request")
        self.client.force_authenticate(user=self.ana)
        row = self.client.get('/api/staff/transactions/').data[0]
        single = StaffTransactionSerializer(CtmsTransaction.objects.get(pk=tx.pk)).data
        self.assertEqual(row['latest_note']['text'], single['latest_note']['text'])
        self.assertEqual(row['is_surveyed'], single['is_surveyed'])

    def test_my_current_client_shows_a_client_left_serving_from_yesterday(self):
        tx = call_transaction(create_transaction(self.office, self.service, client_name="Juan"), self.ana)
        yesterday = timezone.now() - timedelta(days=1)
        CtmsTransaction.objects.filter(pk=tx.pk).update(queue_date=timezone.localdate() - timedelta(days=1),
                                                        called_at=yesterday, checked_in_at=yesterday)
        self.client.force_authenticate(user=self.ana)
        data = self.client.get('/api/staff/queue/', {'office': self.office.id}).data
        self.assertEqual(data['my_current']['id'], tx.id)

    def test_change_password_requires_the_current_password(self):
        self.client.force_authenticate(user=self.ana)
        url = '/api/staff/auth/change-password/'
        self.assertEqual(self.client.post(url, {'new_password': 'New-Pass-9', 'confirm_password': 'New-Pass-9'},
                                          format='json').status_code, 400)
        self.assertEqual(self.client.post(url, {'current_password': 'wrong', 'new_password': 'New-Pass-9',
                                                'confirm_password': 'New-Pass-9'}, format='json').status_code, 400)
        res = self.client.post(url, {'current_password': 'Ana-Pass-1', 'new_password': 'New pass 9 ',
                                     'confirm_password': 'New pass 9 '}, format='json')
        self.assertEqual(res.status_code, 200)
        self.ana.refresh_from_db()
        self.assertTrue(self.ana.check_password('New pass 9 '))  # kept exactly as typed

    def test_garbage_forwarded_for_does_not_break_account_creation(self):
        CtmsOfficeProfile.objects.update_or_create(office=self.office, defaults={'office_type': 'REGIONAL'})
        admin = User.objects.create_superuser(username="root", password="Root-Pass-1")
        self.client.force_authenticate(user=admin)
        res = self.client.post('/api/staff/users/', {
            'username': 'carla', 'password': 'Carla-Pass-1', 'first_name': 'Carla', 'last_name': 'Cruz',
            'office': self.office.id,
        }, format='json', HTTP_X_FORWARDED_FOR='not-an-ip-' + 'x' * 200)
        self.assertEqual(res.status_code, 201, res.data)
        log = CtmsAuditLog.objects.filter(action='USER_CREATE').latest('timestamp')
        self.assertIsNone(log.ip_address)

    def test_group_registration_size_is_capped(self):
        res = self.client.post('/api/public/checkin/', {
            'office': self.office.id, 'service': self.service.id, 'client_name': 'Rep (Group of 51)',
            'group_member_names': [f'Member {i}' for i in range(51)],
        }, format='json')
        self.assertEqual(res.status_code, 400)


class TvCallAnnouncementTestCase(CsmTablesTestCase):
    """Every call is logged for the TV, and the TV feed returns all of them, in order."""

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.office = CsmOffice.objects.create(name="Bataan Field Office", code="BAT", is_active=True)
        self.service = CsmService.objects.create(name="SEnA", is_active=True, sort_order=1)
        self.staff = []
        for i in range(1, 7):
            user = User.objects.create_user(username=f"w{i}", password="Pass-1234", is_staff=True, first_name=f"Staff{i}")
            CtmsStaffOffice.objects.create(user=user, office=self.office)
            CtmsCounter.objects.create(office=self.office, name=f"Window {i}", is_active=True, assigned_user=user)
            self.staff.append(user)
        self.url = f'/api/public/display/{self.office.id}/calls/'

    def ticket(self, name="Client"):
        return create_transaction(self.office, self.service, client_name=name)

    def feed(self, after=None):
        params = {} if after is None else {'after': after}
        res = self.client.get(self.url, params)
        self.assertEqual(res.status_code, 200)
        return res.data

    def test_simultaneous_calls_from_five_windows_are_all_in_the_feed_in_order(self):
        cursor = self.feed()['cursor']
        tickets = [self.ticket(f"C{i}") for i in range(5)]
        for user in self.staff[:5]:
            call_next_transaction(self.office, user)
        calls = self.feed(cursor)['calls']
        self.assertEqual([c['queue_no'] for c in calls], [t.queue_no for t in tickets])
        self.assertEqual([c['counter'] for c in calls], [f"Window {i}" for i in range(1, 6)])
        self.assertEqual([c['personnel'] for c in calls], [f"Staff{i}" for i in range(1, 6)])
        self.assertEqual(len({c['id'] for c in calls}), 5)
        self.assertEqual(calls, sorted(calls, key=lambda c: c['id']))

    def test_first_sync_returns_only_the_cursor(self):
        self.ticket()
        call_next_transaction(self.office, self.staff[0])
        data = self.feed()
        self.assertEqual(data['calls'], [])
        self.assertEqual(data['cursor'], CtmsCallAnnouncement.objects.latest('id').id)
        bad = self.feed('abc')  # a malformed cursor is treated like a first sync
        self.assertEqual(bad['calls'], [])

    def test_recall_is_a_new_announcement(self):
        cursor = self.feed()['cursor']
        tx = call_transaction(self.ticket(), self.staff[0])
        call_transaction(tx, self.staff[0])  # recall
        calls = self.feed(cursor)['calls']
        self.assertEqual([c['kind'] for c in calls], ['CALL', 'RECALL'])
        self.assertEqual(calls[0]['queue_no'], calls[1]['queue_no'])
        self.assertNotEqual(calls[0]['id'], calls[1]['id'])

    def test_resume_is_announced_but_reassigned_clients_are_not(self):
        cursor = self.feed()['cursor']
        paused = call_transaction(self.ticket("Paused"), self.staff[0])
        mark_pending(paused, actor=self.staff[0])
        call_transaction(CtmsTransaction.objects.get(pk=paused.pk), self.staff[0])  # resume

        moved = call_transaction(self.ticket("Moved"), self.staff[1])
        transfer_transaction(moved, self.staff[1], self.staff[2])
        call_transaction(CtmsTransaction.objects.get(pk=moved.pk), self.staff[2])  # served off the board

        kinds = [(c['kind'], c['queue_no']) for c in self.feed(cursor)['calls']]
        self.assertEqual(kinds, [('CALL', paused.queue_no), ('RESUME', paused.queue_no), ('CALL', moved.queue_no)])

    def test_feed_is_not_consumed_so_every_tv_gets_the_calls(self):
        cursor = self.feed()['cursor']
        self.ticket()
        call_next_transaction(self.office, self.staff[0])
        tv1 = self.feed(cursor)['calls']
        tv2 = APIClient().get(self.url, {'after': cursor}).data['calls']
        self.assertEqual([c['id'] for c in tv1], [c['id'] for c in tv2])
        self.assertEqual(len(tv1), 1)

    def test_recent_calls_are_resent_for_late_commits_and_old_ones_are_not(self):
        cursor = self.feed()['cursor']
        self.ticket()
        call_next_transaction(self.office, self.staff[0])
        first = self.feed(cursor)
        # Polling again from the new cursor still includes the last few seconds (the TV skips ids
        # it already announced); this is what catches a call that committed out of id order.
        self.assertEqual([c['id'] for c in self.feed(first['cursor'])['calls']], [c['id'] for c in first['calls']])
        CtmsCallAnnouncement.objects.update(created_at=timezone.now() - timedelta(minutes=1))
        self.assertEqual(self.feed(first['cursor'])['calls'], [])

    def test_large_bursts_are_paged(self):
        cursor = self.feed()['cursor']
        tx = call_transaction(self.ticket(), self.staff[0])
        for _ in range(54):
            call_transaction(tx, self.staff[0])  # recalls
        page1 = self.feed(cursor)
        self.assertTrue(page1['has_more'])
        self.assertEqual(len(page1['calls']), 50)
        CtmsCallAnnouncement.objects.update(created_at=timezone.now() - timedelta(minutes=1))
        page2 = self.feed(page1['cursor'])
        self.assertFalse(page2['has_more'])
        self.assertEqual(len(page2['calls']), 5)

    def test_unknown_or_inactive_office_is_404(self):
        self.assertEqual(self.client.get('/api/public/display/999999/calls/').status_code, 404)
        CsmOffice.objects.filter(pk=self.office.pk).update(is_active=False)
        self.assertEqual(self.client.get(self.url).status_code, 404)


class TvDisplayAccountTestCase(CsmTablesTestCase):
    """TV Display accounts: system admin only; sign-in opens the office TV; no staff access."""

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.aurora = CsmOffice.objects.create(name="Aurora Field Office", code="AUR", is_active=True)
        self.ro3 = CsmOffice.objects.create(name="DOLE Regional Office III", code="RO3", is_active=True)
        CtmsOfficeProfile.objects.update_or_create(office=self.ro3, defaults={'office_type': 'REGIONAL'})
        self.root = User.objects.create_superuser(username="root", password="Root-Pass-1")
        self.regional_admin = User.objects.create_user(username="radmin", password="Admin-Pass-1", is_staff=True,
                                                       first_name="Rita", last_name="Admin")
        CtmsStaffOffice.objects.create(user=self.regional_admin, office=self.ro3)
        DolePersonnel.objects.create(user=self.regional_admin, employee_id="radmin", first_name="Rita",
                                     last_name="Admin", office=self.ro3, role=DolePersonnel.ROLE_ADMIN)

    def create_tv(self, username="tv_aurora", office=None):
        self.client.force_authenticate(user=self.root)
        res = self.client.post('/api/staff/users/', {
            'username': username, 'password': 'Tv-Pass-123', 'confirm_password': 'Tv-Pass-123',
            'role': 'DISPLAY', 'office': (office or self.aurora).id,
        }, format='json')
        self.client.force_authenticate(user=None)
        return res

    def test_system_admin_creates_a_tv_account_that_is_not_staff(self):
        res = self.create_tv()
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['role'], 'DISPLAY')
        tv = User.objects.get(username="tv_aurora")
        self.assertFalse(tv.is_staff)
        self.assertFalse(CtmsStaffOffice.objects.filter(user=tv).exists())
        self.assertFalse(tv.dole_personnel.must_change_password)
        self.assertEqual(tv.dole_personnel.office, self.aurora)

    def test_regional_admin_cannot_create_or_see_tv_accounts(self):
        self.create_tv()
        self.client.force_authenticate(user=self.regional_admin)
        res = self.client.post('/api/staff/users/', {
            'username': 'tv2', 'password': 'Tv-Pass-123', 'role': 'DISPLAY', 'office': self.aurora.id,
        }, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertIn("system administrator", res.data['detail'])
        listed = [a['username'] for a in self.client.get('/api/staff/users/').data]
        self.assertNotIn('tv_aurora', listed)
        self.client.force_authenticate(user=self.root)
        self.assertIn('tv_aurora', [a['username'] for a in self.client.get('/api/staff/users/').data])

    def test_sign_in_returns_the_office_tv_link_with_its_key(self):
        self.create_tv()
        res = self.client.post('/api/staff/auth/login/', {'username': 'tv_aurora', 'password': 'Tv-Pass-123'}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        user = res.data['user']
        key = CtmsOfficeQrConfig.objects.get(office=self.aurora).display_key
        self.assertEqual(user['role'], 'DISPLAY')
        self.assertEqual(user['display']['office_id'], self.aurora.id)
        self.assertEqual(user['display']['url'], f"/display/office/{self.aurora.id}?key={key}")
        self.assertEqual(user['assigned_offices'], [])
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")
        self.assertEqual(self.client.get('/api/staff/auth/me/').data['display']['key'], key)

    def test_tv_account_cannot_use_staff_pages_or_actions(self):
        self.create_tv()
        tv = User.objects.get(username="tv_aurora")
        self.client.force_authenticate(user=tv)
        for method, url, body in (
            ('get', f'/api/staff/queue/?office={self.aurora.id}', None),
            ('post', '/api/staff/call-next/', {'office': self.aurora.id}),
            ('get', '/api/staff/my-clients/', None),
            ('get', '/api/staff/transactions/', None),
            ('get', f'/api/staff/qr-config/?office={self.aurora.id}', None),
            ('get', '/api/staff/windows/', None),
            ('get', '/api/staff/users/', None),
            ('get', '/api/staff/reports/summary/', None),
        ):
            res = getattr(self.client, method)(url, body, format='json') if body else getattr(self.client, method)(url)
            self.assertIn(res.status_code, (401, 403), f"{method} {url} -> {res.status_code}")

    def test_tv_and_staff_roles_cannot_be_switched(self):
        self.create_tv()
        tv = User.objects.get(username="tv_aurora")
        self.client.force_authenticate(user=self.root)
        res = self.client.patch(f'/api/staff/users/{tv.id}/', {'role': 'PERSONNEL'}, format='json')
        self.assertEqual(res.status_code, 400)
        res = self.client.patch(f'/api/staff/users/{self.regional_admin.id}/', {'role': 'DISPLAY'}, format='json')
        self.assertEqual(res.status_code, 400)
        # Moving the TV account to another office is fine and keeps it a non-staff account
        res = self.client.patch(f'/api/staff/users/{tv.id}/', {'office': self.ro3.id}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        tv.refresh_from_db()
        self.assertFalse(tv.is_staff)
        self.assertFalse(CtmsStaffOffice.objects.filter(user=tv).exists())

    def test_password_reset_does_not_force_a_change_on_the_tv(self):
        self.create_tv()
        tv = User.objects.get(username="tv_aurora")
        self.client.force_authenticate(user=self.root)
        res = self.client.post(f'/api/staff/users/{tv.id}/reset-password/', {'password': 'New-Tv-Pass-1'}, format='json')
        self.assertEqual(res.status_code, 200)
        tv.refresh_from_db()
        self.assertTrue(tv.check_password('New-Tv-Pass-1'))
        self.assertFalse(tv.dole_personnel.must_change_password)

    def test_tv_sign_in_refused_when_its_office_is_inactive(self):
        self.create_tv()
        CsmOffice.objects.filter(pk=self.aurora.pk).update(is_active=False)
        res = self.client.post('/api/staff/auth/login/', {'username': 'tv_aurora', 'password': 'Tv-Pass-123'}, format='json')
        self.assertEqual(res.status_code, 400)


class RememberMeSignInTestCase(CsmTablesTestCase):
    """"Remember me" sign-ins last 30 days, also across token refreshes; normal ones keep 1 day."""

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.office = CsmOffice.objects.create(name="Bataan Field Office", code="BAT", is_active=True)
        self.user = User.objects.create_user(username="ana", password="Ana-Pass-1", is_staff=True, first_name="Ana")
        CtmsStaffOffice.objects.create(user=self.user, office=self.office)

    def login(self, **extra):
        res = self.client.post('/api/staff/auth/login/', {'username': 'ana', 'password': 'Ana-Pass-1', **extra}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        return res.data

    @staticmethod
    def days_left(refresh):
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken(refresh)
        return (token['exp'] - timezone.now().timestamp()) / 86400, token.get('remember', False)

    def test_normal_sign_in_lasts_one_day(self):
        days, remember = self.days_left(self.login()['refresh'])
        self.assertAlmostEqual(days, 1, delta=0.01)
        self.assertFalse(remember)

    def test_remember_me_lasts_thirty_days_and_survives_refresh(self):
        data = self.login(remember=True)
        self.assertTrue(data['remember'])
        days, remember = self.days_left(data['refresh'])
        self.assertAlmostEqual(days, 30, delta=0.01)
        self.assertTrue(remember)
        refreshed = self.client.post('/api/staff/auth/refresh/', {'refresh': data['refresh']}, format='json')
        self.assertEqual(refreshed.status_code, 200)
        days, remember = self.days_left(refreshed.data['refresh'])
        self.assertAlmostEqual(days, 30, delta=0.01)
        self.assertTrue(remember)
        # Sign-out still revokes it
        self.client.post('/api/staff/auth/logout/', {'refresh': refreshed.data['refresh']}, format='json')
        again = self.client.post('/api/staff/auth/refresh/', {'refresh': refreshed.data['refresh']}, format='json')
        self.assertEqual(again.status_code, 401)

    def test_tv_account_with_remember_me_stays_signed_in(self):
        tv = User.objects.create_user(username="tv_bat", password="Tv-Pass-123", is_staff=False)
        DolePersonnel.objects.create(user=tv, employee_id="tv_bat", first_name="TV Display", last_name="Bataan",
                                     office=self.office, role=DolePersonnel.ROLE_DISPLAY)
        res = self.client.post('/api/staff/auth/login/', {'username': 'tv_bat', 'password': 'Tv-Pass-123',
                                                          'remember': True}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        days, remember = self.days_left(res.data['refresh'])
        self.assertGreater(days, 3600)
        self.assertEqual(remember, 'tv')
        refreshed = self.client.post('/api/staff/auth/refresh/', {'refresh': res.data['refresh']}, format='json')
        days, remember = self.days_left(refreshed.data['refresh'])
        self.assertGreater(days, 3600)
        # Deactivating the TV account still ends the sign-in
        User.objects.filter(pk=tv.pk).update(is_active=False)
        again = self.client.post('/api/staff/auth/refresh/', {'refresh': refreshed.data['refresh']}, format='json')
        self.assertEqual(again.status_code, 401)


class RegistrationDeskAccountTestCase(CsmTablesTestCase):
    """Registration Desk accounts: system admin only; register walk-ins for their own office; nothing else."""

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.aurora = CsmOffice.objects.create(name="Aurora Field Office", code="AUR", is_active=True)
        self.bataan = CsmOffice.objects.create(name="Bataan Field Office", code="BAT", is_active=True)
        self.ro3 = CsmOffice.objects.create(name="DOLE Regional Office III", code="RO3", is_active=True)
        CtmsOfficeProfile.objects.update_or_create(office=self.ro3, defaults={'office_type': 'REGIONAL'})
        self.service = CsmService.objects.create(name="SEnA", is_active=True, sort_order=1)
        self.root = User.objects.create_superuser(username="root", password="Root-Pass-1")
        self.regional_admin = User.objects.create_user(username="radmin", password="Admin-Pass-1", is_staff=True)
        CtmsStaffOffice.objects.create(user=self.regional_admin, office=self.ro3)
        DolePersonnel.objects.create(user=self.regional_admin, employee_id="radmin", first_name="Rita",
                                     last_name="Admin", office=self.ro3, role=DolePersonnel.ROLE_ADMIN)

    def create_desk(self, username="desk_aurora"):
        self.client.force_authenticate(user=self.root)
        res = self.client.post('/api/staff/users/', {
            'username': username, 'password': 'Desk-Pass-1', 'confirm_password': 'Desk-Pass-1',
            'role': 'REGISTRAR', 'office': self.aurora.id,
        }, format='json')
        self.client.force_authenticate(user=None)
        return res

    def desk(self):
        return User.objects.get(username="desk_aurora")

    def test_system_admin_creates_a_desk_account_that_is_not_staff(self):
        res = self.create_desk()
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['role'], 'REGISTRAR')
        desk = self.desk()
        self.assertFalse(desk.is_staff)
        self.assertFalse(CtmsStaffOffice.objects.filter(user=desk).exists())
        self.assertTrue(desk.dole_personnel.must_change_password)  # a person signs in at the desk

    def test_regional_admin_cannot_create_or_see_desk_accounts(self):
        self.create_desk()
        self.client.force_authenticate(user=self.regional_admin)
        res = self.client.post('/api/staff/users/', {'username': 'desk2', 'password': 'Desk-Pass-1',
                                                     'role': 'REGISTRAR', 'office': self.aurora.id}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertNotIn('desk_aurora', [a['username'] for a in self.client.get('/api/staff/users/').data])

    def test_sign_in_returns_the_registration_office(self):
        self.create_desk()
        res = self.client.post('/api/staff/auth/login/', {'username': 'desk_aurora', 'password': 'Desk-Pass-1'}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['user']['role'], 'REGISTRAR')
        self.assertEqual(res.data['user']['registration']['office_id'], self.aurora.id)

    def test_desk_registers_walkins_for_its_own_office_only(self):
        self.create_desk()
        self.client.force_authenticate(user=self.desk())
        res = self.client.post('/api/staff/transactions/walkin/', {'office': self.aurora.id, 'service': self.service.id,
                                                      'client_name': 'Juan', 'is_priority': True}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        tx = CtmsTransaction.objects.get(pk=res.data['id'])
        self.assertEqual((tx.office, tx.status, tx.source), (self.aurora, 'waiting', CtmsTransaction.SOURCE_STAFF))
        self.assertTrue(CtmsAuditLog.objects.filter(action='CREATE_WALKIN', actor=self.desk()).exists())
        other = self.client.post('/api/staff/transactions/walkin/', {'office': self.bataan.id, 'service': self.service.id,
                                                        'client_name': 'Maria'}, format='json')
        self.assertEqual(other.status_code, 403)

    def test_registration_page_shows_the_waiting_count(self):
        self.create_desk()
        create_transaction(self.aurora, self.service, client_name="A")
        create_transaction(self.aurora, self.service, client_name="B", is_priority=True)
        create_transaction(self.bataan, self.service, client_name="C")
        self.client.force_authenticate(user=self.desk())
        data = self.client.get('/api/staff/registration/').data
        self.assertEqual(data['office']['id'], self.aurora.id)
        self.assertEqual((data['waiting_count'], data['priority_waiting']), (2, 1))

    def test_desk_cannot_use_any_other_staff_page_or_action(self):
        self.create_desk()
        tx = create_transaction(self.aurora, self.service, client_name="Juan")
        self.client.force_authenticate(user=self.desk())
        for method, url in (
            ('get', f'/api/staff/queue/?office={self.aurora.id}'),
            ('post', '/api/staff/call-next/'),
            ('post', f'/api/staff/transactions/{tx.id}/cancel/'),
            ('get', '/api/staff/my-clients/'),
            ('get', '/api/staff/transactions/'),
            ('get', f'/api/staff/qr-config/?office={self.aurora.id}'),
            ('get', '/api/staff/windows/'),
            ('get', '/api/staff/users/'),
            ('get', '/api/staff/reports/summary/'),
            ('get', '/api/staff/audit-logs/'),
        ):
            res = getattr(self.client, method)(url, {'office': self.aurora.id}, format='json') if method == 'post' \
                else self.client.get(url)
            self.assertIn(res.status_code, (401, 403, 404), f"{method} {url} -> {res.status_code}")
        tx.refresh_from_db()
        self.assertEqual(tx.status, 'waiting')

    def test_desk_and_staff_roles_cannot_be_switched(self):
        self.create_desk()
        self.client.force_authenticate(user=self.root)
        self.assertEqual(self.client.patch(f'/api/staff/users/{self.desk().id}/', {'role': 'PERSONNEL'},
                                           format='json').status_code, 400)
        self.assertEqual(self.client.patch(f'/api/staff/users/{self.desk().id}/', {'role': 'DISPLAY'},
                                           format='json').status_code, 400)


class ServerVoiceTestCase(CsmTablesTestCase):
    """The TV's server-made announcement audio (ctms/tts.py); the browser voice is the fallback."""

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.office = CsmOffice.objects.create(name="Aurora Field Office", code="AUR", is_active=True)
        self.other = CsmOffice.objects.create(name="Bataan Field Office", code="BAT", is_active=True)
        service = CsmService.objects.create(name="SEnA", is_active=True, sort_order=1)
        staff = User.objects.create_user(username="ana", password="Ana-Pass-1", is_staff=True,
                                         first_name="Wilson", last_name="Dayrit")
        CtmsStaffOffice.objects.create(user=staff, office=self.office)
        CtmsCounter.objects.create(office=self.office, name="TSSD 1", is_active=True, assigned_user=staff)
        call_transaction(create_transaction(self.office, service, client_name="Juan", is_priority=True), staff)
        self.call = CtmsCallAnnouncement.objects.get()

    def test_announcement_wording_is_clear(self):
        from . import tts
        self.assertEqual(tts.announcement_text('001', 'TSSD 1', 'Wilson Dayrit'),
                         "Queue number, zero zero one. Please proceed to, T S S D 1. Please look for Wilson Dayrit.")
        self.assertEqual(tts.announcement_text('P-003', 'IMSD'),
                         "Queue number, Priority, P, zero zero three. Please proceed to, I M S D.")
        self.assertEqual(tts.spoken_window('Window 4'), 'Window 4')

    def test_no_server_voice_means_404_and_the_tv_uses_the_browser_voice(self):
        with mock.patch('ctms.tts.synthesize', return_value=None), mock.patch('ctms.tts.is_enabled', return_value=False):
            url = f'/api/public/display/{self.office.id}/calls/{self.call.id}/audio/'
            self.assertEqual(self.client.get(url).status_code, 404)
            self.assertFalse(self.client.get(f'/api/public/display/{self.office.id}/calls/').data['server_voice'])

    def test_call_audio_is_the_spoken_announcement(self):
        with mock.patch('ctms.tts.synthesize', return_value=b'RIFF-fake') as synth, \
                mock.patch('ctms.tts.is_enabled', return_value=True):
            res = self.client.get(f'/api/public/display/{self.office.id}/calls/{self.call.id}/audio/')
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res['Content-Type'], 'audio/wav')
            self.assertEqual(res.content, b'RIFF-fake')
            self.assertEqual(synth.call_args[0][0], "Queue number, Priority, P, zero zero one. Please proceed to, "
                                                   "T S S D 1. Please look for Wilson Dayrit.")
            self.assertTrue(self.client.get(f'/api/public/display/{self.office.id}/calls/').data['server_voice'])
            # Another office's address can't read this office's calls
            self.assertEqual(self.client.get(f'/api/public/display/{self.other.id}/calls/{self.call.id}/audio/').status_code, 404)

    def test_sound_check_says_only_the_fixed_sentence(self):
        from . import tts
        with mock.patch('ctms.tts.synthesize', return_value=b'RIFF-fake') as synth:
            res = self.client.get(f'/api/public/display/{self.office.id}/voice-check/', {'text': 'anything else'})
            self.assertEqual(res.status_code, 200)
            synth.assert_called_once_with(tts.SOUND_CHECK_TEXT)


class ReferralTestCase(CsmTablesTestCase):
    """
    Referring a client to another office: the ticket closes as Referred, and the client
    joins the other office's line only when they arrive there (QR check-in or staff).
    """

    def setUp(self):
        self.bataan = CsmOffice.objects.create(name="Bataan Field Office", code="BAT", is_active=True)
        self.aurora = CsmOffice.objects.create(name="Aurora Field Office", code="AUR", is_active=True)
        self.service = CsmService.objects.create(name="SEnA Assistance", is_active=True, sort_order=1)
        self.ana = self._staff("ana", self.bataan, "Window 1")
        self.ben = self._staff("ben", self.bataan, "Window 2")
        self.aura = self._staff("aura", self.aurora, "Window 1")
        self.client = APIClient()

    def _staff(self, username, office, window):
        user = User.objects.create_user(username=username, password="pw", is_staff=True, first_name=username.title())
        CtmsStaffOffice.objects.create(user=user, office=office)
        CtmsCounter.objects.create(office=office, name=window, assigned_user=user)
        return user

    def _as(self, user):
        self.client.force_authenticate(user=user)
        return self.client

    def _refer(self, tx, by, office, note="Establishment is in Baler", **extra):
        return self._as(by).post(f'/api/staff/transactions/{tx.id}/refer/',
                                 {'to_office': office.id, 'note': note, **extra}, format='json')

    def _referred(self, **create):
        tx = call_transaction(create_transaction(self.bataan, self.service, **create), self.ana)
        res = self._refer(tx, self.ana, self.aurora)
        self.assertEqual(res.status_code, 200, res.data)
        tx.refresh_from_db()
        return tx

    def _arrive(self, tx, office_code=None):
        self.client.force_authenticate(user=None)
        return self.client.post(f'/api/public/tickets/{tx.ticket_token}/arrive/',
                                {'office_code': office_code} if office_code else {}, format='json')

    def test_referred_client_is_expected_not_in_the_line(self):
        tx = self._referred(client_name="Juan", is_priority=True)
        self.assertEqual(tx.status, CtmsTransaction.STATUS_REFERRED)
        self.assertEqual(tx.referral_office, self.aurora)
        self.assertIsNone(tx.counter)
        self.assertIsNone(tx.survey_url)

        # Nothing is in Aurora's line, so it can't be called and nobody is skipped
        self.assertFalse(CtmsTransaction.objects.filter(office=self.aurora).exists())
        self.assertIsNone(call_next_transaction(self.aurora, self.aura))

        queue = self._as(self.aura).get(f'/api/staff/queue/?office={self.aurora.id}').data
        self.assertEqual(queue['waiting'], [])
        expected = queue['expected_referrals']
        self.assertEqual([e['id'] for e in expected], [tx.id])
        self.assertEqual(expected[0]['from_office_name'], "Bataan Field Office")
        self.assertEqual(expected[0]['referral_note'], "Establishment is in Baler")
        self.assertEqual(expected[0]['referred_by'], "Ana")

        # Aurora's staff are told the client is on the way; Bataan's are not
        self.assertTrue(CtmsNotification.objects.filter(recipient=self.aura, notification_type='REFERRAL').exists())
        self.assertFalse(CtmsNotification.objects.filter(recipient=self.ben, notification_type='REFERRAL').exists())

        ticket = self.client.get(f'/api/public/tickets/{tx.ticket_token}/').data
        self.assertEqual(ticket['referred_to']['office_name'], "Aurora Field Office")
        self.assertFalse(ticket['referred_to']['arrived'])
        self.assertIsNone(ticket['referred_to']['ticket_token'])

    def test_client_joins_the_line_on_arrival_behind_those_waiting(self):
        create_transaction(self.aurora, self.service)  # already waiting in Aurora
        tx = self._referred(client_name="Juan")

        res = self._arrive(tx)
        self.assertEqual(res.status_code, 201, res.data)
        new_tx = CtmsTransaction.objects.get(referred_from=tx)
        self.assertEqual(res.data['ticket_token'], new_tx.ticket_token)
        self.assertEqual(new_tx.office, self.aurora)
        self.assertEqual(new_tx.status, CtmsTransaction.STATUS_WAITING)
        self.assertEqual(new_tx.queue_no, "002")  # numbered on arrival, after the client already there
        self.assertEqual(new_tx.client_name, "Juan")
        self.assertEqual(new_tx.referral_note, "Establishment is in Baler")
        self.assertTrue(CtmsAuditLog.objects.filter(action='REFERRAL_ARRIVED', office=self.aurora).exists())

        queue = self._as(self.aura).get(f'/api/staff/queue/?office={self.aurora.id}').data
        self.assertEqual(queue['expected_referrals'], [])
        referred = next(r for r in queue['waiting'] if r['id'] == new_tx.id)
        self.assertEqual(referred['referred_from']['office_name'], "Bataan Field Office")
        self.assertEqual(referred['referred_from']['by'], "Ana")

        ticket = self.client.get(f'/api/public/tickets/{tx.ticket_token}/').data
        self.assertTrue(ticket['referred_to']['arrived'])
        self.assertEqual(ticket['referred_to']['ticket_token'], new_tx.ticket_token)

        # Arriving twice does not make a second ticket
        self.assertEqual(self._arrive(tx).status_code, 409)
        self.assertEqual(CtmsTransaction.objects.filter(office=self.aurora).count(), 2)

    def test_arrival_follows_the_offices_checkin_code(self):
        config = CtmsOfficeQrConfig.objects.create(office=self.aurora, is_qr_enabled=True, requires_office_code=True)
        from .services import get_or_rotate_office_code
        code = get_or_rotate_office_code(config)
        tx = self._referred()

        res = self._arrive(tx, office_code='0000' if code != '0000' else '1111')
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data['code'], 'OFFICE_CODE_INVALID')
        self.assertFalse(CtmsTransaction.objects.filter(office=self.aurora).exists())
        self.assertEqual(self._arrive(tx, office_code=code).status_code, 201)

    def test_staff_can_confirm_arrival(self):
        tx = self._referred()
        # Only the receiving office's staff
        self.assertEqual(self._as(self.ben).post(f'/api/staff/referrals/{tx.id}/arrived/').status_code, 404)
        res = self._as(self.aura).post(f'/api/staff/referrals/{tx.id}/arrived/')
        self.assertEqual(res.status_code, 201, res.data)
        new_tx = CtmsTransaction.objects.get(referred_from=tx)
        self.assertEqual(res.data['id'], new_tx.id)
        event = new_tx.assignment_history.get(event=CtmsAssignmentHistory.EVENT_REFERRAL_RECEIVED)
        self.assertEqual(event.actor, self.aura)

    def test_referral_lapses_after_three_days(self):
        tx = self._referred()
        CtmsTransaction.objects.filter(pk=tx.pk).update(closed_at=timezone.now() - timedelta(days=3, minutes=1))

        queue = self._as(self.aura).get(f'/api/staff/queue/?office={self.aurora.id}').data
        self.assertEqual(queue['expected_referrals'], [])
        self.assertEqual(self._arrive(tx).status_code, 409)
        self.assertTrue(self.client.get(f'/api/public/tickets/{tx.ticket_token}/').data['referred_to']['expired'])

        admin = User.objects.create_superuser(username="root", password="pw")
        bataan = self._as(admin).get(f'/api/staff/reports/summary/?office={self.bataan.id}').data
        self.assertEqual(bataan['total_referred_not_arrived'], 1)

    def test_referral_requires_a_note_and_another_office(self):
        tx = call_transaction(create_transaction(self.bataan, self.service), self.ana)
        self.assertEqual(self._refer(tx, self.ana, self.aurora, note="  ").status_code, 409)
        self.assertEqual(self._refer(tx, self.ana, self.bataan).status_code, 409)
        tx.refresh_from_db()
        self.assertEqual(tx.status, CtmsTransaction.STATUS_SERVING)

    def test_only_the_handler_can_refer_and_only_unfinished_clients(self):
        tx = call_transaction(create_transaction(self.bataan, self.service), self.ana)
        self.assertEqual(self._refer(tx, self.ben, self.aurora).status_code, 403)

        waiting = create_transaction(self.bataan, self.service)
        self.assertEqual(self._refer(waiting, self.ana, self.aurora).status_code, 409)

        mark_done(tx, self.ana)
        self.assertEqual(self._refer(tx, self.ana, self.aurora).status_code, 409)
        self.assertFalse(CtmsTransaction.objects.filter(referral_office=self.aurora).exists())

    def test_referral_can_change_the_service(self):
        other = CsmService.objects.create(name="Labor Inspection", is_active=True, sort_order=2)
        tx = call_transaction(create_transaction(self.bataan, self.service), self.ana)
        self.assertEqual(self._refer(tx, self.ana, self.aurora, service=other.id).status_code, 200)
        tx.refresh_from_db()
        self._arrive(tx)
        self.assertEqual(CtmsTransaction.objects.get(referred_from=tx).service, other)

    def test_referred_ticket_is_final_and_counted_in_reports(self):
        admin = User.objects.create_superuser(username="root", password="pw")
        tx = self._referred()

        # Finished for the sending office: cannot be deleted, shows in the handler's Done tab
        self.assertEqual(self._as(self.ana).post(f'/api/staff/transactions/{tx.id}/delete/').status_code, 409)
        done_tab = self._as(self.ana).get('/api/staff/my-clients/?tab=done').data
        self.assertEqual([r['id'] for r in done_tab['results']], [tx.id])
        self.assertFalse(done_tab['results'][0]['referred_to']['arrived'])

        self._arrive(tx)
        bataan = self._as(admin).get(f'/api/staff/reports/summary/?office={self.bataan.id}').data
        self.assertEqual((bataan['total_referred_out'], bataan['total_referred_in'], bataan['total_referred_not_arrived']), (1, 0, 0))
        self.assertEqual(bataan['survey_rate_percent'], 0)  # not a Done ticket, so not in the survey rate
        aurora = self._as(admin).get(f'/api/staff/reports/summary/?office={self.aurora.id}').data
        self.assertEqual((aurora['total_referred_out'], aurora['total_referred_in']), (0, 1))

    def test_new_ticket_keeps_the_first_slips_survey_code(self):
        tx = self._referred()
        self._arrive(tx)
        self.assertEqual(CtmsTransaction.objects.get(referred_from=tx).claim_code, tx.claim_code)

    def _desk(self, office, username):
        user = User.objects.create_user(username=username, password="pw")
        DolePersonnel.objects.create(user=user, employee_id=username, first_name="Desk", last_name=office.code,
                                     office=office, role=DolePersonnel.ROLE_REGISTRAR)
        return user

    def test_registration_desk_confirms_arrivals_for_its_own_office(self):
        tx = self._referred(client_name="Juan")
        aurora_desk = self._desk(self.aurora, "desk_aur")
        bataan_desk = self._desk(self.bataan, "desk_bat")

        desk = self._as(aurora_desk).get('/api/staff/registration/').data
        self.assertEqual([e['id'] for e in desk['expected_referrals']], [tx.id])
        self.assertEqual(desk['expected_referrals'][0]['from_transaction_no'], tx.transaction_no)
        self.assertEqual(self._as(bataan_desk).get('/api/staff/registration/').data['expected_referrals'], [])

        self.assertEqual(self._as(bataan_desk).post(f'/api/staff/referrals/{tx.id}/arrived/').status_code, 404)
        res = self._as(aurora_desk).post(f'/api/staff/referrals/{tx.id}/arrived/')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['office_name'], "Aurora Field Office")
        self.assertEqual(res.data['claim_code'], tx.claim_code)  # printed on the new slip

    def test_deleting_an_arrived_referral_does_not_bring_it_back(self):
        tx = self._referred(client_name="Juan")
        res = self._as(self.aura).post(f'/api/staff/referrals/{tx.id}/arrived/')
        self.assertEqual(res.status_code, 201, res.data)
        new_id = res.data['id']

        res = self._as(self.aura).post(f'/api/staff/transactions/{new_id}/delete/')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertFalse(CtmsTransaction.objects.filter(pk=new_id).exists())

        # Not back on the "on the way" list, and can't be joined again
        queue = self._as(self.aura).get(f'/api/staff/queue/?office={self.aurora.id}').data
        self.assertEqual(queue['expected_referrals'], [])
        self.assertEqual(self._as(self.aura).post(f'/api/staff/referrals/{tx.id}/arrived/').status_code, 409)
        self.assertEqual(self._arrive(tx).status_code, 409)
        # The sending office's record stays (referred), and the client's ticket says to check in again
        tx.refresh_from_db()
        self.assertEqual(tx.status, CtmsTransaction.STATUS_REFERRED)
        self.assertTrue(self.client.get(f'/api/public/tickets/{tx.ticket_token}/').data['referred_to']['expired'])


class ClientIdentThrottleTestCase(CsmTablesTestCase):
    """A client can't escape the check-in limit by faking X-Forwarded-For; real clients stay separate."""

    def setUp(self):
        cache.clear()
        self.office = CsmOffice.objects.create(name="Bataan Field Office", code="BAT", is_active=True)
        self.service = CsmService.objects.create(name="SEnA", is_active=True, sort_order=1)
        self.client = APIClient()

    def _checkin(self, **meta):
        return self.client.post('/api/public/checkin/', {
            'office': self.office.id, 'service': self.service.id, 'client_name': 'Juan',
        }, format='json', **meta).status_code

    def _limit(self):
        from .throttling import CheckinThrottle
        return CheckinThrottle().parse_rate(CheckinThrottle().get_rate())[0]

    def test_faked_forwarded_for_does_not_reset_the_limit(self):
        limit = self._limit()
        # Through nginx (in Docker): the client's fake entries come first, nginx appends the real address
        codes = [self._checkin(HTTP_X_FORWARDED_FOR=f'10.99.{i}.1, 203.0.113.5', REMOTE_ADDR='172.18.0.3')
                 for i in range(limit + 3)]
        self.assertEqual(codes.count(201), limit)
        self.assertEqual(codes.count(429), 3)

    def test_behind_two_proxies_too(self):
        limit = self._limit()
        codes = [self._checkin(HTTP_X_FORWARDED_FOR=f'10.99.{i}.1, 203.0.113.5, 172.18.0.2', REMOTE_ADDR='172.18.0.3')
                 for i in range(limit + 1)]
        self.assertEqual(codes.count(429), 1)

    def test_real_clients_are_counted_separately(self):
        limit = self._limit()
        for i in range(limit):
            self.assertEqual(self._checkin(HTTP_X_FORWARDED_FOR='203.0.113.5', REMOTE_ADDR='172.18.0.3'), 201)
        self.assertEqual(self._checkin(HTTP_X_FORWARDED_FOR='203.0.113.6', REMOTE_ADDR='172.18.0.3'), 201)
        self.assertEqual(self._checkin(REMOTE_ADDR='192.168.1.20'), 201)  # no proxy at all


class SessionEndingTestCase(CsmTablesTestCase):
    """Renewing a sign-in replaces it; a new password or a disabled account ends every other sign-in."""

    def setUp(self):
        cache.clear()
        self.office = CsmOffice.objects.create(name="DOLE Regional Office III", code="RO3", is_active=True)
        CtmsOfficeProfile.objects.update_or_create(office=self.office, defaults={'office_type': 'REGIONAL'})
        self.user = User.objects.create_user(username="ana", password="Old-Pass-123", is_staff=True)
        CtmsStaffOffice.objects.create(user=self.user, office=self.office)
        DolePersonnel.objects.create(user=self.user, employee_id="ana", first_name="Ana", last_name="Cruz",
                                     office=self.office)
        self.client = APIClient()

    def _login(self, password="Old-Pass-123"):
        self.client.force_authenticate(user=None)
        res = self.client.post('/api/staff/auth/login/', {'username': 'ana', 'password': password}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        return res.data['refresh']

    def _refresh(self, token):
        self.client.force_authenticate(user=None)
        return self.client.post('/api/staff/auth/refresh/', {'refresh': token}, format='json')

    def test_renewal_replaces_the_token_with_a_short_grace(self):
        old = self._login()
        res = self._refresh(old)
        self.assertEqual(res.status_code, 200)
        new = res.data['refresh']
        self.assertNotEqual(new, old)
        self.assertEqual(self._refresh(new).status_code, 200)
        # Another tab sending the replaced token moments later still renews
        self.assertEqual(self._refresh(old).status_code, 200)
        # ...but not once the grace period is over
        from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken
        BlacklistedToken.objects.update(blacklisted_at=timezone.now() - timedelta(minutes=2))
        self.assertEqual(self._refresh(old).status_code, 401)

    def test_signed_out_token_gets_no_grace(self):
        token = self._login()
        self.client.post('/api/staff/auth/logout/', {'refresh': token}, format='json')
        self.assertEqual(self._refresh(token).status_code, 401)

    def test_password_change_ends_other_sessions_and_keeps_this_one(self):
        other_browser = self._login()
        this_browser = self._login()
        self.client.force_authenticate(user=self.user)
        res = self.client.post('/api/staff/auth/change-password/', {
            'current_password': 'Old-Pass-123', 'new_password': 'New-Pass-456',
            'confirm_password': 'New-Pass-456', 'refresh': this_browser,
        }, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(self._refresh(other_browser).status_code, 401)
        self.assertEqual(self._refresh(this_browser).status_code, 401)
        self.assertEqual(self._refresh(res.data['refresh']).status_code, 200)  # the fresh one works

    def test_admin_reset_and_deactivation_end_sessions(self):
        admin = User.objects.create_superuser(username="root", password="Root-Pass-1")
        token = self._login()
        self.client.force_authenticate(user=admin)
        res = self.client.post(f'/api/staff/users/{self.user.id}/reset-password/',
                               {'password': 'Temp-Pass-789', 'confirm_password': 'Temp-Pass-789'}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(self._refresh(token).status_code, 401)

        token = self._login(password='Temp-Pass-789')
        self.client.force_authenticate(user=admin)
        self.assertEqual(self.client.post(f'/api/staff/users/{self.user.id}/toggle-active/').status_code, 200)
        self.assertEqual(self._refresh(token).status_code, 401)
