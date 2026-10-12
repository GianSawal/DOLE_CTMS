from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model
from ctms.models import CsmOffice, CtmsStaffOffice, CtmsCounter

User = get_user_model()

class Command(BaseCommand):
    help = "Create one dedicated staff user per active DOLE office"

    def add_arguments(self, parser):
        parser.add_argument(
            '--password',
            type=str,
            default='staff123',
            help='Default password for newly created staff accounts (default: staff123)'
        )
        parser.add_argument(
            '--reset-passwords',
            action='store_true',
            help='Also reset passwords and re-activate existing staff accounts'
        )

    def handle(self, *args, **options):
        password = options['password']
        reset_passwords = options['reset_passwords']
        self.stdout.write("Creating one dedicated staff account per office...")

        offices = CsmOffice.objects.filter(is_active=True).order_by('name')
        if not offices.exists():
            self.stdout.write(self.style.WARNING("No active offices found in database."))
            return

        created_count = 0
        updated_count = 0

        for office in offices:
            clean_code = "".join(c for c in office.code if c.isalnum()).lower()
            username = f"staff_{clean_code}"

            user, created = User.objects.get_or_create(
                username=username,
                defaults={
                    'is_staff': True,
                    'is_active': True,
                    'first_name': 'Staff',
                    'last_name': office.code,
                    'email': f"{username}@dole.gov.ph",
                }
            )

            # Only set credentials on new accounts (or when explicitly requested).
            # This command runs on every container start, so it must never
            # overwrite passwords or re-enable accounts that admins changed.
            if created or reset_passwords:
                user.is_staff = True
                user.is_active = True
                user.set_password(password)
                user.save()

            # Strict RBAC: Staff account can ONLY access their own assigned office
            CtmsStaffOffice.objects.filter(user=user).exclude(office=office).delete()
            CtmsStaffOffice.objects.get_or_create(user=user, office=office)

            # Ensure default counters exist for this office
            counter_names = ["Window 1", "Window 2", "Window 3 (Priority)", "Helpdesk"]
            for cname in counter_names:
                CtmsCounter.objects.get_or_create(office=office, name=cname, defaults={'is_active': True})

            if created:
                created_count += 1
                self.stdout.write(f"  + Created: {username} -> {office.name} ({office.code})")
            else:
                updated_count += 1
                self.stdout.write(f"  * Updated: {username} -> {office.name} ({office.code})")

        self.stdout.write(self.style.SUCCESS(
            f"Successfully processed {len(offices)} offices ({created_count} created, {updated_count} updated). Default password for new accounts: '{password}'"
        ))
