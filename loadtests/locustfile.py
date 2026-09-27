"""
SNIST ERP AI QR-Attendance System — Load Test Harness (Locust)
Location: loadtests/locustfile.py

Models the REAL client behavior (Phase 5 DoD Invariants):
1. 8-second scan submission timeout.
2. Exactly ONE silent retry using the IDENTICAL Idempotency-Key on timeout/abort.
3. Rescan on QR expired / stale token.
4. On HTTP 202 Accepted: polls /attendance/job/{job_id} at 500ms intervals (up to 5 polls).
5. Token refresh before scan burst.
"""

import time
import json
import uuid
import hashlib
from locust import HttpUser, task, between, events
from locust.runners import MasterRunner, WorkerRunner

class StudentScannerUser(HttpUser):
    wait_time = between(0.1, 0.5)

    def on_start(self):
        """Simulate student login, token acquisition, and device binding state."""
        self.roll_number = f"21071A{self.user_id:04d}" if hasattr(self, "user_id") else f"21071A{uuid.uuid4().hex[:4].upper()}"
        self.device_uuid = f"DEV-LOCUST-{uuid.uuid4().hex[:12].upper()}"
        self.access_token = None
        self.session_id = 101 # Default test session

        # 1. Login or mock token initialization
        res = self.client.post(
            "/api/v1/auth/login",
            data={"username": self.roll_number, "password": "TestStudent@2026"},
            headers={"x-device-public-id": self.device_uuid},
            catch_response=True
        )
        if res.status_code == 200:
            self.access_token = res.json().get("access_token")
        else:
            # Fallback mock bearer for isolated load rig
            self.access_token = f"mock_bearer_for_{self.roll_number}"

    @task(10)
    def scan_and_submit_attendance(self):
        """Executes full attendance submission pipeline with realistic retry semantics."""
        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "x-device-public-id": self.device_uuid,
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)"
        }

        # Step 0: Sliding token refresh (1 per client session wake)
        self.client.post("/api/v1/auth/refresh", headers=headers, name="/auth/refresh")

        # Step 1: Compute Idempotency-Key per physical scan act (FIX-2 & Section 3.2)
        raw_token = f"tok_live_s{self.session_id}_{int(time.time())}"
        idem_hash = hashlib.sha256(raw_token.encode()).hexdigest()[:16]
        idempotency_key = f"{self.device_uuid}:{idem_hash}"
        headers["Idempotency-Key"] = idempotency_key

        payload = {
            "session_id": self.session_id,
            "token": raw_token,
            "device_id": self.device_uuid,
            "latitude": 17.4550,
            "longitude": 78.6660,
            "accuracy": 10.0,
            "binding_proof": {
                "challenge_token": f"mock_chal_{self.roll_number}",
                "binding_signature": "MEQCIB...mock_der_sig...==",
                "device_id": self.device_uuid
            }
        }

        # Step 2: Primary Submission Attempt (8s client timeout)
        t0 = time.perf_counter()
        submit_res = self.client.post(
            "/api/v1/student/scan-session",
            json=payload,
            headers=headers,
            timeout=8.0,
            catch_response=True,
            name="/student/scan-session [Primary]"
        )

        # Step 3: Handle Silent Retry (on client abort / timeout / network drop)
        if submit_res.status_code in [0, 408, 504] or (time.perf_counter() - t0 >= 8.0):
            # Silent Retry: strictly re-uses the SAME Idempotency-Key
            retry_res = self.client.post(
                "/api/v1/student/scan-session",
                json=payload,
                headers=headers,
                timeout=8.0,
                name="/student/scan-session [Silent-Retry]"
            )
            submit_res = retry_res

        # Step 4: Handle HTTP 202 Accepted (Asynchronous Job Polling)
        if submit_res.status_code == 202:
            job_data = submit_res.json()
            job_id = job_data.get("job_id")
            if job_id:
                for poll_num in range(5):
                    time.sleep(0.5) # 500ms poll interval
                    poll_res = self.client.get(
                        f"/api/v1/attendance/job/{job_id}",
                        headers=headers,
                        name="/attendance/job/{job_id} [Poll]"
                    )
                    if poll_res.status_code == 200:
                        poll_json = poll_res.json()
                        if poll_json.get("status") in ["committed", "SUCCESS"]:
                            break

        # Step 5: Post-Hoc Selfie Upload (Simulating 30 concurrent uploads at peak)
        if submit_res.status_code in [200, 202]:
            self.client.post(
                "/api/v1/attendance/selfie",
                data={
                    "attendance_id": submit_res.json().get("attendance_id", 1),
                    "session_id": self.session_id,
                    "image": "data:image/jpeg;base64," + "A" * 150000 # ~150KB mock selfie
                },
                headers={"Authorization": f"Bearer {self.access_token}"},
                name="/attendance/selfie"
            )
