# DOLE CTMS / QMS — System Architecture & Feature Reference Guide
**Department of Labor and Employment — Regional Office III (DOLE RO3)**  
*Client Transaction Monitoring System (CTMS) & Queue Management System (QMS)*

---

## 1. Executive Summary & Core Purpose

The **DOLE Client Transaction Monitoring System (CTMS / QMS)** is an enterprise queue management, transaction tracking, and Citizen's Charter compliance platform designed for the Department of Labor and Employment Regional Office III (DOLE RO3), its Field Offices, and Satellite Offices.

### The Core Architectural Rule
The CTMS serves as the **front door** of all client visits and the **strict prerequisite** to the **Client Satisfaction Measurement (CSM)** survey system:
> **A client can answer the DOLE CSM survey ONLY with a valid CTMS transaction number, and ONLY after DOLE staff have marked that transaction as *Done*.**
>
> - **Waiting, Serving, Pending, Cancelled, or No-Show transactions cannot access the survey.**
> - **One transaction allows at most one survey response.**
> - **No HTTP backchannel is used:** The CTMS and CSM integrate directly through a **shared MySQL database**.

---

## 2. Technology Stack & Topology

| Layer | Technology | Key Dependencies & Characteristics |
| :--- | :--- | :--- |
| **Backend API** | Python 3.12+ / Django 5.2.x (LTS) | `djangorestframework`, `djangorestframework-simplejwt`, `django-cors-headers`, `mysqlclient` / `pymysql`, `whitenoise`, `qrcode` |
| **Frontend SPA** | React 19 + Vite 6 | `react-router-dom` (v7), `lucide-react`, Vanilla CSS / DOLE Design Tokens |
| **Database** | MySQL 8.0 (Shared with CSM) | `utf8mb4`, strict SQL modes, UTC datetimes, `Asia/Manila` application timezone |
| **Dev Ports** | Backend: `8001` \| Frontend: `5174` | Vite dev server proxies `/api` and `/media` to `http://127.0.0.1:8001` |
| **Deployment** | Docker / Coolify / Linux / Windows | Gunicorn + WhiteNoise backend, Nginx reverse proxy frontend container |

```
                       ┌────────────────────────────────────────┐
                       │          Client Browser / TV           │
                       │     (Check-in, Ticket, TV Display)     │
                       └───────────────────┬────────────────────┘
                                           │
                                           ▼
┌──────────────────────┐        ┌──────────────────────┐        ┌──────────────────────┐
│  DOLE Staff Portal   │───────▶│    React SPA Frontend │───────▶│   Nginx / Vite Proxy │
│  (Queue / Admin)     │        │     (Port 5174)      │        │  (Reverse Proxy /api)│
└──────────────────────┘        └──────────────────────┘        └──────────┬───────────┘
                                                                           │
                                                                           ▼
                                                                ┌──────────────────────┐
                                                                │  Django 5.2 REST API │
                                                                │  (Port 8001 / Gunicorn│
                                                                └──────────┬───────────┘
                                                                           │
                                                                           ▼
                                                       ┌───────────────────────────────────────┐
                                                       │       Shared MySQL 8.0 Database       │
                                                       │   (CSM Tables  +  CTMS Managed Tables)│
                                                       └───────────────────┬───────────────────┘
                                                                           │
                                                                           ▼
                                                       ┌───────────────────────────────────────┐
                                                       │      DOLE CSM Survey Platform         │
                                                       │      (Reads ctms_transaction status)  │
                                                       └───────────────────────────────────────┘
```

---

## 3. Database Schema & Data Models

The database contains two distinct groups of models:
1. **CSM Shared Tables (Unmanaged):** Tables owned by the CSM system. The CTMS reads them (and tags service divisions).
2. **CTMS Tables (Managed):** Dedicated tables prefixed with `ctms_` owned by this codebase.

### 3.1 CSM Shared Models (`managed = False`)
* **`CsmOffice` (`csm_office`):** Regional, Field, and Satellite Offices (e.g. Pampanga, Bulacan, Bataan, Clark, Regional Office III).
  * Fields: `id`, `name`, `code` (e.g. `CRK`, `BUL`, `PAM`), `is_active`, `qr_issued_at`.
