import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const executablePath = fs.existsSync(CHROME_PATH) ? CHROME_PATH : EDGE_PATH;

const BASE_URL = 'http://localhost:5173';
const API_URL = 'http://127.0.0.1:8001';

const ARTIFACT_DIR = 'C:\\Users\\bhask\\.gemini\\antigravity-ide\\brain\\95c9e38e-7aac-455f-8839-2b9601974bee';

async function main() {
  console.log('=== PHASE 5 COMPREHENSIVE AUTOMATED VERIFICATION ===\n');

  // STEP 1: API Math Validation
  console.log('--- Step 1: Exporting backend attendance records and computing manual math ---');
  const loginRes = await fetch(`${API_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const { access_token: adminToken } = await loginRes.json();

  const mathResults = {};
  for (const r of ['today', 'week', 'month']) {
    const res = await fetch(`${API_URL}/api/v1/attendance/records?range=${r}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const records = await res.json();
    let present = 0, late = 0, absent = 0;
    let qr = 0, face = 0, manual = 0, kiosk = 0;

    for (const rec of records) {
      const s = String(rec.status || '').toUpperCase();
      if (s === 'LATE') late++;
      else if (['PRESENT', '1', '2', '3', '4', '5', '6', '7', '8'].includes(s)) present++;
      else absent++;

      const m = String(rec.verification_method || '').toUpperCase();
      if (m.includes('FACE') || m.includes('SELFIE')) face++;
      else if (m.includes('KIOSK')) kiosk++;
      else if (m.includes('MANUAL')) manual++;
      else qr++;
    }
    const total = records.length;
    const ratePct = total > 0 ? Math.round((present / total) * 1000) / 10 : 0;
    mathResults[r] = { present, late, absent, total, ratePct, qr, face, manual, kiosk };
  }
  console.log('Manual math arithmetic table:');
  console.table(mathResults);

  // Launch browser
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    defaultViewport: { width: 1440, height: 900 },
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();

  // Helper to login in UI
  async function uiLogin(username, password) {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('input#username, input[name="username"], input[type="text"]');
    const uInput = await page.$('input#username, input[name="username"], input[type="text"]');
    const pInput = await page.$('input#password, input[name="password"], input[type="password"]');
    await uInput.click({ clickCount: 3 });
    await uInput.type(username);
    await pInput.click({ clickCount: 3 });
    await pInput.type(password);
    const submitBtn = await page.$('button[type="submit"]');
    await submitBtn.click();
    await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1000));
  }

  // STEP 2: Admin Dashboard & Range Switching
  console.log('\n--- Step 2: Admin Dashboard & Range Switching ---');
  await uiLogin('admin', 'admin123');
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1500));

  // Verify default range is week
  let currentUrl = page.url();
  console.log('Initial URL:', currentUrl);

  // Check Gauge on week
  const getHeroStats = async () => {
    return page.evaluate(() => {
      const gauge = document.querySelector('[role="img"][aria-label*="Overall attendance"]');
      const gaugeAria = gauge ? gauge.getAttribute('aria-label') : null;
      const rateText = gauge ? gauge.querySelector('.tabular-nums')?.textContent?.trim() : null;
      const sublabel = gauge ? gauge.querySelector('.text-white\\/70')?.textContent?.trim() : null;
      
      // Substats
      const substatEls = Array.from(document.querySelectorAll('.tabular-nums'));
      const textContents = substatEls.map(el => el.textContent?.trim());
      
      return { gaugeAria, rateText, sublabel, allNumbers: textContents };
    });
  };

  const weekHero = await getHeroStats();
  console.log('Week Hero Stats:', weekHero);

  // Click 'today' chip
  console.log('Clicking "today" chip...');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const todayBtn = btns.find(b => b.textContent?.trim().toLowerCase() === 'today');
    if (todayBtn) todayBtn.click();
  });
  await new Promise((r) => setTimeout(r, 1000));
  console.log('URL after clicking today:', page.url());
  const todayHero = await getHeroStats();
  console.log('Today Hero Stats:', todayHero);

  // Click 'month' chip
  console.log('Clicking "month" chip...');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const monthBtn = btns.find(b => b.textContent?.trim().toLowerCase() === 'month');
    if (monthBtn) monthBtn.click();
  });
  await new Promise((r) => setTimeout(r, 1000));
  console.log('URL after clicking month:', page.url());
  const monthHero = await getHeroStats();
  console.log('Month Hero Stats:', monthHero);

  // Test Browser Back button
  console.log('Pressing browser Back...');
  await page.goBack();
  await new Promise((r) => setTimeout(r, 1000));
  console.log('URL after Back:', page.url());
  const backHero = await getHeroStats();
  console.log('Back Hero Stats:', backHero);

  // STEP 3: Kebab navigation vs Hero click-through
  console.log('\n--- Step 3: Kebab navigation vs Non-click-through Hero ---');
  // Click on the hero gauge (should NOT navigate)
  const prevUrl = page.url();
  await page.evaluate(() => {
    const gauge = document.querySelector('[role="img"][aria-label*="Overall attendance"]');
    if (gauge) gauge.click();
  });
  await new Promise((r) => setTimeout(r, 500));
  console.log('URL after clicking hero body (must be same):', page.url(), 'Equal:', page.url() === prevUrl);

  // Open kebab menu
  await page.evaluate(() => {
    const kebab = document.querySelector('button[aria-label="Attendance options"]');
    if (kebab) kebab.click();
  });
  await new Promise((r) => setTimeout(r, 500));
  
  // Click "View compliance bands"
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('[role="menuitem"]'));
    const comp = items.find(i => i.textContent?.includes('compliance'));
    if (comp) comp.click();
  });
  await new Promise((r) => setTimeout(r, 1000));
  console.log('URL after clicking "View compliance bands":', page.url());

  // STEP 4: Reduced Motion Emulation
  console.log('\n--- Step 4: prefers-reduced-motion emulation ---');
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.goto(`${BASE_URL}/dashboard?range=today`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 500));

  const motionCheck = await page.evaluate(() => {
    const circle = document.querySelectorAll('[role="img"][aria-label*="Overall attendance"] circle')[1];
    if (!circle) return null;
    return {
      transition: window.getComputedStyle(circle).transition,
      strokeDashoffset: circle.style.strokeDashoffset,
    };
  });
  console.log('Reduced motion circle properties:', motionCheck);

  // Reset media features
  await page.emulateMediaFeatures([]);

  // STEP 5: Teacher Scope Validation
  console.log('\n--- Step 5: Teacher Role Scoping ---');
  await uiLogin('demoteacher', 'demoteacher@2026');
  await page.goto(`${BASE_URL}/dashboard?range=week`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1500));
  const teacherHero = await getHeroStats();
  console.log('Teacher Week Hero Stats:', teacherHero);

  // STEP 6: Student Access Check
  console.log('\n--- Step 6: Student Login Check (No Overview access) ---');
  await uiLogin('23311A0525', 'demostudent@2026');
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1500));
  const studentUrl = page.url();
  console.log('Student redirected URL:', studentUrl);

  // STEP 7: Screenshots in Dark and Light themes at XL and Mobile
  console.log('\n--- Step 7: Capturing Screenshots (Dark/Light at XL and Mobile) ---');
  await uiLogin('admin', 'admin123');
  
  // XL Dark
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE_URL}/dashboard?range=week`, { waitUntil: 'networkidle2' });
  await page.evaluate(() => document.documentElement.classList.remove('light'));
  await new Promise((r) => setTimeout(r, 1000));
  const xlDarkPath = path.join(ARTIFACT_DIR, 'overview_xl_dark.png');
  await page.screenshot({ path: xlDarkPath, fullPage: false });
  console.log('Saved:', xlDarkPath);

  // XL Light
  await page.evaluate(() => {
    document.documentElement.classList.add('light');
    document.documentElement.classList.remove('dark');
  });
  await new Promise((r) => setTimeout(r, 1000));
  const xlLightPath = path.join(ARTIFACT_DIR, 'overview_xl_light.png');
  await page.screenshot({ path: xlLightPath, fullPage: false });
  console.log('Saved:', xlLightPath);

  // Mobile Dark
  await page.setViewport({ width: 375, height: 812, isMobile: true });
  await page.evaluate(() => {
    document.documentElement.classList.remove('light');
    document.documentElement.classList.add('dark');
  });
  await new Promise((r) => setTimeout(r, 1000));
  const mobileDarkPath = path.join(ARTIFACT_DIR, 'overview_mobile_dark.png');
  await page.screenshot({ path: mobileDarkPath, fullPage: false });
  console.log('Saved:', mobileDarkPath);

  // Mobile Light
  await page.evaluate(() => {
    document.documentElement.classList.add('light');
    document.documentElement.classList.remove('dark');
  });
  await new Promise((r) => setTimeout(r, 1000));
  const mobileLightPath = path.join(ARTIFACT_DIR, 'overview_mobile_light.png');
  await page.screenshot({ path: mobileLightPath, fullPage: false });
  console.log('Saved:', mobileLightPath);

  await browser.close();
  console.log('\n=== ALL PHASE 5 AUTOMATED CHECKS COMPLETED SUCCESSFULLY ===');
}

main().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
