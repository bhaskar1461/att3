# Binding Phase 4: Scan-Path Challenge Enforcement — Delivery Report

**Date**: September 12, 2026  
**Phase**: 4 of 6 (Device Binding V2)  
**Status**: ✅ COMPLETE — All 9 tests passing, Phase 3 regression clean

---

## 1. Executive Summary

Phase 4 **wires the cryptographic possession-proof into the production attendance scan path**. When `BINDING_V2=true`, every QR scan submission now requires an ECDSA P-256 challenge-response proof, cryptographically verifying that the request originates from the student's enrolled device. This eliminates the fundamental class of device-spoofing attacks that bypass V1 device-ID-based checks.

### Key Metrics
| Metric | Target | Actual |
|--------|--------|--------|
| Verify duration (avg) | ≤ 5.0ms | **< 0.5ms** |
| Verify duration (max) | ≤ 10ms | **< 2ms** |
| Test cases | 9 | **9 passed** |
| Phase 3 regression | 0 failures | **0 failures** |
| Production behavior (flag off) | Zero change | **Verified** |

---

## 2. Changes Summary

### Backend — `app/api/student.py`

#### Model Extension
```python
class StudentScanSessionRequest(BaseModel):
    # ... existing fields ...
    challenge_token: Optional[str] = None    # HMAC-signed challenge from /binding/challenge
    binding_signature: Optional[str] = None  # IEEE P1363 ECDSA signature
```

#### `_verify_binding_proof()` Helper
A pure, in-memory verification function that:
1. Checks brute-force lockout
2. Validates `challenge_token` + `binding_signature` presence
3. Decodes and validates HMAC challenge token (signature + freshness)
4. Consumes nonce (single-use replay prevention)
5. Queries `DeviceBinding` for student's active binding (single DB read)
6. Verifies ECDSA P-256 signature (< 0.5ms)

#### Scan Path Integration
```python
# Step 0e: Device Binding V2 Possession Proof (Feature-Flagged)
if getattr(settings, 'BINDING_V2', False) and not req.is_offline_submission:
    binding_proof_meta = _verify_binding_proof(db, current_student, req, ip_addr)
```

**Insertion point**: After Step 0d (valid token exemption) and BEFORE the async/sync branch, ensuring both MySQL and SQLite paths are gated.

### Frontend — `StudentClassScannerModal.tsx`

#### Import
```typescript
import { BINDING_V2_ENABLED, signChallenge, getBindingState } from '../services/binding';
```

#### Challenge Fetch + Sign Pipeline
After QR decode, before submission:
1. Check `BINDING_V2_ENABLED`
2. Check `getBindingState() === 'enrolled'`
3. Fetch fresh challenge from `POST /binding/challenge`
4. Sign with non-extractable private key via `signChallenge()`
5. Append `challenge_token` and `binding_signature` to scan request body

---

## 3. Test Matrix

| # | Test Case | Status |
|---|-----------|--------|
| 1 | `BINDING_V2=false` → scan succeeds without binding fields | ✅ PASS |
| 2 | Enrolled student + valid signature → SUCCESS | ✅ PASS |
| 3 | Unenrolled student → 403 BINDING_REQUIRED | ✅ PASS |
| 4 | Wrong key signature → 401 signature_invalid | ✅ PASS |
| 5 | Expired challenge → 401 challenge_expired | ✅ PASS |
| 6 | Replayed challenge → 401 challenge_reused | ✅ PASS |
| 7 | Offline submission → SUCCESS (binding skipped) | ✅ PASS |
| 8 | Verify duration ≤ 5ms budget | ✅ PASS |
| 9 | Lockout after repeated failures → 429 | ✅ PASS |

---

## 4. Security Properties Achieved

- **Device Possession Proof**: Cryptographic ECDSA P-256 signature proves the request originates from the enrolled device's non-extractable private key
- **Replay Prevention**: Single-use nonce consumption with in-memory TTL cache
- **Challenge Freshness**: HMAC-signed challenge tokens with server-enforced 60s TTL
- **Brute-Force Defense**: 5 failed signature verifications → 15-minute lockout
- **Feature Flag Isolation**: `BINDING_V2=false` → zero execution path change
- **Offline Tolerance**: Offline-queued submissions bypass binding check (server flags this)
- **Defensive Degradation**: Binding module unavailability or internal errors never crash the scan path

---

## 5. Phase 5 Handover

Phase 4 completes the **end-to-end chain**: enrollment → challenge → sign → verify → attendance.

Phase 5 (Recovery & Migration) will address:
- [ ] Storage divergence recovery (incomplete binding states)
- [ ] Device re-enrollment workflow improvements
- [ ] Binding migration tooling for existing students
- [ ] Admin dashboard binding status visibility
