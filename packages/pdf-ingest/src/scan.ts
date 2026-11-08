import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';
import type { OcrAssets, Rect } from './types';
import { findGutters, segmentToLine, type Glyph, type Line } from './lines';

// ---------------------------------------------------------------------------------------------
// Pixel helpers

export interface Gray {
  data: Uint8Array;
  width: number;
  height: number;
  /** Typical paper brightness, 0..255. */
  background: number;
}

export function toGray(canvas: HTMLCanvasElement): Gray {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const out = new Uint8Array(width * height);
  const hist = new Uint32Array(256);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const v = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    out[j] = v;
    hist[out[j]]++;
  }
  // Background = the most common bright value.
  let background = 255;
  let best = 0;
  for (let v = 128; v < 256; v++)
    if (hist[v] > best) {
      best = hist[v];
      background = v;
    }
  return { data: out, width, height, background };
}

function inkThreshold(g: Gray): number {
  return Math.min(170, g.background * 0.62);
}

// ---------------------------------------------------------------------------------------------
// Two-page spreads

/**
 * Looks for a scanned two-page spread (a landscape image with a gutter in the middle). Returns the
 * x position (in pixels) to split at, or null when the page is a single page.
 */
export function findSpreadSplit(g: Gray): number | null {
  if (g.width < g.height * 1.15) return null;
  const threshold = inkThreshold(g);
  const ink = new Float32Array(g.width);
  const lum = new Float32Array(g.width);
  const y0 = Math.floor(g.height * 0.08);
  const y1 = Math.floor(g.height * 0.92);
  const step = Math.max(1, Math.floor((y1 - y0) / 400));
  let rows = 0;
  for (let y = y0; y < y1; y += step) {
    rows++;
    const row = y * g.width;
    for (let x = 0; x < g.width; x++) {
      const v = g.data[row + x];
      lum[x] += v;
      if (v < threshold) ink[x]++;
    }
  }
  for (let x = 0; x < g.width; x++) {
    ink[x] /= rows;
    lum[x] /= rows;
  }
  const radius = Math.max(2, Math.round(g.width * 0.004));
  const smooth = (arr: Float32Array, x: number) => {
    let s = 0;
    let n = 0;
    for (let k = x - radius; k <= x + radius; k++)
      if (k >= 0 && k < arr.length) {
        s += arr[k];
        n++;
      }
    return s / n;
  };
  const from = Math.floor(g.width * 0.4);
  const to = Math.ceil(g.width * 0.6);
  let lightX = -1;
  let lightInk = Infinity;
  let darkX = -1;
  let darkLum = Infinity;
  for (let x = from; x <= to; x++) {
    const i = smooth(ink, x);
    if (i < lightInk) {
      lightInk = i;
      lightX = x;
    }
    const l = smooth(lum, x);
    if (l < darkLum) {
      darkLum = l;
      darkX = x;
    }
  }
  const avg = (a: number, b: number) => {
    let s = 0;
    for (let x = a; x < b; x++) s += ink[x];
    return s / Math.max(1, b - a);
  };
  const leftInk = avg(Math.floor(g.width * 0.1), Math.floor(g.width * 0.4));
  const rightInk = avg(Math.floor(g.width * 0.6), Math.floor(g.width * 0.9));
  if (leftInk < 0.005 || rightInk < 0.005) return null; // one side is blank: not a text spread
  // A dark shadow down the middle is the clearest sign of a book gutter.
  if (darkLum < g.background * 0.55) return darkX;
  // Otherwise, a clean light gap between two inked halves.
  if (lightInk < Math.min(leftInk, rightInk) * 0.15) return lightX;
  return null;
}

// ---------------------------------------------------------------------------------------------
// OCR

let worker: Promise<Worker> | null = null;
let workerKey = '';