* **`CsmDivision` (`csm_division`):** The only service divisions: **`TSSD 1`, `TSSD 2`, `IMSD`** (`CANONICAL_DIVISIONS` in `ctms/models.py`). Divisions **classify services only**; they never decide who can see, call, or serve a client.
* **`CsmService` (`csm_service`):** DOLE public services (e.g. SEnA, AEP, Rule 1020, SPES, TUPAD, DILP). Tagged with one division or none.
* **`CsmResponse` (`csm_csmresponse`):** Completed client feedback surveys.
  * Fields: `id`, `ctms_transaction_id` (Unique reference to `ctms_transaction.id`), `created_at`.
* **`auth_user`:** Django accounts, **shared with the CSM** (same logins). Staff = `is_staff`.

### 3.2 CTMS Managed Models (`managed = True`)
* **`CtmsTransaction` (`ctms_transaction`):** Core queue lifecycle entity.
  * `transaction_no`: Unique human-readable code (e.g. `CRK-261012-0001`).
  * `queue_no`: Short queue identifier (e.g. `001` or `P-001` for priority).
  * `status`: `waiting` | `serving` | `transferred` | `pending` | `done` | `no_show` | `cancelled` (allowed changes are defined once in `ALLOWED_TRANSITIONS`, `ctms/services.py`). The CSM only unlocks the survey on `done`.
  * `assigned_to`: The personnel account that currently owns the client (set when called; changed by transfers).
  * `counter`: The window the client is being served at (null while waiting, after a transfer, or when served without a window).
  * `served_by` / `served_by_name`: Who pressed Done, and the **name of the final handler** for CSM attribution.
  * `assigned_personnel`: Legacy free-text handler name, kept for history.
  * `source`: `qr` (Self scan) | `kiosk` (Self-service terminal) | `staff` (PACD walk-in).
  * `is_priority`: Boolean (Senior Citizens, PWDs, Pregnant Women under RA 9994 / RA 7277).
  * `client_name`, `group_member_names`, `ticket_token`, `survey_token`, `claim_code` (4 characters, no ambiguous `0/O/1/I/L`).
  * Timestamps: `checked_in_at`, `called_at`, `started_at`, `done_at`, `closed_at`.
* **`CtmsAssignmentHistory` (`ctms_assignment_history`):** Immutable event log per transaction (called, transferred, pending, resumed, completed, reopened, requeued, no-show, cancelled) with from/to user, window, status, actor, reason, and name snapshots.
* **`CtmsCounter` (`ctms_counter`):** A **service window** of one office. `assigned_user` (unique: one person per window, one window per person), `assigned_at`, `is_active`, `archived_at` (soft delete), `sort_order`.
* **`CtmsOfficeProfile` (`ctms_office_profile`):** Office type `REGIONAL` (RO3) or `PROVINCIAL`.
* **`DolePersonnel` (`ctms_dole_personnel`):** The **personnel profile of a login account** (one-to-one with `User`): personnel ID, names, office, position, `role` (`PERSONNEL` / `ADMIN`), `must_change_password`.
* **`CtmsStaffOffice` (`ctms_staff_office`):** The account's office (one per account; the system admin may have several).
* **`DolePosition` (`ctms_dole_position`):** Position catalog used by the account form (pre-loaded with DOLE plantilla/job order designations).
* **`CtmsDisplayConfig` (`ctms_display_config`):** Office TV configuration (ARTA MP4 uploads, YouTube video links).
* **`CtmsOfficeQrConfig` (`ctms_office_qr_config`):** Office-level check-in gating (enable/disable QR registration during off-hours, custom notices).
* **`CtmsAuditLog` (`ctms_audit_log`):** Audit trail of logins, calls, status changes, transfers, window and account changes, with actor IP address.
* **`CtmsNotification` (`ctms_notification`):** In-app notifications, e.g. when a client is transferred to someone.

