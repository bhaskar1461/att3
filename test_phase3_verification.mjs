// test_phase3_verification.mjs
// Comprehensive automated test suite for Phase 3: Typed Data Layer

import fs from 'fs';
import path from 'path';
import http from 'http';

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    passCount++;
    console.log(`  ✓ ${message}`);
  } else {
    failCount++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

const SRC = 'frontend/src';

console.log('====================================================');
console.log('   PHASE 3 VERIFICATION SUITE — TYPED DATA LAYER    ');
console.log('====================================================\n');

// 1. PART A: FILE TREE VERIFICATION
console.log('TEST GROUP 1: Part A File Tree Structure');
const expectedFiles = [
  'core/api/schemas/auth.ts',
  'core/api/schemas/roster.ts',
  'core/api/schemas/attendance.ts',
  'core/api/schemas/sessions.ts',
  'core/api/schemas/reports.ts',
  'core/api/schemas/devices.ts',
  'core/api/schemas/onboarding.ts',
  'core/api/schemas/security.ts',
  'core/api/schemas/sync.ts',
  'core/api/schemas/aggregates.ts',
  'core/api/schemas/index.ts',
  'core/api/endpoints/auth.ts',
  'core/api/endpoints/roster.ts',
  'core/api/endpoints/attendance.ts',
  'core/api/endpoints/sessions.ts',
  'core/api/endpoints/reports.ts',
  'core/api/endpoints/devices.ts',
  'core/api/endpoints/onboarding.ts',
  'core/api/endpoints/security.ts',
  'core/api/endpoints/sync.ts',
  'core/api/endpoints/aggregates.ts',
  'core/api/keys.ts',
  'core/api/invalidation.ts',
  'core/auth/AuthProvider.tsx',
  'features/auth/manifest.ts',
  'features/auth/LoginPage.tsx',
  'features/auth/hooks.ts',
  'features/overview/hooks.ts',
  'features/roster/hooks.ts',
  'features/reports/hooks.ts',
  'features/devices/hooks.ts',
  'features/onboarding/hooks.ts',
  'features/sessions/hooks.ts',
  'features/security/hooks.ts',
  'features/sync/hooks.ts',
  'features/student-qr/hooks.ts',
  'features/compliance/hooks.ts',
  'features/credentials/hooks.ts',
  'features/excel-grid/hooks.ts',
  'features/departments/hooks.ts',
  'features/faculty/hooks.ts',
  'features/classes/hooks.ts',
  'features/telemetry/hooks.ts',
  'features/audit/hooks.ts',
  'services/mock/handlers.ts',
  'services/mock/generators.ts',
  'services/mock/README.md',
  'dev/ContractsPage.tsx',
  'components/dashboard/MockBanner.tsx',
];

for (const rel of expectedFiles) {
  const fullPath = path.join(SRC, rel);
  assert(fs.existsSync(fullPath), `File exists: ${rel}`);
}

// 2. ARCHITECTURAL CONSTRAINTS
console.log('\nTEST GROUP 2: Architectural Boundary Constraints');

// Rule: No React in src/core/api/**
function scanForReactInApi(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanForReactInApi(full);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      const content = fs.readFileSync(full, 'utf8');
      assert(!content.includes('from \'react\'') && !content.includes('from "react"'), `No React in ${full}`);
    }
  }
}
scanForReactInApi(path.join(SRC, 'core/api'));

// Rule: No fetch/transport in src/features/** (hooks + selectors only)
function scanForDirectFetchInFeatures(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanForDirectFetchInFeatures(full);
    } else if (entry.isFile() && entry.name === 'hooks.ts') {
      const content = fs.readFileSync(full, 'utf8');
      assert(!content.includes('fetch('), `No direct fetch() in feature hook: ${full}`);
    }
  }
}
scanForDirectFetchInFeatures(path.join(SRC, 'features'));

// Rule: grep -r "TODO-REAL" src returns ONLY aggregates.ts and mock/**
console.log('\nTEST GROUP 3: TODO-REAL Scope Enforcement');
function findTodoRealFiles(dir, fileList = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findTodoRealFiles(full, fileList);
    } else if (entry.isFile()) {
      const content = fs.readFileSync(full, 'utf8');
      if (content.includes('TODO-REAL')) {
        fileList.push(full.replace(/\\/g, '/'));
      }
    }
  }
  return fileList;
}

const todoRealFiles = findTodoRealFiles(SRC);
console.log(`Found ${todoRealFiles.length} files containing TODO-REAL`);
for (const f of todoRealFiles) {
  const isAllowed =
    f.includes('core/api/schemas/aggregates.ts') ||
    f.includes('core/api/endpoints/aggregates.ts') ||
    f.includes('services/mock/');
  assert(isAllowed, `TODO-REAL permitted in: ${f}`);
}