export async function getOcrWorker(assets: OcrAssets = {}): Promise<Worker> {
  const key = JSON.stringify(assets);
  if (worker && key === workerKey) return worker;
  if (worker) await terminateOcr();
  workerKey = key;
  worker = (async () => {
    const options: Record<string, unknown> = { gzip: true };
    if (assets.workerPath) options.workerPath = assets.workerPath;
    if (assets.corePath) options.corePath = assets.corePath;
    if (assets.langPath) options.langPath = assets.langPath;
    const w = await createWorker(assets.lang ?? 'eng', OEM.LSTM_ONLY, options);
    await w.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: '0' });
    return w;
  })();
  worker.catch(() => {
    worker = null;
  });
  return worker;
}

export async function terminateOcr(): Promise<void> {
  const w = worker;
  worker = null;
  if (w) await (await w).terminate().catch(() => undefined);
}

export interface OcrWord {
  text: string;
  conf: number;
  /** Pixel box in the OCR'd canvas. */
  box: Rect;
  baseline: number;
  lineHeight: number;
  /** Index of the OCR line the word belongs to, and that line's mean confidence. */
  line: number;
  lineConf: number;
}

export async function ocrCanvas(canvas: HTMLCanvasElement, assets?: OcrAssets): Promise<OcrWord[]> {
  const w = await getOcrWorker(assets);
  const { data } = await w.recognize(canvas, {}, { blocks: true, text: false });
  const words: OcrWord[] = [];
  let lineIndex = 0;
  for (const block of data.blocks ?? [])
    for (const para of block.paragraphs)
      for (const line of para.lines) {
        const bl = line.baseline;
        const rowH = line.rowAttributes?.row_height || line.bbox.y1 - line.bbox.y0;
        lineIndex++;
        // Baseline: bottom of the words that have no descenders (more reliable than the
        // reported baseline, which is missing or off on some lines).
        const flat = line.words.filter((w) => w.text.trim() && !/[gjpqyQ,;()\[\]{}|/@$_]/.test(w.text)).map((w) => w.bbox.y1).sort((a, b) => a - b);
        const flatBase = flat.length ? flat[flat.length >> 1] : undefined;
        for (const word of line.words) {
          const text = word.text.trim();
          if (!text) continue;
          const cx = (word.bbox.x0 + word.bbox.x1) / 2;
          let baseline = flatBase ?? word.bbox.y1;
          if (flatBase === undefined && bl?.has_baseline && bl.x1 !== bl.x0) baseline = bl.y0 + ((bl.y1 - bl.y0) * (cx - bl.x0)) / (bl.x1 - bl.x0);
          words.push({ text, conf: word.confidence, box: { ...word.bbox }, baseline, lineHeight: rowH, line: lineIndex, lineConf: line.confidence });
        }
      }
  return words;
}

// ---------------------------------------------------------------------------------------------
// Pictures on scanned pages

/**
 * Finds pictures on a scanned page: inked areas that are not covered by recognised words.
 * Returns pixel rectangles relative to the analysed area.
 */
