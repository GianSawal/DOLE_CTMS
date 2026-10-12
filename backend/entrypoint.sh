#!/bin/sh
set -e

echo "==> DOLE CTMS Backend starting..."

# Database availability check (skip if SQLite)
python << 'EOF'
import os, sys, time, socket

use_sqlite = os.getenv('USE_SQLITE_DEV', 'False').lower() in ('true', '1', 't')
if not use_sqlite:
    host = os.getenv('DB_HOST', 'db')
    port = int(os.getenv('DB_PORT', '3306'))
    max_retries = 30
    retry_interval = 2
    
    print(f"==> Waiting for database at {host}:{port}...")
    for i in range(max_retries):
        try:
            with socket.create_connection((host, port), timeout=3):
                print(f"==> Database ({host}:{port}) is ready!")
                sys.exit(0)
        except (socket.error, socket.timeout):
            time.sleep(retry_interval)
    
    print(f"==> ERROR: Database at {host}:{port} could not be reached after {max_retries * retry_interval} seconds.")
    sys.exit(1)
else:
    print("==> USE_SQLITE_DEV=True: Using SQLite database.")
EOF

echo "==> Running database migrations..."
python manage.py migrate --noinput

# Development seed data (sample offices, admin/admin123, staff_* accounts, sample tickets).
# Never run against a live database; enable only for a fresh local/demo install.
if [ "${CTMS_SEED_DEV_DATA:-False}" = "True" ]; then
    echo "==> CTMS_SEED_DEV_DATA=True: seeding development data..."
    python manage.py seed_ctms_dev || true
fi

echo "==> Collecting static files..."
python manage.py collectstatic --noinput

echo "==> Starting application server..."
exec "$@"