// 4. PARITY LEDGER VERIFICATION
console.log('\nTEST GROUP 4: FEATURES.md Parity & Data Layer Column');
const featuresContent = fs.readFileSync('FEATURES.md', 'utf8');
assert(featuresContent.includes('Data Layer'), 'FEATURES.md has Data Layer column header');
const rows = featuresContent.split('\n').filter((l) => l.startsWith('| **'));
assert(rows.length >= 18, `FEATURES.md has ${rows.length} tracked feature rows`);
const readyCount = (featuresContent.match(/READY/g) || []).length;
assert(readyCount >= 18, `FEATURES.md has ${readyCount} READY Data Layer indicators`);

// 5. LIVE API CONTRACTS PARITY
console.log('\nTEST GROUP 5: Live API Parity Execution');
async function testLiveApi() {
  const BASE = 'http://127.0.0.1:8001';

  async function login(username, password, extra = {}) {
    const reqData = JSON.stringify({ username, password, ...extra });
    return new Promise((resolve, reject) => {
      const req = http.request(`${BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(reqData),
          ...(extra.device_public_id ? { 'x-device-id': extra.device_public_id } : {}),
        },
      }, (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          if (res.statusCode === 200) resolve(JSON.parse(d).access_token);
          else reject(new Error(`Login failed for ${username}: ${res.statusCode}`));
        });
      });
      req.on('error', reject);
      req.write(reqData);
      req.end();
    });
  }

  async function get(path, token, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
      http.get(`${BASE}${path}`, {
        headers: { Authorization: `Bearer ${token}`, ...extraHeaders },
      }, (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(d) });
          } catch {
            resolve({ status: res.statusCode, raw: d });
          }
        });
      }).on('error', reject);
    });
  }

  try {
    const adminToken = await login('admin', 'admin123');
    const teacherToken = await login('demoteacher', 'demoteacher@2026');
    const studentToken = await login('23311A0525', 'demostudent@2026', {
      device_public_id: 'suite-test-student',
      device_secret: 'suite-test-secret',
    });

    const checks = [
      { name: 'Admin Me', path: '/api/v1/auth/me', token: adminToken },
      { name: 'Admin Dashboard Stats', path: '/api/v1/admin/dashboard-stats', token: adminToken },
      { name: 'Admin Audit Logs', path: '/api/v1/admin/audit-logs?limit=5', token: adminToken },
      { name: 'Admin Students', path: '/api/v1/admin/students?page=1&page_size=2', token: adminToken },
      { name: 'Admin Teachers', path: '/api/v1/admin/teachers', token: adminToken },
      { name: 'Admin Departments', path: '/api/v1/admin/departments', token: adminToken },
      { name: 'Admin Sections', path: '/api/v1/admin/sections', token: adminToken },
      { name: 'Admin Subjects', path: '/api/v1/admin/subjects', token: adminToken },
      { name: 'Admin Years', path: '/api/v1/admin/years', token: adminToken },
      { name: 'Admin Onboard Status', path: '/api/v1/admin/onboard/status?page=1&page_size=2', token: adminToken },
      { name: 'Telemetry Scanner Health', path: '/api/v1/telemetry/scanner-health?timeframe_days=7', token: adminToken },
      { name: 'Telemetry Summary', path: '/api/v1/telemetry/summary', token: adminToken },
      { name: 'Reports Low Attendance', path: '/api/v1/reports/low-attendance', token: adminToken },
      { name: 'Teacher Assigned Classes', path: '/api/v1/teacher/assigned-classes', token: teacherToken },
      { name: 'Teacher Historical Sessions', path: '/api/v1/teacher/historical-sessions', token: teacherToken },
      { name: 'Student Profile', path: '/api/v1/student/profile', token: studentToken, extraHeaders: { 'x-device-id': 'suite-test-student' } },
      { name: 'Student Attendance Summary', path: '/api/v1/student/attendance-summary', token: studentToken, extraHeaders: { 'x-device-id': 'suite-test-student' } },
    ];

    for (const c of checks) {
      const res = await get(c.path, c.token, c.extraHeaders);
      assert(res.status === 200, `Live 200 OK: ${c.name} (${c.path})`);
    }
  } catch (err) {
    failCount++;
    console.error('Live API parity test failure:', err.message);
  }
}

testLiveApi().then(() => {
  console.log('\n====================================================');
  console.log(`TOTAL CHECKS: ${passCount + failCount}`);
  console.log(`PASSED: ${passCount}`);
  console.log(`FAILED: ${failCount}`);
  console.log('====================================================');

  if (failCount > 0) {
    process.exit(1);
  } else {
    console.log('\n🎉 ALL PHASE 3 VERIFICATION CHECKS PASSED WITH 100% SUCCESS!');
  }
});
