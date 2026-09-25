// test_phase3_contracts.mjs
// Automated verification script for /dev/contracts RUN ALL parity gate

import http from 'http';

const BASE = 'http://127.0.0.1:8001';

async function loginAdmin() {
  const reqData = JSON.stringify({ username: 'admin', password: 'admin123' });
  return new Promise((resolve, reject) => {
    const req = http.request(`${BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(reqData),
      },
    }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(d).access_token);
        } else {
          reject(new Error(`Login failed: ${res.statusCode} ${d}`));
        }
      });
    });
    req.on('error', reject);
    req.write(reqData);
    req.end();
  });
}

async function loginTeacher() {
  const reqData = JSON.stringify({ username: 'demoteacher', password: 'demoteacher@2026' });
  return new Promise((resolve, reject) => {
    const req = http.request(`${BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(reqData),
      },
    }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(d).access_token);
        } else {
          reject(new Error(`Teacher login failed: ${res.statusCode} ${d}`));
        }
      });
    });
    req.on('error', reject);
    req.write(reqData);
    req.end();
  });
}

async function loginStudent() {
  const reqData = JSON.stringify({
    username: '23311A0525',
    password: 'demostudent@2026',
    device_public_id: 'contract-test-student',
    device_secret: 'contract-test-secret',
  });
  return new Promise((resolve, reject) => {
    const req = http.request(`${BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(reqData),
        'x-device-id': 'contract-test-student',
      },
    }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(d).access_token);
        } else {
          reject(new Error(`Student login failed: ${res.statusCode} ${d}`));
        }
      });
    });
    req.on('error', reject);
    req.write(reqData);
    req.end();
  });
}

async function callEndpoint(path, token, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    http.get(`${BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...extraHeaders,
      },
    }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try {
          const json = JSON.parse(d);
          resolve({ status: res.statusCode, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, raw: d });
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('--- Phase 3 Contracts Parity Verification ---');
  
  const adminToken = await loginAdmin();
  console.log('✓ Admin authenticated');

  const teacherToken = await loginTeacher();
  console.log('✓ Teacher authenticated');

  const studentToken = await loginStudent();
  console.log('✓ Student authenticated');

  const realEndpoints = [
    { name: 'Auth Current User', path: '/api/v1/auth/me', token: adminToken, role: 'ADMIN' },
    { name: 'Admin Dashboard Stats', path: '/api/v1/admin/dashboard-stats', token: adminToken, role: 'ADMIN' },
    { name: 'Admin Audit Logs', path: '/api/v1/admin/audit-logs?limit=5', token: adminToken, role: 'ADMIN' },
    { name: 'Admin Students Directory', path: '/api/v1/admin/students?page=1&page_size=3', token: adminToken, role: 'ADMIN' },
    { name: 'Admin Faculty Roster', path: '/api/v1/admin/teachers', token: adminToken, role: 'ADMIN' },
    { name: 'Admin Departments', path: '/api/v1/admin/departments', token: adminToken, role: 'ADMIN' },
    { name: 'Admin Sections', path: '/api/v1/admin/sections', token: adminToken, role: 'ADMIN' },
    { name: 'Admin Subjects', path: '/api/v1/admin/subjects', token: adminToken, role: 'ADMIN' },
    { name: 'Admin Academic Years', path: '/api/v1/admin/years', token: adminToken, role: 'ADMIN' },
    { name: 'Admin Onboarding Status', path: '/api/v1/admin/onboard/status?page=1&page_size=3', token: adminToken, role: 'ADMIN' },
    { name: 'Admin Rebind Requests', path: '/api/v1/admin/onboard/rebind-requests', token: adminToken, role: 'ADMIN' },
    { name: 'Telemetry Scanner Health', path: '/api/v1/telemetry/scanner-health?timeframe_days=7', token: adminToken, role: 'ADMIN' },
    { name: 'Telemetry Summary', path: '/api/v1/telemetry/summary', token: adminToken, role: 'ADMIN' },
    { name: 'Reports Low Attendance', path: '/api/v1/reports/low-attendance', token: adminToken, role: 'ADMIN' },
    { name: 'Reports Class Sheet Matrix', path: '/api/v1/reports/class-sheet-matrix?section_id=35', token: teacherToken, role: 'TEACHER' },
    { name: 'Devices Student Info', path: '/api/v1/devices/student-device-info?roll_number=23311A0504', token: adminToken, role: 'ADMIN' },
    { name: 'Student Binding Status', path: '/api/v1/binding/status', token: studentToken, role: 'STUDENT', extraHeaders: { 'x-device-id': 'contract-test-student' } },
    { name: 'Teacher Assigned Classes', path: '/api/v1/teacher/assigned-classes', token: teacherToken, role: 'TEACHER' },
    { name: 'Teacher Historical Sessions', path: '/api/v1/teacher/historical-sessions', token: teacherToken, role: 'TEACHER' },
    { name: 'Student Profile', path: '/api/v1/student/profile', token: studentToken, role: 'STUDENT', extraHeaders: { 'x-device-id': 'contract-test-student' } },
    { name: 'Student Attendance Summary', path: '/api/v1/student/attendance-summary', token: studentToken, role: 'STUDENT', extraHeaders: { 'x-device-id': 'contract-test-student' } },
  ];

  let passCount = 0;
  let failCount = 0;

  for (const ep of realEndpoints) {
    const res = await callEndpoint(ep.path, ep.token, ep.extraHeaders);
    const pass = res.status === 200 && res.data;
    if (pass) {
      passCount++;
      const keys = Array.isArray(res.data)
        ? `Array(${res.data.length})`
        : Object.keys(res.data).slice(0, 6).join(', ');
      console.log(`[PASS] (200) ${ep.name.padEnd(28)} -> ${keys}`);
    } else {
      failCount++;
      console.error(`[FAIL] (${res.status}) ${ep.name.padEnd(28)} -> ${JSON.stringify(res)}`);
    }
  }

  console.log('\n--- Parity Summary ---');
  console.log(`Total Endpoints Tested: ${realEndpoints.length}`);
  console.log(`PASS: ${passCount}`);
  console.log(`FAIL: ${failCount}`);
  console.log(`Parity Rate: ${Math.round((passCount / realEndpoints.length) * 100)}%`);

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
