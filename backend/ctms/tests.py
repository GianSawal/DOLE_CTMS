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
    CtmsTransaction,
)
from .services import (
    create_transaction,
    call_next_transaction,
    mark_done,
    undo_done,
)

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
        res_reset = self.client.post(f"/api/staff/users/{emp.id}/reset-password/", data={"password": "NewTempPassword123"}, format='json')
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




