// Imports a PDF through the real UI and prints the extracted blocks.
// Usage: node e2e/ingest-dump.mjs <file.pdf> [outDir]
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(execSync('npm root -g').toString().trim() + '/');
const { chromium } = require('playwright');
import { writeFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';

const file = process.argv[2];
const outDir = process.argv[3] ?? '/tmp/ingest-out';
const base = process.env.APP_URL ?? 'http://localhost:4300/';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(base);
await page.locator('input[type=file]').setInputFiles(file);
const t0 = Date.now();
await page.waitForFunction(() => document.body.innerText.includes('Added to your library') || document.body.innerText.includes('Could not import'), null, { timeout: 600_000 });
const ms = Date.now() - t0;
// The library lives on the server: read the newest paper back through its API.
const api = (p) => new URL(`api/${p}`, base).href;
const papers = await (await fetch(api('papers'))).json();
const meta = papers.sort((x, y) => x.addedAt - y.addedAt).at(-1);
const { blocks } = await (await fetch(api(`papers/${meta.id}/content`))).json();
const images = [];
for (const b of blocks) {
  if (b.kind !== 'figure') continue;
  const buf = Buffer.from(await (await fetch(api(`papers/${meta.id}/images/${b.imageId}`))).arrayBuffer());
  images.push({ id: b.imageId, buf });
}
const dump = { meta, blocks, images };
const name = basename(file, '.pdf');
writeFileSync(join(outDir, `${name}.json`), JSON.stringify({ meta: dump.meta, blocks: dump.blocks }, null, 2));
for (const im of dump.images) writeFileSync(join(outDir, `${name}-${im.id}.png`), im.buf);
console.log(`import took ${ms} ms; ${dump.blocks?.length} blocks; ${dump.images.length} images`);
console.log('title:', dump.meta.title, '| authors:', dump.meta.authors.join('; '), '| kind:', dump.meta.kind, '| pages:', dump.meta.pageCount);
for (const [i, b] of (dump.blocks ?? []).entries()) {
  const t = b.text ?? b.caption ?? '';
  console.log(String(i).padStart(3), `p${b.page}`, b.kind === 'paragraph' ? `P[${b.role}]` : b.kind === 'heading' ? `H${b.level}` : b.kind === 'figure' ? `FIG[${b.variant}] ${Math.round(b.width)}x${Math.round(b.height)} ${b.imageId.slice(0, 10)}` : b.kind.toUpperCase(), '|', t.slice(0, 110));
}
const errors = logs.filter((l) => /error|warn/i.test(l));
if (errors.length) console.log('--- console ---\n' + errors.slice(0, 20).join('\n'));
await browser.close();
