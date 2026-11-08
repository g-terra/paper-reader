// Prints rows/lines and gutters for one page, using the pipeline modules directly.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const require = createRequire(execSync('npm root -g').toString().trim() + '/');
const { chromium } = require('playwright');
const [file, pageNo = '1'] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (m) => console.log('LOG', m.text()));
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4300/');
const b64 = readFileSync(file).toString('base64');
const out = await page.evaluate(async ({ b64, pageNo }) => {
  const root = '/@fs/home/user/paper-reader/packages/pdf-ingest/src/';
  const pdfjs = await import(root + 'pdfjs.ts');
  const { buildLines } = await import(root + 'lines.ts');
  const workerUrl = (await import('/@fs/home/user/paper-reader/node_modules/.pnpm/pdfjs-dist@5.4.624/node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const p = await doc.getPage(Number(pageNo));
  const vp = p.getViewport({ scale: 1 });
  await p.getOperatorList();
  const tc = await p.getTextContent();
  const glyphs = tc.items.filter((i) => i.str && i.str.trim()).map((it) => {
    const tx = pdfjs.Util.transform(vp.transform, it.transform);
    return { str: it.str, x: tx[4], y: tx[5], w: it.width, size: Math.hypot(tx[2], tx[3]), bold: false, italic: false, math: false };
  });
  globalThis.__debugGutters = true;
  const { lines, gutters } = buildLines(glyphs, 1, vp.width);
  return { gutters, lines: lines.map((l) => `${l.x0.toFixed(0)}-${l.x1.toFixed(0)} y${l.baseline.toFixed(1)} s${l.size} | ${l.text.slice(0, 70)}`) };
}, { b64, pageNo });
console.log('gutters', out.gutters);
console.log(out.lines.join('\n'));
await browser.close();
