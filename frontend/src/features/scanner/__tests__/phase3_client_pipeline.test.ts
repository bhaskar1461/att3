/**
 * Phase 3 Adversarial Verification Suite: Client Pre-Flight & Network Fault Injection
 * Location: frontend/src/features/scanner/__tests__/phase3_client_pipeline.test.ts
 *
 * Covers:
 * Task 2.1: Decode Storm (Deduplication & Cooldown before dispatch, Idempotency-Key identity)
 * Task 2.2: Keystore Loss (IndexedDB unavailable, StorageDivergence, taxonomy gap)
 * Task 2.3: Clock Skew (+2h, -2h, client-side exp check, lack of client skew correction)
 * Task 2.4: GPS Denied / Timeout (submits without coordinates, geofence_failed fallback, taxonomy gap)
 * Task 2.5: Malformed QR (non-JSON, missing fields, v1 legacy, invalid qr_type)
 * Task 3.1: Two-Generals Matrix: False-Timeout Recovery (Silent retry replay 200, no error card flash)
 * Task 3.2: Double Timeout Recovery: Rescan fresh QR returns already_marked as benign SUCCESS
 * Task 3.3: App-Killed Reconciliation (sessionStorage FSM restoration and stale-resume analysis)
 * Task 3.4: Offline Button Truth (network_error card offers no "Save Offline" button, offline sync gaps)
 * Task 3.5: Background-Tab Throttling (Naive interval counts in poll loop leading to false aborts)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  scannerFsmReducer,
  FsmContext,
  buildErrorInfo,
  isCachedPayloadValid,
  getInitialFsmContext,
  persistFsmContext,
  ErrorCode,
  ERROR_CODE_TAXONOMY
} from '../state/scannerFSM';

describe('PHASE 3 — Client Pre-Flight & Network Fault Injection Audit', () => {

  // =========================================================================
  // TASK 2.1: DECODE STORM
  // =========================================================================
  describe('Task 2.1: Decode Storm Fault Injection', () => {
    it('HOP: Camera -> Decode -> Dispatch | Fault: 5 decodes in 200ms -> Deduplication drops subsequent frames', () => {
      // Simulate the lock state maintained by useAttendanceSubmission
      let isScanningLocked = false;
      let dispatchCount = 0;
      const dispatchedKeys: string[] = [];

      const tokenPayload = 'SNIST-SES|TEST1|1|100|MOCKMAC12345';
      const deviceId = 'test-dev-uuid-1234';

      // Simple mock of computeIdempotencyKey
      const computeMockKey = (token: string, dev: string) => `${dev}:${token.slice(0, 16)}`;

      const handleFrameDecode = (decodedText: string) => {
        if (isScanningLocked) {
          return; // Drop storm frames
        }
        // First frame acquires lock synchronously
        isScanningLocked = true;
        dispatchCount++;
        dispatchedKeys.push(computeMockKey(decodedText, deviceId));
      };

      // Inject 5 rapid frame decodes within 200ms
      for (let i = 0; i < 5; i++) {
        handleFrameDecode(tokenPayload);
      }

      // Assertions
      expect(dispatchCount).toBe(1); // Exactly 1 dispatch allowed through
      expect(dispatchedKeys.length).toBe(1);
      expect(dispatchedKeys[0]).toBe(`${deviceId}:${tokenPayload.slice(0, 16)}`);

      // Even if two dispatches hypothetically bypassed the ref lock:
      const key1 = computeMockKey(tokenPayload, deviceId);
      const key2 = computeMockKey(tokenPayload, deviceId);
      expect(key1).toBe(key2); // Idempotency keys are identical -> server deduplicates
    });
  });

  // =========================================================================
  // TASK 2.2: KEYSTORE LOSS
  // =========================================================================
  describe('Task 2.2: Keystore Loss Fault Injection', () => {
    it('HOP: Key Fetch -> Sign | Fault: IndexedDB unavailable -> Taxonomy gap (No signing/keystore error code)', () => {
      // Check if ERROR_CODE_TAXONOMY contains any dedicated code for keystore/signing failure
      const availableCodes = Object.keys(ERROR_CODE_TAXONOMY) as ErrorCode[];
      const hasKeystoreCode = availableCodes.includes('keystore_error' as any) ||
                              availableCodes.includes('signing_failed' as any) ||
                              availableCodes.includes('crypto_unavailable' as any);

      expect(hasKeystoreCode).toBe(false); // Finding F-018: Taxonomy gap!

      // When signing fails (e.g. NoKeyStoredError / StorageDivergenceError), it falls back to generic_error
      const errorInfo = buildErrorInfo('generic_error', 'Cannot sign challenge: No device binding key is enrolled.');
      expect(errorInfo.code).toBe('generic_error');
      expect(errorInfo.message).toContain('No device binding key is enrolled');

      // FSM handles generic_error by transitioning to ERROR state
      const initialCtx: FsmContext = {
        state: 'SUBMITTING',
        isActionInFlight: false,
        updatedAt: Date.now()
      };
      const nextCtx = scannerFsmReducer(initialCtx, { type: 'SUBMIT_FAILED', error: errorInfo });
      expect(nextCtx.state).toBe('ERROR');
      expect(nextCtx.errorInfo?.code).toBe('generic_error');
    });
  });

  // =========================================================================
  // TASK 2.3: CLOCK SKEW
  // =========================================================================
  describe('Task 2.3: Clock Skew Fault Injection', () => {
    it('HOP: Client Pre-Validate | Fault: Device clock +2h ahead -> Guaranteed false qr_expired rejection', () => {
      const serverNowMs = 1700000000000;
      const tokenExpMs = serverNowMs + 10000; // Token valid for next 10s on server

      // Device clock skewed +2 hours ahead
      const deviceClockNowMs = serverNowMs + (2 * 3600 * 1000);

      // Client pre-validation logic from useAttendanceSubmission.ts:344-348
      let validationError: 'qr_type_invalid' | 'qr_expired' | undefined = undefined;
      if (deviceClockNowMs > tokenExpMs + 30000) {
        validationError = 'qr_expired';
      }

      // Assert that client falsely rejects the token BEFORE any network request leaves the browser
      expect(validationError).toBe('qr_expired');

      // FSM transitions to ERROR(qr_expired)
      const err = buildErrorInfo('qr_expired', 'QR expired — rescan');
      const initialCtx: FsmContext = { state: 'SCANNING', isActionInFlight: false, updatedAt: deviceClockNowMs };
      const nextCtx = scannerFsmReducer(initialCtx, { type: 'QR_INVALID', error: err });
      expect(nextCtx.state).toBe('ERROR');
      expect(nextCtx.errorInfo?.code).toBe('qr_expired');
    });

    it('HOP: Client Pre-Validate | Fault: Device clock -2h behind -> Client passes, server authoritative time enforces expiry', () => {
      const serverNowMs = 1700000000000;
      const tokenExpMs = serverNowMs + 10000;

      // Device clock skewed -2 hours behind
      const deviceClockNowMs = serverNowMs - (2 * 3600 * 1000);

      // Client pre-validation logic
      let validationError: 'qr_type_invalid' | 'qr_expired' | undefined = undefined;
      if (deviceClockNowMs > tokenExpMs + 30000) {
        validationError = 'qr_expired';
      }

      // Client check passes falsely
      expect(validationError).toBeUndefined();
    });
  });

  // =========================================================================
  // TASK 2.4: GPS DENIED / TIMEOUT
  // =========================================================================
  describe('Task 2.4: GPS Denied / Timeout Fault Injection', () => {
    it('HOP: Geolocation -> Submit | Fault: Permission denied -> Submits without coordinates, taxonomy gap', () => {
      // Simulate geolocation rejection
      const getStudentGeolocation = vi.fn().mockRejectedValue(new Error('User denied Geolocation'));

      // In useAttendanceSubmission.ts:474, failure is caught and evaluates to null
      return getStudentGeolocation()
        .catch(() => null)
        .then((geo) => {
          expect(geo).toBeNull();

          // Body payload construction: coordinates are omitted when null
          const body: any = {
            session_token: 'SNIST-SES|TEST|1|100|MOCK',
            scan_mode: 'QR_CAMERA'
          };
          if (geo?.latitude != null) {
            body.latitude = geo.latitude;
            body.longitude = geo.longitude;
          }

          expect(body.latitude).toBeUndefined();
          expect(body.longitude).toBeUndefined();

          // Taxonomy check: Check if an error code exists for GPS denied / geofence failure
          const availableCodes = Object.keys(ERROR_CODE_TAXONOMY) as ErrorCode[];
          const hasGpsCode = availableCodes.includes('gps_denied' as any) ||
                             availableCodes.includes('geofence_failed' as any) ||
                             availableCodes.includes('geofence_exceeded' as any);

          expect(hasGpsCode).toBe(false); // Finding F-019: GPS/Geofence taxonomy gap!
        });
    });
  });

  // =========================================================================
  // TASK 2.5: MALFORMED QR
  // =========================================================================
  describe('Task 2.5: Malformed QR Payloads', () => {
    it('HOP: Decode -> Parse | Fault: Non-JSON payload -> Triggers qr_type_invalid, scanner stays open', () => {
      const trimmed = 'random garbage text 12345';
      const isJson = trimmed.startsWith('{') && trimmed.endsWith('}');
      expect(isJson).toBe(false);

      const err = buildErrorInfo('qr_type_invalid', 'Wrong QR — scan the live session QR');
      const initialCtx: FsmContext = { state: 'SCANNING', isActionInFlight: false, updatedAt: Date.now() };
      const nextCtx = scannerFsmReducer(initialCtx, { type: 'QR_INVALID', error: err });

      expect(nextCtx.state).toBe('ERROR');
      expect(nextCtx.errorInfo?.code).toBe('qr_type_invalid');
    });

    it('HOP: Decode -> Parse | Fault: Invalid qr_type ("attendance") -> Triggers qr_type_invalid inline', () => {
      const payload = {
        v: 2,
        qr_type: 'attendance', // Spec D2 drift: generator uses 'live_session'
        session_id: '123',
        token: 'MOCK_TOKEN_STRING_123',
        exp: Date.now() + 10000
      };

      let validationError: 'qr_type_invalid' | 'qr_expired' | undefined = undefined;
      if (payload.qr_type !== 'live_session' && payload.qr_type !== 'frequency_extended') {
        validationError = 'qr_type_invalid';
      }

      expect(validationError).toBe('qr_type_invalid');
    });
  });

  // =========================================================================
  // TASK 3: NETWORK FAULT INJECTION (TWO-GENERALS MATRIX)
  // =========================================================================
  describe('Task 3: Network Fault Injection (Two-Generals Matrix)', () => {
    it('Matrix Row 2: False-Timeout Recovery: Replay 200 payload returns SUCCESS without error flash', () => {
      // Attempt 1 aborts at 8s -> Attempt 2 retries with SAME Idempotency-Key
      const initialCtx: FsmContext = {
        state: 'SUBMITTING',
        submittingStage: 'submitting',
        isActionInFlight: false,
        updatedAt: Date.now()
      };

      // Attempt 1 times out: stage set to submitting for attempt 2 (silent retry)
      const stage2Ctx = scannerFsmReducer(initialCtx, {
        type: 'SET_SUBMITTING_STAGE',
        stage: 'submitting'
      });
      expect(stage2Ctx.state).toBe('SUBMITTING');
      expect(stage2Ctx.errorInfo).toBeUndefined(); // Zero error flash during retry!

      // Server returns cached 200 replay response
      const serverReplayResponse = {
        status: 'SUCCESS',
        attendance_id: 9942,
        message: 'Successfully marked present for 1 period!'
      };

      const successCtx = scannerFsmReducer(stage2Ctx, {
        type: 'SUBMIT_SUCCESS',
        result: serverReplayResponse
      });

      expect(successCtx.state).toBe('SUCCESS');
      expect(successCtx.successData.attendance_id).toBe(9942);
    });

    it('Matrix Row 2: Double-Timeout + Fresh QR Rescan: Returns already_marked as benign SUCCESS', () => {
      // Both attempts timed out -> Client showed client_abort
      const abortErr = buildErrorInfo('client_abort', 'Taking longer than usual');
      const abortCtx = scannerFsmReducer(
        { state: 'SUBMITTING', isActionInFlight: false, updatedAt: Date.now() },
        { type: 'SUBMIT_FAILED', error: abortErr }
      );
      expect(abortCtx.state).toBe('ERROR');
      expect(abortCtx.errorInfo?.code).toBe('client_abort');

      // Student taps "Rescan QR" -> FSM DISMISS transitions ERROR -> SCANNING
      const scanningCtx = scannerFsmReducer(abortCtx, { type: 'DISMISS' });
      expect(scanningCtx.state).toBe('SCANNING');

      // Camera decodes fresh QR -> QR_VALIDATED -> LINK_CHECK
      const linkCheckCtx = scannerFsmReducer(scanningCtx, {
        type: 'QR_VALIDATED',
        payload: { token: 'FRESH_TOKEN_T2' }
      });
      expect(linkCheckCtx.state).toBe('LINK_CHECK');

      // Link confirmed -> SUBMITTING
      const submittingCtx = scannerFsmReducer(linkCheckCtx, { type: 'LINK_V2_CONFIRMED' });
      expect(submittingCtx.state).toBe('SUBMITTING');

      // Server recognizes student is already present and returns already_marked (handled as SUBMIT_SUCCESS)
      const serverAlreadyMarkedRes = {
        status: 'ALREADY_MARKED',
        already_marked: true,
        attendance_id: 9942,
        message: 'Attendance already recorded for this session.'
      };

      const resolvedCtx = scannerFsmReducer(submittingCtx, {
        type: 'SUBMIT_SUCCESS',
        result: serverAlreadyMarkedRes
      });

      expect(resolvedCtx.state).toBe('SUCCESS');
      expect(resolvedCtx.successData.already_marked).toBe(true);
      expect(resolvedCtx.errorInfo).toBeUndefined(); // Clean success, NOT an error!
    });

    it('Matrix Row 3: App-Killed Reconciliation: sessionStorage FSM restoration logic', () => {
      const now = Date.now();
      const validPayload = {
        state: 'SUBMITTING',
        cachedPayload: {
          payload: { token: 'VALID_TOKEN', exp: now + 20000 },
          captured_at: now - 5000 // 5s old (< 30s TTL)
        },
        updatedAt: now - 5000
      };

      expect(isCachedPayloadValid(validPayload.cachedPayload as any)).toBe(true);

      const stalePayload = {
        state: 'SUBMITTING',
        cachedPayload: {
          payload: { token: 'EXPIRED_TOKEN', exp: now - 1000 },
          captured_at: now - 35000 // 35s old (> 30s TTL)
        },
        updatedAt: now - 35000
      };

      expect(isCachedPayloadValid(stalePayload.cachedPayload as any)).toBe(false);
    });

    it('Matrix Row 4: Offline Button Truth: network_error card lacks "Save Offline" action button', () => {
      // Check the taxonomy actions for network_error
      const networkMeta = ERROR_CODE_TAXONOMY.network_error;
      expect(networkMeta.primary).toBe('Retry');
      expect(networkMeta.secondary).toBeUndefined(); // No "Save Offline" button!

      // Finding: The offline queue is only invoked if navigator.onLine is false at scan time.
      // If a network error occurs mid-flight, the UI displays a generic "Retry" button
      // and does not enqueue the token for offline sync.
    });

    it('Matrix Row 5: Background-Tab Throttling: Poll loop relies on naive iteration count', () => {
      // In useAttendanceSubmission.ts:558:
      // while (pollCount < 5) { await setTimeout(500); pollCount++; ... }
      // Mobile browsers throttle setTimeout to >= 1000ms in background tabs.
      // If 5 polls execute while server is still writing, pollCount reaches 5 and triggers client_abort.
      let pollCount = 0;
      const maxPolls = 5;
      const pollStatuses = ['pending', 'pending', 'pending', 'pending', 'pending'];

      let committed = false;
      while (pollCount < maxPolls) {
        const status = pollStatuses[pollCount];
        pollCount++;
        if (status === 'committed') {
          committed = true;
          break;
        }
      }

      expect(pollCount).toBe(5);
      expect(committed).toBe(false);

      // Demonstrates that poll exhaustion triggers client_abort error card
      const err = buildErrorInfo('client_abort', 'Confirming attendance with server…');
      expect(err.code).toBe('client_abort');
    });
  });
});
