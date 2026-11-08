import { median } from './geometry';

/** A run of text as extracted from the PDF text layer or from OCR. */
export interface Glyph {
  str: string;
  /** Left edge, in points. */
  x: number;
  /** Baseline, in points from the top of the page. */
  y: number;
  /** Advance width, in points. */
  w: number;
  /** Font size, in points. */
  size: number;
  bold: boolean;
  italic: boolean;
  math: boolean;
}

/** A visual line of text inside one column. */
export interface Line {
  text: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  baseline: number;
  size: number;
  /** Share of characters set in a bold face. */
  bold: number;
  /** Share of characters set in a math font or made of math symbols. */
  math: number;
  page: number;
  /** Number of separate segments found on the same visual row (tables, equations with numbers). */
  rowSegments: number;
  /** Number of cells in the line when it is split by wide gaps (table rows have several). */
  cells?: number;
  /** True for lines read with OCR, whose font sizes are only estimates. */
  ocr?: boolean;
}

const LIGATURES: Record<string, string> = {
  'ﬀ': 'ff',
  'ﬁ': 'fi',
  'ﬂ': 'fl',
  'ﬃ': 'ffi',
  'ﬄ': 'ffl',
  'ﬅ': 'st',
  'ﬆ': 'st',
};

const COMBINING: Record<string, string> = { '´': '\u0301', '`': '\u0300', '˜': '\u0303', '¨': '\u0308', 'ˆ': '\u0302', '¸': '\u0327', 'ˇ': '\u030C', '˚': '\u030A' };

