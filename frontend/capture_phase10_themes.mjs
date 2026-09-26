import puppeteer from 'puppeteer-core';
import path from 'path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BACKEND_URL = 'http://127.0.0.1:8001';
const FRONTEND_URL = 'http://localhost:5173';
const ARTIFACT_DIR = 'C:\\Users\\bhask\\.gemini\\antigravity-ide\\brain\\56f8a3d2-4bc6-4b8a-a63e-ba11035dcd33';

async function main() {
  console.log('Capturing Dark and Light theme screenshots for /overview (xl 1440x900)...');

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
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

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

  // 1. Dark Theme Capture
  await page.goto(`${FRONTEND_URL}/overview`, { waitUntil: 'networkidle2' });
  await new Promise((res) => setTimeout(res, 1200));

  await page.evaluate(() => {
    document.documentElement.classList.add('dark');
    localStorage.setItem('theme', 'dark');
  });
  await new Promise((res) => setTimeout(res, 400));

  const darkShot = path.join(ARTIFACT_DIR, 'phase10_overview_dark_final.png');
  await page.screenshot({ path: darkShot, fullPage: false });
  console.log('✓ Captured Dark Theme:', darkShot);

  // 2. Light Theme Capture
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark');
    localStorage.setItem('theme', 'light');
  });
  await new Promise((res) => setTimeout(res, 400));

  const lightShot = path.join(ARTIFACT_DIR, 'phase10_overview_light_final.png');
  await page.screenshot({ path: lightShot, fullPage: false });
  console.log('✓ Captured Light Theme:', lightShot);

  await browser.close();
}

main().catch(console.error);
