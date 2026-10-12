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
    call_transaction,
    mark_done,
    undo_done,
    requeue_transaction,
    get_default_officer_for_service,
    validate_personnel_office_assignment,
    DIVISION_OFFICER_POOLS,
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
        backfill.forwards(apps, SimpleNamespace(connection=connection))

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

    def _create(self, name, office=None, user=None):
        return self._as(user or self.ana).post('/api/staff/windows/', {'office': (office or self.bataan).id, 'name': name}, format='json')

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
        # Re-creating the same name restores the archived row
        self.assertEqual(self._create("Window 1").data['id'], w1)

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

        self.ana = self._staff("ana", self.bataan, window="Window 1", division=self.tssd2)
        self.ben = self._staff("ben", self.bataan, window="Window 2")
        self.pam = self._staff("pam", self.pampanga, window="Window 1")
        self.client = APIClient()

    def _staff(self, username, office, window=None, division=None):
        user = User.objects.create_user(username=username, password="pw", is_staff=True)
        CtmsStaffOffice.objects.create(user=user, office=office)
        if division:
            CtmsStaffDivision.objects.create(user=user, division=division)
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
        # Ana is tagged TSSD 2 but still sees and calls a TSSD 1 ticket
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

    def test_only_waiting_tickets_can_be_deleted(self):
        tx = create_transaction(self.bataan, self.svc_tssd1)
        self._as(self.ana).post(f'/api/staff/transactions/{tx.id}/call/')
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

    def test_waiting_ticket_cannot_be_transferred(self):
        tx = create_transaction(self.bataan, self.service)
        res = self._transfer(tx, self.ana, self.ben)
        self.assertEqual(res.status_code, 409)
