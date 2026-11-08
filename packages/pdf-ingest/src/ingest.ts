import { getDocument, Util, type PDFDocumentProxy, type PDFPageProxy } from './pdfjs';
import type { TextItem, TextStyle } from 'pdfjs-dist/types/src/display/api';
import type { Block, ExtractedImage, IngestOptions, IngestResult, PageRef, Rect } from './types';
import { buildLines, type Glyph } from './lines';
import { scanGraphics } from './graphics';
import {
  assembleBlocks,
  detectColumns,
  documentStats,
  extractAbstract,
  extractAuthors,
  findEquations,
  findGraphicRegions,
  readingOrder,
  removeRunningElements,
  type FlowItem,
  type PageInput,
  type Region,
} from './layout';
import { canvasToBlob, cropCanvas, fitScale, releaseCanvas, renderPage, createCanvas } from './canvas';
import { findScanFigures, findSpreadSplit, ocrCanvas, ocrLines, snapOcrSizes, toGray, type OcrWord } from './scan';
import { makeId } from './ids';
import { documentParams, renderPdfPage } from './pdf';
import { coverage, union } from './geometry';

const MATH_FONT = /CMMI|CMSY|CMEX|MSBM|MSAM|Math|Symbol|MTMI|MTSY|MTEX|txmi|txsy|txex|rtxm|NewTX(MI|SY|EX)|LMMath|eufm|rsfs|esint|stmary|wasy|cmmib|cmbsy|Euler/i;
const BOLD_FONT = /bold|black|heavy|semibold|demi|\bmedi|[-,]B$|\.B$|CMBX|CMB10|CMSSBX|-Bd|Bd$|-Heavy/i;
const ITALIC_FONT = /italic|oblique|-It$|-It\b|CMTI|CMSL/i;

class AbortedError extends Error {
  constructor() {
    super('Import cancelled');
    this.name = 'AbortError';
  }
}

interface FontInfo {
  bold: boolean;
  italic: boolean;
  math: boolean;
}

function fontInfo(page: PDFPageProxy, fontName: string, styles: Record<string, TextStyle>, cache: Map<string, FontInfo>): FontInfo {
  const cached = cache.get(fontName);
  if (cached) return cached;
  let name = '';
  let bold = false;
  let italic = false;
  try {
    if (page.commonObjs.has(fontName)) {
      const f = page.commonObjs.get(fontName) as { name?: string; bold?: boolean; black?: boolean; italic?: boolean } | null;
      name = f?.name ?? '';
      bold = !!(f?.bold || f?.black);
      italic = !!f?.italic;
    }
  } catch {
    // Font data not available: fall back to the style family.
  }
  name ||= styles[fontName]?.fontFamily ?? '';
  const info = { bold: bold || BOLD_FONT.test(name), italic: italic || ITALIC_FONT.test(name), math: MATH_FONT.test(name) };
  cache.set(fontName, info);
  return info;
}

function textGlyphs(page: PDFPageProxy, items: TextItem[], styles: Record<string, TextStyle>, viewportTransform: number[]): Glyph[] {
  const cache = new Map<string, FontInfo>();
  const out: Glyph[] = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const tx = Util.transform(viewportTransform, it.transform);
    const size = Math.hypot(tx[2], tx[3]);
    if (!size) continue;
    // Skip rotated text (arXiv side stamps, rotated axis labels are handled with figures).
    if (Math.abs(tx[1]) > size * 0.15 || Math.abs(tx[2]) > size * 0.15) continue;
    const f = fontInfo(page, it.fontName, styles, cache);
    const scaleX = Math.hypot(tx[0], tx[1]) / Math.max(1e-6, Math.hypot(it.transform[0], it.transform[1]));
    out.push({ str: it.str, x: tx[4], y: tx[5], w: it.width * (Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1), size, ...f });
  }
  return out;
}

/** True when the text layer is mostly unusable characters (broken font encodings). */
function textLooksBroken(glyphs: Glyph[]): boolean {
  let n = 0;
  let bad = 0;
  for (const g of glyphs)
    for (const ch of g.str) {
      if (ch === ' ') continue;
      n++;
      if (/[-�\u0000-\u001F]/.test(ch)) bad++;
    }
  return n > 50 && bad / n > 0.2;
}