### 3.3 Alternative / Local Queueing App Models (`queueing/models.py`)
A separate, older server-rendered queue (`/q/<office>/`, `/front-desk/`) used for processing cycle time (PCT) tracking. Not part of the CTMS workflow below.
* **`Office` / `Unit` / `Service`:** Citizen's Charter standards (`pct_minutes`, `classification`: Simple ≤3 days, Complex ≤7 days, Highly Technical ≤20 days).
* **`QueueTicket` / `TicketItem`:** Multi-unit ticket model tracking step-by-step routing across units.

---

## 4. End-to-End Workflow & Modules

```
Office → Service selection → Shared office queue → Call from a window → Serve
       → (Pending / Transfer) → Done → CSM survey
```

### 4.1 Roles & Access

| Account | Sees |
| :--- | :--- |
| **System Admin** (the only superuser; set with `manage.py set_system_admin <username> --apply`) | Everything |
| **Regional Administrator** (`role = ADMIN` **and** a `REGIONAL` office) | Queue, Windows, My Clients, Transactions, QR, plus **User Management, Services, Reports, Audit Log**, with oversight of **all offices** |
| **Everyone else** (all provincial accounts, regional personnel) | Queue, Windows, My Clients, Transactions (own office), Check-in QR |

Rules live in `ctms/permissions.py` and are enforced on every endpoint; the sidebar only mirrors them. An `ADMIN` role on a provincial account grants nothing extra.

### 4.2 Public Client Self Check-In & Mobile Ticket
* **QR Check-In (`/checkin/office/:officeId`):** office-locked; services grouped by division; priority lane (`P-` numbers); group registration; office-hours gating via `CtmsOfficeQrConfig`; throttled (10/min per IP).
* **Tickets enter the office's shared waiting queue unassigned.** Nobody is pre-assigned.
* **Live Ticket (`/t/:ticketToken`):** polls every 5 seconds; queue number, transaction code, claim code, position, window when called; turns into the **Rate Our Service** button when Done, then shows "Feedback Submitted".

### 4.3 Windows (`/staff/windows`)
* Card per window of the office: status (Available / Occupied / Your Window / Inactive), occupant, client being served.
* Any staff member of the office can **add, rename, activate/deactivate, and archive** windows (archived names are restored on re-create).
* **Assign Myself / Release:** one window per person, one person per window (row locks + unique column). Inactive or archived windows cannot be taken; busy windows cannot be archived or deactivated.

### 4.4 Queue (`/staff/queue`)
* **One shared waiting line per office**, priority first then first-come-first-served. Division is only a label.
* **Call Next / Call:** requires the caller's active window in that office; the row is locked so each ticket gets exactly one caller; a person serves one client at a time. The caller becomes the owner (`assigned_to`).
* **My Current Client:** Done, Recall on TV, Pending (with reason), Reassign, Return to Queue (back to the shared line, unassigned), No-show.
* **Owner only:** only the person handling a client can update it (system admin excepted).
* Waiting tickets: Call, Cancel, Delete (waiting tickets only).
* **Walk-in Registration** with a printable 80mm slip.

### 4.5 My Clients (`/staff/my-clients`)
* **Ongoing:** clients you are serving, plus clients transferred to you ("Transferred – not started"), any date.
* **Pending:** clients you paused; they stay yours.
* **Done:** your latest 200 completed transactions with CSM status.
* **View:** ticket details and full handling history.
* **Reassign:** to active staff of the same office. The client leaves your lists and window immediately, the recipient is notified, and you can no longer change it. The recipient presses **Start**:
  * at their own window if they have one;
  * otherwise at the **window the client was transferred from** (shown and announced there on the TV);
  * with a "Proceed to <name>" TV card only if that window no longer exists.

### 4.6 TV Display Board (`/display/office/:officeId`)
* **One card per active window** of the office, in Windows-page order; cards resize to fit. No hardcoded windows or divisions.
* Each card: window name, queue number being served (or Idle / "<name> · Available"), personnel name, service. The latest call is highlighted; extra clients at the same window are listed as **Also serving**.
* Next in line (priority first), ARTA / Citizen's Charter video, chime + voice announcement (English/Filipino), light/dark mode.
* **Privacy (RA 10173):** queue numbers only, never client names.

