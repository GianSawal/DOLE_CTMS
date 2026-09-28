from django.test import TestCase
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework import status

from .models import (
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
