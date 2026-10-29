import os
import sys
import tempfile
from pathlib import Path
from datetime import timedelta
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

# Load environment variables from .env
load_dotenv(BASE_DIR / '.env')

SECRET_KEY = os.getenv('DJANGO_SECRET_KEY', 'django-insecure-ctms-secret-key-default-replace-in-prod')
# Off unless explicitly turned on: a missing setting must never expose debug pages
DEBUG = os.getenv('DJANGO_DEBUG', 'False').lower() in ('true', '1', 't')
TESTING = 'test' in sys.argv

# The secret key signs every login token. A missing or publicly known key lets anyone forge a
# login, so say so loudly at startup (without refusing to start, to keep the service up).
_PUBLIC_DEFAULT_KEYS = {
    'django-insecure-ctms-secret-key-default-replace-in-prod',
    'coolify-ctms-secret-key-change-in-production',
    'replace-with-a-strong-random-secret-key-min-50-chars',
}
if not DEBUG and not TESTING and (SECRET_KEY in _PUBLIC_DEFAULT_KEYS or len(SECRET_KEY) < 40):
    print("!!! SECURITY WARNING: DJANGO_SECRET_KEY is missing, a public default, or too short. "
          "Set a long random value in the server's environment variables.", file=sys.stderr, flush=True)

ALLOWED_HOSTS = [host.strip() for host in os.getenv('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1,*').split(',') if host.strip()]

# Application definition
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    
    # Third-party
    'corsheaders',
    'rest_framework',
    'rest_framework_simplejwt',
    'rest_framework_simplejwt.token_blacklist',  # lets logout revoke a refresh token
    
    # CTMS app
    'ctms.apps.CtmsConfig',
    # Queueing app
    'queueing.apps.QueueingConfig',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'
ASGI_APPLICATION = 'config.asgi.application'

# Database Configuration
# Shared with DOLE CSM System (MySQL)
USE_SQLITE_DEV = os.getenv('USE_SQLITE_DEV', 'False').lower() in ('true', '1', 't')

if USE_SQLITE_DEV or 'test' in sys.argv:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'db.sqlite3',
        }
    }
else:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.mysql',
            'NAME': os.getenv('DB_NAME', 'dole_csm_system'),
            'USER': os.getenv('DB_USER', 'root'),
            'PASSWORD': os.getenv('DB_PASSWORD', ''),
            'HOST': os.getenv('DB_HOST', '127.0.0.1'),
            'PORT': int(os.getenv('DB_PORT', '3306')),
            'OPTIONS': {
                'charset': 'utf8mb4',
                'init_command': "SET sql_mode='STRICT_TRANS_TABLES'",
            },
        }
    }

# Password validation
# Usernames are matched ignoring capitals at sign-in; passwords stay case-sensitive
AUTHENTICATION_BACKENDS = ['ctms.auth_backends.CaseInsensitiveUsernameBackend']

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

# Internationalization / Timezone
# Mandated: Asia/Manila, UTC in database
LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Asia/Manila'
USE_I18N = True
USE_TZ = True

# Static files
STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_STORAGE = 'whitenoise.storage.CompressedStaticFilesStorage'

# Media files (e.g. uploaded ARTA video files)
MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'
# Largest request body other than uploaded files (videos are files and don't count). Was 300 MB:
# one anonymous 40 MB request held ~200 MB of memory, so a few could take the server down.
DATA_UPLOAD_MAX_MEMORY_SIZE = int(os.getenv('DATA_UPLOAD_MAX_MEMORY_SIZE', 2621440))  # 2.5 MB, Django's default
FILE_UPLOAD_MAX_MEMORY_SIZE = int(os.getenv('FILE_UPLOAD_MAX_MEMORY_SIZE', 20971520))   # 20MB in memory

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# Django REST Framework
CHECKIN_THROTTLE_RATE = os.getenv('CHECKIN_THROTTLE_RATE', '10/min')
LOGIN_THROTTLE_RATE = os.getenv('LOGIN_THROTTLE_RATE', '5/min')

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ),
    'DEFAULT_PERMISSION_CLASSES': (
        'rest_framework.permissions.AllowAny',
    ),
    # Same limits as DRF's, but a faked X-Forwarded-For can't reset them (ctms/throttling.py)
    'DEFAULT_THROTTLE_CLASSES': [
        'ctms.throttling.AnonThrottle',
        'ctms.throttling.UserThrottle',
    ],
    'DEFAULT_THROTTLE_RATES': {
        'anon': '600/min',
        'user': '1200/min',
        'checkin': CHECKIN_THROTTLE_RATE,
        'login': LOGIN_THROTTLE_RATE,
        'two_factor': os.getenv('TWO_FACTOR_THROTTLE_RATE', '10/min'),
    },
}

