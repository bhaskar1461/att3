# Community 38

> 26 nodes · cohesion 0.09

## Key Concepts

- **generate_launch_token()** (20 connections) — `backend/app/services/launch_token.py`
- **._get_student_proof()** (6 connections) — `backend/tests/test_qr_expiry_and_claim_flow.py`
- **._get_student_proof()** (5 connections) — `backend/tests/test_universal_launch_entry.py`
- **.test_launch_attend_flow()** (5 connections) — `backend/tests/test_universal_launch_entry.py`
- **.test_paste_and_go_with_launch_token()** (5 connections) — `backend/tests/test_universal_launch_entry.py`
- **.test_pwa_scanner_with_https_url()** (5 connections) — `backend/tests/test_universal_launch_entry.py`
- **.test_claim_not_consumed_on_binding_failure_and_succeeds_on_retry()** (4 connections) — `backend/tests/test_qr_expiry_and_claim_flow.py`
- **.test_claim_ticket_surviving_login_delay()** (4 connections) — `backend/tests/test_qr_expiry_and_claim_flow.py`
- **.test_distinct_server_error_codes()** (4 connections) — `backend/tests/test_qr_expiry_and_claim_flow.py`
- **.test_scanner_recovering_after_expired_response()** (4 connections) — `backend/tests/test_qr_expiry_and_claim_flow.py`
- **.test_expired_launch_token_rejected()** (4 connections) — `backend/tests/test_universal_launch_entry.py`
- **.test_claim_rejection_for_expired_launch_token()** (3 connections) — `backend/tests/test_qr_expiry_and_claim_flow.py`
- **.test_public_launch_validate_endpoint()** (3 connections) — `backend/tests/test_universal_launch_entry.py`
- **.test_tampered_launch_token_rejected()** (3 connections) — `backend/tests/test_universal_launch_entry.py`
- **Generates a short-lived, signed launch token for URL embedding. Args:…** (1 connections) — `backend/app/services/launch_token.py`
- **3. Launch link exchanges token for a single-use claim that survives a 20s login…** (1 connections) — `backend/tests/test_qr_expiry_and_claim_flow.py`
- **4. Attempting to exchange an expired launch token for a claim is rejected with…** (1 connections) — `backend/tests/test_qr_expiry_and_claim_flow.py`
- **5. Verify distinct error codes: expired, invalid, no_active_binding,…** (1 connections) — `backend/tests/test_qr_expiry_and_claim_flow.py`
- **6. Verify scanner recovery: after receiving 'expired' error on old QR, fresh QR…** (1 connections) — `backend/tests/test_qr_expiry_and_claim_flow.py`
- **7. Claim ticket is NOT consumed when attendance fails due to missing device…** (1 connections) — `backend/tests/test_qr_expiry_and_claim_flow.py`
- **Test 3: Normal Phone Camera opens landing page which calls GET /launch/validate.** (1 connections) — `backend/tests/test_universal_launch_entry.py`
- **Test 4: Authenticated student submits attendance via launch token.** (1 connections) — `backend/tests/test_universal_launch_entry.py`
- **Test 5: Student PWA Scanner reads full HTTPS URL and submits to /student/scan-…** (1 connections) — `backend/tests/test_universal_launch_entry.py`
- **Test 6: Paste-and-Go passes raw launch token to /student/scan-session.** (1 connections) — `backend/tests/test_universal_launch_entry.py`
- **Test 7: Expired launch token is strictly rejected with HTTP 400.** (1 connections) — `backend/tests/test_universal_launch_entry.py`
- *... and 1 more nodes in this community*

## Relationships

- [Community 10](Community_10.md) (8 shared connections)
- [Community 0](Community_0.md) (6 shared connections)
- [Community 4](Community_4.md) (3 shared connections)
- [Community 1](Community_1.md) (3 shared connections)
- [Community 20](Community_20.md) (3 shared connections)
- [Community 8](Community_8.md) (2 shared connections)
- [Community 64](Community_64.md) (2 shared connections)
- [Community 99](Community_99.md) (1 shared connections)
- [Community 52](Community_52.md) (1 shared connections)

## Source Files

- `backend/app/services/launch_token.py`
- `backend/tests/test_qr_expiry_and_claim_flow.py`
- `backend/tests/test_universal_launch_entry.py`

## Audit Trail

- EXTRACTED: 58 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*