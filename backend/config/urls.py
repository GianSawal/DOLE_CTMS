from django.conf import settings
from django.contrib import admin
from django.urls import path, include, re_path
from django.views.static import serve

urlpatterns = [
    path('api/', include('ctms.urls')),
    re_path(r'^media/(?P<path>.*)$', serve, {'document_root': settings.MEDIA_ROOT}),
]

# Both off unless turned on in the environment (see settings.py)
if settings.ENABLE_DJANGO_ADMIN:
    urlpatterns.insert(0, path('django-admin/', admin.site.urls))
if settings.ENABLE_LEGACY_QUEUEING:
    urlpatterns.append(path('', include('queueing.urls')))
