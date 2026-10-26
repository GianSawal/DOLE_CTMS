from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from ctms import two_factor
from ctms.security import end_all_sessions


class Command(BaseCommand):
    help = ("Resets an account's two-factor sign-in (lost phone) from the server, e.g. for a system "
            "administrator who can't sign in. The account sets up its authenticator again at its next sign-in.")

    def add_arguments(self, parser):
        parser.add_argument('username')

    def handle(self, *args, **options):
        user = get_user_model().objects.filter(username__iexact=options['username']).first()
        if not user:
            raise CommandError(f"No account named '{options['username']}'.")
        two_factor.reset(user)
        end_all_sessions(user)
        self.stdout.write(self.style.SUCCESS(
            f"Two-factor sign-in reset for {user.username}. They set it up again at their next sign-in."))
