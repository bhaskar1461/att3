import puppeteer from 'puppeteer-core';
import path from 'path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BACKEND_URL = 'http://127.0.0.1:8001';
const FRONTEND_URL = 'http://localhost:5173';
const ARTIFACT_DIR = 'C:\\Users\\bhask\\.gemini\\antigravity-ide\\brain\\56f8a3d2-4bc6-4b8a-a63e-ba11035dcd33';

async function main() {
  console.log('=== PHASE 10 PART E: RESPONSIVE AUDIT (360 / 768 / 1024 / 1440) ===\n');

  const loginRes = await fetch(`${BACKEND_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const token = (await loginRes.json()).access_token;

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();

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
  }, token);

  const viewports = [
    { name: 'mobile_360', width: 360, height: 740 },
    { name: 'tablet_768', width: 768, height: 1024 },
    { name: 'desktop_1024', width: 1024, height: 768 },
    { name: 'desktop_1440', width: 1440, height: 900 },
  ];

  const routes = ['/overview', '/roster/students', '/security', '/leave'];

  for (const vp of viewports) {
    console.log(`\nTesting Viewport: ${vp.name} (${vp.width}x${vp.height})...`);
    await page.setViewport({ width: vp.width, height: vp.height });

    for (const r of routes) {
      await page.goto(`${FRONTEND_URL}${r}`, { waitUntil: 'networkidle2' });
      await new Promise((res) => setTimeout(res, 600));

      const scrollInfo = await page.evaluate(() => {
        const docEl = document.documentElement;
        const scrollWidth = docEl.scrollWidth;
        const innerWidth = window.innerWidth;
        const hasHorizontalScroll = scrollWidth > innerWidth + 1; // 1px threshold for subpixel rounding
        return { scrollWidth, innerWidth, hasHorizontalScroll };
      });

      if (scrollInfo.hasHorizontalScroll) {
        console.warn(`[WARN] Horizontal scroll on ${r} at ${vp.width}px: scrollWidth=${scrollInfo.scrollWidth}, innerWidth=${scrollInfo.innerWidth}`);
      } else {
        console.log(`✓ ${r.padEnd(18)} at ${vp.width}px: No horizontal scroll (scrollWidth: ${scrollInfo.scrollWidth} <= innerWidth: ${scrollInfo.innerWidth})`);
      }

      if (r === '/overview') {
        const screenshotPath = path.join(ARTIFACT_DIR, `phase10_overview_${vp.name}.png`);
        await page.screenshot({ path: screenshotPath });
        console.log(`  -> Captured screenshot: ${screenshotPath}`);
      }
    }
  }

  await browser.close();
  console.log('\n=== RESPONSIVE AUDIT: COMPLETED SUCCESSFULLY ===');
}

main().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});