export function findScanFigures(g: Gray, words: OcrWord[], area: Rect): Rect[] {
  const aw = area.x1 - area.x0;
  const ah = area.y1 - area.y0;
  const cell = Math.max(6, Math.round(aw / 160));
  const cols = Math.ceil(aw / cell);
  const rows = Math.ceil(ah / cell);
  const ink = new Uint8Array(cols * rows);
  const threshold = inkThreshold(g);
  for (let cy = 0; cy < rows; cy++)
    for (let cx = 0; cx < cols; cx++) {
      let dark = 0;
      let n = 0;
      const px0 = area.x0 + cx * cell;
      const py0 = area.y0 + cy * cell;
      for (let y = py0; y < Math.min(area.y1, py0 + cell); y += 2)
        for (let x = px0; x < Math.min(area.x1, px0 + cell); x += 2) {
          n++;
          if (g.data[y * g.width + x] < threshold) dark++;
        }
      if (n && dark / n > 0.04) ink[cy * cols + cx] = 1;
    }
  // Clear the cells that hold confidently read words.
  for (const w of words) {
    if (w.conf < 55 || !/[\p{L}\d]{2,}/u.test(w.text)) continue;
    const pad = 3 + (w.box.y1 - w.box.y0) * 0.2;
    const x0 = Math.max(0, Math.floor((w.box.x0 - area.x0 - pad) / cell));
    const x1 = Math.min(cols - 1, Math.floor((w.box.x1 - area.x0 + pad) / cell));
    const y0 = Math.max(0, Math.floor((w.box.y0 - area.y0 - pad) / cell));
    const y1 = Math.min(rows - 1, Math.floor((w.box.y1 - area.y0 + pad) / cell));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) ink[y * cols + x] = 0;
  }
  // Connected components, bridging gaps of up to two cells.
  const label = new Int32Array(cols * rows).fill(-1);
  const out: Rect[] = [];
  const reach = 2;
  for (let start = 0; start < ink.length; start++) {
    if (!ink[start] || label[start] >= 0) continue;
    const stack = [start];
    label[start] = start;
    let minX = cols, minY = rows, maxX = 0, maxY = 0, count = 0;
    while (stack.length) {
      const idx = stack.pop()!;
      const x = idx % cols;
      const y = (idx - x) / cols;
      count++;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (let dy = -reach; dy <= reach; dy++)
        for (let dx = -reach; dx <= reach; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const n = ny * cols + nx;
          if (ink[n] && label[n] < 0) {
            label[n] = start;
            stack.push(n);
          }
        }
    }
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    if (w < cols * 0.12 || h < rows * 0.05 || count < 25) continue;
    if (w * h > cols * rows * 0.75) continue; // the whole page: noise or a dark scan border
    const touchesEdge = minX <= 0 || minY <= 0 || maxX >= cols - 1 || maxY >= rows - 1;
    if (touchesEdge && (w < cols * 0.1 || h < rows * 0.1)) continue; // scanner edge shadow
    if (count / (w * h) < 0.08) continue; // a sparse scatter of specks
    const rect = trimProse(
      {
        x0: area.x0 + minX * cell,
        y0: area.y0 + minY * cell,
        x1: Math.min(area.x1, area.x0 + (maxX + 1) * cell),
        y1: Math.min(area.y1, area.y0 + (maxY + 1) * cell),
      },
      words,
    );
    if (rect && rect.x1 - rect.x0 >= aw * 0.12 && rect.y1 - rect.y0 >= ah * 0.05) out.push(rect);
  }
  return out;
}

/** Cuts lines of running text off the top and bottom of a picture found on a scan. */
function trimProse(rect: Rect, words: OcrWord[]): Rect | null {
  const r = { ...rect };
  for (let guard = 0; guard < 40; guard++) {
    const lines = new Map<number, OcrWord[]>();
    for (const w of words) {
      if (w.conf < 70 || !/\p{L}{3,}/u.test(w.text)) continue;
      const cy = (w.box.y0 + w.box.y1) / 2;
      const cx = (w.box.x0 + w.box.x1) / 2;
      if (cy < r.y0 || cy > r.y1 || cx < r.x0 || cx > r.x1) continue;
      lines.set(w.line, [...(lines.get(w.line) ?? []), w]);
    }
    const prose = [...lines.values()].filter((ws) => ws.length >= 4);
    if (!prose.length) return r;
    // Remove the prose line nearest to an edge.
    let best: { edge: 'top' | 'bottom'; y: number; dist: number } | null = null;
    for (const ws of prose) {
      const y0 = Math.min(...ws.map((w) => w.box.y0));
      const y1 = Math.max(...ws.map((w) => w.box.y1));
      const dTop = y0 - r.y0;
      const dBottom = r.y1 - y1;
      const cand = dTop <= dBottom ? { edge: 'top' as const, y: y1, dist: dTop } : { edge: 'bottom' as const, y: y0, dist: dBottom };
      if (!best || cand.dist < best.dist) best = cand;
    }
    if (!best) return r;
    if (best.edge === 'top') r.y0 = best.y + 2;
    else r.y1 = best.y - 2;
    if (r.y1 - r.y0 < 10) return null;
  }
  return r;
}

