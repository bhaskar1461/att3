# 🔐 Heroku Deployment Secrets & Scheduled Jobs Checklist

This document details the configuration for the automated GitHub Actions daylight dyno scaler (`.github/workflows/heroku-daylight.yml`), how to obtain and configure the required repository secrets, and how to handle background tasks when the web dyno is scaled to zero.

---

## 1. Required GitHub Actions Secrets

To allow GitHub Actions to scale your Heroku dynos up and down and perform health checks, you must configure **three repository secrets** in GitHub.

| Secret Name | Description | Example / Format |
| :--- | :--- | :--- |
| `HEROKU_API_TOKEN` | Your Heroku account API authorization key | `HRKU-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` |
| `HEROKU_APP_NAME` | The exact name of your Heroku application | `snist-attendance` |
| `APP_URL` | Public base URL of your deployed Heroku app | `https://snist-attendance.herokuapp.com` |

---

## 2. Where to Obtain Each Secret

### 1. `HEROKU_API_TOKEN`
1. Log into your [Heroku Dashboard](https://dashboard.heroku.com).
2. Click your avatar in the top-right corner and select **Account Settings**.
3. Scroll down to the **API Key** section (or **Applications** -> **Authorizations**).
4. Click **Reveal** next to **API Key**.
5. Copy the secret API token.

### 2. `HEROKU_APP_NAME`
1. In your [Heroku Dashboard](https://dashboard.heroku.com/apps), select your application.
2. The name shown at the top-left of the application overview is your `HEROKU_APP_NAME` (e.g. `snist-attendance`).

### 3. `APP_URL`
1. In your Heroku application dashboard, click the **Open app** button in the upper-right corner.
2. The browser URL is your `APP_URL` (format: `https://<your-app-name>.herokuapp.com`).
3. Ensure there is **no trailing slash** when adding this secret (e.g., `https://snist-attendance.herokuapp.com`).

---

## 3. Where to Add Secrets in GitHub

1. Open your repository on GitHub: `https://github.com/<your-username>/att2`.
2. Go to **Settings** (top navigation tab).
3. In the left sidebar, click **Secrets and variables** -> **Actions**.
4. Click the green button **New repository secret**.
5. Add each secret one by one:
   * **Name**: `HEROKU_API_TOKEN` | **Secret**: `<pasted API Key>`
   * **Name**: `HEROKU_APP_NAME`  | **Secret**: `<pasted app name>`
   * **Name**: `APP_URL`          | **Secret**: `https://<your-app-name>.herokuapp.com`
6. Click **Add secret** to save each one.

---

## 4. 🌙 Night-Job Note: Background Tasks When Dyno is Scaled to 0 (`web=0`)

> [!WARNING]
> When the web dyno is scaled down to 0 outside class hours (17:00 – 08:50 IST), **the entire web process is terminated**.
> Any in-memory background worker threads, FastAPI `BackgroundTasks`, or async workers running inside `web` will be suspended and cannot execute.

To prevent critical administrative syncs, digest emails, or background reconciliation from being blocked or delayed until 08:50 AM, these background operations should be moved to the **Heroku Scheduler** add-on (`heroku addons:create scheduler:standard`). Heroku Scheduler spins up an ephemeral, short-lived one-off dyno, runs the designated CLI script, and terminates immediately, consuming minimal dyno hours.

### Exact Functions Qualified for Heroku Scheduler:

| Domain | Module & Function | Call Sites | Recommended Schedule |
| :--- | :--- | :--- | :--- |
| **Google Sheets Sync** | `app.services.gsheets_service.GoogleSheetsService.sync_session_attendance_to_sheet` | `app/api/attendance.py`, `app/api/teacher.py`, `app/api/admin.py` | Daily at 17:15 IST (reconcile full-day registers after classes end) |
| **Security Digest Email** | `app.services.security_alert_service.dispatch_hourly_security_digest` | `app/services/security_alert_service.py:238`, `app/main.py:868` | Daily at 18:00 IST (generate end-of-day security audit summary) |
| **Batch Credential Dispatch** | `app.services.email_service.dispatch_email_batch_background` | `app/api/admin_credentials.py:88` | Off-peak / evening one-off run (dispatches welcome emails & PINs) |
| **Student Onboarding Bulk** | `app.services.onboarding_service.dispatch_onboarding_emails_bulk` | `app/services/onboarding_service.py:249`, `app/api/admin_onboarding.py` | Scheduled bulk enrollment dispatches |
| **Device Rebind OTP Flush** | `app.services.email_service.dispatch_rebind_otp_email_bg` | `app/api/binding.py:157`, `app/api/devices.py:26` | Immediate retry of any failed student verification codes |
| **Database Session Housekeeping**| `app.services.attendance_engine.close_stale_attendance_sessions` | `app/services/attendance_engine.py`, `app/models/models.py` | Daily at 17:30 IST (auto-close unfinalized faculty sessions) |
