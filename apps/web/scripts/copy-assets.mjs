// Copies the pdf.js fonts and the Tesseract (OCR) worker, engine and English language data into public/ocr so that
// scanned papers can be read offline, without fetching anything from a CDN.
import { copyFileSync, cpSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'public', 'ocr');
mkdirSync(out, { recursive: true });

const tesseractDir = dirname(require.resolve('tesseract.js/package.json'));
const coreDir = dirname(require.resolve('tesseract.js-core/package.json'));
const engDir = dirname(require.resolve('@tesseract.js-data/eng/package.json'));

const files = [
  [join(tesseractDir, 'dist', 'worker.min.js'), 'worker.min.js'],
  [join(coreDir, 'tesseract-core-simd-lstm.wasm.js'), 'tesseract-core-simd-lstm.wasm.js'],
  [join(coreDir, 'tesseract-core-lstm.wasm.js'), 'tesseract-core-lstm.wasm.js'],
  [join(engDir, '4.0.0_best_int', 'eng.traineddata.gz'), 'eng.traineddata.gz'],
];
for (const [from, name] of files) {
  if (!existsSync(from)) throw new Error(`Missing OCR asset: ${from}`);
  copyFileSync(from, join(out, name));
}
console.log(`OCR assets copied to ${out}`);

// pdf.js standard fonts and character maps, so PDFs that don't embed their fonts still render.
const pdfjsDir = dirname(require.resolve('pdfjs-dist/package.json'));
const pdfOut = join(here, '..', 'public', 'pdfjs');
cpSync(join(pdfjsDir, 'standard_fonts'), join(pdfOut, 'standard_fonts'), { recursive: true });
cpSync(join(pdfjsDir, 'cmaps'), join(pdfOut, 'cmaps'), { recursive: true });
console.log(`pdf.js fonts and cmaps copied to ${pdfOut}`);
