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
1. **CSM Shared Tables (Unmanaged):** Read-only tables maintained primarily by the CSM system.
2. **CTMS Tables (Managed):** Dedicated tables prefixed with `ctms_` owned by this codebase.

### 3.1 CSM Shared Models (`managed = False`)
* **`CsmOffice` (`csm_office`):** Regional, Field, and Satellite Offices (e.g. Pampanga, Bulacan, Bataan, Clark, Regional Office III).
  * Fields: `id`, `name`, `code` (e.g. `CRK`, `BUL`, `PAM`), `is_active`, `qr_issued_at`.
* **`CsmDivision` (`csm_division`):** DOLE administrative divisions and units (e.g. `IMSD`, `TSSD 1`, `TSSD 2`, `MALSU`).
* **`CsmService` (`csm_service`):** DOLE public services (e.g. SEnA, AEP, Rule 1020, SPES, TUPAD, DILP). Linked to `CsmDivision`.
* **`CsmResponse` (`csm_csmresponse`):** Completed client feedback surveys.
  * Fields: `id`, `ctms_transaction_id` (Unique foreign key reference to `ctms_transaction.id`), `created_at`.

### 3.2 CTMS Managed Models (`managed = True`)
* **`CtmsTransaction` (`ctms_transaction`):** Core queue lifecycle entity.
  * `transaction_no`: Unique human-readable code (e.g. `CRK-261012-0001`).
  * `queue_no`: Short queue identifier (e.g. `001` or `P-001` for priority).
  * `status`: `waiting` | `serving` | `pending` | `done` | `no_show` | `cancelled`.
  * `source`: `qr` (Self scan) | `kiosk` (Self-service terminal) | `staff` (PACD walk-in).
  * `is_priority`: Boolean (Senior Citizens, PWDs, Pregnant Women under RA 9994 / RA 7277).
  * `client_name`: Client name (optional during check-in, required for walk-in slips).
  * `group_member_names`: JSON array for multi-member group registrations.
  * `ticket_token`: Unique URL token for the live mobile ticket (`/t/:ticketToken`).
  * `survey_token`: Unique secret token for the CSM survey link (`/survey/t/:surveyToken`).
  * `claim_code`: 4-character uppercase alphanumeric code (excluding ambiguous `0/O/1/I/L`).
  * Timestamps: `checked_in_at`, `called_at`, `started_at`, `done_at`, `closed_at`.
* **`CtmsCounter` (`ctms_counter`):** Office service windows/counters (e.g. Window 1, Window 2, Helpdesk).
* **`CtmsStaffOffice` (`ctms_staff_office`):** Many-to-many office assignment bridge for Django `User` accounts.
* **`CtmsStaffDivision` (`ctms_staff_division`):** Division queue scoping bridge for staff user accounts.
* **`DolePersonnel` (`ctms_dole_personnel`):** Pure employee directory for action officers. *Does not have login credentials or passwords.*
* **`DolePosition` (`ctms_dole_position`):** Configurable employee position directory (pre-loaded with standard DOLE plantilla/job order designations).
* **`CtmsEmployee` (`ctms_employee`):** Legacy profile extension linking a `User` to personal details and forced password reset flags.
* **`CtmsServiceDefaultOfficer` (`ctms_service_default_officer`):** Designated default personnel assigned per service and office.
* **`CtmsDisplayConfig` (`ctms_display_config`):** Office TV configuration (ARTA MP4 uploads, YouTube video links, display toggles).
* **`CtmsOfficeQrConfig` (`ctms_office_qr_config`):** Office-level check-in gating (enable/disable QR registration during off-hours, custom notices).
* **`CtmsAuditLog` (`ctms_audit_log`):** Government compliance audit trail tracking logins, calls, status mutations, deletions, and user modifications with actor IP address.
* **`CtmsNotification` (`ctms_notification`):** In-app notification queue alerting officers when clients are assigned or transferred to them.

### 3.3 Alternative / Local Queueing App Models (`queueing/models.py`)
Used for processing cycle time (PCT) tracking and Citizen's Charter benchmarks:
* **`Office` / `Unit` / `Service`:** Standalone models containing Citizen's Charter standards (`pct_minutes`, `classification`: Simple ≤3 days, Complex ≤7 days, Highly Technical ≤20 days).
* **`QueueTicket` / `TicketItem`:** Multi-unit ticket model tracking step-by-step routing across units.

