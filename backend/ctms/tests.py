from django.test import TestCase
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
    CtmsStaffDivision,
    CtmsTransaction,
    CtmsServiceDefaultOfficer,
    DolePersonnel,
    DolePosition,
    CtmsAuditLog,
    CtmsNotification,
    CtmsOfficeQrConfig,
)
from .services import (
    create_transaction,
    call_next_transaction,
    call_specific_transaction,
    mark_done,
    undo_done,
    requeue_transaction,
    get_default_officer_for_service,
    validate_personnel_office_assignment,
    DIVISION_OFFICER_POOLS,
)
from .serializers import StaffTransactionSerializer

User = get_user_model()

class CtmsCoreTestCase(TestCase):
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

    def setUp(self):
        self.client = APIClient()
        self.office = CsmOffice.objects.create(name="DOLE Pampanga Field Office", code="CRK", is_active=True)
        self.service = CsmService.objects.create(name="SEnA Assistance", is_active=True, sort_order=1)
        self.counter1 = CtmsCounter.objects.create(office=self.office, name="Window 1", is_active=True)
        self.counter2 = CtmsCounter.objects.create(office=self.office, name="Window 2", is_active=True)
        
        self.staff_user = User.objects.create_user(username="teststaff", password="password123", is_staff=True)
        CtmsStaffOffice.objects.create(user=self.staff_user, office=self.office)

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
        called = call_next_transaction(self.office, self.counter1, personnel="Officer Juan")
        self.assertIsNotNone(called)
        self.assertEqual(called.id, tx_priority.id)
        self.assertEqual(called.status, 'serving')
        self.assertEqual(called.counter, self.counter1)

        # Second call -> Regular client called
        called_second = call_next_transaction(self.office, self.counter1, personnel="Officer Juan")
        self.assertEqual(called_second.id, tx_regular.id)

    def test_done_and_survey_hand_off(self):
        tx = create_transaction(self.office, self.service, is_priority=False)
        call_next_transaction(self.office, self.counter1, personnel="Officer Juan")
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

    def test_division_queue_filtering_and_calling(self):
        div_tssd1 = CsmDivision.objects.create(name="TSSD 1")
        div_tssd2 = CsmDivision.objects.create(name="TSSD 2")

        svc_tssd1 = CsmService.objects.create(name="Contractors Registration", division=div_tssd1, is_active=True, sort_order=2)
        svc_tssd2 = CsmService.objects.create(name="TUPAD Assistance", division=div_tssd2, is_active=True, sort_order=3)

        cnt_tssd1 = CtmsCounter.objects.create(office=self.office, name="TSSD 1", is_active=True)
        cnt_tssd2 = CtmsCounter.objects.create(office=self.office, name="TSSD 2", is_active=True)

        tx1 = create_transaction(self.office, svc_tssd1, client_name="TSSD1 Client", is_priority=False)
        tx2 = create_transaction(self.office, svc_tssd2, client_name="TSSD2 Client", is_priority=False)

        # Authenticate staff user
        self.client.force_authenticate(user=self.staff_user)

        # View queue with TSSD 1 counter -> only tx1 in waiting
        res1 = self.client.get(f"/api/staff/queue/?office={self.office.id}&counter={cnt_tssd1.id}")
        self.assertEqual(res1.status_code, status.HTTP_200_OK)
        waiting_ids_1 = [item['id'] for item in res1.data['waiting']]
        self.assertIn(tx1.id, waiting_ids_1)
        self.assertNotIn(tx2.id, waiting_ids_1)

        # View queue with TSSD 2 counter -> only tx2 in waiting
        res2 = self.client.get(f"/api/staff/queue/?office={self.office.id}&counter={cnt_tssd2.id}")
        self.assertEqual(res2.status_code, status.HTTP_200_OK)
        waiting_ids_2 = [item['id'] for item in res2.data['waiting']]
        self.assertIn(tx2.id, waiting_ids_2)
        self.assertNotIn(tx1.id, waiting_ids_2)

        # Calling next with counter TSSD 1 calls tx1, not tx2
        called = call_next_transaction(self.office, cnt_tssd1, personnel="Officer Juan")
        self.assertIsNotNone(called)
        self.assertEqual(called.id, tx1.id)
        self.assertEqual(called.counter, cnt_tssd1)

        # Calling next with counter TSSD 2 calls tx2
        called2 = call_next_transaction(self.office, cnt_tssd2, personnel="Officer Maria")
        self.assertIsNotNone(called2)
        self.assertEqual(called2.id, tx2.id)
        self.assertEqual(called2.counter, cnt_tssd2)

    def test_user_management_crud_by_admin(self):
        admin_user = User.objects.create_superuser(username="adminuser", password="adminpassword")
        div_tssd1 = CsmDivision.objects.create(name="TSSD 1")
        div_malsu = CsmDivision.objects.create(name="MALSU")

        # Regular staff should get 403
        self.client.force_authenticate(user=self.staff_user)
        res_forbidden = self.client.get("/api/staff/users/")
        self.assertEqual(res_forbidden.status_code, status.HTTP_403_FORBIDDEN)

        # Admin user should get 200
        self.client.force_authenticate(user=admin_user)
        res_list = self.client.get("/api/staff/users/")
        self.assertEqual(res_list.status_code, status.HTTP_200_OK)

        # Admin creates new employee
        create_payload = {
            "employee_id": "EMP-1001",
            "first_name": "Juan",
            "middle_name": "Santos",
            "last_name": "Dela Cruz",
            "position": "Labor and Employment Officer III",
            "office": self.office.id,
            "division_ids": [div_tssd1.id, div_malsu.id],
            "temporary_password": "EMP-1001",
        }
        res_create = self.client.post("/api/staff/users/", data=create_payload, format='json')
        self.assertEqual(res_create.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res_create.data["employee_id"], "EMP-1001")
        self.assertEqual(len(res_create.data["division_ids"]), 2)

        # Verify created User in database
        created_user = User.objects.get(username="EMP-1001")
        self.assertTrue(created_user.is_staff)
        self.assertFalse(created_user.is_superuser)
        self.assertTrue(created_user.check_password("EMP-1001"))

        # Verify CtmsEmployee in database
        from .models import CtmsEmployee
        emp = CtmsEmployee.objects.get(employee_id="EMP-1001")
        self.assertEqual(emp.full_name, "Juan Santos Dela Cruz")
        self.assertEqual(emp.position, "Labor and Employment Officer III")
        self.assertEqual(emp.office, self.office)
        self.assertEqual(emp.divisions.count(), 2)

        # Test reset password endpoint
        res_reset = self.client.post(f"/api/staff/users/{created_user.id}/reset-password/", data={"password": "NewTempPassword123"}, format='json')
        self.assertEqual(res_reset.status_code, status.HTTP_200_OK)
        created_user.refresh_from_db()
        self.assertTrue(created_user.check_password("NewTempPassword123"))

    def test_employee_division_queue_restriction(self):
        from .models import CtmsEmployee
        div_tssd1 = CsmDivision.objects.create(name="TSSD 1")
        div_tssd2 = CsmDivision.objects.create(name="TSSD 2")

        svc1 = CsmService.objects.create(name="Service TSSD 1", division=div_tssd1, is_active=True, sort_order=10)
        svc2 = CsmService.objects.create(name="Service TSSD 2", division=div_tssd2, is_active=True, sort_order=11)

        # Employee assigned ONLY to TSSD 1
        emp_user = User.objects.create_user(username="emp_tssd1", password="password", is_staff=True)
        CtmsStaffOffice.objects.create(user=emp_user, office=self.office)
        emp = CtmsEmployee.objects.create(
            user=emp_user,
            employee_id="EMP-TSSD1",
            first_name="Jane",
            last_name="Doe",
            office=self.office
        )
        emp.divisions.set([div_tssd1])

        # Create transactions for each division
        tx1 = create_transaction(self.office, svc1, client_name="Client 1")
        tx2 = create_transaction(self.office, svc2, client_name="Client 2")

        # Authenticate as emp_tssd1
        self.client.force_authenticate(user=emp_user)

        # In StaffQueueView, emp_tssd1 ONLY sees tx1 in waiting
        res = self.client.get(f"/api/staff/queue/?office={self.office.id}")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        waiting_ids = [item['id'] for item in res.data['waiting']]
        self.assertIn(tx1.id, waiting_ids)
        self.assertNotIn(tx2.id, waiting_ids)

        # Counters list only includes TSSD 1
        counter_names = [c['name'] for c in res.data['counters']]
        self.assertIn("TSSD 1", counter_names)
        self.assertNotIn("TSSD 2", counter_names)

        # Employee cannot call or act on tx2 from TSSD 2
        cnt_tssd2, _ = CtmsCounter.objects.get_or_create(office=self.office, name="TSSD 2", defaults={'is_active': True})
        res_forbidden_call = self.client.post(f"/api/staff/transactions/{tx2.id}/call/", data={"counter": cnt_tssd2.id, "personnel": "Jane Doe"})
        self.assertEqual(res_forbidden_call.status_code, status.HTTP_403_FORBIDDEN)

    def test_window_and_front_desk_division_universal_access(self):
        from .models import CtmsEmployee
        admin_user = User.objects.create_superuser(username="admin_univ", password="password")
        self.client.force_authenticate(user=admin_user)

        # 1. /api/staff/divisions/ ensures and returns Window 1-10 and Front Desk
        res_divs = self.client.get("/api/staff/divisions/")
        self.assertEqual(res_divs.status_code, status.HTTP_200_OK)
        div_names = [d['name'] for d in res_divs.data]
        self.assertIn("Front Desk", div_names)
        for i in range(1, 11):
            self.assertIn(f"Window {i}", div_names)

        div_window1 = CsmDivision.objects.get(name="Window 1")
        div_frontdesk = CsmDivision.objects.get(name="Front Desk")
        div_tssd1 = CsmDivision.objects.get(name="TSSD 1")
        div_tssd2 = CsmDivision.objects.get(name="TSSD 2")

        # 2. Admin creates user assigned to Window 1
        create_payload = {
            "username": "window1_staff",
            "first_name": "Window",
            "last_name": "One",
            "office": self.office.id,
            "office_ids": [self.office.id],
            "division_ids": [div_window1.id],
            "password": "Password123!",
            "role": "staff",
        }
        res_create = self.client.post("/api/staff/users/", data=create_payload, format='json')
        self.assertEqual(res_create.status_code, status.HTTP_201_CREATED)
        self.assertFalse(res_create.data["all_divisions_access"])
        self.assertTrue(res_create.data["all_services_access"])
        self.assertIn("Window 1", res_create.data["division_names"])

        # 3. Create services and transactions across different divisions
        svc_tssd1, _ = CsmService.objects.get_or_create(name="Service TSSD 1 Univ", defaults={'division': div_tssd1, 'is_active': True})
        svc_tssd2, _ = CsmService.objects.get_or_create(name="Service TSSD 2 Univ", defaults={'division': div_tssd2, 'is_active': True})
        tx1 = create_transaction(self.office, svc_tssd1, client_name="TSSD 1 Client")
        tx2 = create_transaction(self.office, svc_tssd2, client_name="TSSD 2 Client")

        # 4. Authenticate as window1_staff
        window_user = User.objects.get(username="window1_staff")
        self.client.force_authenticate(user=window_user)

        # Me endpoint returns all_divisions_access=False, all_services_access=True
        res_me = self.client.get("/api/staff/auth/me/")
        self.assertEqual(res_me.status_code, status.HTTP_200_OK)
        self.assertFalse(res_me.data["all_divisions_access"])
        self.assertTrue(res_me.data["all_services_access"])

        # In StaffQueueView, window1_staff CAN access all services from ALL divisions
        res_queue = self.client.get(f"/api/staff/queue/?office={self.office.id}")
        self.assertEqual(res_queue.status_code, status.HTTP_200_OK)
        waiting_ids = [item['id'] for item in res_queue.data['waiting']]
        self.assertIn(tx1.id, waiting_ids)
        self.assertIn(tx2.id, waiting_ids)

        # 5. Window 1 staff can create walk-in for any division's service
        res_walkin = self.client.post("/api/staff/transactions/walkin/", data={
            "office": self.office.id,
            "service": svc_tssd2.id,
            "client_name": "Walkin Any Division",
            "is_priority": False,
        }, format='json')
        self.assertEqual(res_walkin.status_code, status.HTTP_201_CREATED)

        # 6. Window 1 staff can call transactions from any division
        cnt_w1 = CtmsCounter.objects.get(office=self.office, name="Window 1")
        res_call = self.client.post(f"/api/staff/transactions/{tx2.id}/call/", data={
            "counter": cnt_w1.id,
            "personnel": "Window One"
        }, format='json')
        self.assertEqual(res_call.status_code, status.HTTP_200_OK)
        self.assertEqual(res_call.data["counter_name"], "Window 1")

    def test_first_time_login_password_change(self):
        from .models import CtmsEmployee
        admin_user = User.objects.create_superuser(username="admin_sec", password="adminpassword")

        # Admin creates new employee
        self.client.force_authenticate(user=admin_user)
        res_create = self.client.post("/api/staff/users/", data={
            "employee_id": "EMP-9999",
            "first_name": "Pedro",
            "last_name": "Penduko",
            "office": self.office.id,
            "temporary_password": "EMP-9999",
        }, format='json')
        self.assertEqual(res_create.status_code, status.HTTP_201_CREATED)

        emp = CtmsEmployee.objects.get(employee_id="EMP-9999")
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

    def test_assigned_officer_unavailable_until_completed(self):
        # 1. Create two transactions
        tx1 = create_transaction(self.office, self.service, client_name="Client 1")
        tx2 = create_transaction(self.office, self.service, client_name="Client 2")

        self.client.force_authenticate(user=self.staff_user)

        # 2. Assign Officer Camille Santos to tx1
        res1 = self.client.post(f"/api/staff/transactions/{tx1.id}/assign/", {
            "personnel": "Camille Santos"
        })
        self.assertEqual(res1.status_code, status.HTTP_200_OK)
        tx1.refresh_from_db()
        self.assertEqual(tx1.assigned_personnel, "Camille Santos")

        # 3. Verify active_assignments in queue endpoint
        res_queue = self.client.get(f"/api/staff/queue/?office={self.office.id}")
        self.assertEqual(res_queue.status_code, status.HTTP_200_OK)
        self.assertIn("active_assignments", res_queue.data)
        self.assertTrue(any(a['assigned_personnel'] == "Camille Santos" for a in res_queue.data['active_assignments']))

        # 4. Attempt to assign Camille Santos to tx2 -> Must fail with HTTP 400
        res2 = self.client.post(f"/api/staff/transactions/{tx2.id}/assign/", {
            "personnel": "Camille Santos"
        })
        self.assertEqual(res2.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("currently assigned to Queue", res2.data['detail'])

        # 5. Reassigning Camille Santos to tx1 itself is permitted
        res1_re = self.client.post(f"/api/staff/transactions/{tx1.id}/assign/", {
            "personnel": "Camille Santos"
        })
        self.assertEqual(res1_re.status_code, status.HTTP_200_OK)

        # 6. Complete tx1 (call and mark done)
        call_specific_transaction(tx1, counter=self.counter1)
        mark_done(tx1, self.staff_user)
        tx1.refresh_from_db()
        self.assertEqual(tx1.status, 'done')

        # 7. Now Camille Santos should automatically become available again for tx2!
        res2_after = self.client.post(f"/api/staff/transactions/{tx2.id}/assign/", {
            "personnel": "Camille Santos"
        })
        self.assertEqual(res2_after.status_code, status.HTTP_200_OK)
        tx2.refresh_from_db()
        self.assertEqual(tx2.assigned_personnel, "Camille Santos")

    def test_default_officer_determined_by_service_and_availability(self):
        # 1. Create TSSD 2 division and TUPAD Assistance service
        tssd2 = CsmDivision.objects.create(name="TSSD 2")
        tupad_service = CsmService.objects.create(
            name="TUPAD Assistance",
            division_id=tssd2.id,
            is_active=True,
            sort_order=2,
        )

        # 2. Test get_default_officer_for_service returns a randomized TSSD2 default officer
        default_officer = get_default_officer_for_service(tupad_service, office=self.office)
        self.assertIn(default_officer, DIVISION_OFFICER_POOLS['TSSD 2'])

        # 3. Create transaction with TUPAD Assistance service
        tx = create_transaction(self.office, tupad_service, client_name="Tupad Beneficiary")
        self.client.force_authenticate(user=self.staff_user)

        # 4. Verify StaffTransactionSerializer and queue API provide default_officer
        serialized = StaffTransactionSerializer(tx).data
        self.assertIn(serialized['default_officer'], DIVISION_OFFICER_POOLS['TSSD 2'])
        self.assertEqual(serialized['division_name'], "TSSD 2")

        res_queue = self.client.get(f"/api/staff/queue/?office={self.office.id}")
        self.assertEqual(res_queue.status_code, status.HTTP_200_OK)
        waiting_tx = next((w for w in res_queue.data['waiting'] if w['id'] == tx.id), None)
        self.assertIsNotNone(waiting_tx)
        self.assertIn(waiting_tx['default_officer'], DIVISION_OFFICER_POOLS['TSSD 2'])

        # 5. Test database override via CtmsServiceDefaultOfficer
        CtmsServiceDefaultOfficer.objects.create(
            service=tupad_service,
            officer_name="SPECIAL TUPAD OFFICER"
        )
        self.assertEqual(get_default_officer_for_service(tupad_service, office=self.office), "SPECIAL TUPAD OFFICER")
        self.assertEqual(StaffTransactionSerializer(tx).data['default_officer'], "SPECIAL TUPAD OFFICER")

        # 6. Availability rule: If CAMILLE SANTOS is assigned to an active transaction, she is not assignable to another client
        CtmsServiceDefaultOfficer.objects.filter(service=tupad_service).delete()
        res_assign = self.client.post(f"/api/staff/transactions/{tx.id}/assign/", {
            "personnel": "CAMILLE SANTOS"
        })
        self.assertEqual(res_assign.status_code, status.HTTP_200_OK)
        tx.refresh_from_db()
        self.assertEqual(tx.assigned_personnel, "CAMILLE SANTOS")

        # Another client with TUPAD Assistance
        tx2 = create_transaction(self.office, tupad_service, client_name="Second Client")
        res_assign2 = self.client.post(f"/api/staff/transactions/{tx2.id}/assign/", {
            "personnel": "CAMILLE SANTOS"
        })
        self.assertEqual(res_assign2.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("currently assigned to Queue", res_assign2.data['detail'])

        # Once first transaction is done, officer is available again
        call_specific_transaction(tx, counter=self.counter1)
        mark_done(tx, self.staff_user)
        res_assign2_retry = self.client.post(f"/api/staff/transactions/{tx2.id}/assign/", {
            "personnel": "CAMILLE SANTOS"
        })
        self.assertEqual(res_assign2_retry.status_code, status.HTTP_200_OK)
        tx2.refresh_from_db()
        self.assertEqual(tx2.assigned_personnel, "CAMILLE SANTOS")

    def test_admin_user_office_and_division_access_options(self):
        admin_creator = User.objects.create_superuser(username="superadmin", password="superpassword")
        self.client.force_authenticate(user=admin_creator)

        office2 = CsmOffice.objects.create(name="Zambales Field Office", code="ZFO", is_active=True)
        div_tssd1 = CsmDivision.objects.create(name="TSSD 1")
        div_tssd2 = CsmDivision.objects.create(name="TSSD 2")
        div_imsd = CsmDivision.objects.create(name="IMSD")

        # 1. Create an admin with all offices & all divisions (default)
        res_full_admin = self.client.post("/api/staff/users/", data={
            "username": "full_admin",
            "password": "Password123!",
            "role": "admin",
            "all_offices": True,
            "all_divisions": True,
        }, format='json')
        self.assertEqual(res_full_admin.status_code, status.HTTP_201_CREATED)
        self.assertTrue(res_full_admin.data["all_offices_access"])
        self.assertTrue(res_full_admin.data["all_divisions_access"])
        self.assertEqual(res_full_admin.data["office_name"], "All Offices")

        full_admin_user = User.objects.get(username="full_admin")
        from .views import get_staff_offices, get_staff_divisions
        offices_allowed = get_staff_offices(full_admin_user)
        self.assertIn(self.office, offices_allowed)
        self.assertIn(office2, offices_allowed)

        # 2. Create an admin with specific office choice (e.g. only Zambales)
        res_specific_admin = self.client.post("/api/staff/users/", data={
            "username": "zambales_admin",
            "password": "Password123!",
            "role": "admin",
            "office_ids": [office2.id],
            "division_ids": [div_tssd1.id],
        }, format='json')
        self.assertEqual(res_specific_admin.status_code, status.HTTP_201_CREATED)
        self.assertFalse(res_specific_admin.data["all_offices_access"])
        self.assertEqual(res_specific_admin.data["office_ids"], [office2.id])
        self.assertEqual(res_specific_admin.data["office_name"], "Zambales Field Office")

        zambales_admin_user = User.objects.get(username="zambales_admin")
        zambales_offices = get_staff_offices(zambales_admin_user)
        self.assertIn(office2, zambales_offices)
        self.assertNotIn(self.office, zambales_offices)

        # 3. Update admin to add another office
        res_update = self.client.put(f"/api/staff/users/{zambales_admin_user.id}/", data={
            "office_ids": [self.office.id, office2.id],
        }, format='json')
        self.assertEqual(res_update.status_code, status.HTTP_200_OK)
        zambales_admin_user.refresh_from_db()
        updated_offices = get_staff_offices(zambales_admin_user)
        self.assertIn(self.office, updated_offices)
        self.assertIn(office2, updated_offices)

    def test_staff_services_tab_and_division_restricted_personnel_assignment(self):
        # Authenticate as standard non-admin staff user (Services tab available to all accounts)
        self.client.force_authenticate(user=self.staff_user)

        div_tssd1, _ = CsmDivision.objects.get_or_create(name="TSSD 1")
        div_tssd2, _ = CsmDivision.objects.get_or_create(name="TSSD 2")

        # 1. Create services
        tupad = CsmService.objects.create(
            name="TUPAD Program Assistance",
            division=div_tssd2,
            is_active=True,
            sort_order=31
        )
        cshp = CsmService.objects.create(
            name="Construction Safety and Health Program (CSHP)",
            division=div_tssd1,
            is_active=True,
            sort_order=3
        )
        spes = CsmService.objects.create(
            name="Special Program for Employment of Students (SPES)",
            division=div_tssd2,
            is_active=True,
            sort_order=30
        )

        # 2. Create personnel in respective divisions
        p_tssd2_a = DolePersonnel.objects.create(
            employee_id="EMP-TSSD2-A",
            first_name="Camille",
            last_name="Santos",
            office=self.office,
            is_active=True
        )
        p_tssd2_a.divisions.set([div_tssd2])

        p_tssd2_b = DolePersonnel.objects.create(
            employee_id="EMP-TSSD2-B",
            first_name="Arvie",
            last_name="Angat",
            office=self.office,
            is_active=True
        )
        p_tssd2_b.divisions.set([div_tssd2])

        p_tssd1_a = DolePersonnel.objects.create(
            employee_id="EMP-TSSD1-A",
            first_name="Raymond",
            last_name="Gonzales",
            office=self.office,
            is_active=True
        )
        p_tssd1_a.divisions.set([div_tssd1])

        # 3. Test list services endpoint
        res_list = self.client.get("/api/staff/services/")
        self.assertEqual(res_list.status_code, status.HTTP_200_OK)
        service_names = [s['name'] for s in res_list.data]
        self.assertIn("TUPAD Program Assistance", service_names)
        self.assertIn("Construction Safety and Health Program (CSHP)", service_names)

        # 4. Test eligible personnel endpoint for TUPAD (belongs to TSSD 2)
        res_eligible = self.client.get(f"/api/staff/services/{tupad.id}/eligible-personnel/")
        self.assertEqual(res_eligible.status_code, status.HTTP_200_OK)
        eligible_ids = [p['id'] for p in res_eligible.data['personnel']]
        self.assertIn(p_tssd2_a.id, eligible_ids)
        self.assertIn(p_tssd2_b.id, eligible_ids)
        self.assertNotIn(p_tssd1_a.id, eligible_ids)  # TSSD 1 personnel must NOT be eligible

        # 5. Multi-selection assignment: assign both TSSD 2 personnel to TUPAD
        res_assign = self.client.post(f"/api/staff/services/{tupad.id}/assign-personnel/", {
            "personnel_ids": [p_tssd2_a.id, p_tssd2_b.id]
        }, format='json')
        self.assertEqual(res_assign.status_code, status.HTTP_200_OK)
        self.assertEqual(tupad.assigned_personnel.count(), 2)

        # 6. Strict division restriction: attempting to assign TSSD 1 personnel to TSSD 2 service must fail
        res_invalid = self.client.post(f"/api/staff/services/{tupad.id}/assign-personnel/", {
            "personnel_ids": [p_tssd1_a.id]
        }, format='json')
        self.assertEqual(res_invalid.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Division Restriction Error", res_invalid.data['detail'])

        # 7. Multiple services per personnel: assign p_tssd2_a to SPES as well
        res_assign_spes = self.client.post(f"/api/staff/services/{spes.id}/assign-personnel/", {
            "personnel_ids": [p_tssd2_a.id]
        }, format='json')
        self.assertEqual(res_assign_spes.status_code, status.HTTP_200_OK)
        self.assertEqual(p_tssd2_a.services.count(), 2)
        assigned_service_names = list(p_tssd2_a.services.values_list('name', flat=True))
        self.assertIn("TUPAD Program Assistance", assigned_service_names)
        self.assertIn("Special Program for Employment of Students (SPES)", assigned_service_names)

    def test_service_default_personnel_auto_assignment_and_waiting_queue_reassignment(self):
        self.client.force_authenticate(user=self.staff_user)

        div_tssd2, _ = CsmDivision.objects.get_or_create(name="TSSD 2")
        tupad_service = CsmService.objects.create(
            name="TUPAD Livelihood Assistance",
            division=div_tssd2,
            is_active=True,
            sort_order=40
        )

        p1 = DolePersonnel.objects.create(
            employee_id="EMP-TUPAD-01",
            first_name="Maria",
            last_name="Clara",
            office=self.office,
            is_active=True
        )
        p1.divisions.set([div_tssd2])

        p2 = DolePersonnel.objects.create(
            employee_id="EMP-TUPAD-02",
            first_name="Crisostomo",
            last_name="Ibarra",
            office=self.office,
            is_active=True
        )
        p2.divisions.set([div_tssd2])

        # Associate both personnel with TUPAD service
        tupad_service.assigned_personnel.set([p1, p2])

        # 1. When a client selects a service (via check-in or walk-in), default personnel is automatically assigned
        # based on the personnel associated with that specific service
        tx1 = create_transaction(self.office, tupad_service, client_name="Beneficiary One")
        self.assertIsNotNone(tx1.assigned_personnel)
        self.assertIn(tx1.assigned_personnel, ["Maria Clara", "Crisostomo Ibarra"])

        # 2. When a second client selects the same service, the other available officer is automatically assigned
        other_officer = "Crisostomo Ibarra" if tx1.assigned_personnel == "Maria Clara" else "Maria Clara"
        tx2 = create_transaction(self.office, tupad_service, client_name="Beneficiary Two")
        self.assertEqual(tx2.assigned_personnel, other_officer)

        # 3. Verify in the staff waiting queue, assigned_personnel is present
        res_queue = self.client.get(f"/api/staff/queue/?office={self.office.id}")
        self.assertEqual(res_queue.status_code, status.HTTP_200_OK)
        q_tx1 = next(item for item in res_queue.data['waiting'] if item['id'] == tx1.id)
        self.assertEqual(q_tx1['assigned_personnel'], tx1.assigned_personnel)

        # 4. Attempting to reassign tx1 to p2 while p2 is busy with tx2 fails
        res_busy = self.client.post(f"/api/staff/transactions/{tx1.id}/assign/", {
            "personnel": other_officer
        })
        self.assertEqual(res_busy.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("currently assigned to Queue", res_busy.data['detail'])

        # 5. Create a third available personnel member in TSSD 2
        p3 = DolePersonnel.objects.create(
            employee_id="EMP-TUPAD-03",
            first_name="Elias",
            last_name="Piloto",
            office=self.office,
            is_active=True
        )
        p3.divisions.set([div_tssd2])

        # Reassign tx1 to the available personnel member Elias Piloto
        res_reassign = self.client.post(f"/api/staff/transactions/{tx1.id}/assign/", {
            "personnel": "Elias Piloto"
        })
        self.assertEqual(res_reassign.status_code, status.HTTP_200_OK)
        tx1.refresh_from_db()
        self.assertEqual(tx1.assigned_personnel, "Elias Piloto")

        # 6. Check that REASSIGN_PERSONNEL audit event was logged
        audit_log = CtmsAuditLog.objects.filter(
            action='REASSIGN_PERSONNEL',
            target_id=tx1.id
        ).first()
        self.assertIsNotNone(audit_log)
        self.assertIn("Reassigned", audit_log.description)
        self.assertIn("Elias Piloto", audit_log.description)

    def test_linked_personnel_user_and_assignment_notifications(self):
        # 1. Create a division and DolePersonnel record
        div_mal = CsmDivision.objects.create(name="Mediation and Arbitration Unit")
        personnel = DolePersonnel.objects.create(
            employee_id="EMP-NOTIF-01",
            first_name="Ligaya",
            last_name="Paraiso",
            position="Labor Officer II",
            office=self.office,
            is_active=True
        )
        personnel.divisions.set([div_mal])

        # 2. Create staff user account and link to personnel
        officer_user = User.objects.create_user(
            username="ligaya",
            password="password123",
            first_name="Ligaya",
            last_name="Paraiso",
            email="ligaya@dole.gov.ph",
            is_staff=True
        )
        CtmsStaffOffice.objects.create(user=officer_user, office=self.office)

        # Link personnel to user
        personnel.user = officer_user
        personnel.save()

        # Verify /api/staff/auth/me/ returns linked personnel
        client_officer = APIClient()
        client_officer.force_authenticate(user=officer_user)
        res_me = client_officer.get("/api/staff/auth/me/")
        self.assertEqual(res_me.status_code, status.HTTP_200_OK)
        self.assertIsNotNone(res_me.data.get('linked_personnel'))
        self.assertEqual(res_me.data['linked_personnel']['id'], personnel.id)
        self.assertEqual(res_me.data['linked_personnel']['full_name'], "Ligaya Paraiso")

        # 3. Associate personnel with a service
        service_mal = CsmService.objects.create(name="Labor Dispute Settlement", division=div_mal, is_active=True, sort_order=2)
        service_mal.assigned_personnel.set([personnel])

        # 4. Create another officer who is NOT linked to this user
        other_personnel = DolePersonnel.objects.create(
            employee_id="EMP-NOTIF-02",
            first_name="Danilo",
            last_name="Cruz",
            office=self.office,
            is_active=True
        )
        other_personnel.divisions.set([div_mal])
        service_other = CsmService.objects.create(name="Alien Employment Permit", division=div_mal, is_active=True, sort_order=3)
        service_other.assigned_personnel.set([other_personnel])

        # 5. Create transactions: one for Ligaya, one for Danilo
        tx_ligaya = create_transaction(self.office, service_mal, client_name="Worker Client")
        tx_danilo = create_transaction(self.office, service_other, client_name="Employer Client")

        # Verify transaction assignments
        self.assertEqual(tx_ligaya.assigned_personnel, "Ligaya Paraiso")
        self.assertEqual(tx_danilo.assigned_personnel, "Danilo Cruz")

        # 6. Verify real-time notification generated for Ligaya's user account
        notifications = CtmsNotification.objects.filter(recipient=officer_user)
        self.assertEqual(notifications.count(), 1)
        notif = notifications.first()
        self.assertEqual(notif.queue_no, tx_ligaya.queue_no)
        self.assertEqual(notif.service_name, "Labor Dispute Settlement")
        self.assertFalse(notif.is_read)

        # Check notifications API
        res_notif = client_officer.get("/api/staff/notifications/")
        self.assertEqual(res_notif.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res_notif.data['results']), 1)
        self.assertEqual(res_notif.data['results'][0]['queue_no'], tx_ligaya.queue_no)
        self.assertIn("New Client Assigned", res_notif.data['results'][0]['title'])

        # 7. Check staff queue for Ligaya: default (assigned_to_me=1) should ONLY show tx_ligaya
        res_queue_assigned = client_officer.get(f"/api/staff/queue/?office={self.office.id}")
        self.assertEqual(res_queue_assigned.status_code, status.HTTP_200_OK)
        self.assertTrue(res_queue_assigned.data.get('is_personnel_filtered'))
        waiting_ids = [item['id'] for item in res_queue_assigned.data['waiting']]
        self.assertIn(tx_ligaya.id, waiting_ids)
        self.assertNotIn(tx_danilo.id, waiting_ids)

        # When explicitly requesting assigned_to_me=0, show all
        res_queue_all = client_officer.get(f"/api/staff/queue/?office={self.office.id}&assigned_to_me=0")
        self.assertEqual(res_queue_all.status_code, status.HTTP_200_OK)
        self.assertFalse(res_queue_all.data.get('is_personnel_filtered'))
        all_waiting_ids = [item['id'] for item in res_queue_all.data['waiting']]
        self.assertIn(tx_ligaya.id, all_waiting_ids)
        self.assertIn(tx_danilo.id, all_waiting_ids)

        # 8. Reassignment triggers a notification as well
        # Serve and finish tx_ligaya so Ligaya is free to take another client
        call_specific_transaction(tx_ligaya, self.counter1, personnel="Ligaya Paraiso")
        mark_done(tx_ligaya, officer_user)

        # Reassign tx_danilo to Ligaya
        res_reassign = client_officer.post(f"/api/staff/transactions/{tx_danilo.id}/assign/", {
            "personnel": "Ligaya Paraiso"
        })
        self.assertEqual(res_reassign.status_code, status.HTTP_200_OK)

        # Check that a reassignment notification was received
        notifs_after = CtmsNotification.objects.filter(recipient=officer_user).order_by('-created_at')
        self.assertEqual(notifs_after.count(), 2)
        latest_notif = notifs_after.first()
        self.assertEqual(latest_notif.queue_no, tx_danilo.queue_no)
        self.assertIn("Client Reassigned", latest_notif.title)

        # 9. Mark all notifications as read
        res_mark_read = client_officer.post("/api/staff/notifications/", {"action": "mark_all_read"})
        self.assertEqual(res_mark_read.status_code, status.HTTP_200_OK)
        self.assertEqual(CtmsNotification.objects.filter(recipient=officer_user, is_read=False).count(), 0)

    def test_multiple_waiting_clients_calling_does_not_block_assigned_officer(self):
        """
        Verify that having multiple clients in WAITING line for the same officer
        does not block calling the first waiting client.
        Only an active SERVING client should block calling another client.
        """
        div = CsmDivision.objects.create(name="Technical Support Division")
        personnel = DolePersonnel.objects.create(
            employee_id="EMP-TEST",
            first_name="TEST",
            last_name="ACCOUNT",
            office=self.office,
            is_active=True
        )
        personnel.divisions.set([div])

        service = CsmService.objects.create(
            name="CSHP Application",
            division=div,
            is_active=True,
            sort_order=10
        )
        service.assigned_personnel.set([personnel])

        # Create counter matching division name
        counter = CtmsCounter.objects.create(office=self.office, name=div.name, is_active=True)

        # Authenticate staff user
        staff_client = APIClient()
        staff_client.force_authenticate(user=self.staff_user)

        # 1. Create two transactions assigned to TEST ACCOUNT
        tx1 = create_transaction(self.office, service, client_name="Client 1")
        tx2 = create_transaction(self.office, service, client_name="Client 2")

        self.assertEqual(tx1.assigned_personnel, "TEST ACCOUNT")
        self.assertEqual(tx2.assigned_personnel, "TEST ACCOUNT")
        self.assertEqual(tx1.status, CtmsTransaction.STATUS_WAITING)
        self.assertEqual(tx2.status, CtmsTransaction.STATUS_WAITING)

        # 2. Staff calls tx1 - this MUST SUCCEED even though tx2 is also in WAITING
        res_call = staff_client.post(f"/api/staff/transactions/{tx1.id}/call/", {
            "counter": counter.id,
            "personnel": "TEST ACCOUNT"
        })
        self.assertEqual(res_call.status_code, status.HTTP_200_OK)
        tx1.refresh_from_db()
        self.assertEqual(tx1.status, CtmsTransaction.STATUS_SERVING)

        # 3. Now that tx1 is actively SERVING, attempting to call tx2 simultaneously should fail
        res_call_second = staff_client.post(f"/api/staff/transactions/{tx2.id}/call/", {
            "counter": counter.id,
            "personnel": "TEST ACCOUNT"
        })
        self.assertEqual(res_call_second.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("currently serving", res_call_second.data['detail'])

        # 4. Finish tx1
        mark_done(tx1, self.staff_user)

        # 5. Now tx2 can be called successfully
        res_call_tx2 = staff_client.post(f"/api/staff/transactions/{tx2.id}/call/", {
            "counter": counter.id,
            "personnel": "TEST ACCOUNT"
        })
        self.assertEqual(res_call_tx2.status_code, status.HTTP_200_OK)
        tx2.refresh_from_db()
        self.assertEqual(tx2.status, CtmsTransaction.STATUS_SERVING)

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

    def test_notify_assigned_personnel_again_action(self):
        """
        Verify that admin/staff caller can press notify and it notifies the personnel again.
        """
        # Create user account for personnel
        officer_user = User.objects.create_user(
            username="remind_officer",
            password="password123",
            first_name="Ramon",
            last_name="Bautista",
            is_staff=True
        )
        CtmsStaffOffice.objects.create(user=officer_user, office=self.office)

        personnel = DolePersonnel.objects.create(
            employee_id="EMP-NOTIF-99",
            first_name="Ramon",
            last_name="Bautista",
            office=self.office,
            user=officer_user,
            is_active=True
        )

        service = CsmService.objects.create(name="Special Assistance", is_active=True, sort_order=25)
        service.assigned_personnel.set([personnel])

        tx = create_transaction(self.office, service, client_name="Waiting Client")
        self.assertEqual(tx.assigned_personnel, "Ramon Bautista")

        # Initial assignment created 1 notification
        self.assertEqual(CtmsNotification.objects.filter(recipient=officer_user).count(), 1)

        # Admin/caller calls the notify endpoint
        staff_client = APIClient()
        staff_client.force_authenticate(user=self.staff_user)

        res_notify = staff_client.post(f"/api/staff/transactions/{tx.id}/notify/")
        self.assertEqual(res_notify.status_code, status.HTTP_200_OK)
        self.assertTrue(res_notify.data.get('notified'))

        # Check that a second (reminder) notification was created
        notifs = CtmsNotification.objects.filter(recipient=officer_user).order_by('-created_at')
        self.assertEqual(notifs.count(), 2)

        latest_notif = notifs.first()
        self.assertEqual(latest_notif.notification_type, 'REMINDER')
        self.assertIn("Queue Reminder", latest_notif.title)
        self.assertIn("Reminder from", latest_notif.message)
        self.assertEqual(latest_notif.queue_no, tx.queue_no)

        # Check that audit log recorded the event
        audit = CtmsAuditLog.objects.filter(action='NOTIFY_PERSONNEL', target_id=str(tx.id)).first()
        self.assertIsNotNone(audit)
        self.assertIn("Sent notification reminder", audit.description)

    def test_update_user_personnel_assignment_does_not_mismatch_other_account(self):
        """
        Verify that PATCH /api/staff/users/{user_a.id}/ updates User A,
        even if a CtmsEmployee record exists whose primary key equals user_a.id but is linked to User B.
        """
        user_a = User.objects.create_user(
            username="target_user_a",
            password="password123",
            first_name="Target",
            last_name="Alpha",
            is_staff=True
        )
        user_b = User.objects.create_user(
            username="other_user_b",
            password="password123",
            first_name="Other",
            last_name="Beta",
            is_staff=True
        )

        from .models import CtmsEmployee
        # Create a CtmsEmployee whose primary key equals user_a.id, but linked to user_b
        # This simulated the previous bug where get_object checked CtmsEmployee.pk first
        CtmsEmployee.objects.filter(pk=user_a.id).delete()
        emp_b = CtmsEmployee.objects.create(
            id=user_a.id,
            user=user_b,
            employee_id="EMP-BETA-ID",
            first_name="Other",
            last_name="Beta",
            office=self.office,
            is_active=True
        )

        personnel = DolePersonnel.objects.create(
            employee_id="EMP-ASSIGN-TARGET",
            first_name="Target",
            last_name="Officer",
            position="Senior Officer",
            office=self.office,
            is_active=True
        )

        admin_user = User.objects.create_superuser(
            username="admin_test_user",
            password="adminpassword",
            email="admintest@dole.gov.ph"
        )
        admin_client = APIClient()
        admin_client.force_authenticate(user=admin_user)

        # Update User A with personnel
        res = admin_client.patch(f"/api/staff/users/{user_a.id}/", {
            "first_name": "Target",
            "last_name": "Alpha",
            "personnel_id": personnel.id
        })
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data.get('personnel_id'), personnel.id)

        # Verify that personnel is linked to User A, NOT User B!
        personnel.refresh_from_db()
        self.assertEqual(personnel.user, user_a)
        self.assertNotEqual(personnel.user, user_b)

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
        called = call_specific_transaction(tx, counter=self.counter1, personnel="Officer Juan")
        tx.refresh_from_db()
        self.assertEqual(tx.status, 'serving')
        self.assertIsNotNone(tx.started_at)
        self.assertIsNotNone(tx.called_at)
        self.assertEqual(tx.started_at, tx.called_at)
        orig_started_at = tx.started_at

        # 2. Recalling transaction does not overwrite original started_at
        call_specific_transaction(tx, counter=self.counter1, personnel="Officer Juan")
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

    def test_personnel_office_restriction_and_assignment_isolation(self):
        # 1. Create two separate offices: Clark Satellite Office and DOLE Regional Office III
        clark_office = CsmOffice.objects.create(name="Clark Satellite Office", code="CSO", is_active=True)
        ro3_office = CsmOffice.objects.create(name="DOLE Regional Office III", code="RO3", is_active=True)

        # Create counter for Clark
        clark_counter = CtmsCounter.objects.create(office=clark_office, name="TSSD 1", is_active=True)

        # Create division and service
        tssd1 = CsmDivision.objects.create(name="TSSD 1")
        service = CsmService.objects.create(name="Special Labor Service", division=tssd1, is_active=True, sort_order=10)

        # 2. Create personnel in DOLE Regional Office III and Clark Satellite Office
        p_ro3 = DolePersonnel.objects.create(
            employee_id="RO3-001",
            first_name="Regional",
            last_name="Officer",
            office=ro3_office,
            is_active=True,
        )
        p_ro3.divisions.add(tssd1)

        p_clark = DolePersonnel.objects.create(
            employee_id="CSO-001",
            first_name="Clark",
            last_name="Personnel",
            office=clark_office,
            is_active=True,
        )
        p_clark.divisions.add(tssd1)

        # Associate both personnel with the service
        service.assigned_personnel.add(p_ro3, p_clark)

        # 3. Test get_default_officer_for_service for Clark only picks Clark personnel
        default_officer_clark = get_default_officer_for_service(service, office=clark_office)
        self.assertEqual(default_officer_clark, "Clark Personnel")

        default_officer_ro3 = get_default_officer_for_service(service, office=ro3_office)
        self.assertEqual(default_officer_ro3, "Regional Officer")

        # 4. Create transaction at Clark Satellite Office -> assigned_personnel must be Clark Personnel
        tx_clark = create_transaction(clark_office, service, client_name="Clark Client")
        self.assertEqual(tx_clark.assigned_personnel, "Clark Personnel")

        # 5. Attempting to assign Regional Officer to Clark queue via API is rejected
        clark_staff = User.objects.create_user(username="clarkstaff", password="password123", is_staff=True)
        CtmsStaffOffice.objects.create(user=clark_staff, office=clark_office)
        CtmsStaffDivision.objects.create(user=clark_staff, division=tssd1)
        self.client.force_authenticate(user=clark_staff)

        res_assign_ro3 = self.client.post(f"/api/staff/transactions/{tx_clark.id}/assign/", {
            "personnel": "Regional Officer"
        })
        self.assertEqual(res_assign_ro3.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("cannot be assigned to queues at Clark Satellite Office", res_assign_ro3.data['detail'])

        # Attempting to assign by employee ID of RO3 officer is also rejected
        res_assign_ro3_id = self.client.post(f"/api/staff/transactions/{tx_clark.id}/assign/", {
            "personnel": "RO3-001"
        })
        self.assertEqual(res_assign_ro3_id.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("cannot be assigned to queues at Clark Satellite Office", res_assign_ro3_id.data['detail'])

        # Assigning Clark Personnel succeeds
        res_assign_clark = self.client.post(f"/api/staff/transactions/{tx_clark.id}/assign/", {
            "personnel": "Clark Personnel"
        })
        self.assertEqual(res_assign_clark.status_code, status.HTTP_200_OK)

        # 6. Attempting to call next with RO3 officer at Clark is rejected
        res_call_ro3 = self.client.post("/api/staff/call-next/", {
            "office": clark_office.id,
            "counter": clark_counter.id,
            "personnel": "Regional Officer"
        })
        self.assertEqual(res_call_ro3.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("cannot be assigned to queues at Clark Satellite Office", res_call_ro3.data['detail'])

        # 7. Verify /api/staff/services/{id}/eligible-personnel/?office=clark_office.id only lists Clark personnel
        res_eligible = self.client.get(f"/api/staff/services/{service.id}/eligible-personnel/?office={clark_office.id}")
        self.assertEqual(res_eligible.status_code, status.HTTP_200_OK)
        eligible_names = [p['full_name'] for p in res_eligible.data['personnel']]
        self.assertIn("Clark Personnel", eligible_names)
        self.assertNotIn("Regional Officer", eligible_names)

        # 8. Verify /api/staff/personnel/?office=clark_office.id only lists Clark personnel
        res_personnel = self.client.get(f"/api/staff/personnel/?office={clark_office.id}")
        self.assertEqual(res_personnel.status_code, status.HTTP_200_OK)
        personnel_names = [p['full_name'] for p in res_personnel.data]
        self.assertIn("Clark Personnel", personnel_names)
        self.assertNotIn("Regional Officer", personnel_names)

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












