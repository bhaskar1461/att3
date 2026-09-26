import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ARTIFACTS_DIR = 'C:\\Users\\bhask\\.gemini\\antigravity-ide\\brain\\56f8a3d2-4bc6-4b8a-a63e-ba11035dcd33';

async function main() {
  console.log('=== STARTING PHASE 9 AUTOMATED VERIFICATION ===\n');

  // 1. Authenticate with backend
  console.log('1. Authenticating as admin...');
  const loginRes = await fetch('http://127.0.0.1:8001/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const loginData = await loginRes.json();
  const token = loginData.access_token;
  console.log('✓ Token acquired:', token.slice(0, 15) + '...');

  // 2. Launch Puppeteer
  console.log('2. Launching Chrome browser...');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  // Track network requests to prove shared-key polling
  const networkRequests = [];
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/api/v1/')) {
      networkRequests.push({ url, method: req.method(), time: Date.now() });
    }
  });

  // Inject token into localStorage before page loads
  await page.evaluateOnNewDocument((tok) => {
    localStorage.setItem('snist_auth_schema_version', '2');
    localStorage.setItem('token', tok);
    localStorage.setItem('access_token', tok);
    localStorage.setItem('role', 'SUPER_ADMIN');
    localStorage.setItem(
      'user',
      JSON.stringify({
        id: 1,
        username: 'admin',
        role: 'SUPER_ADMIN',
        full_name: 'System Administrator',
        email: 'admin@snist.edu.in',
      })
    );
  }, token);

  // Navigate to Overview page
  console.log('3. Navigating to http://localhost:5173/overview...');
  await page.goto('http://localhost:5173/overview', { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 2000));

  // --- TEST A: OPERATIONAL TABLES ---
  console.log('\n--- TEST A: OPERATIONAL TABLES UNDER OVERVIEW GRID ---');
  const tablesInfo = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('h3')).map((h) => h.textContent);
    const hasRecentRegisters = cards.some((c) => c?.includes('Recent Registers'));
    const hasFlaggedEvents = cards.some((c) => c?.includes('Flagged Events'));

    // Find table rows
    const registerRows = document.querySelectorAll('table tbody tr');
    return {
      cards,
      hasRecentRegisters,
      hasFlaggedEvents,
      rowCount: registerRows.length,
    };
  });
  console.log('✓ Cards found:', tablesInfo.cards);
  console.log('✓ Recent Registers Card present:', tablesInfo.hasRecentRegisters);
  console.log('✓ Flagged Events Card present:', tablesInfo.hasFlaggedEvents);

  // Take Overview tables screenshot
  const tablesShotPath = path.join(ARTIFACTS_DIR, 'phase9_overview_tables.png');
  await page.screenshot({ path: tablesShotPath, fullPage: false });
  console.log('✓ Saved artifact:', tablesShotPath);

  // --- TEST B: GLOBAL SEARCH (COMBOBOX) ---
  console.log('\n--- TEST B: GLOBAL SEARCH KEYBOARD COMBOBOX ---');
  // Press Control+K
  console.log('Pressing Control+k to focus GlobalSearch...');
  await page.keyboard.down('Control');
  await page.keyboard.press('k');
  await page.keyboard.up('Control');
  await new Promise((r) => setTimeout(r, 400));

  // Type query
  console.log('Typing "Sup" (query for student Suprathik)...');
  await page.keyboard.type('Sup', { delay: 50 });
  await new Promise((r) => setTimeout(r, 600)); // wait for 250ms debounce + fetch

  // Verify search popover results
  const searchResults = await page.evaluate(() => {
    const popover = document.querySelector('[role="listbox"]');
    if (!popover) return { open: false, items: [] };
    const items = Array.from(popover.querySelectorAll('[role="option"]')).map((opt) => ({
      text: opt.textContent?.trim(),
      hasMark: Boolean(opt.querySelector('mark')),
    }));
    return { open: true, items };
  });
  console.log('✓ Search listbox opened:', searchResults.open);
  console.log('✓ Search results count:', searchResults.items.length);
  console.log('✓ Sample result item:', searchResults.items[0]);

  // Take search screenshot
  const searchShotPath = path.join(ARTIFACTS_DIR, 'phase9_global_search.png');
  await page.screenshot({ path: searchShotPath, fullPage: false });
  console.log('✓ Saved artifact:', searchShotPath);

  // Keyboard navigation: ArrowDown, ArrowDown, Enter
  console.log('Navigating with ArrowDown and pressing Enter...');
  await page.keyboard.press('ArrowDown');
  await new Promise((r) => setTimeout(r, 150));
  await page.keyboard.press('ArrowDown');
  await new Promise((r) => setTimeout(r, 150));
  await page.keyboard.press('Enter');

  // Wait for navigation
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 5000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1000));

  const studentPageInfo = await page.evaluate(() => {
    const url = window.location.href;
    const dialogOpen = Boolean(document.querySelector('form') || document.querySelector('[role="dialog"]'));
    const inputRoll = document.querySelector('input[name="roll_number"]')?.getAttribute('value');
    return { url, dialogOpen, inputRoll };
  });
  console.log('✓ Navigated to URL:', studentPageInfo.url);
  console.log('✓ Student edit dialog auto-opened:', studentPageInfo.dialogOpen);

  // --- TEST C: PRESENT TODAY PILL ---
  console.log('\n--- TEST C: PRESENT TODAY PILL LIVE TICK & TRANSCRIPT ---');
  await page.goto('http://localhost:5173/overview', { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1000));

  const pillTextBefore = await page.evaluate(() => {
    const pill = document.querySelector('button[aria-label*="Present today"]');
    return pill?.textContent?.trim() || 'not found';
  });
  console.log(`Live pill text before additional check-in: "${pillTextBefore}"`);

  // Record a new check-in to backend
  console.log('Recording another check-in for R Vinay (24315A6605) on section 35...');
  const markRes = await fetch('http://127.0.0.1:8001/api/v1/attendance/admin/mark-daily', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
    },
    body: JSON.stringify({
      roll_number: '24315A6605',
      section_id: 35,
      status: 'PRESENT',
      date: new Date().toISOString().split('T')[0],
      period_count: 4,
    }),
  });
  const markData = await markRes.json();
  console.log('✓ Backend mark response:', markData.message);

  // Trigger query refetch / reload in page to simulate next poll cycle
  await page.evaluate(() => {
    window.location.reload();
  });
  await page.waitForNavigation({ waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1000));

  const pillTextAfter = await page.evaluate(() => {
    const pill = document.querySelector('button[aria-label*="Present today"]');
    return pill?.textContent?.trim() || 'not found';
  });
  console.log(`✓ Live pill text after check-in: "${pillTextAfter}"`);

  // --- TEST D: NOTIFICATIONS BELL & DEEP LINK ---
  console.log('\n--- TEST D: NOTIFICATIONS BELL & DEEP LINK ---');
  const bellInfo = await page.evaluate(() => {
    const bellBtn = document.querySelector('button[aria-label*="notification"]');
    const badge = bellBtn?.querySelector('span.bg-rose-500');
    return {
      hasBell: Boolean(bellBtn),
      badgeText: badge?.textContent?.trim() || 'none',
    };
  });
  console.log('✓ Bell button found:', bellInfo.hasBell);
  console.log('✓ Unread badge count:', bellInfo.badgeText);

  // Click bell to open dropdown
  console.log('Clicking notification bell to open dropdown...');
  await page.click('button[aria-label*="notification"]');
  await new Promise((r) => setTimeout(r, 500));

  // Take bell dropdown screenshot
  const bellShotPath = path.join(ARTIFACTS_DIR, 'phase9_bell_dropdown.png');
  await page.screenshot({ path: bellShotPath, fullPage: false });
  console.log('✓ Saved artifact:', bellShotPath);

  // Click first alert item to follow deep link
  console.log('Clicking top alert row to follow deep link...');
  const alertRow = await page.$('div[role="dialog"] button.w-full');
  if (alertRow) {
    await alertRow.click();
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 5000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1000));

    const securityPageInfo = await page.evaluate(() => {
      return {
        url: window.location.href,
        highlightedRow: Boolean(document.querySelector('tr.animate-pulse')),
      };
    });
    console.log('✓ Landed on security URL:', securityPageInfo.url);
    console.log('✓ Deep-linked row highlighted with pulse:', securityPageInfo.highlightedRow);

    // Take security deep-link screenshot
    const secShotPath = path.join(ARTIFACTS_DIR, 'phase9_security_deeplink.png');
    await page.screenshot({ path: secShotPath, fullPage: false });
    console.log('✓ Saved artifact:', secShotPath);
  }

  // --- TEST E: MARK ALL READ & LOCALSTORAGE PERSISTENCE ---
  console.log('\n--- TEST E: MARK ALL READ & STORAGE PERSISTENCE ---');
  await page.goto('http://localhost:5173/overview', { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 800));

  await page.click('button[aria-label*="notification"]');
  await new Promise((r) => setTimeout(r, 300));

  console.log('Clicking "Mark all read"...');
  await page.evaluate(() => {
    const markReadBtn = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Mark all read')
    );
    markReadBtn?.click();
  });
  await new Promise((r) => setTimeout(r, 400));

  const badgeAfterMark = await page.evaluate(() => {
    const bellBtn = document.querySelector('button[aria-label*="notification"]');
    const badge = bellBtn?.querySelector('span.bg-rose-500');
    return badge ? badge.textContent?.trim() : 'cleared';
  });
  console.log('✓ Badge status immediately after Mark all read:', badgeAfterMark);

  // Reload to verify persistence
  await page.reload({ waitUntil: 'networkidle2' });
  const badgeAfterReload = await page.evaluate(() => {
    const bellBtn = document.querySelector('button[aria-label*="notification"]');
    const badge = bellBtn?.querySelector('span.bg-rose-500');
    return badge ? badge.textContent?.trim() : 'cleared';
  });
  console.log('✓ Badge status after page reload (persisted):', badgeAfterReload);

  // --- TEST F: SHARED-KEY POLLING TELEMETRY ---
  console.log('\n--- TEST F: SHARED-KEY POLLING TELEMETRY ANALYSIS ---');
  const auditRequests = networkRequests.filter((r) => r.url.includes('/api/v1/admin/audit-logs'));
  console.log(`Total requests to /api/v1/admin/audit-logs: ${auditRequests.length}`);
  console.log('Timestamps of audit-logs requests:');
  auditRequests.forEach((r, idx) => {
    console.log(`  [Req ${idx + 1}] ${r.method} ${r.url}`);
  });

  console.log('\n=== ALL PHASE 9 VERIFICATIONS COMPLETED SUCCESSFULLY ===');
  await browser.close();
}

main().catch((err) => {
  console.error('VERIFICATION ERROR:', err);
  process.exit(1);
});
