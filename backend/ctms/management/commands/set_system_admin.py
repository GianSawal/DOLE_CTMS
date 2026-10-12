from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from ctms.models import CtmsOfficeProfile, CtmsStaffOffice, DolePersonnel

User = get_user_model()


class Command(BaseCommand):
    help = (
        "Make USERNAME the only superuser (the system administrator). Every other superuser "
        "becomes a normal account in its own office: Administrator role if that office is "
        "regional, Personnel otherwise. Accounts with no office are deactivated. "
        "Dry run unless --apply is given."
    )

    def add_arguments(self, parser):
        parser.add_argument('username')
        parser.add_argument('--apply', action='store_true', help='Write the changes (default is a dry run)')

    def handle(self, username, apply=False, **options):
        admin = User.objects.filter(username__iexact=username).first()
        if not admin:
            raise CommandError(f"No account named '{username}'.")

        plan = []
        with transaction.atomic():
            if not (admin.is_superuser and admin.is_staff and admin.is_active):
                plan.append(f"{admin.username}: make active system admin")
                admin.is_superuser = admin.is_staff = admin.is_active = True
                admin.save(update_fields=['is_superuser', 'is_staff', 'is_active'])

            for user in User.objects.filter(is_superuser=True).exclude(pk=admin.pk):
                profile = DolePersonnel.objects.filter(user=user).select_related('office').first()
                office = profile.office if profile else None

                user.is_superuser = False
                if not office:
                    user.is_active = False
                    user.save(update_fields=['is_superuser', 'is_active'])
                    CtmsStaffOffice.objects.filter(user=user).delete()
                    plan.append(f"{user.username}: no office -> demoted and deactivated")
                    continue
                user.save(update_fields=['is_superuser'])

                regional = CtmsOfficeProfile.objects.filter(
                    office=office, office_type=CtmsOfficeProfile.TYPE_REGIONAL).exists()
                role = DolePersonnel.ROLE_ADMIN if regional else DolePersonnel.ROLE_PERSONNEL
                profile.office = office
                profile.role = role
                profile.is_active = user.is_active
                profile.save()

                CtmsStaffOffice.objects.filter(user=user).exclude(office=office).delete()
                CtmsStaffOffice.objects.get_or_create(user=user, office=office)
                plan.append(f"{user.username}: demoted -> {role.title()} at {office.name}")

            if not apply:
                transaction.set_rollback(True)

        for line in plan or ["Nothing to change."]:
            self.stdout.write(f"  {line}")
        if apply:
            self.stdout.write(self.style.SUCCESS(f"{admin.username} is now the only system administrator."))
        else:
            self.stdout.write(self.style.WARNING("Dry run only. Re-run with --apply to save these changes."))
