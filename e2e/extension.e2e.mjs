/**
 * E2E: the extension content script intercepts a send, shows the review panel,
 * sends only redacted text, and rehydrates the assistant reply — verified
 * against the bundled mock chat page.
 *
 * Run: node e2e/extension.e2e.mjs   (set PW_CHROMIUM to override the browser path)
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, resolveChromium, loadPlaywright } from './server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const chromium = await loadPlaywright();
const exe = await resolveChromium();
if (!chromium || !exe) {
  console.log('SKIP extension e2e: playwright-core or Chromium not available.');
  process.exit(0);
}

const site = await serve(resolve(root, 'extension'));
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
  await page.goto(`http://localhost:${site.port}/test/mock.html`);

  await page.fill(
    '[data-pii-composer]',
    'Email jane@example.com and SSN 123-45-6789 please.',
  );
  await page.click('[data-pii-send]');

  await page.waitForSelector('#pii-guard-panel', { timeout: 3000 });
  const panelItems = await page.$$eval('#pii-guard-panel .pg-row', (r) => r.length);
  const preview = await page.textContent('#pii-guard-panel .pg-preview pre');

  await page.click('#pii-guard-panel .pg-send');

  await page.waitForSelector('.msg.assistant', { timeout: 3000 });
  await page.waitForFunction(
    () => {
      const a = document.querySelector('.msg.assistant');
      return a && !a.textContent.includes('[[');
    },
    { timeout: 3000 },
  );

  const userMsg = await page.textContent('.msg.user');
  const assistantMsg = await page.textContent('.msg.assistant');

  ok =
    panelItems === 2 &&
    preview.includes('[[EMAIL_1]]') &&
    userMsg.includes('[[EMAIL_1]]') &&
    userMsg.includes('[[SSN_1]]') &&
    !userMsg.includes('jane@example.com') &&
    assistantMsg.includes('jane@example.com') &&
    errors.length === 0;

  console.log('ext panel items:', panelItems);
  console.log('ext user sent:', userMsg.trim());
  console.log('ext assistant rehydrated:', assistantMsg.trim());
  if (errors.length) console.log('ext errors:', errors);
} finally {
  await browser.close();
  await site.close();
}

console.log(`extension e2e: ${ok ? 'PASS' : 'FAIL'}`);
process.exit(ok ? 0 : 1);