/** Converts OCR words (pixels) into text runs in page points. */
export function wordsToGlyphs(words: OcrWord[], scale: number): Glyph[] {
  // Font size per OCR line from the median ascent (baseline to top of word) of its words, which
  // ignores superscripts and is steadier than the line box height.
  const ascents = new Map<number, number[]>();
  for (const w of words) {
    const asc = w.baseline - w.box.y0;
    if (asc > 0 && /^[\p{L}\p{N}'’.,:;-]+$/u.test(w.text) && /[\p{Lu}\p{N}bdfhklt]/u.test(w.text)) ascents.set(w.line, [...(ascents.get(w.line) ?? []), asc]);
  }
  const lineSize = new Map<number, number>();
  for (const [line, list] of ascents) {
    const sorted = list.sort((a, b) => a - b);
    lineSize.set(line, sorted[sorted.length >> 1] / 0.7 / scale);
  }
  return words.map((w) => ({
    str: w.text,
    x: w.box.x0 / scale,
    y: w.baseline / scale,
    w: (w.box.x1 - w.box.x0) / scale,
    size: Math.max(4, lineSize.get(w.line) ?? (w.lineHeight / scale) * 0.75),
    bold: false,
    italic: false,
    math: false,
  }));
}

/** OCR font sizes jitter from line to line; snap the ones close to the page's body size. */
export function snapOcrSizes<T extends { size: number; text: string }>(lines: T[]): void {
  const weights = new Map<number, number>();
  for (const l of lines) {
    const k = Math.round(l.size * 2) / 2;
    weights.set(k, (weights.get(k) ?? 0) + l.text.length);
  }
  // Body size: the size window (±12%) holding the most text.
  let body = 0;
  let best = -1;
  for (const k of weights.keys()) {
    let w = 0;
    for (const [k2, w2] of weights) if (Math.abs(k2 - k) <= k * 0.12) w += w2;
    if (w > best) {
      best = w;
      body = k;
    }
  }
  if (!body) return;
  for (const l of lines) {
    const r = l.size / body;
    if (r > 0.8 && r < 1.2) l.size = body;
    else if (r <= 0.8) l.size = Math.min(l.size, body * 0.8);
  }
}

/**
 * Builds text lines from OCR output, keeping Tesseract's own line grouping (it already separates
 * columns and copes with slightly skewed scans).
 */
export function ocrLines(words: OcrWord[], scale: number, page: number, pageWidth: number): { lines: Line[]; gutters: number[] } {
  const glyphs = wordsToGlyphs(words, scale);
  const byLine = new Map<number, Glyph[]>();
  words.forEach((w, i) => byLine.set(w.line, [...(byLine.get(w.line) ?? []), glyphs[i]]));
  const lines: Line[] = [];
  const rows: { glyphs: Glyph[]; size: number }[] = [];
  for (const gs of byLine.values()) {
    gs.sort((a, b) => a.x - b.x);
    rows.push({ glyphs: gs, size: gs[0].size });
    // Split a line only at very wide gaps (equation numbers, table cells).
    let seg: Glyph[] = [];
    let right = -Infinity;
    const segs: Glyph[][] = [];
    for (const g of gs) {
      if (seg.length && g.x - right > Math.max(g.size * 3, 12)) {
        segs.push(seg);
        seg = [];
      }
      seg.push(g);
      right = Math.max(right, g.x + g.w);
    }
    if (seg.length) segs.push(seg);
    for (const sg of segs) {
      const l = segmentToLine(sg, page);
      if (l) {
        l.rowSegments = segs.length;
        l.ocr = true;
        // Keep the baseline from Tesseract even when the scan is slightly rotated.
        lines.push(l);
      }
    }
  }
  return { lines, gutters: findGutters(rows, pageWidth).map((g) => g.x) };
}