### 4.7 User Management (`/staff/users`, regional admins)
* **One account = login + personnel profile**, created and edited in a single form: username, email, temporary password + confirmation, role; first/middle/last name, personnel ID, office (one), position.
* New accounts and admin-set passwords require a password change at next login.
* Cannot change office or deactivate while the person has active clients; accounts that handled transactions are deactivated, not deleted; no self-deactivation or self-demotion.

### 4.8 Services (`/staff/services`, regional admins)
* Catalog with a division tag per service (TSSD 1, TSSD 2, IMSD, or none). Service names and availability are managed in the CSM.

### 4.9 Transactions, Reports, QR, Audit Log
* **Transactions (`/staff/transactions`):** history with filters and CSV export; own office, or all offices for regional admins.
* **Reports (`/staff/reports`, regional admins):** volumes, wait/service times, no-show rate, CSM conversion.
* **Check-in QR (`/staff/qr`):** printable A4 poster and open/close check-in switch.
* **Audit Log (`/staff/audit-logs`, regional admins):** all queue, window, account, and configuration actions.
* **PCT report (`/reports/pct/`, legacy `queueing` app):** Citizen's Charter processing cycle time compliance.

### 4.10 CSM Integration
* The CSM reads `ctms_transaction` (`id, transaction_no, office_id, service_id, status, done_at, survey_token, claim_code`) and unlocks the survey only when `status = 'done'`.
* **Personnel attribution:** `ctms_transaction.served_by_name` holds the final handler's name (earlier handlers stay in `ctms_assignment_history`). The CSM can show it by adding that column to its read-only model.

---

## 5. REST API Reference

| Endpoint | Method | Permissions | Purpose |
| :--- | :---: | :--- | :--- |
| `/api/health/` | `GET` | AllowAny | Health check |
| `/api/public/offices/<id>/` | `GET` | AllowAny | Office details, active services, QR status |
| `/api/public/checkin/` | `POST` | AllowAny (Throttled) | Create a ticket |
| `/api/public/tickets/<token>/` | `GET` | AllowAny | Live ticket polling |
| `/api/public/display/<office_id>/` | `GET` | AllowAny | TV board: window cards, next in line, latest call |
| `/api/staff/auth/login/` | `POST` | AllowAny (Throttled) | JWT login; returns the session summary |
| `/api/staff/auth/refresh/` | `POST` | AllowAny | Refresh access token |
| `/api/staff/auth/me/` | `GET` | Staff | Session summary: role, office type, permissions, oversight offices, window |
| `/api/staff/auth/change-password/` | `POST` | Authenticated | Change password, clears `must_change_password` |
| `/api/staff/queue/` | `GET` | Staff | Shared queue: waiting, serving, my pending/transferred, my window, my current client |
| `/api/staff/call-next/` | `POST` | Staff (at a window) | Call the next client to the caller's window |
| `/api/staff/transactions/<id>/<action>/` | `POST` | Staff (owner for owned tickets) | `call`, `recall`, `done`, `undo-done`, `pending`, `requeue`, `transfer`, `no-show`, `cancel`, `delete` |
| `/api/staff/transactions/<id>/history/` | `GET` | Staff | Assignment history of one transaction |
| `/api/staff/transactions/<id>/transfer-recipients/` | `GET` | Staff | Same-office personnel who can take the client |
| `/api/staff/my-clients/?tab=ongoing\|pending\|done` | `GET` | Staff | The caller's workload |
| `/api/staff/windows/` (+ `<id>/`, `<id>/assign-me/`, `<id>/release/`) | `GET`/`POST`/`PATCH`/`DELETE` | Staff of the office | Window management and self-assignment |
| `/api/staff/transactions/` | `GET` | Staff | History ledger (own office; all offices for regional admins) |
| `/api/staff/transactions/walkin/` | `POST` | Staff | Walk-in registration |
| `/api/staff/users/` (+ `reset-password/`, `toggle-active/`) | `GET`/`POST`/`PATCH`/`DELETE` | Regional admin | Unified accounts |
| `/api/staff/services/` (+ `summary/`) | `GET` / `PATCH` | Staff / Regional admin | Service catalog; PATCH changes only `division` |
| `/api/staff/divisions/` | `GET` | Authenticated | TSSD 1, TSSD 2, IMSD |
| `/api/staff/positions/` | `GET`/`POST`/`DELETE` | Regional admin | Position catalog |
| `/api/staff/reports/summary/` | `GET` | Regional admin | Queue and survey metrics |
| `/api/staff/audit-logs/` | `GET` | Regional admin | Audit log |
| `/api/staff/offices/` | `GET` | Authenticated | Active offices with office type |
| `/api/staff/qr/<office_id>/`, `/api/staff/qr-config/` | `GET`/`POST` | Staff | Check-in QR and open/close switch |
| `/api/staff/notifications/` | `GET`/`POST` | Authenticated | Notifications |
| `/api/staff/counters/` | `GET` | Staff | Read-only window list (use `/staff/windows/`) |
| `/api/staff/staff-offices/` | CRUD | System admin | Raw office assignments |

