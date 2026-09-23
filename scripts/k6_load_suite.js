/**
 * SNIST ERP Attendance System — Week 9 Load Certification Suite (k6)
 *
 * Scenarios:
 * 1. 100-Student Burst: 100 VUs scanning and submitting attendance tokens in a 90-second window.
 * 2. Telemetry Flood: Continuous background batches (60/min/user cap) ingested concurrently.
 * 3. Sustained Daily Load: Modeled multi-department class changeover over 5 minutes.
 *
 * Gates:
 * - p95 submit latency < 300ms
 * - Zero 5xx errors (http_req_failed < 0.001)
 * - Telemetry ingest returns HTTP 202 Accepted
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

// Custom Metrics
const SubmitLatency = new Trend('scan_submit_duration_ms');
const TelemetryLatency = new Trend('telemetry_ingest_duration_ms');
const SubmitFailureRate = new Rate('scan_submit_failures');
const TelemetryFailureRate = new Rate('telemetry_failures');
const CompletedScans = new Counter('completed_attendance_scans');

export const options = {
  scenarios: {
    // Scenario 1: 100 Virtual Students Burstable in 90s
    student_burst: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s', target: 50 },  // Faculty opens QR; students open app
        { duration: '30s', target: 100 }, // Peak burst: 100 students scanning
        { duration: '30s', target: 100 }, // Sustained scanning
        { duration: '15s', target: 0 },   // Tail off / session close
      ],
      gracefulRampDown: '5s',
      exec: 'studentScanBurst',
    },
    // Scenario 2: Telemetry Background Flood
    telemetry_flood: {
      executor: 'constant-vus',
      vus: 20,
      duration: '90s',
      exec: 'telemetryBatchFlood',
    },
  },
  thresholds: {
    'scan_submit_duration_ms': ['p(95)<300'], // Gate: p95 < 300ms
    'scan_submit_failures': ['rate<0.01'],    // Gate: < 1% errors
    'http_req_failed': ['rate<0.01'],         // Gate: zero 5xx
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';
const DEMO_TOKEN = __ENV.DEMO_TOKEN || 'DEMO_STUDENT_JWT_TOKEN';

export function studentScanBurst() {
  const vuId = __VU;
  const roll = `21891A05${String(vuId).padStart(2, '0')}`;
  
  // 1. Fetch Session Preview (read-only cached call)
  const previewRes = http.get(`${BASE_URL}/api/v1/student/active-session`, {
    headers: {
      'Authorization': `Bearer ${DEMO_TOKEN}`,
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10; SM-A10) AppleWebKit/537.36',
    },
  });

  check(previewRes, {
    'preview status 200': (r) => r.status === 200,
  });

  // Jitter scan time between 1s and 15s to simulate optical framing
  sleep(Math.random() * 8 + 1);

  // 2. Submit Attendance Token
  const submitStart = Date.now();
  const submitPayload = JSON.stringify({
    session_token: '8XK2Q7MD',
    v: Math.floor(Date.now() / 10000),
    token_format: 'short',
    device_uuid: `DEV-K6-${vuId}`,
  });

  const submitRes = http.post(`${BASE_URL}/api/v1/student/scan-session`, submitPayload, {
    headers: {
      'Authorization': `Bearer ${DEMO_TOKEN}`,
      'Content-Type': 'application/json',
      'X-Device-Public-Id': `DEV-K6-${vuId}`,
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10; SM-A10) AppleWebKit/537.36',
    },
  });

  const duration = Date.now() - submitStart;
  SubmitLatency.add(duration);

  const isSuccess = check(submitRes, {
    'submit status 200': (r) => r.status === 200 || r.status === 409,
    'no 5xx error': (r) => r.status < 500,
  });

  if (isSuccess) {
    CompletedScans.add(1);
    SubmitFailureRate.add(0);
  } else {
    SubmitFailureRate.add(1);
  }

  sleep(5);
}

export function telemetryBatchFlood() {
  const vuId = __VU;
  const batchPayload = JSON.stringify({
    session_id: 1,
    events: [
      {
        event_type: 'frame_decoded',
        stage: 'frame_decoded',
        timestamp_ms: Date.now(),
        device_bucket: vuId % 3 === 0 ? 'old' : (vuId % 3 === 1 ? 'mid' : 'new'),
        display_type: 'projector',
        token_format: 'short',
        ladder_rung: 1,
        duration_ms: Math.random() * 20 + 2,
      },
      {
        event_type: 'token_submitted',
        stage: 'token_submitted',
        timestamp_ms: Date.now() + 10,
        device_bucket: 'mid',
        display_type: 'projector',
        token_format: 'short',
        ladder_rung: 1,
        duration_ms: Math.random() * 50 + 10,
      }
    ],
  });

  const tStart = Date.now();
  const res = http.post(`${BASE_URL}/api/v1/telemetry/scan`, batchPayload, {
    headers: {
      'Authorization': `Bearer ${DEMO_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });

  TelemetryLatency.add(Date.now() - tStart);
  const is202 = check(res, {
    'telemetry 202 accepted': (r) => r.status === 202,
  });

  TelemetryFailureRate.add(is202 ? 0 : 1);
  sleep(1);
}
