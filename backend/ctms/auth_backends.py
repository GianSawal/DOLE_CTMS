from django.contrib.auth import get_user_model
from django.contrib.auth.backends import ModelBackend


class CaseInsensitiveUsernameBackend(ModelBackend):
    """
    Signs staff in whatever capitals they type the username in ("dole-admin" for
    "DOLE-ADMIN"; phones often capitalize the first letter). Passwords stay
    case-sensitive. If two accounts ever differ only by capitals, only the exact
    username is accepted, so the right account is always the one checked.
    """

    def authenticate(self, request, username=None, password=None, **kwargs):
        UserModel = get_user_model()
        if username is None:
            username = kwargs.get(UserModel.USERNAME_FIELD)
        if username is None or password is None:
            return None
        username = username.strip()
        from .security import clear_login_failures, login_locked, record_login_failure
        if login_locked(username):
            # Too many wrong passwords for this account: refuse until the window passes
            UserModel().set_password(password)
            return None
        user = self._find_and_check(UserModel, username, password)
        if user is None:
            record_login_failure(username)
        else:
            clear_login_failures(username)
        return user

    def _find_and_check(self, UserModel, username, password):
        manager = UserModel._default_manager
        matches = list(manager.filter(**{f'{UserModel.USERNAME_FIELD}__iexact': username})[:2])
        user = matches[0] if len(matches) == 1 else manager.filter(**{UserModel.USERNAME_FIELD: username}).first()
        if user is None:
            # Run the hasher anyway so a missing account takes as long as a wrong password
            UserModel().set_password(password)
            return None
        if user.check_password(password) and self.user_can_authenticate(user):
            return user
        return None
