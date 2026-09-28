from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model
from ctms.models import CsmOffice, CtmsCounter, CtmsStaffOffice, CsmDivision

User = get_user_model()

class Command(BaseCommand):
    help = "Initialize default window counters and staff assignments for active DOLE offices from csm_division table"

    def handle(self, *args, **options):
        self.stdout.write("Initializing counters and staff assignments from csm_division...")

        offices = CsmOffice.objects.filter(is_active=True)
        self.stdout.write(f"Found {offices.count()} active offices.")

        divisions = CsmDivision.objects.all().order_by('id')
        division_names = [d.name for d in divisions]
        self.stdout.write(f"Found divisions in csm_division: {division_names}")

        total_counters = 0
        for office in offices:
            for name in division_names:
                cnt, created = CtmsCounter.objects.get_or_create(
                    office=office,
                    name=name,
                    defaults={'is_active': True}
                )
                if not created and not cnt.is_active:
                    cnt.is_active = True
                    cnt.save(update_fields=['is_active'])
                if created:
                    total_counters += 1

            # Deactivate any legacy/obsolete counters not in csm_division
            CtmsCounter.objects.filter(office=office).exclude(name__in=division_names).update(is_active=False)

        self.stdout.write(self.style.SUCCESS(f"Initialized division counters (created {total_counters} new, deactivated legacy counters)."))

        # Ensure superuser administrators have access to all offices
        superusers = User.objects.filter(is_superuser=True)
        assigned_count = 0
        for admin in superusers:
            for office in offices:
                _, created = CtmsStaffOffice.objects.get_or_create(
                    user=admin,
                    office=office
                )
                if created:
                    assigned_count += 1

        self.stdout.write(self.style.SUCCESS(f"Configured counters and admin assignments. Regular staff accounts are strictly assigned per office via seed_office_staff."))