---

## 4. End-to-End System Features & Modules

### 4.1 Module 1: Public Client Self Check-In & Mobile Ticket

#### 1. QR Code Check-In (`/checkin/office/:officeId`)
* **Office Locked Scoping:** Bound to the specific office represented by the QR code.
* **Office Hours Enforcement:** If an administrator disables QR registration via `CtmsOfficeQrConfig`, the page displays a branded notice informing clients of operating hours (Monday to Friday, 8:00 AM - 5:00 PM).
* **Service Selection:** Displays active services grouped by division in official DOLE CSF Form No. 3 order.
* **Priority Lane Integration (RA 9994 / RA 7277):**
  * Checkbox for Senior Citizens, Persons with Disabilities (PWD), and Pregnant Women.
  * Issues a priority ticket number prefixed with `P-` (e.g. `P-001`) which is prioritized in the staff queue.
* **Group Check-In Support:** Supports registering a group (e.g., union delegations, company representatives) by recording individual member names in `group_member_names`.
* **Rate Limiting:** Guarded by `CheckinThrottle` (10 requests/minute per IP) to prevent spam.

#### 2. Live Ticket Screen (`/t/:ticketToken`)
* **Zero App Install:** Operates entirely in mobile web browsers after scanning the check-in QR.
* **Real-time Status Polling:** Polls every 5 seconds for status updates.
* **Key Visual Elements:**
  * Prominent Queue Number (`042` or `P-007`).
  * Unique Transaction Code (`CRK-261012-0042`) and 4-digit Claim Code.
  * Dynamic Wait Position ("3 clients ahead of you").
  * Active Service Window Callout ("Now Serving at Window 2 — Officer: Juan Dela Cruz").
* **Instant Survey Handoff:**
  * As soon as staff marks the transaction **Done**, the ticket dynamically morphs into a vibrant **"Rate Our Service"** button.
  * Directs clients to `{CSM_SURVEY_BASE_URL}/survey/t/{survey_token}`.
  * If the client has completed the survey, the ticket displays **"Feedback Submitted — Thank you for helping DOLE serve you better"**.

---

### 4.2 Module 2: Office TV Display Board (`/display/office/:officeId`)

A high-contrast, responsive full-screen display designed for wall-mounted TV monitors in DOLE waiting lounges:

* **Dual-Pane Layout:**
  * **Left Pane (Queue Operations):**
    * **"Now Serving" Grid:** Live tiles for each active window/counter displaying the serving queue number, client name, service, and assigned officer.
    * **Priority Badges:** High-visibility gold/amber badges for priority lane tickets.
    * **"Next in Line" Waiting Carousel:** Upcoming ticket numbers queued for service.
  * **Right Pane (Public Information & ARTA Video):**
    * Continuous video loop for ARTA (Anti-Red Tape Authority), Citizen's Charter, or DOLE information videos.
    * Supports direct MP4 uploads (stored under `/media/arta_videos/`) or embedded YouTube video URLs.
* **Audio Voice Chime & Text-to-Speech:**
  * Configurable two-tone ding-dong chime.
  * Web Speech API synthesis: Announcing in English or Filipino: *"Now calling Ticket Number 042, please proceed to Window 1"*.
* **Marquee Announcement Ticker:** Scrolling bottom text banner for official office advisories.
* **Privacy Compliance:** In accordance with Philippine Data Privacy Act (RA 10173), ticket displays can be configured to show queue numbers only, omitting client full names.

---

### 4.3 Module 3: Staff Queue Operations Console (`/staff/queue`)

The operational hub for DOLE front-line officers and counter staff:

#### 1. Counter & Office Selection
* Remembers the staff member's selected office and counter in `localStorage`.
* Restricts access strictly to offices assigned to the user in `CtmsStaffOffice` (Superusers have global access).

#### 2. Queue Dispatch Operations
* **Queue Priority Order:** Automatically sorts tickets so that **Priority lane clients (RA 9994/7277) are called first**, followed by standard tickets in First-In, First-Out (FIFO) chronological sequence.
* **Call Next:** Immediately advances the highest-priority waiting ticket to `serving`, assigns the staff member's window, and triggers the TV chime.
* **Recall:** Re-announces the currently served client on the TV display board without altering ticket status.
* **Start Service:** Records the exact `started_at` timestamp to benchmark actual service duration against Citizen's Charter standards.
* **Complete / Done:**
  * Marks the transaction `done`, sets `done_at`, and calculates `service_duration_seconds`.
  * **Immediately unlocks the CSM survey** for the client's mobile ticket.