---

## 6. Execution, Development & Deployment Guide

### 6.1 Environment Variables (`backend/.env`)
```ini
DJANGO_SECRET_KEY=ctms-dev-secret-key-change-in-production
DJANGO_DEBUG=True
DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1,192.168.*,10.*

# Shared CSM MySQL Database Connection
DB_NAME=default
DB_USER=mysql
DB_PASSWORD=your_mysql_password
DB_HOST=10.6.8.96
DB_PORT=3311
USE_SQLITE_DEV=False

# URLs & Integration
CTMS_BASE_URL=http://localhost:5174
CSM_SURVEY_BASE_URL=http://localhost:5173
CSM_SURVEY_WINDOW_DAYS=3

# Rate Limiting
CHECKIN_THROTTLE_RATE=10/min
LOGIN_THROTTLE_RATE=5/min

# Docker/Coolify only: sample offices, admin/admin123, staff_* accounts, sample tickets.
# Leave False on any real database.
CTMS_SEED_DEV_DATA=False
```

### 6.2 Running Locally
```powershell
# 1. Start Django Backend on Port 8001 (CRITICAL: Default port 8000 will cause proxy failure)
cd backend
backend\venv\Scripts\python.exe manage.py runserver 8001

# 2. Start React Frontend on Port 5174 (in a separate terminal)
cd frontend
npm run dev
```

### 6.3 Accounts
* **System admin:** the single superuser. Make an account the only one with `python manage.py set_system_admin <username>` (dry run) and `--apply`.
* **Everyone else** is created in **User Management** by a regional administrator; new accounts must change their temporary password at first login.
* **Development seed data** (`seed_ctms_dev`: `admin` / `admin123`, `staff_*` / `staff123`, sample tickets) runs only when `CTMS_SEED_DEV_DATA=True`. Never enable it on a live database.

### 6.4 Every Office's First Steps
1. Open **Windows** and add one window per counter (e.g. Window 1, Window 2).
2. Each staff member presses **Assign Myself** on their window before calling clients.
3. Open the TV page `/display/office/<officeId>`; it shows the office's active windows automatically.

---

## 7. Common Troubleshooting Guidelines for AI Agents & Developers

1. **"Cannot login on any account / Failed to fetch" (local):** the backend must run on **port 8001** (`python manage.py runserver 8001`); Vite proxies `/api` to `127.0.0.1:8001`.
2. **"No active account found with the given credentials" (Coolify):** check that the backend's `DB_*` variables point at the shared MySQL database; otherwise it uses the empty bundled `db` container. The startup log prints `Waiting for database at <host>:<port>`.
3. **"Request was throttled":** more than 5 login attempts in a minute. Wait 60 seconds or raise `LOGIN_THROTTLE_RATE`.
4. **"Take a window on the Windows page before calling clients":** the user has no active window in that office. Assign one on **Windows**.
5. **"Queue #… is handled by …":** only the client's current handler can update it; reassign instead.
6. **Database connectivity:** if MySQL `10.6.8.96:3311` is unreachable, set `USE_SQLITE_DEV=True` in `.env` to use local `db.sqlite3`.
7. **Local `.env` points at production.** Migrations and shell commands run from a developer PC change the live database. Back up first.
