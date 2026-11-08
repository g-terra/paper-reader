// Imports the sample papers and takes screenshots of the library and reader at several sizes.
// Usage: node e2e/screens.mjs <outDir>
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(execSync('npm root -g').toString().trim() + '/');
const { chromium, devices } = require('playwright');
const out = process.argv[2] ?? '/tmp/screens';
const base = process.env.APP_URL ?? 'http://localhost:5173/';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(base);
await page.screenshot({ path: `${out}/empty.png` });
await page.locator('input[type=file]').setInputFiles(['fixtures/two-column-paper.pdf']);
await page.waitForFunction(() => document.body.innerText.includes('Added to your library'), null, { timeout: 600000 });
if (process.env.WITH_SCAN) {
  await page.locator('input[type=file]').setInputFiles(['fixtures/scanned-spreads.pdf']);
  await page.waitForFunction(() => (document.body.innerText.match(/Added to your library/g) ?? []).length >= 2, null, { timeout: 600000 });
}
await page.getByRole('button', { name: 'Close' }).first().click().catch(() => {});
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/library-desktop.png` });
const state = await ctx.storageState();

const sizes = [
  ['phone', { ...devices['iPhone 13'] }],
  ['ipad-portrait', { ...devices['iPad (gen 7)'] }],
  ['ipad-landscape', { ...devices['iPad (gen 7) landscape'] }],
];
for (const [name, dev] of sizes) {
  const c = await browser.newContext({ ...dev, storageState: state });
  const p = await c.newPage();
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  // IndexedDB is not part of storageState: re-import in each context.
  await p.goto(base);
  await p.locator('input[type=file]').setInputFiles(['fixtures/two-column-paper.pdf']);
  await p.waitForFunction(() => document.body.innerText.includes('Added to your library'), null, { timeout: 600000 });
  await p.getByRole('button', { name: 'Close' }).first().click().catch(() => {});
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${out}/${name}-library.png` });
  await p.getByRole('button', { name: /^Open / }).first().click();
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${out}/${name}-reader-1.png` });
  const vp = p.viewportSize();
  await p.mouse.click(vp.width * 0.9, vp.height * 0.5);
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${out}/${name}-reader-2.png` });
  await p.mouse.click(vp.width * 0.9, vp.height * 0.5);
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${out}/${name}-reader-3.png` });
  await p.mouse.click(vp.width * 0.5, vp.height * 0.5);
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${out}/${name}-reader-chrome.png` });
  await p.getByRole('button', { name: 'Text and theme' }).click();
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${out}/${name}-appearance.png` });
  await p.getByRole('button', { name: 'Sepia theme' }).click();
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  await p.mouse.click(vp.width * 0.5, vp.height * 0.5);
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${out}/${name}-reader-sepia.png` });
  await c.close();
}
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
