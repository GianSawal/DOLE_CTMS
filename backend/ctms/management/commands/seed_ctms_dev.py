from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model
from django.utils import timezone
from ctms.models import (
    CsmOffice,
    CsmService,
    CtmsStaffOffice,
    CtmsTransaction,
)
from ctms.services import create_transaction

User = get_user_model()

class Command(BaseCommand):
    help = "Seed initial development data for DOLE CTMS (Offices, Services, Admin, Sample Queue)"

    def handle(self, *args, **options):
        self.stdout.write("Seeding DOLE CTMS development data...")

        # 1. Offices
        offices_data = [
            ("DOLE Pampanga Field Office", "CRK"),
            ("DOLE Bulacan Field Office", "BUL"),
            ("DOLE Bataan Field Office", "BAT"),
            ("DOLE Nueva Ecija Field Office", "NE"),
            ("DOLE Tarlac Field Office", "TAR"),
            ("DOLE Zambales Field Office", "ZAM"),
            ("DOLE Aurora Provincial Field Office", "AUR"),
            ("DOLE Regional Office III", "RO3"),
        ]

        offices = []
        for name, code in offices_data:
            office, created = CsmOffice.objects.get_or_create(
                code=code,
                defaults={'name': name, 'is_active': True}
            )
            offices.append(office)
        self.stdout.write(f"Offices ready: {len(offices)}")

        # 2. Services
        services_data = [
            ("Single Entry Approach (SEnA)", 1),
            ("Alien Employment Permit (AEP)", 2),
            ("Labor Inspection / Clearance", 3),
            ("Registration of Establishment (Rule 1020)", 4),
            ("Special Program for Employment of Students (SPES)", 5),
            ("TUPAD Program Assistance", 6),
            ("Livelihood Assistance / DILP", 7),
            ("General Labor Standards Assistance", 8),
        ]

        services = []
        for name, order in services_data:
            service, _ = CsmService.objects.get_or_create(
                name=name,
                defaults={'sort_order': order, 'is_active': True}
            )
            services.append(service)
        self.stdout.write(f"Services ready: {len(services)}")

        # Windows are created per office by staff on the Windows page.
        crk_office = offices[0]

        # 4. Staff Accounts
        admin_user, admin_created = User.objects.get_or_create(
            username='admin',
            defaults={
                'is_staff': True,
                'is_superuser': True,
                'first_name': 'DOLE',
                'last_name': 'Administrator',
            }
        )
        if admin_created:
            admin_user.set_password('admin123')
            admin_user.save()
            self.stdout.write("Created superuser: admin / admin123")

        staff_user, staff_created = User.objects.get_or_create(
            username='staff',
            defaults={
                'is_staff': True,
                'is_superuser': False,
                'first_name': 'Window',
                'last_name': 'Officer',
            }
        )
        if staff_created:
            staff_user.set_password('staff123')
            staff_user.save()
            self.stdout.write("Created staff user: staff / staff123")

        # Assign to office
        CtmsStaffOffice.objects.get_or_create(user=admin_user, office=crk_office)
        CtmsStaffOffice.objects.get_or_create(user=staff_user, office=crk_office)

        # 5. Sample Transactions if none exist for today
        today = timezone.localdate()
        if not CtmsTransaction.objects.filter(office=crk_office, queue_date=today).exists():
            tx1 = create_transaction(crk_office, services[0], client_name="Juan Dela Cruz", is_priority=True, source='qr')
            tx2 = create_transaction(crk_office, services[1], client_name="Maria Santos", is_priority=False, source='qr')
            tx3 = create_transaction(crk_office, services[5], client_name="Pedro Penduko", is_priority=False, source='staff')
            self.stdout.write(f"Created sample transactions for today: {tx1.queue_no}, {tx2.queue_no}, {tx3.queue_no}")

        # 6. One staff account per office
        from django.core.management import call_command
        call_command('seed_office_staff')

        self.stdout.write(self.style.SUCCESS("Dev data seeding complete!"))