/** TeX papers draw accents as separate glyphs before the letter ("Cl´audio", "S˜ao"). */
export function composeAccents(s: string): string {
  // A backtick only counts inside a word, so TeX quotes (``like this'') survive.
  return s.replace(/([´˜¨ˆ¸ˇ˚]|(?<=\p{L})`) ?(\p{L})/gu, (m, a: string, l: string) => {
    const c = ((l === 'ı' ? 'i' : l) + COMBINING[a]).normalize('NFC');
    return c.length === 1 ? c : m;
  });
}

export function cleanText(s: string): string {
  return s
    .replace(/[ﬀ-ﬆ]/g, (c) => LIGATURES[c] ?? c)
    .replace(/­/g, '')
    .replace(/[\u0000-\u0008\u000B-\u001F]/g, '')
    .replace(/\s+/g, ' ');
}

const MATH_CHARS = /[=+−±×÷∀-⋿←-⇿Α-ω′″∞∑∏∫<>|^_{}]/;

function mathShare(text: string): number {
  let n = 0;
  let m = 0;
  for (const ch of text) {
    if (ch === ' ') continue;
    n++;
    if (MATH_CHARS.test(ch)) m++;
  }
  return n ? m / n : 0;
}

interface Row {
  top: number;
  bottom: number;
  size: number;
  glyphs: Glyph[];
}

/**
 * Finds the gutters between text columns: vertical bands that are empty on most rows while
 * the rows on both sides hold text. Works on word positions, so wide justified spacing inside
 * a column does not look like a gutter.
 */
export interface Gutter {
  x: number;
  width: number;
}

type GutterRow = { glyphs: Glyph[]; size: number };

/**
 * Column gutters for the page. Looks at the whole page and at bands of consecutive rows, so a
 * two-column section below a long full-width title block or abstract is still found.
 */
export function findGutters(rows: GutterRow[], pageWidth: number): Gutter[] {
  const cands: { x: number; width: number; support: number }[] = [];
  for (const g of findGuttersIn(rows, pageWidth, false)) cands.push({ ...g, support: 3 });
  const sorted = [...rows].sort((a, b) => a.glyphs[0].y - b.glyphs[0].y);
  for (let start = 0; start + 8 <= sorted.length; start += 7) {
    for (const g of findGuttersIn(sorted.slice(start, start + 14), pageWidth, true)) cands.push({ ...g, support: 1 });
  }
  const clusters: { xs: number[]; width: number; support: number }[] = [];
  for (const c of cands.sort((a, b) => a.x - b.x)) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(c.x - last.xs[last.xs.length - 1]) < 12) {
      last.xs.push(c.x);
      last.width = Math.min(last.width, c.width);
      last.support += c.support;
    } else clusters.push({ xs: [c.x], width: c.width, support: c.support });
  }
  return clusters
    .filter((c) => c.support >= 2)
    .sort((a, b) => b.support - a.support)
    .slice(0, 2)
    .map((c) => ({ x: c.xs[c.xs.length >> 1], width: c.width }))
    .sort((a, b) => a.x - b.x);
}

function findGuttersIn(rows: GutterRow[], pageWidth: number, local: boolean): Gutter[] {
  if (rows.length < (local ? 8 : 12)) return [];
  const bins = Math.ceil(pageWidth) + 2;
  const cover = new Uint16Array(bins);
  const minXs: number[] = [];
  const maxXs: number[] = [];
  for (const r of rows) {
    const pad = r.size * 0.15;
    const mark = new Uint8Array(bins);
    let mn = Infinity;
    let mx = -Infinity;
    for (const g of r.glyphs) {
      const a = Math.max(0, Math.floor(g.x - pad));
      const b = Math.min(bins - 1, Math.ceil(g.x + g.w + pad));
      for (let x = a; x <= b; x++) mark[x] = 1;
      mn = Math.min(mn, g.x);
      mx = Math.max(mx, g.x + g.w);
    }
    for (let x = 0; x < bins; x++) cover[x] += mark[x];
    minXs.push(mn);
    maxXs.push(mx);
  }
  const sortedMin = [...minXs].sort((a, b) => a - b);
  const sortedMax = [...maxXs].sort((a, b) => a - b);
  const left = sortedMin[Math.floor(sortedMin.length * 0.03)];
  const right = sortedMax[Math.ceil(sortedMax.length * 0.97) - 1];
  const extent = right - left;
  if (extent < 150) return [];
  const inside: number[] = [];
  for (let x = Math.floor(left); x <= Math.ceil(right); x++) inside.push(cover[x] ?? 0);
  inside.sort((a, b) => a - b);
  const ref = inside[Math.floor(inside.length * 0.8)] || 0;
  if (ref < (local ? 4 : 8)) return [];

  const from = Math.floor(left + extent * 0.22);
  const to = Math.ceil(right - extent * 0.22);
  const found: { x: number; depth: number; width: number }[] = [];
  let runStart = -1;
  let runMin = Infinity;
  for (let x = from; x <= to + 1; x++) {
    const low = x <= to && cover[x] <= ref * 0.3;
    if (low) {
      if (runStart < 0) runStart = x;
      runMin = Math.min(runMin, cover[x]);
    } else if (runStart >= 0) {
      // Inside a low band (which may include a sparse column), the gutter is the widest
      // stretch that sits at the band's minimum.
      const limit = runMin + Math.max(1, ref * 0.05);
      let best: { a: number; b: number } | null = null;
      let a = -1;
      for (let k = runStart; k <= x; k++) {
        const ok = k < x && cover[k] <= limit;
        if (ok && a < 0) a = k;
        if (!ok && a >= 0) {
          if (!best || k - 1 - a > best.b - best.a) best = { a, b: k - 1 };
          a = -1;
        }
      }
      if (best && best.b - best.a + 1 >= 5) found.push({ x: (best.a + best.b) / 2, depth: runMin, width: best.b - best.a + 1 });
      runStart = -1;
      runMin = Infinity;
    }
  }
  const gutters: Gutter[] = [];
  for (const cand of found.sort((a, b) => a.depth - b.depth)) {
    const x = cand.x;
    let leftRows = 0;
    let rightRows = 0;
    for (const r of rows) {
      if (r.glyphs.some((g) => g.x < x && g.x + g.w > x)) continue;
      if (r.glyphs.some((g) => g.x + g.w <= x && g.x + g.w > x - 70)) leftRows++;
      if (r.glyphs.some((g) => g.x >= x && g.x < x + 70)) rightRows++;
    }
    const need = local ? Math.max(4, rows.length * 0.3) : Math.max(5, rows.length * 0.08);
    if (leftRows < need || rightRows < need) continue;
    if (gutters.some((g) => Math.abs(g.x - x) < extent * 0.2)) continue;
    gutters.push({ x, width: cand.width });
    if (gutters.length === 2) break;
  }
  return gutters.sort((a, b) => a.x - b.x);
}

/**
 * Groups text runs into visual lines. Rows are split at column gutters and at very wide gaps
 * (table cells, equation numbers).
 */
export function buildLines(input: Glyph[], page: number, pageWidth = 1000): { lines: Line[]; gutters: number[] } {
  const glyphs = input
    .filter((g) => g.str.trim().length > 0 && g.size > 1)
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const rows: Row[] = [];
  for (const g of glyphs) {
    const top = g.y - g.size * 0.8;
    const bottom = g.y + g.size * 0.2;
    let best: Row | undefined;
    let bestRatio = 0;
    for (let i = rows.length - 1; i >= 0 && i >= rows.length - 8; i--) {
      const r = rows[i];
      const ov = Math.min(bottom, r.bottom) - Math.max(top, r.top);
      const ratio = ov / Math.min(bottom - top, r.bottom - r.top);
      if (ratio > 0.5 && ratio > bestRatio) {
        best = r;
        bestRatio = ratio;
      }
    }
    if (best) {
      best.glyphs.push(g);
      if (g.size > best.size * 1.05) {
        best.size = g.size;
        best.top = top;
        best.bottom = bottom;
      }
    } else {
      rows.push({ top, bottom, size: g.size, glyphs: [g] });
    }
  }

  const gutters = findGutters(rows, pageWidth);
  const lines: Line[] = [];
  for (const row of rows) {
    const gs = row.glyphs.sort((a, b) => a.x - b.x);
    const segments: Glyph[][] = [];
    let current: Glyph[] = [];
    let rightEdge = -Infinity;
    for (const g of gs) {
      const gap = g.x - rightEdge;
      // Only a gap as wide as the gutter splits the row there (a justified word space may straddle it).
      const atGutter = gutters.some((gt) => rightEdge <= gt.x + 1 && g.x >= gt.x - 1 && gap >= Math.max(gt.width * 0.6, row.size * 0.8));
      const wide = gap > Math.max(row.size * 3, 12);
      if (current.length && (atGutter || wide)) {
        segments.push(current);
        current = [];
      }
      current.push(g);
      rightEdge = Math.max(rightEdge, g.x + g.w);
    }
    if (current.length) segments.push(current);
    for (const seg of segments) {
      const line = segmentToLine(seg, page);
      if (line) {
        line.rowSegments = segments.length;
        line.cells = countCells(seg, row.size);
        lines.push(line);
      }
    }
  }
  return { lines, gutters: gutters.map((g) => g.x) };
}
/** Counts the cells of a line separated by gaps much wider than a word space. */
export function countCells(seg: Glyph[], size: number): number {
  let cells = 1;
  let right = -Infinity;
  for (const g of seg) {
    if (right > -Infinity && g.x - right > Math.max(size * 1.5, 8)) cells++;
    right = Math.max(right, g.x + g.w);
  }
  return cells;
}

const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', ',': '˒', '–': '⁻',
};

/** Superscript digits become Unicode superscripts; affiliation letters (ᵃ, ABD) are dropped. */
function superscript(s: string): string {
  const t = s.trim();
  if (/^[\d+\-−=(),–\s]+$/.test(t)) return [...t].map((c) => SUPERSCRIPT[c] ?? '').join('');
  if (/^[*†‡§¶#∗⋆]+$/.test(t)) return t;
  // Affiliation markers: "a", "a,b", "a,*", "1ABD", "c,d". Letters go; digits and symbols stay.
  if (/^(?:[A-Z]{1,5}|[a-z]{1,2}|\d{1,2}[A-Z]{0,5})(?:[,\s]*(?:[A-Z]{1,5}|[a-z]{1,2}|\d{1,2}|[*†‡§¶#∗⋆⇑]))*[,*]?$/.test(t)) {
    const kept = t.replace(/[A-Za-z]/g, '').replace(/^[,\s]+|[,\s]+$/g, '').replace(/,(?=[*†‡§¶#∗⋆⇑])|(?<=[*†‡§¶#∗⋆⇑]),/g, '');
    return [...kept].map((c) => SUPERSCRIPT[c] ?? c).join('');
  }
  return s;
}

export function segmentToLine(seg: Glyph[], page: number): Line | null {
  // Dominant size and baseline first, to recognise superscripts.
  const weights0 = new Map<number, number>();
  for (const g of seg) {
    const k = Math.round(g.size * 2) / 2;
    weights0.set(k, (weights0.get(k) ?? 0) + g.str.trim().length);
  }
  let mainSize = 0;
  let w0 = -1;
  for (const [k, w] of weights0) if (w > w0 || (w === w0 && k > mainSize)) (mainSize = k), (w0 = w);
  const mainBase = median(seg.filter((g) => Math.abs(g.size - mainSize) < mainSize * 0.15).map((g) => g.y));
  let text = '';
  let prev: Glyph | undefined;
  let chars = 0;
  let boldChars = 0;
  let mathChars = 0;
  const sizeWeights = new Map<number, number>();
  for (const g of seg) {
    const sup = g.size < mainSize * 0.8 && mainBase - g.y > mainSize * 0.18 && seg.length > 1;
    const s = sup ? superscript(cleanText(g.str)) : cleanText(g.str);
    if (sup && !s) continue;
    if (prev) {
      // Fake bold: the same run drawn twice at almost the same spot.
      if (s === cleanText(prev.str) && Math.abs(g.x - prev.x) < 1.5) continue;
      const gap = g.x - (prev.x + prev.w);
      const size = Math.min(g.size, prev.size);
      if (!sup && gap > size * 0.12 && !text.endsWith(' ') && !s.startsWith(' ')) text += ' ';
    }
    text += s;
    const n = s.replace(/\s/g, '').length;
    chars += n;
    if (g.bold) boldChars += n;
    if (g.math) mathChars += n;
    const key = Math.round(g.size * 2) / 2;
    sizeWeights.set(key, (sizeWeights.get(key) ?? 0) + n);
    prev = g;
  }
  text = composeAccents(text.replace(/\s+/g, ' ').trim());
  if (!text) return null;
  let size = 0;
  let bestWeight = -1;
  for (const [s, w] of sizeWeights) {
    if (w > bestWeight || (w === bestWeight && s > size)) {
      size = s;
      bestWeight = w;
    }
  }
  const x0 = Math.min(...seg.map((g) => g.x));
  const x1 = Math.max(...seg.map((g) => g.x + g.w));
  const main = seg.filter((g) => Math.abs(g.size - size) < size * 0.15);
  const baseline = median((main.length ? main : seg).map((g) => g.y));
  return {
    text,
    x0,
    x1,
    y0: baseline - size * 0.8,
    y1: baseline + size * 0.22,
    baseline,
    size,
    bold: chars ? boldChars / chars : 0,
    math: Math.max(chars ? mathChars / chars : 0, mathShare(text)),
    page,
    rowSegments: 1,
  };
}