* **Undo Done:** Reverts an accidental completion back to `serving` (available only if the client has not yet submitted a CSM survey).
* **Hold / Multi-Day Pending:**
  * Moves the transaction to `pending` status for services requiring inspection, legal review, or document compliance across multiple days.
  * Preserves ticket history without distorting same-day waiting queue metrics.
* **No-Show:** Marks the ticket as `no_show` if the client fails to report to the window after multiple calls.
* **Cancel:** Cancels an erroneous or duplicate check-in.
* **Return to Queue (Requeue):** Returns a serving ticket back to the waiting queue if a client temporarily steps away.

#### 3. PACD / Front Desk Walk-in Registration
* Allows counter staff or Public Assistance and Complaints Desk (PACD) officers to register clients who lack smartphones or QR scanners.
* Generates a printable **80mm thermal receipt slip** containing:
  * Official DOLE Seal & Office Header.
  * Large Queue Number and Transaction Barcode / QR Code.
  * Direct survey URL and Claim Code.

#### 4. Action Officer Assignment & Live Push Notifications
* Staff can assign or transfer any ticket to a specific `DolePersonnel` record.
* Automatically creates a `CtmsNotification` for the recipient officer's account.

---

### 4.4 Module 4: Staff User & Role-Based Access Control (RBAC) (`/staff/users`)

Accessible exclusively to superuser administrators:

* **Two Distinct Account Entities:**
  1. **Login Accounts (`User`):** Staff accounts used to authenticate via `/staff/login`.
  2. **Personnel Directory (`DolePersonnel`):** Directory of DOLE officers who provide services. Users can be linked to a personnel record to receive assignments and queue dispatches.
* **Office Scoping (Strict Isolation):**
  * Admin accounts can be granted access to **All Offices** or a custom subset.
  * Field Office staff are restricted strictly to their assigned Field Office (e.g., Bataan staff cannot see or modify Pampanga transactions).
* **Division Queue Permissions:**
  * Staff accounts can be scoped to specific operational divisions (`IMSD`, `TSSD 1`, `TSSD 2`, `MALSU`) or universal front-desk counters (Window 1 to 10).
* **Password Lifecycle & Security:**
  * Supports creating initial temporary passwords (defaults to username if omitted).
  * Enforces **`must_change_password`** upon first login or following an administrative password reset.

---

### 4.5 Module 5: DOLE Personnel & Plantilla Directory (`/staff/personnel`)

* **Comprehensive Personnel Database:** Manages employee ID numbers, full legal names, assigned office, and affiliated divisions.
* **Dynamic Position Management (`/api/staff/positions/`):**
  * Pre-loaded with 40+ official DOLE government positions (e.g., *Labor and Employment Officer I/II/III*, *Supervising LEO*, *Attorney III/IV*, *Mediator-Arbiter*, *Director*, *GIP*, *Job Order*).
  * Administrators can create and manage custom positions on the fly without database migrations.
* **Service Specialization:** Maps personnel to the specific CSM public services they are certified to handle.

---

### 4.6 Module 6: Transaction History & Monitoring (`/staff/transactions`)

* **Filterable Historical Ledger:** Filter by Office, Division, Service, Transaction Status, Date Range, Priority Type, or Client Name.
* **Survey Audit Tracking:** Real-time indicator displaying whether the client has submitted their CSM survey (`Yes (Surveyed)` vs `Pending Survey`).
* **Multi-Day Status Tracking:** Highlights pending transactions that have remained open across business days.
* **CSV Export:** Comprehensive export for administrative reports and COA / ARTA submissions.

---

### 4.7 Module 7: Processing Cycle Time (PCT) Compliance & ARTA Report

Located under `backend/queueing/templates/queueing/pct_report.html` and `/reports/pct/`:

* **Citizen's Charter & ARTA (RA 11032) Performance Analytics:**
  * Evaluates agency compliance with prescribed Processing Cycle Times.
  * Categorizes services by complexity:
    * **Simple Transactions:** ≤ 3 business days.
    * **Complex Transactions:** ≤ 7 business days.
    * **Highly Technical Transactions:** ≤ 20 business days.
