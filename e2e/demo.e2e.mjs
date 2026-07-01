/**
 * E2E: the demo playground redacts in-browser and rehydrates locally.
 * Deterministic path only (no network / no model download).
 *
 * Run: node e2e/demo.e2e.mjs   (set PW_CHROMIUM to override the browser path)
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, resolveChromium, loadPlaywright } from './server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const chromium = await loadPlaywright();
const exe = await resolveChromium();
if (!chromium || !exe) {
  console.log('SKIP demo e2e: playwright-core or Chromium not available.');
  process.exit(0);
}

const site = await serve(resolve(root, 'demo'));
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && !t.includes('Failed to load resource')) errors.push(t);
});

let ok = false;
try {
  await page.goto(`http://localhost:${site.port}/index.html`);
  await page.click('#redactBtn');
  await page.waitForFunction(() =>
    document.getElementById('latency').textContent.includes('entities'),
  );

  const redacted = await page.textContent('#redactedOut');
  const vaultRows = await page.$$eval('#vaultTable tbody tr', (r) => r.length);

  await page.fill('#responseIn', 'Contacting [[EMAIL_1]] now.');
  await page.click('#rehydrateBtn');
  const rehydrated = await page.textContent('#rehydratedOut');

  ok =
    redacted.includes('[[EMAIL_1]]') &&
    redacted.includes('[[SSN_1]]') &&
    redacted.includes('[[ORG_1]]') && // dictionary: Acme Corp
    !redacted.includes('jane.doe@example.com') &&
    vaultRows > 3 &&
    rehydrated.includes('jane.doe@example.com') &&
    errors.length === 0;

  console.log('demo redacted:', redacted.trim().slice(0, 120), '...');
  console.log('demo vault rows:', vaultRows);
  console.log('demo rehydrated:', rehydrated.trim());
  if (errors.length) console.log('demo errors:', errors);
} finally {
  await browser.close();
  await site.close();
}

console.log(`demo e2e: ${ok ? 'PASS' : 'FAIL'}`);
process.exit(ok ? 0 : 1);
