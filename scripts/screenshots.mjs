// npm run screenshots   (needs the app running on BASE_URL, default http://localhost:3000, and Google Chrome)
// Logs in as the demo users and saves full-page screenshots to docs/screenshots/.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'docs', 'screenshots');
const CHROME = process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
].find((p) => fs.existsSync(p));
const PASSWORD = 'Demo@1234';

fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 } });
const problems = [];

async function session(email) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${email} pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && problems.push(`${email} console: ${m.text()}`));
  page.on('response', (r) => r.status() >= 500 || (r.status() === 404 && !r.url().includes('favicon')) ? problems.push(`${email} ${r.status()} ${r.url()}`) : null);
  if (email) {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' });
    await page.type('input[type=email]', email);
    await page.type('input[type=password]', PASSWORD);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('form button')]);
  }
  return { ctx, page };
}

const settle = (page) => page.waitForNetworkIdle({ idleTime: 400, timeout: 20000 }).catch(() => {});
async function shot(page, name, { full = true } = {}) {
  await settle(page);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });
  console.log(`  saved ${name}.png`);
}
async function go(page, url, name, opts) {
  await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle0' });
  await shot(page, name, opts);
}
async function selectAccount(page, name) {
  await page.evaluate((n) => {
    const sel = document.querySelector('.nav select');
    const opt = [...sel.options].find((o) => o.textContent.startsWith(n));
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, opt.value);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, name);
  await settle(page);
}

console.log('Taking screenshots...');
{
  const { page } = await session(null);
  await go(page, '/login', '01-login', { full: false });
}
{
  const { page } = await session('apeksha@moneyghosts.dev');
  await selectAccount(page, 'HDFC Savings');
  await go(page, '/dashboard', '02-dashboard');
  await go(page, '/subscriptions', '03-subscriptions');
  const netflix = await page.evaluate(() => [...document.querySelectorAll('a')].find((a) => a.textContent === 'Netflix')?.getAttribute('href'));
  await go(page, netflix, '04-subscription-detail', { full: false });
  await go(page, '/transactions', '05-transactions', { full: false });
  for (const [q, mode, name] of [['video streaming', 'meaning', '06-search-meaning'], ['video streaming', 'keyword', '07-search-keyword']]) {
    await page.goto(`${BASE}/search`, { waitUntil: 'networkidle0' });
    await page.type('form input', q);
    await page.select('form select', mode);
    await page.click('form button');
    await new Promise((r) => setTimeout(r, 800));
    await shot(page, name);
  }
  await page.goto(`${BASE}/import`, { waitUntil: 'networkidle0' });
  const input = await page.$('input[type=file]');
  await input.uploadFile(path.resolve(OUT, '..', '..', 'sample', 'generic_statement.csv'));
  await page.waitForFunction(() => /Imported|already imported/.test(document.body.innerText), { timeout: 60000 });
  await shot(page, '08-import');
  await go(page, '/household', '09-household');
  await go(page, '/budgets', '10-budgets');
  await selectAccount(page, 'SBI Savings');
  await go(page, '/import', '11-read-only-access', { full: false });
}
{
  const { page } = await session('avanthika@moneyghosts.dev');
  await go(page, '/household', '12-household-avanthika');
}
await browser.close();
if (problems.length) {
  console.log('\nBrowser problems:\n' + problems.join('\n'));
  process.exitCode = 1;
} else {
  console.log('No browser errors.');
}
