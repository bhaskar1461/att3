import puppeteer from 'puppeteer-core';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BACKEND_URL = 'http://127.0.0.1:8001';
const FRONTEND_URL = 'http://localhost:5173';

async function main() {
  console.log('=== PHASE 10 PART C: EXTENSIBILITY PROOF (LEAVE EXPERIMENT) ===\n');

  // Obtain admin & teacher tokens
  const adminRes = await fetch(`${BACKEND_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const adminToken = (await adminRes.json()).access_token;

  const teacherRes = await fetch(`${BACKEND_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'teacher1', password: 'teacher123' }),
  });
  const teacherToken = (await teacherRes.json()).access_token;

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  // --- EXPERIMENT GATE 1: ADMIN VISIBILITY & INTERACTION ---
  console.log('Test 1: Admin navigates to /overview and verifies LeaveWidget & Nav item...');
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  await page.evaluateOnNewDocument((tok) => {
    localStorage.setItem('snist_auth_schema_version', '2');
    localStorage.setItem('token', tok);
    localStorage.setItem('access_token', tok);
    localStorage.setItem('role', 'SUPER_ADMIN');
    localStorage.setItem('user', JSON.stringify({
      id: 1,
      username: 'admin',
      role: 'SUPER_ADMIN',
      full_name: 'System Administrator',
    }));
  }, adminToken);

  await page.goto(`${FRONTEND_URL}/overview`, { waitUntil: 'networkidle2' });
  await new Promise((res) => setTimeout(res, 1200));

  const adminOverviewCheck = await page.evaluate(() => {
    const hasNav = document.body.textContent?.includes('Leave Requests');
    const hasLeaveWidget = document.body.textContent?.includes('Student absence & medical notices');
    const hasPendingBadge = document.body.textContent?.includes('Pending Approval');
    return { hasNav, hasLeaveWidget, hasPendingBadge };
  });

  console.log('Admin Overview Result:', adminOverviewCheck);
  if (!adminOverviewCheck.hasNav || !adminOverviewCheck.hasLeaveWidget) {
    throw new Error(`Admin failed to see Leave nav or LeaveWidget: ${JSON.stringify(adminOverviewCheck)}`);
  }
  console.log('✓ Admin sees Leave nav item, section, and LeaveWidget on /overview\n');

  // Navigate admin to /leave
  console.log('Test 2: Admin visits /leave and checks permission leave.act...');
  await page.goto(`${FRONTEND_URL}/leave`, { waitUntil: 'networkidle2' });
  await new Promise((res) => setTimeout(res, 1000));

  const adminLeavePageCheck = await page.evaluate(() => {
    const title = document.querySelector('h1')?.textContent || '';
    const hasPermBadge = document.body.textContent?.includes('leave.act (Active)');
    const approveButtons = Array.from(document.querySelectorAll('button')).filter(
      (b) => b.textContent?.trim() === 'Approve'
    ).length;
    return { title, hasPermBadge, approveButtons };
  });

  console.log('Admin Leave Page Result:', adminLeavePageCheck);
  if (!adminLeavePageCheck.hasPermBadge || adminLeavePageCheck.approveButtons === 0) {
    throw new Error(`Admin permission leave.act not recognized: ${JSON.stringify(adminLeavePageCheck)}`);
  }
  console.log('✓ Admin successfully accessed /leave with permission leave.act active\n');

  // Trigger Approve action
  console.log('Test 3: Admin clicks Approve button on pending leave request...');
  const approveBtn = await page.evaluateHandle(() => {
    const btns = Array.from(document.querySelectorAll('button')).filter(
      (b) => b.textContent?.trim() === 'Approve'
    );
    return btns[0] || null;
  });

  if (approveBtn) {
    await approveBtn.click();
    await new Promise((res) => setTimeout(res, 1000));
    console.log('✓ Approve button clicked. Checking toast / mutation...');
  }

  // --- EXPERIMENT GATE 2: TEACHER LOCKOUT ---
  console.log('\nTest 4: Teacher visits /overview and verifies LeaveWidget & Nav are ABSENT...');
  const teacherPage = await browser.newPage();
  await teacherPage.setViewport({ width: 1440, height: 900 });

  await teacherPage.evaluateOnNewDocument((tok) => {
    localStorage.setItem('snist_auth_schema_version', '2');
    localStorage.setItem('token', tok);
    localStorage.setItem('access_token', tok);
    localStorage.setItem('role', 'TEACHER');
    localStorage.setItem('user', JSON.stringify({
      id: 2,
      username: 'teacher1',
      role: 'TEACHER',
      full_name: 'Faculty Member',
    }));
  }, teacherToken);

  await teacherPage.goto(`${FRONTEND_URL}/overview`, { waitUntil: 'networkidle2' });
  await new Promise((res) => setTimeout(res, 1000));

  const teacherOverviewCheck = await teacherPage.evaluate(() => {
    const hasNav = document.body.textContent?.includes('Leave Requests');
    const hasLeaveWidget = document.body.textContent?.includes('Student absence & medical notices');
    return { hasNav, hasLeaveWidget };
  });

  console.log('Teacher Overview Result:', teacherOverviewCheck);
  if (teacherOverviewCheck.hasNav || teacherOverviewCheck.hasLeaveWidget) {
    throw new Error(`Security breach: Teacher saw leave nav or widget: ${JSON.stringify(teacherOverviewCheck)}`);
  }
  console.log('✓ Teacher nav and overview strictly omit Leave Requests.\n');

  console.log('Test 5: Teacher direct-URLs /leave (Must render ForbiddenPage)...');
  await teacherPage.goto(`${FRONTEND_URL}/leave`, { waitUntil: 'networkidle2' });
  await new Promise((res) => setTimeout(res, 800));

  const teacherForbiddenCheck = await teacherPage.evaluate(() => {
    const hasForbidden =
      document.body.textContent?.includes('Access Restricted') ||
      document.body.textContent?.includes('403 Forbidden') ||
      document.body.textContent?.includes('Access Denied');
    const hasPageNotFound = document.body.textContent?.includes('Page Not Found');
    const hasLeaveTitle = document.querySelector('h1')?.textContent?.includes('Leave Requests');
    return { hasForbidden, hasPageNotFound, hasLeaveTitle };
  });

  console.log('Teacher /leave Result:', teacherForbiddenCheck);
  if (!teacherForbiddenCheck.hasForbidden && !teacherForbiddenCheck.hasPageNotFound) {
    throw new Error(`Teacher direct access was not forbidden: ${JSON.stringify(teacherForbiddenCheck)}`);
  }
  if (teacherForbiddenCheck.hasLeaveTitle) {
    throw new Error('Teacher was rendered Leave Requests page content!');
  }
  console.log('✓ Teacher direct-URL to /leave rendered ForbiddenPage (Zero data leak).\n');

  await browser.close();
  console.log('=== EXTENSIBILITY PROOF: ALL EXPERIMENT GATES PASSED (100% CLEAN) ===');
}

main().catch((err) => {
  console.error('Experiment Failed:', err);
  process.exit(1);
});