# One cache for all the server's worker processes (gunicorn runs several). Sign-in lockouts,
# check-in code limits and request throttles are counted here; with Django's default
# per-process memory cache each worker counted on its own, so the limits were several times
# looser than set and reset on every restart. Tests keep the in-memory cache.
CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
    } if TESTING else {
        'BACKEND': 'django.core.cache.backends.filebased.FileBasedCache',
        'LOCATION': os.getenv('CTMS_CACHE_DIR', os.path.join(tempfile.gettempdir(), 'ctms-cache')),
        'OPTIONS': {'MAX_ENTRIES': 20000},
    },
}

# Off unless turned on (tests keep them on). Django's admin signs in with a password only,
# which would skip the staff two-factor sign-in; the legacy `queueing` pages are unused (the
# web app replaced them) and only widen what can be attacked.
ENABLE_DJANGO_ADMIN = os.getenv('ENABLE_DJANGO_ADMIN', 'False').lower() in ('true', '1', 't') or TESTING
ENABLE_LEGACY_QUEUEING = os.getenv('ENABLE_LEGACY_QUEUEING', 'False').lower() in ('true', '1', 't') or TESTING

# Backups (Backups page; ctms/backups.py). The passphrase encrypts every backup and is never
# sent to a browser: keep a copy of it apart from the server, since without it no backup can
# be opened. With it set, a backup is made every day at BACKUP_TIME (TIME_ZONE: Asia/Manila,
# GMT+8) into BACKUP_DIR, keeping the newest BACKUP_KEEP. BACKUP_DIR must not be in MEDIA_ROOT
# (served to the public).
BACKUP_PASSPHRASE = os.getenv('BACKUP_PASSPHRASE', '')
BACKUP_DIR = os.getenv('BACKUP_DIR', str(BASE_DIR / 'backups'))
BACKUP_TIME = os.getenv('BACKUP_TIME', '23:00')
BACKUP_KEEP = int(os.getenv('BACKUP_KEEP', '14'))
BACKUP_SCHEDULE_CONTENTS = os.getenv('BACKUP_SCHEDULE_CONTENTS', 'database')  # or 'everything'
BACKUP_SCHEDULE_ENABLED = os.getenv('BACKUP_SCHEDULE_ENABLED', 'True').lower() in ('true', '1', 't')

# SimpleJWT Configuration
SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=30),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=1),
    'ROTATE_REFRESH_TOKENS': True,
    # A renewed sign-in replaces the old one, so a copied token stops working. Two tabs
    # renewing at the same moment get a short grace period (StaffTokenRefreshSerializer).
    'BLACKLIST_AFTER_ROTATION': True,
    'ALGORITHM': 'HS256',
    'SIGNING_KEY': SECRET_KEY,
    'AUTH_HEADER_TYPES': ('Bearer',),
}

# CORS Configuration
# Only when asked for explicitly: DEBUG used to switch this on too, so a server left in debug
# mode let any website call the API with a signed-in staff member's browser.
CORS_ALLOW_ALL_ORIGINS = os.getenv('CORS_ALLOW_ALL_ORIGINS', 'False').lower() in ('true', '1', 't')
cors_env = os.getenv('CORS_ALLOWED_ORIGINS')
if cors_env:
    CORS_ALLOWED_ORIGINS = [o.strip() for o in cors_env.split(',') if o.strip()]
else:
    CORS_ALLOWED_ORIGINS = [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:5174',
        'http://127.0.0.1:5174',
    ]
CORS_ALLOW_CREDENTIALS = True

# CSRF Configuration
csrf_env = os.getenv('CSRF_TRUSTED_ORIGINS')
if csrf_env:
    CSRF_TRUSTED_ORIGINS = [o.strip() for o in csrf_env.split(',') if o.strip()]

# CTMS specific URLs & settings
CTMS_BASE_URL = os.getenv('CTMS_BASE_URL', 'http://localhost:5174').rstrip('/')
CSM_SURVEY_BASE_URL = os.getenv('CSM_SURVEY_BASE_URL', 'http://localhost:5173').rstrip('/')
# Where the client's "Rate Our Service" button sends them (the CSM on the office network).
# Separate from CSM_SURVEY_BASE_URL so a wrong value there can't break the client's button.
CSM_SURVEY_PUBLIC_URL = os.getenv('CSM_SURVEY_PUBLIC_URL', 'http://csm.dolero3.lan').rstrip('/')
CSM_SURVEY_WINDOW_DAYS = int(os.getenv('CSM_SURVEY_WINDOW_DAYS', '3'))
QUEUE_DEFAULT_OFFICE_SLUG = os.getenv('QUEUE_DEFAULT_OFFICE_SLUG', None)

TESTING = 'test' in sys.argv