* **Key Analytical Metrics:**
  * **Prescribed PCT (Target):** Standard turnaround time defined in the Citizen's Charter.
  * **Actual PCT (Achieved):** Elapsed time from `started_at` to `done_at`.
  * **Average Waiting Time:** Elapsed time from `checked_in_at` to `called_at`.
  * **Compliance Rate (%):** Proportion of transactions completed strictly within the prescribed Citizen's Charter benchmark.
* **Interactive Filtering & Export:** Date range pickers, office filter, unit filter, and single-click CSV export (`DOLE_RO3_PCT_Report_YYYY-MM-DD.csv`).

---

### 4.8 Module 8: General CTMS Summary Reports (`/staff/reports`)

* **Executive Dashboard Metrics:**
  * Total Checked-in vs Total Served.
  * No-show Rate and Cancellation Rate.
  * Average Queue Wait Time (Minutes).
  * Average Transaction Service Time (Minutes).
  * **CSM Survey Conversion Rate (%):** Total Completed Surveys ÷ Total Done Transactions.
* **Visual Breakdown:** Volume breakdown per service and per counter window.

---

### 4.9 Module 9: QR Poster Generation & Office Hours Control (`/staff/qr`)

* **Printable A4 Check-In Poster:**
  * Official DOLE Region III layout with logo, instructions, and high-resolution QR code.
  * Encodes direct check-in URL: `{CTMS_BASE_URL}/checkin/office/{officeId}`.
* **Office Check-In Switch (Open / Close):**
  * Instant toggle switch allowing administrators to enable or disable client check-ins.
  * Configurable off-hours notice message shown to clients when scanning outside official hours.

---

### 4.10 Module 10: Security, Throttling & Government Audit Logs (`/staff/audit-logs`)

* **Comprehensive Audit Trail:** Logs all critical actions to `CtmsAuditLog`:
  * `LOGIN`: User authentication events.
  * `CALL_CLIENT` / `RECALL_CLIENT`: Queue dispatch calls.
  * `COMPLETE_SERVICE`: Marking transactions as Done.
  * `REQUEUE_TICKET` / `HOLD_PENDING`: Queue adjustments.
  * `CREATE_WALKIN` / `DELETE_TICKET`: Ticket creation/deletion.
  * `USER_CREATE` / `USER_UPDATE`: Staff account provisioning.
  * `ASSIGN_OFFICER`: Personnel assignment.
* **Metadata Captured:** Actor username, role, client IP address (`X-Forwarded-For`), target ID, office name, human-readable summary, and structured JSON details.
* **Built-in Rate Limiting (Throttling):**
  * `LOGIN_THROTTLE_RATE = 5/min`: Prevents brute-force authentication attempts.
  * `CHECKIN_THROTTLE_RATE = 10/min`: Prevents automated ticket generation spam.

---

## 5. Complete REST API Reference