function decentMetadataTitle(t: unknown): string | undefined {
  if (typeof t !== 'string') return undefined;
  const s = t.trim();
  if (s.length < 8 || s.length > 300) return undefined;
  if (/\.(dvi|docx?|pdf|tex|ps|indd|rtf)$/i.test(s) || /^(untitled|microsoft word|document\d*|title)$/i.test(s)) return undefined;
  if (!/\s/.test(s)) return undefined;
  return s;
}

function isMostlyBlank(c: HTMLCanvasElement): boolean {
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  let dark = 0;
  const step = Math.max(4, Math.floor(data.length / 4 / 20000) * 4);
  let n = 0;
  for (let i = 0; i < data.length; i += step) {
    n++;
    if (data[i] + data[i + 1] + data[i + 2] < 600) dark++;
  }
  return dark / n < 0.002;
}

interface ScanHalf {
  x0: number;
  x1: number;
  half?: 'left' | 'right';
}

/** OCRs one scanned PDF page; returns one or two logical pages (spreads are split). */
async function processScannedPage(
  pdfPage: PDFPageProxy,
  pdfPageNumber: number,
  firstLogical: number,
  opts: IngestOptions,
): Promise<{ inputs: PageInput[]; refs: PageRef[] }> {
  const vp = pdfPage.getViewport({ scale: 1 });
  const landscape = vp.width > vp.height * 1.15;
  const scale = fitScale(pdfPage, landscape ? 4000 : 2200);
  const canvas = await renderPage(pdfPage, scale);
  try {
    const gray = toGray(canvas);
    const split = findSpreadSplit(gray);
    const halves: ScanHalf[] = split
      ? [
          { x0: 0, x1: split, half: 'left' },
          { x0: split, x1: canvas.width, half: 'right' },
        ]
      : [{ x0: 0, x1: canvas.width }];
    const inputs: PageInput[] = [];
    const refs: PageRef[] = [];
    for (const h of halves) {
      if (opts.signal?.aborted) throw new AbortedError();
      const logical = firstLogical + inputs.length;
      let target = canvas;
      if (split) {
        target = createCanvas(h.x1 - h.x0, canvas.height);
        target.getContext('2d')!.drawImage(canvas, h.x0, 0, h.x1 - h.x0, canvas.height, 0, 0, h.x1 - h.x0, canvas.height);
      }
      let words: OcrWord[] = await ocrCanvas(target, opts.ocr);
      if (target !== canvas) releaseCanvas(target);
      words = words.map((w) => ({ ...w, box: { ...w.box, x0: w.box.x0 + h.x0, x1: w.box.x1 + h.x0 } }));

      const figures = findScanFigures(gray, words, { x0: h.x0, y0: 0, x1: h.x1, y1: canvas.height });
      words = words.filter((w) => !figures.some((f) => coverage(w.box, f) > 0.5));

      // Lines the OCR could not read (usually equations) are kept as pictures of the scan.
      const preset: Region[] = [];
      const byLine = new Map<number, OcrWord[]>();
      for (const w of words) byLine.set(w.line, [...(byLine.get(w.line) ?? []), w]);
      const unreadable = new Set<number>();
      for (const [line, ws] of byLine) {
        const conf = ws[0].lineConf;
        const letters = ws.map((w) => w.text).join('').replace(/[^\p{L}]/gu, '').length;
        const chars = ws.map((w) => w.text).join('').length;
        if (conf < 45 || (conf < 70 && letters < chars * 0.5)) unreadable.add(line);
      }
      const lowRects = [...unreadable].map((l) => byLine.get(l)!.reduce<Rect>((r, w) => union(r, w.box), { ...byLine.get(l)![0].box }));
      lowRects.sort((a, b) => a.y0 - b.y0);
      const groups: Rect[] = [];
      for (const r of lowRects) {
        const last = groups[groups.length - 1];
        if (last && r.y0 - last.y1 < (r.y1 - r.y0) * 0.8 && Math.min(r.x1, last.x1) > Math.max(r.x0, last.x0)) groups[groups.length - 1] = union(last, r);
        else groups.push(r);
      }
      for (const r of groups) {
        // Tiny unreadable bits (stray marks, superscripts) are dropped rather than shown as pictures.
        if ((r.x1 - r.x0) / scale < 30 || (r.y1 - r.y0) / scale < 6) continue;
        const pts = { x0: r.x0 / scale - 2, y0: r.y0 / scale - 2, x1: r.x1 / scale + 2, y1: r.y1 / scale + 2 };
        preset.push({ id: makeId('img-'), page: logical, rect: pts, variant: 'equation', graphic: false });
      }
      words = words.filter((w) => !unreadable.has(w.line) && w.conf >= 20);

      const built = ocrLines(words, scale, logical, vp.width);
      snapOcrSizes(built.lines);
      inputs.push({
        page: logical,
        width: vp.width,
        height: vp.height,
        lines: built.lines,
        gutters: built.gutters,
        graphics: figures.map((f) => ({ x0: f.x0 / scale, y0: f.y0 / scale, x1: f.x1 / scale, y1: f.y1 / scale })),
        presetRegions: preset,
      });
      refs.push({ pdfPage: pdfPageNumber, half: h.half, ocr: true });
    }
    return { inputs, refs };
  } finally {
    releaseCanvas(canvas);
  }
}

