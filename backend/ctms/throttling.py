import ipaddress

from rest_framework.throttling import AnonRateThrottle, UserRateThrottle

# Addresses of the proxies in front of the app: Docker's networks (the frontend's nginx,
# and a platform proxy such as Coolify's in front of it) and the machine itself.
_PROXY_NETWORKS = [ipaddress.ip_network(n) for n in ('172.16.0.0/12', '127.0.0.0/8', '::1/128')]


def _is_proxy(ip):
    return any(ip in net for net in _PROXY_NETWORKS)


class ClientIdentMixin:
    """
    Identifies the client by the address the proxies saw, not by what the client claims.

    Proxies append to X-Forwarded-For, so anything a client sends lands on the left and the
    real address is the right-most one that isn't a proxy. DRF's default takes the whole
    header, which a client can change on every request to escape the limit. If no such
    address is found, DRF's default is used, exactly as before.
    """

    def get_ident(self, request):
        forwarded = request.META.get('HTTP_X_FORWARDED_FOR', '')
        chain = [part.strip() for part in forwarded.split(',') if part.strip()]
        chain.append(request.META.get('REMOTE_ADDR', ''))
        for raw in reversed(chain):
            try:
                ip = ipaddress.ip_address(raw)
            except ValueError:
                continue
            if not _is_proxy(ip):
                return str(ip)
        return super().get_ident(request)


class AnonThrottle(ClientIdentMixin, AnonRateThrottle):
    pass


class UserThrottle(ClientIdentMixin, UserRateThrottle):
    pass


class CheckinThrottle(ClientIdentMixin, AnonRateThrottle):
    scope = 'checkin'


class LoginThrottle(ClientIdentMixin, AnonRateThrottle):
    scope = 'login'


class TwoFactorThrottle(ClientIdentMixin, AnonRateThrottle):
    """The 2FA setup and code steps: their own limit, so a first setup plus a mistyped code
    doesn't run into the password step's. Wrong codes are also capped per account (two_factor.py)."""
    scope = 'two_factor'