| Endpoint | Method | Permissions | Purpose |
| :--- | :---: | :--- | :--- |
| **`/api/health/`** | `GET` | AllowAny | Service health check & database ping |
| **`/api/public/offices/<id>/`** | `GET` | AllowAny | Office details, active services, and QR status |
| **`/api/public/checkin/`** | `POST` | AllowAny (Throttled) | Creates new client transaction ticket |
| **`/api/public/tickets/<token>/`** | `GET` | AllowAny | Polling endpoint for client live ticket |
| **`/api/public/display/<office_id>/`** | `GET` | AllowAny | Polling endpoint for office TV display board |
| **`/api/public/display-video-upload/<id>/`** | `POST` | AllowAny / Admin | Upload MP4 video file for office display |
| **`/api/public/stream-video/`** | `GET` | AllowAny | Range-based HTTP media streaming for videos |
| **`/api/staff/auth/login/`** | `POST` | AllowAny (Throttled) | Authenticate staff and issue SimpleJWT tokens |
| **`/api/staff/auth/refresh/`** | `POST` | AllowAny | Refresh expired JWT access token |
| **`/api/staff/auth/me/`** | `GET` | IsAuthenticated (Staff) | Current user profile, offices, and divisions |
| **`/api/staff/auth/change-password/`** | `POST` | IsAuthenticated | Update staff password & clear `must_change_password` |
| **`/api/staff/queue/`** | `GET` | IsAuthenticated (Staff) | Live queue list (waiting, serving, pending) |
| **`/api/staff/call-next/`** | `POST` | IsAuthenticated (Staff) | Call highest priority waiting ticket |
| **`/api/staff/transactions/walkin/`** | `POST` | IsAuthenticated (Staff) | Register walk-in client ticket at front desk |
| **`/api/staff/transactions/<id>/<action>/`** | `POST` | IsAuthenticated (Staff) | Perform action (`call`, `recall`, `start`, `done`, `undo_done`, `no_show`, `cancel`, `hold_pending`, `requeue`, `assign`, `delete`) |
| **`/api/staff/transactions/`** | `GET` | IsAuthenticated (Staff) | Search & filter transaction history ledger |
| **`/api/staff/reports/summary/`** | `GET` | IsAuthenticated (Staff) | Statistical queue & survey performance metrics |
| **`/api/staff/qr/<office_id>/`** | `GET` | IsAuthenticated (Staff) | Returns QR code PNG / SVG for office |
| **`/api/staff/qr-config/<office_id>/`** | `GET`/`POST` | IsAuthenticated (Staff) | Get or update office check-in enable/disable flag |
| **`/api/staff/display-video/<office_id>/`** | `GET`/`POST` | IsAuthenticated (Staff) | Get or configure display board video sources |
| **`/api/staff/offices/`** | `GET` | IsAuthenticated (Staff) | List active DOLE offices |
| **`/api/staff/divisions/`** | `GET` | IsAuthenticated (Staff) | List DOLE divisions (`IMSD`, `TSSD 1`, etc.) |
| **`/api/staff/counters/`** | `GET`/`POST` | IsAuthenticated (Staff) | CRUD service window counters |
| **`/api/staff/users/`** | `GET`/`POST`/`PATCH` | IsAdminUser (Superuser) | CRUD staff user login accounts |
| **`/api/staff/personnel/`** | `GET`/`POST`/`PATCH` | IsAdminUser (Superuser) | CRUD action personnel directory |
| **`/api/staff/positions/`** | `GET`/`POST`/`DELETE` | IsAdminUser (Superuser) | Manage DOLE position titles |
| **`/api/staff/services/`** | `GET`/`POST` | IsAuthenticated (Staff) | View services and assign default officers |
| **`/api/staff/audit-logs/`** | `GET` | IsAdminUser (Superuser) | Query government compliance audit logs |
| **`/api/staff/notifications/`** | `GET`/`POST` | IsAuthenticated (Staff) | Real-time dispatch notification alerts |

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

### 6.3 Default Seed Credentials
* **System Superuser:** `admin` / `admin123`
* **General Staff:** `staff` / `staff123`
* **Dedicated Field Office Accounts:** Password for all is `staff123`
  * `staff_aur` (Aurora Field Office)
  * `staff_bat` (Bataan Field Office)
  * `staff_bul` (Bulacan Field Office)
  * `staff_crk` (Clark Satellite Office)
  * `staff_ne`  (Nueva Ecija Field Office)
  * `staff_pam` (Pampanga Field Office)
  * `staff_ro3` (Regional Office III)
  * `staff_tar` (Tarlac Field Office)
  * `staff_zam` (Zambales Field Office)

---

## 7. Common Troubleshooting Guidelines for AI Agents & Developers

1. **"Cannot login on any account / Failed to fetch":**
   * Ensure backend is running specifically on **port 8001** (`python manage.py runserver 8001`), as Vite's proxy forwards `/api` to `127.0.0.1:8001`.
2. **"Request was throttled":**
   * Triggered if more than 5 login attempts occur within 1 minute. Wait 60 seconds or increase `LOGIN_THROTTLE_RATE` in `.env`.
3. **Inactive Accounts:**
   * Inactive accounts (`is_active = False`) like `staff_imsd` or `staff_tssd1` cannot authenticate until updated via Django ORM:
     ```python
     User.objects.filter(username='staff_imsd').update(is_active=True)
     ```
4. **Database Connectivity:**
   * If MySQL host `10.6.8.96:3311` is unreachable due to office network disconnection, toggle `USE_SQLITE_DEV=True` in `.env` to fallback to local `db.sqlite3`.