/** Reads an academic paper PDF and turns it into reflowable reading blocks. */
export async function ingestPdf(data: ArrayBuffer | Uint8Array, opts: IngestOptions = {}): Promise<IngestResult> {
  const report = opts.onProgress ?? (() => undefined);
  const check = () => {
    if (opts.signal?.aborted) throw new AbortedError();
  };
  report({ stage: 'opening', fraction: 0, message: 'Opening PDF' });
  const bytes = data instanceof Uint8Array ? data.slice() : new Uint8Array(data.slice(0));
  const doc: PDFDocumentProxy = await getDocument({ data: bytes, useSystemFonts: true, ...documentParams() }).promise;
  try {
    const n = doc.numPages;
    const meta = await doc.getMetadata().catch(() => null);
    const pages: PageInput[] = [];
    const refs: PageRef[] = [];

    for (let i = 1; i <= n; i++) {
      check();
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const ops = await page.getOperatorList();
      const tc = await page.getTextContent();
      const items = tc.items.filter((it): it is TextItem => 'str' in it);
      const glyphs = textGlyphs(page, items, tc.styles, vp.transform);
      const graphics = scanGraphics(ops.fnArray, ops.argsArray as unknown[][], vp.transform, vp.width, vp.height);
      const chars = glyphs.reduce((s, g) => s + g.str.replace(/\s/g, '').length, 0);
      const scanned =
        opts.forceOcr ||
        textLooksBroken(glyphs) ||
        (chars < 40 && graphics.largestImageShare > 0.3) ||
        (chars < 40 && graphics.imageCount > 0 && graphics.regions.length === 0);

      if (scanned) {
        report({ stage: 'ocr', page: i, pageCount: n, fraction: ((i - 1) / n) * 0.85, message: `Recognising text on scanned page ${i} of ${n}` });
        const res = await processScannedPage(page, i, pages.length + 1, opts);
        pages.push(...res.inputs);
        refs.push(...res.refs);
      } else {
        report({ stage: 'reading', page: i, pageCount: n, fraction: ((i - 1) / n) * 0.85, message: `Reading page ${i} of ${n}` });
        const logical = pages.length + 1;
        const built = buildLines(glyphs, logical, vp.width);
        pages.push({ page: logical, width: vp.width, height: vp.height, lines: built.lines, gutters: built.gutters, graphics: graphics.regions });
        refs.push({ pdfPage: i, ocr: false });
      }
      page.cleanup();
    }

    report({ stage: 'layout', fraction: 0.86, message: 'Rebuilding paragraphs and sections' });
    removeRunningElements(pages);
    const stats = documentStats(pages);
    const flows: { page: number; height: number; items: FlowItem[] }[] = [];
    const regions = new Map<string, Region>();
    for (const p of pages) {
      const found = [...findGraphicRegions(p, stats, () => makeId('img-')), ...(p.presetRegions ?? [])];
      const cols = detectColumns(p.lines, p.gutters, p.width);
      let items = readingOrder(p.lines, found, cols);
      items = findEquations(items, stats, p.page, () => makeId('img-'));
      for (const it of items) if (it.type === 'region') regions.set(it.region.id, it.region);
      flows.push({ page: p.page, height: p.height, items });
    }
    const { blocks: assembled, titleText } = assembleBlocks(flows, stats);

    // Crop pictures from the rendered pages.
    const images: ExtractedImage[] = [];
    const wanted = assembled.filter((b): b is Extract<Block, { kind: 'figure' }> => b.kind === 'figure');
    const byPdfPage = new Map<number, Region[]>();
    for (const b of wanted) {
      const r = regions.get(b.imageId);
      if (!r) continue;
      const pdfPage = refs[r.page - 1]?.pdfPage ?? r.page;
      byPdfPage.set(pdfPage, [...(byPdfPage.get(pdfPage) ?? []), r]);
    }
    const failed = new Set<string>();
    let done = 0;
    for (const [pdfPage, rs] of byPdfPage) {
      check();
      report({ stage: 'layout', fraction: 0.88 + (done++ / Math.max(1, byPdfPage.size)) * 0.1, message: `Copying figures from page ${pdfPage}` });
      const page = await doc.getPage(pdfPage);
      const vp = page.getViewport({ scale: 1 });
      const scale = fitScale(page, vp.width * 3);
      const canvas = await renderPage(page, scale);
      for (const r of rs) {
        const rect = { x0: Math.max(0, r.rect.x0), y0: Math.max(0, r.rect.y0), x1: Math.min(vp.width, r.rect.x1), y1: Math.min(vp.height, r.rect.y1) };
        if (rect.x1 - rect.x0 < 3 || rect.y1 - rect.y0 < 3) {
          failed.add(r.id);
          continue;
        }
        const crop = cropCanvas(canvas, rect, scale);
        if (isMostlyBlank(crop)) {
          failed.add(r.id);
          releaseCanvas(crop);
          continue;
        }
        const blob = await canvasToBlob(crop, 'image/png');
        images.push({ id: r.id, blob, width: crop.width, height: crop.height });
        releaseCanvas(crop);
      }
      releaseCanvas(canvas);
      page.cleanup();
    }
    let blocks = assembled.filter((b) => !(b.kind === 'figure' && (failed.has(b.imageId) || !images.some((im) => im.id === b.imageId))));

    // Title, authors and abstract.
    const info = (meta?.info ?? {}) as Record<string, unknown>;
    const metaTitle = decentMetadataTitle(info.Title);
    const fileTitle = (opts.fileName ?? 'Untitled paper').replace(/\.pdf$/i, '').replace(/[_]+/g, ' ');
    let title = titleText && titleText.length <= 250 ? titleText : metaTitle ?? titleText ?? fileTitle;
    if (!title.trim()) title = fileTitle;
    if (!blocks.some((b) => b.kind === 'title')) blocks = [{ kind: 'title', text: title, page: 1 }, ...blocks];
    let authors = extractAuthors(blocks);
    if (!authors.length && typeof info.Author === 'string' && info.Author.trim())
      authors = info.Author.split(/;|,|\band\b|&/).map((s) => s.trim()).filter(Boolean).slice(0, 15);
    const abstract = extractAbstract(blocks);

    report({ stage: 'layout', fraction: 0.98, message: 'Making the cover' });
    // For a split two-page scan, the cover is the left page only.
    const coverCanvas = await renderPdfPage(doc, 1, 480, refs[0]?.half);
    const cover = await canvasToBlob(coverCanvas, 'image/jpeg', 0.85);
    releaseCanvas(coverCanvas);

    const ocrPages = refs.filter((r) => r.ocr).length;
    report({ stage: 'done', fraction: 1, message: 'Done' });
    return {
      meta: {
        title,
        authors,
        abstract,
        pageCount: refs.length,
        pages: refs,
        kind: ocrPages === 0 ? 'digital' : ocrPages === refs.length ? 'scanned' : 'mixed',
        bodyFontSize: stats.bodySize,
      },
      blocks,
      images,
      cover,
    };
  } finally {
    await doc.destroy();
  }
}
