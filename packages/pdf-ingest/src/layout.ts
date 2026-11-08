import type { Block, BlockRole, Rect } from './types';
import type { Line } from './lines';
import { coverage, expand, height, horizontalOverlap, intersects, median, percentile, union, width } from './geometry';

/** A non-text area on a page that should be shown as a picture (figure, table, equation). */
export interface Region {
  id: string;
  page: number;
  rect: Rect;
  variant: 'figure' | 'table' | 'equation';
  /** True when the region came from drawing operations or embedded images (not from text). */
  graphic: boolean;
}

export interface PageInput {
  page: number;
  width: number;
  height: number;
  lines: Line[];
  /** Candidate graphic areas found on the page (vector drawings, embedded images, table rules). */
  graphics: Rect[];
  /** Column gutters found while building lines. */
  gutters: number[];
  /** Regions decided before layout (e.g. unreadable OCR lines on scans). */
  presetRegions?: Region[];
}

export interface DocumentStats {
  bodySize: number;
  leading: number;
}

export interface LayoutResult {
  blocks: Block[];
  regions: Region[];
  title?: string;
  authors: string[];
  abstract?: string;
  stats: DocumentStats;
}

// ---------------------------------------------------------------------------------------------
// Document-wide statistics

export function documentStats(pages: PageInput[]): DocumentStats {
  const weights = new Map<number, number>();
  for (const p of pages)
    for (const l of p.lines) {
      const k = Math.round(l.size * 2) / 2;
      weights.set(k, (weights.get(k) ?? 0) + l.text.length);
    }
  let bodySize = 10;
  let best = -1;
  for (const [s, w] of weights)
    if (w > best) {
      best = w;
      bodySize = s;
    }

  const deltas: number[] = [];
  for (const p of pages) {
    const body = p.lines
      .filter((l) => Math.abs(l.size - bodySize) < bodySize * 0.08)
      .sort((a, b) => a.baseline - b.baseline);
    for (let i = 1; i < body.length; i++) {
      const a = body[i - 1];
      for (let j = i; j < Math.min(body.length, i + 4); j++) {
        const b = body[j];
        const d = b.baseline - a.baseline;
        if (d < bodySize * 0.9) continue;
        if (d > bodySize * 2.2) break;
        if (horizontalOverlap(a as Rect, b as Rect) > Math.min(width(a as Rect), width(b as Rect)) * 0.5) {
          deltas.push(d);
          break;
        }
      }
    }
  }
  const leading = deltas.length ? median(deltas) : bodySize * 1.2;
  return { bodySize, leading };
}

// ---------------------------------------------------------------------------------------------
// Running headers, footers, page numbers

const PAGE_NUMBER = /^(page\s*)?[-–—]?\s*\d{1,4}\s*[-–—]?(\s*(of|\/)\s*\d{1,4})?$/i;
const ROMAN_PAGE = /^[ivxlc]{1,6}$/i;

function normalizeForRepeat(s: string): string {
  return s.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
}

/** Removes lines that repeat in the page margins (journal names, page numbers, arXiv stamps). */
export function removeRunningElements(pages: PageInput[]): void {
  const counts = new Map<string, number>();
  const marginal = (l: Line, p: PageInput) => l.y1 < p.height * 0.09 || l.y0 > p.height * 0.9;
  for (const p of pages) {
    const seen = new Set<string>();
    for (const l of p.lines) if (marginal(l, p)) seen.add(normalizeForRepeat(l.text));
    for (const k of seen) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const minRepeats = Math.max(2, Math.ceil(pages.length * 0.3));
  // Running headers that echo a title or section name ("69.4 THE EMERGENCE OF ..." at the top of
  // the page holding that section) appear twice; the copy in the top margin is the header.
  const top = (l: Line, p: PageInput) => l.y1 < p.height * 0.09;
  const occurrences = new Map<string, number>();
  for (const p of pages) for (const l of p.lines) {
    const k = normalizeForRepeat(l.text);
    if (k.length >= 8) occurrences.set(k, (occurrences.get(k) ?? 0) + 1);
  }
  const keptOnce = new Set<string>();
  for (const p of pages) {
    p.lines = p.lines.filter((l) => {
      if (!top(l, p)) return true;
      const k = normalizeForRepeat(l.text);
      if ((occurrences.get(k) ?? 0) < 2) return true;
      const nonTop = pages.some((q) => q.lines.some((m) => m !== l && !top(m, q) && normalizeForRepeat(m.text) === k));
      if (nonTop) return false;
      if (keptOnce.has(k)) return false;
      keptOnce.add(k);
      return true;
    });
  }
  for (const p of pages) {
    p.lines = p.lines.filter((l) => {
      if (!marginal(l, p)) return true;
      const t = l.text.trim();
      if (PAGE_NUMBER.test(t) || ROMAN_PAGE.test(t)) return false;
      if (pages.length >= 3 && (counts.get(normalizeForRepeat(t)) ?? 0) >= minRepeats) return false;
      if (/^arXiv:\d{4}\.\d{4,5}/i.test(t)) return false;
      return true;
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Figures

const CAPTION_START = /^(fig(ure)?|table|tab|algorithm|listing|scheme|chart)\.?\s*(s?\d+|[A-Z]\.?\d+|[IVX]+)[a-z]?\s*[.:|—–\-)]/i;

export function isCaptionStart(text: string): boolean {
  return CAPTION_START.test(text.trim());
}

function looksLikeProse(l: Line, stats: DocumentStats): boolean {
  if (Math.abs(l.size - stats.bodySize) > stats.bodySize * 0.08) return false;
  const words = l.text.split(' ').filter((w) => /^[\p{L}]{3,}[,.;:]?$/u.test(w));
  return words.length >= 6;
}

/**
 * Turns raw graphic rectangles into figure regions, and pulls the text that belongs to them (axis
 * labels, legends, table cells) out of the reading flow.
 */
export function findGraphicRegions(page: PageInput, stats: DocumentStats, makeId: () => string): Region[] {
  const { bodySize } = stats;
  const pageArea = page.width * page.height;
  let rects = page.graphics.filter((r) => width(r) >= 30 && height(r) >= 20 && width(r) * height(r) < pageArea * 0.85);

  // Merge overlapping or touching candidates.
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++)
        if (intersects(expand(rects[i], 4), rects[j])) {
          rects[i] = union(rects[i], rects[j]);
          rects.splice(j, 1);
          merged = true;
          break outer;
        }
  }

  const regions: Region[] = [];
  const taken = new Set<Line>();
  for (let rect of rects) {
    // A box that is mostly running prose (e.g. a shaded abstract) stays as text.
    const inside = page.lines.filter((l) => coverage(l as Rect, rect) > 0.6);
    const prose = inside.filter((l) => looksLikeProse(l, stats));
    if (inside.length > 3 && prose.length / inside.length > 0.6 && !inside.some((l) => isCaptionStart(l.text))) continue;

    // Grow the region over nearby small text: tick labels, legends, sub-captions like "(a)".
    let grew = true;
    while (grew) {
      grew = false;
      const near = expand(rect, bodySize * 1.4);
      for (const l of page.lines) {
        if (taken.has(l) || isCaptionStart(l.text)) continue;
        const lr = l as Rect;
        if (!intersects(near, lr)) continue;
        const within = coverage(lr, rect) > 0.5;
        const ocrProse = !!l.ocr && l.text.split(' ').filter((w) => /\p{L}{3,}/u.test(w)).length >= 4;
        const small = l.size < bodySize * 0.93 && !looksLikeProse(l, stats) && !ocrProse;
        const label = l.text.length <= 6 && /^[(\[]?[a-z0-9]{1,3}[)\]]?$/i.test(l.text);
        if (within || small || label) {
          taken.add(l);
          const next = union(rect, lr);
          if (next.x0 !== rect.x0 || next.x1 !== rect.x1 || next.y0 !== rect.y0 || next.y1 !== rect.y1) grew = true;
          rect = next;
        }
      }
    }
    regions.push({ id: makeId(), page: page.page, rect: expand(rect, 2), variant: 'figure', graphic: true });
  }

  page.lines = page.lines.filter((l) => !taken.has(l));
  // Regions may have grown into each other.
  return mergeRegions(regions);
}

function mergeRegions(regions: Region[]): Region[] {
  const out = [...regions];
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++)
        if (intersects(out[i].rect, out[j].rect)) {
          out[i] = { ...out[i], rect: union(out[i].rect, out[j].rect) };
          out.splice(j, 1);
          merged = true;
          break outer;
        }
  }
  return out;
}

/**
 * Tables set as plain text (no rules): several consecutive lines split into three or more cells.
 * They are kept as pictures, because reflowing them as prose scrambles the columns.
 */
export function findTextTables(page: PageInput, stats: DocumentStats): Rect[] {
  const rows = page.lines.filter((l) => (l.cells ?? 1) >= 3 && !isCaptionStart(l.text)).sort((a, b) => a.y0 - b.y0);
  const out: Rect[] = [];
  let group: Line[] = [];
  const flush = () => {
    if (group.length >= 3) {
      let r: Rect = { x0: group[0].x0, y0: group[0].y0, x1: group[0].x1, y1: group[0].y1 };
      for (const l of group) r = union(r, l as Rect);
      // Take in wrapped cell text that sits between the rows.
      for (const l of page.lines) if (coverage(l as Rect, r) > 0.5) r = union(r, l as Rect);
      out.push(r);
    }
    group = [];
  };
  for (const l of rows) {
    const last = group[group.length - 1];
    if (last && (l.y0 - last.y1 > stats.leading * 3 || horizontalOverlap(l as Rect, last as Rect) <= 0)) flush();
    group.push(l);
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------------------------
// Columns and reading order

export interface Columns {
  /** x positions of the gutters between columns. */
  gutters: number[];
  left: number;
  right: number;
}

export function detectColumns(lines: Line[], gutters: number[], pageWidth: number): Columns {
  if (!lines.length) return { gutters: [], left: 0, right: pageWidth };
  const left = percentile(lines.map((l) => l.x0), 0.03);
  const right = percentile(lines.map((l) => l.x1), 0.97);
  return { gutters, left, right };
}

export type FlowItem =
  | { type: 'line'; line: Line; col: number; colLeft: number; colRight: number }
  | { type: 'region'; region: Region; col: number };

function columnOf(r: Rect, cols: Columns): number {
  for (const g of cols.gutters) if (r.x0 < g - 2 && r.x1 > g + 2) return -1; // spans a gutter
  let c = 0;
  for (const g of cols.gutters) if ((r.x0 + r.x1) / 2 > g) c++;
  return c;
}

/** Orders the lines and regions of one page the way a person would read them. */
export function readingOrder(lines: Line[], regions: Region[], cols: Columns): FlowItem[] {
  type Pending = { rect: Rect; col: number; item: FlowItem };
  const all: Pending[] = [];
  const colLines = new Map<number, Line[]>();
  for (const line of lines) {
    const col = columnOf(line as Rect, cols);
    const list = colLines.get(col) ?? [];
    list.push(line);
    colLines.set(col, list);
  }
  const bounds = new Map<number, [number, number]>();
  for (const [col, ls] of colLines) {
    if (ls.length >= 3) bounds.set(col, [percentile(ls.map((l) => l.x0), 0.15), percentile(ls.map((l) => l.x1), 0.85)]);
    else bounds.set(col, [Math.min(...ls.map((l) => l.x0)), Math.max(...ls.map((l) => l.x1))]);
  }
  for (const line of lines) {
    const col = columnOf(line as Rect, cols);
    const [colLeft, colRight] = bounds.get(col) ?? [cols.left, cols.right];
    all.push({ rect: line as Rect, col, item: { type: 'line', line, col, colLeft, colRight } });
  }
  for (const region of regions) {
    const col = columnOf(region.rect, cols);
    all.push({ rect: region.rect, col, item: { type: 'region', region, col } });
  }
  all.sort((a, b) => a.rect.y0 - b.rect.y0 || a.rect.x0 - b.rect.x0);

  const out: FlowItem[] = [];
  let buffer: Pending[] = [];
  const flush = () => {
    buffer.sort((a, b) => a.col - b.col || a.rect.y0 - b.rect.y0 || a.rect.x0 - b.rect.x0);
    out.push(...buffer.map((p) => p.item));
    buffer = [];
  };
  for (const p of all) {
    if (p.col === -1 && cols.gutters.length) {
      flush();
      out.push(p.item);
    } else buffer.push(p);
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------------------------
// Display equations

/** Finds display equations: centred lines made mostly of math. They are shown as images. */
export function findEquations(items: FlowItem[], stats: DocumentStats, page: number, makeId: () => string): FlowItem[] {
  const out: FlowItem[] = [];
  const isEquationLine = (it: FlowItem): it is Extract<FlowItem, { type: 'line' }> => {
    if (it.type !== 'line') return false;
    const { line, colLeft, colRight } = it;
    const t = line.text;
    if (t.length > 160 || isCaptionStart(t)) return false;
    if (/^\(\d+[a-z]?\)$/.test(t)) return true; // equation number standing alone
    const words = t.split(' ').filter((w) => /^\p{L}{4,}[,.;:]?$/u.test(w)).length;
    const indentL = line.x0 - colLeft;
    const indentR = colRight - line.x1;
    const centred = indentL > line.size * 1.5 && indentR > line.size * 0.5;
    if (line.math >= 0.25 && words <= 3 && (centred || line.rowSegments > 1 || line.math >= 0.6)) return true;
    // Numbered display equation set in a text font: "a = b + c    (3)".
    return centred && /[=≤≥≈∝∈]/.test(t) && /\(\d{1,3}[a-z]?\)$/.test(t) && words <= 4;
  };
  let i = 0;
  while (i < items.length) {
    const it = items[i];
    if (!isEquationLine(it) || /^\(\d+[a-z]?\)$/.test(it.line.text)) {
      // An orphan equation number is folded into the neighbouring equation below; otherwise keep the line.
      if (isEquationLine(it) && /^\(\d+[a-z]?\)$/.test(it.line.text)) {
        const prev = out[out.length - 1];
        if (prev?.type === 'region' && prev.region.variant === 'equation' && Math.abs(prev.region.rect.y1 - it.line.y1) < it.line.size * 2) {
          prev.region.rect = union(prev.region.rect, it.line as Rect);
          i++;
          continue;
        }
      }
      out.push(it);
      i++;
      continue;
    }
    let rect: Rect = { x0: it.line.x0, y0: it.line.y0, x1: it.line.x1, y1: it.line.y1 };
    const col = it.col;
    let j = i + 1;
    while (j < items.length) {
      const next = items[j];
      if (!isEquationLine(next)) break;
      if (next.line.y0 - rect.y1 > stats.leading * 0.9) break;
      if (next.col !== col && next.col !== -1 && col !== -1) break;
      rect = union(rect, next.line as Rect);
      j++;
    }
    // Equation numbers are often a separate segment on the same row, already in the flow nearby.
    out.push({
      type: 'region',
      col,
      region: { id: makeId(), page, rect: expand(rect, 2), variant: 'equation', graphic: false },
    });
    i = j;
  }
  // Pull stray equation numbers that sit on the same row as an equation into it.
  return out.filter((it, idx) => {
    if (it.type !== 'line' || !/^\(\d+[a-z]?\)$/.test(it.line.text)) return true;
    for (let k = Math.max(0, idx - 4); k < Math.min(out.length, idx + 4); k++) {
      const o = out[k];
      if (o.type === 'region' && o.region.variant === 'equation' && it.line.baseline > o.region.rect.y0 && it.line.baseline < o.region.rect.y1 + it.line.size) {
        o.region.rect = union(o.region.rect, it.line as Rect);
        return false;
      }
    }
    return true;
  });
}

// ---------------------------------------------------------------------------------------------
// Headings

const SECTION_KEYWORDS =
  /^(abstract|introduction|related work|related works|background|preliminaries|overview|motivation|methods?|methodology|materials and methods|approach|proposed (method|approach)|model|architecture|experiments?|experimental (setup|results|evaluation)|results( and discussion)?|evaluation|analysis|discussion|limitations|conclusions?( and future work)?|summary|future work|acknowledge?ments?|references|bibliography|appendix|appendices|supplementary materials?|keywords|index terms)\b/i;
const NUMBERED = /^(?:(\d{1,2}(?:\.\d{1,2}){0,3})\.?|([IVX]{1,6})\.|([A-H])(?:\.\d{1,2})*\.?)\s+(\S.*)$/;

function fixSmallCaps(text: string): string {
  if (text !== text.toUpperCase()) return text;
  return text.replace(/\b([A-Z]) ([A-Z]{2,})\b/g, '$1$2');
}

interface HeadingInfo {
  level: 2 | 3 | 4;
  text: string;
}

/** Real headings are words: mostly letters, at least one word of three letters, no equations. */
function wordy(text: string): boolean {
  const chars = text.replace(/^(?:\d{1,2}(?:\.\d{1,2})*\.?|[IVX]{1,6}\.)\s+/, '').replace(/\s/g, '');
  const letters = (chars.match(/\p{L}/gu) ?? []).length;
  return letters >= chars.length * 0.65 && /\p{L}{3}/u.test(text) && !/[=\\]/.test(text);
}

function headingInfo(line: Line, stats: DocumentStats, gapBefore: number, afterHeading = false, inFront = false): HeadingInfo | null {
  const text = fixSmallCaps(line.text.trim());
  if (text.length < 2 || text.length > 140 || !/\p{L}/u.test(text)) return null;
  if (/[,;]$/.test(text) || /[-‐]$/.test(text) || isCaptionStart(text)) return null;
  const { bodySize, leading } = stats;
  const bigger = line.size >= bodySize * (line.ocr ? 1.3 : 1.12);
  const bold = line.bold > 0.7;
  const numbered = NUMBERED.exec(text);
  const keyword = SECTION_KEYWORDS.test(numbered ? numbered[4] : text);
  const words = text.split(' ').length;
  const endsLikeSentence = /[.!?]$/.test(text) && !/^(\d+(\.\d+)*\.?|[IVX]+\.)$/.test(text.split(' ')[0] + '.');
  const isolated = gapBefore > leading * 1.25 || afterHeading;

  // Title-page lines (authors, affiliations) are often larger than the body: only real section
  // names count there. OCR sizes are estimates, so OCR'd headings must also look like headings.
  const headingLike = /^[\p{Lu}\d]/u.test(text) && !/[.,;]$/.test(text) && !/[~|_]/.test(text);
  if (!wordy(text) || /^copyright\b/i.test(text) || /^(table|figure|fig\.?)\s*[\dIVX]+\.?$/i.test(text)) return null;
  const sizeOk = bigger && words <= (line.ocr ? 12 : 22) && line.size < bodySize * 3 && headingLike;
  let ok = false;
  if (inFront && !numbered && !keyword) ok = false;
  else if (sizeOk) ok = true;
  else if (bold && (numbered || keyword) && text.length < 100) ok = true;
  else if (bold && words <= 10 && isolated && !endsLikeSentence) ok = true;
  else if (numbered && words <= 9 && /^\p{Lu}/u.test(numbered[4]) && !endsLikeSentence && line.math < 0.2 && (keyword || isolated)) ok = true;
  else if (keyword && /^\p{Lu}/u.test(text) && words <= 5 && !endsLikeSentence && (isolated || text.length < 25)) ok = true;
  if (!ok) return null;

  let level: 2 | 3 | 4 = 3;
  if (numbered?.[1]) {
    const depth = numbered[1].split('.').length;
    level = depth === 1 ? 2 : depth === 2 ? 3 : 4;
  } else if (numbered?.[2]) level = 2;
  else if (numbered?.[3]) level = 3;
  else if (line.size >= bodySize * 1.25 || keyword) level = 2;
  else if (!bigger && bold) level = 4;
  return { level, text };
}

// ---------------------------------------------------------------------------------------------
// Assembling blocks

function joinLines(a: string, b: string): string {
  if (/\p{L}[-‐]$/u.test(a) && /^\p{Ll}/u.test(b)) return a.slice(0, -1) + b;
  if (/[\/–—]$/.test(a)) return a + b;
  return a + ' ' + b;
}

const SENTENCE_END = /[.!?:]["”’')\]]*$/;
const REFERENCE_START = /^(\[\d{1,3}\]|\d{1,3}\.\s+\p{Lu}|\[[A-Z][A-Za-z+]*\d{2,4}[a-z]?\])/u;

interface OpenParagraph {
  /** Number of lines joined so far. */
  lines?: number;
  /** The first line is short and has no closing punctuation (a possible unstyled subheading). */
  headingCandidate?: boolean;
  kind: 'paragraph' | 'heading';
  level: 2 | 3 | 4;
  role: BlockRole;
  text: string;
  page: number;
  last: Extract<FlowItem, { type: 'line' }>;
}

/**
 * Builds the reading blocks from the ordered lines and regions of every page. Paragraphs flow
 * across columns and page breaks when the text clearly continues.
 */
export function assembleBlocks(pages: { page: number; height: number; items: FlowItem[] }[], stats: DocumentStats): {
  blocks: Block[];
  titleText?: string;
} {
  const { bodySize, leading } = stats;
  const blocks: Block[] = [];
  let open: OpenParagraph | null = null;
  let pendingRegions: Region[] = [];
  let section: 'front' | 'abstract' | 'body' | 'references' = 'front';
  let titleText: string | undefined;

  const pushRegion = (r: Region) => {
    blocks.push({
      kind: 'figure',
      imageId: r.id,
      page: r.page,
      width: width(r.rect),
      height: height(r.rect),
      variant: r.variant,
    });
  };
  const close = () => {
    if (open) {
      const text = open.text.trim();
      // Long prose on the title page means the front matter is over (papers without headings).
      if (open.role === 'front' && text.length > 350) {
        open.role = 'body';
        section = 'body';
      }
      if (text) {
        if (open.kind === 'heading') blocks.push({ kind: 'heading', level: open.level, text, page: open.page });
        else blocks.push({ kind: 'paragraph', text, page: open.page, role: open.role });
      }
      open = null;
    }
    for (const r of pendingRegions) pushRegion(r);
    pendingRegions = [];
  };

  // Title: the largest text in the top half of the first page that has text.
  const first = pages.find((p) => p.items.some((i) => i.type === 'line'));
  const titleLines = new Set<Line>();
  if (first) {
    const lines = first.items.filter((i): i is Extract<FlowItem, { type: 'line' }> => i.type === 'line').map((i) => i.line);
    const top = lines.filter((l) => l.y0 < first.height * 0.5 && /\p{L}{2,}/u.test(l.text) && !SECTION_KEYWORDS.test(l.text));
    const maxSize = Math.max(0, ...top.map((l) => l.size));
    if (maxSize >= bodySize * 1.15) {
      const cands = top.filter((l) => l.size >= maxSize * 0.94).sort((a, b) => a.y0 - b.y0);
      // Keep the first contiguous group of title-sized lines.
      let prev: Line | undefined;
      for (const l of cands) {
        if (prev && l.y0 - prev.y1 > maxSize * 1.6) break;
        titleLines.add(l);
        prev = l;
      }
      titleText = [...titleLines].map((l) => l.text).reduce((a, b) => joinLines(a, b), '').trim() || undefined;
      if (titleText) titleText = fixSmallCaps(titleText);
    }
  }
  let titleEmitted = false;

  for (const page of pages) {
    for (const item of page.items) {
      if (item.type === 'region') {
        if (open && open.kind === 'paragraph' && open.role === 'body' && item.region.variant !== 'equation') pendingRegions.push(item.region);
        else {
          close();
          pushRegion(item.region);
        }
        continue;
      }

      const { line } = item;
      if (section === 'front' && first && line.page !== first.page) section = 'body';
      if (titleLines.has(line)) {
        if (!titleEmitted && titleText) {
          close();
          blocks.push({ kind: 'title', text: titleText, page: page.page });
          titleEmitted = true;
        }
        continue;
      }

      const current = open as OpenParagraph | null;
      const prev: Extract<FlowItem, { type: 'line' }> | undefined = current?.last;
      const samePlace: boolean = !!prev && prev.line.page === line.page && prev.col === item.col;
      const gapBefore: number = samePlace && prev ? line.y0 - prev.line.y1 : Infinity;
      let text = line.text;

      // Section changes driven by headings.
      const heading: HeadingInfo | null = section === 'references' && !(line.bold > 0.7 || line.size > bodySize * 1.12) ? null : headingInfo(line, stats, gapBefore, current?.kind === 'heading', section === 'front');
      if (heading) {
        const continuesHeading =
          open?.kind === 'heading' &&
          samePlace &&
          prev &&
          Math.abs(prev.line.size - line.size) < line.size * 0.05 &&
          Math.abs(prev.line.bold - line.bold) < 0.3 &&
          line.baseline - prev.line.baseline < line.size * 1.7 &&
          !NUMBERED.test(heading.text);
        if (continuesHeading && open) {
          open.text = joinLines(open.text, heading.text);
          open.last = item;
          continue;
        }
        close();
        const bare = (NUMBERED.exec(heading.text)?.[4] ?? heading.text).toLowerCase();
        if (/^(references|bibliography)\b/.test(bare)) section = 'references';
        else if (/^abstract\b/.test(bare)) section = 'abstract';
        else if (section !== 'references' || /^append/.test(bare)) section = 'body';
        // "Abstract—We present ..." run-in style: keep the rest as the first abstract paragraph.
        const runIn = /^(abstract|summary)\s*[—–:.-]\s*(.{20,})$/i.exec(heading.text);
        if (runIn) {
          blocks.push({ kind: 'heading', level: 2, text: 'Abstract', page: line.page });
          open = { kind: 'paragraph', level: 2, role: 'abstract', text: runIn[2], page: line.page, last: item };
          section = 'abstract';
          continue;
        }
        open = { kind: 'heading', level: heading.level, role: 'body', text: heading.text, page: line.page, last: item };
        continue;
      }

      const runInAbstract = /^(abstract|summary)\s*[—–:.-]\s*(.*)$/i.exec(text);
      if (runInAbstract && section === 'front') {
        close();
        blocks.push({ kind: 'heading', level: 2, text: 'Abstract', page: line.page });
        section = 'abstract';
        text = runInAbstract[2];
        if (!text) continue;
        open = { kind: 'paragraph', level: 2, role: 'abstract', text, page: line.page, last: item };
        continue;
      }

      const caption = isCaptionStart(text);
      let role: BlockRole =
        section === 'front' ? 'front' : section === 'abstract' ? 'abstract' : section === 'references' ? 'reference' : 'body';
      if (caption) role = 'caption';
      else if (role === 'body' && line.size < bodySize * (line.ocr ? 0.78 : 0.86)) role = 'note';

      let startNew = !open || open.kind === 'heading' || caption;
      if (!startNew && open && prev) {
        const prevLine = prev.line;
        const sizeChange = Math.abs(prevLine.size - line.size) > Math.max(prevLine.size, line.size) * (line.ocr || prevLine.ocr ? 0.25 : 0.12);
        const roleChange = open.role !== role && !(open.role === 'caption' && (role === 'note' || role === 'body')) && !(open.role === 'note' && role === 'body' && !sizeChange);
        if (sizeChange || roleChange) startNew = true;
        else if (role === 'reference') {
          const outdent = line.x0 < prevLine.x0 - line.size * 0.6;
          startNew = REFERENCE_START.test(text) || (samePlace && (outdent || gapBefore > leading * 0.75));
        } else if (samePlace) {
          const delta = line.baseline - prevLine.baseline;
          const indented = line.x0 > item.colLeft + line.size * 0.7 && line.x0 < item.colLeft + line.size * 5;
          const prevShort = prevLine.x1 < prev.colRight - line.size * 2.5;
          if (delta < 0 || delta > Math.max(leading, line.size * 1.1) * 1.45) startNew = true;
          else if (indented && !(open.role === 'front')) startNew = true;
          else if (prevShort && SENTENCE_END.test(prevLine.text)) startNew = true;
          else if (open.role === 'front' && delta > leading * 1.15) startNew = true;
        } else {
          // New column or new page: continue only if the previous line ran to the margin
          // without ending a sentence, and this one is not indented.
          const prevFull = prevLine.x1 > prev.colRight - line.size * 1.5;
          const indented = line.x0 > item.colLeft + line.size * 0.7;
          const continues = (!SENTENCE_END.test(prevLine.text) || prevFull) && !indented && open.role !== 'caption' && open.role !== 'front';
          if (!continues) startNew = true;
        }
      }

      // A one-line "paragraph" that is short, unpunctuated and followed by more text is a subheading
      // set in the body font ("Cognitive and Executive Functioning Benefits").
      const cur = open as OpenParagraph | null;
      if (cur && cur.kind === 'paragraph' && cur.lines === 1 && cur.headingCandidate && cur.role === 'body') {
        cur.kind = 'heading';
        cur.level = cur.last.line.bold > 0.7 || cur.last.line.size > bodySize * 1.05 ? 3 : 4;
        startNew = true;
      }
      if (startNew) {
        close();
        const words = text.split(' ').length;
        const short = line.x1 < item.colRight - line.size * 4 && line.x0 <= item.colLeft + line.size * 0.7;
        const headingCandidate =
          role === 'body' && short && words >= 1 && words <= 12 && /^[\p{Lu}\d]/u.test(text) && !/[.,;:!?)\]]$/.test(text) && !/[=]/.test(text) && line.math < 0.2 && text.length >= 4 && wordy(text) && !/^(table|figure|fig\.?)\s*[\dIVX]+\.?$/i.test(text);
        open = { kind: 'paragraph', level: 2, role, text, page: line.page, last: item, lines: 1, headingCandidate };
      } else if (open) {
        open.text = joinLines(open.text, text);
        open.last = item;
        open.lines = (open.lines ?? 1) + 1;
      }
    }
  }
  close();
  return { blocks: attachCaptions(blocks), titleText };
}

/** Moves captions into the figure they describe. */
function attachCaptions(blocks: Block[]): Block[] {
  const used = new Set<number>();
  for (let i = 0; i < blocks.length; i++) {
    const fig = blocks[i];
    if (fig.kind !== 'figure' || fig.variant === 'equation') continue;
    const isCap = (k: number) => {
      const b = blocks[k];
      return b && !used.has(k) && b.kind === 'paragraph' && b.role === 'caption' && Math.abs(b.page - fig.page) <= 0;
    };
    const after = isCap(i + 1) ? i + 1 : -1;
    const before = isCap(i - 1) ? i - 1 : -1;
    let pick = after >= 0 ? after : before;
    if (after >= 0 && before >= 0) {
      const b = blocks[before] as Extract<Block, { kind: 'paragraph' }>;
      pick = /^tab/i.test(b.text) ? before : after;
    }
    if (pick >= 0) {
      const cap = blocks[pick] as Extract<Block, { kind: 'paragraph' }>;
      fig.caption = cap.text;
      if (/^tab/i.test(cap.text)) fig.variant = 'table';
      used.add(pick);
    }
  }
  return blocks.filter((_, i) => !used.has(i));
}

// ---------------------------------------------------------------------------------------------
// Authors and abstract

const AFFILIATION =
  /universit|institut|department|dept\.|school|college|laborator|\blab\b|research|center|centre|inc\.|corp|ltd|gmbh|google|microsoft|facebook|meta ai|amazon|ibm|nvidia|openai|deepmind|hospital|faculty|academy|street|road|avenue|email|correspond|equal contribution|@|http|www\.|\d{4,}/i;
const NAME = /^\p{Lu}[\p{L}'’.-]*(?:\s+(?:\p{Lu}[\p{L}'’.-]*|van|von|de|da|der|den|del|di|du|la|le|dos|das|bin|al)){1,4}$/u;

function splitNames(text: string): string[] {
  return text
    .replace(/[∗*†‡§¶⋆♣♠♦♥#⇑✉]/g, ',')
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹˒]+/g, ',')
    .replace(/(\p{L})\d+(,\d+)*/gu, '$1,')
    .split(/,|;|\band\b|&|\s{2,}|·|\|/)
    .map((p) => p.replace(/\s+/g, ' ').trim().replace(/^["'“”‘’`]+|["'“”‘’`~´˜]+$/g, '').trim())
    .filter(Boolean);
}

const isName = (p: string) => NAME.test(p) && p.length < 40 && p !== p.toUpperCase() && !SECTION_KEYWORDS.test(p) && !AFFILIATION.test(p);

/** "John R. Anderson Carnegie-Mellon University" -> "John R. Anderson". */
function leadingName(p: string): string | undefined {
  const words = p.split(' ');
  for (let k = 2; k <= Math.min(4, words.length - 1); k++) {
    const cand = words.slice(0, k).join(' ').replace(/[-*∗†‡]+$/, '');
    if (/^\p{Lu}\.?$/u.test(words[k - 1])) continue; // ends in an initial
    if (isName(cand) && AFFILIATION.test(words.slice(k).join(' '))) return cand;
  }
  return undefined;
}

/** Names in a block, or undefined when the block is not mostly names. */
function namesIn(text: string): string[] | undefined {
  const parts = splitNames(text);
  if (!parts.length || text.length > 400) return undefined;
  const names: string[] = [];
  let other = 0;
  for (const p of parts) {
    if (isName(p)) names.push(p);
    else {
      const lead = leadingName(p);
      if (lead) names.push(lead);
      // "R. S. W. Masters* Department of Psychology, York": the rest is the affiliation.
      else if (names.length && AFFILIATION.test(p)) break;
      else other += p.length;
    }
  }
  const nameChars = names.reduce((n, p) => n + p.length, 0);
  return names.length && nameChars >= other ? names : undefined;
}

/**
 * Authors are the lines straight after the title that consist mostly of names. Journal labels
 * ("OPEN ACCESS"), affiliations and editors are skipped. Returns the names and the indexes of
 * the blocks they came from.
 */
export function extractAuthors(blocks: Block[]): string[] {
  return findAuthors(blocks).names;
}

export function findAuthors(blocks: Block[]): { names: string[]; indexes: number[] } {
  const out: string[] = [];
  const indexes: number[] = [];
  const t = blocks.findIndex((b) => b.kind === 'title');
  for (let i = t + 1; i < blocks.length && i <= t + 8; i++) {
    const b = blocks[i];
    if (b.kind === 'figure') continue;
    if (b.kind === 'title') break;
    const usable = (b.kind === 'paragraph' && (b.role === 'front' || b.role === 'note')) || (b.kind === 'heading' && i === t + 1);
    const names = usable ? namesIn(b.text) : undefined;
    if (!names) {
      if (out.length) break;
      if (b.kind === 'heading' || (b.kind === 'paragraph' && b.role !== 'front' && b.role !== 'note')) break;
      continue;
    }
    for (const n of names) if (!out.includes(n)) out.push(n);
    indexes.push(i);
    if (out.length >= 15) break;
  }
  return { names: out, indexes };
}

const FRONT_NOTE = /^(?:[*∗†‡⇑✉]|e-?mail\b|correspondence\b|requests for reprints|pii\b|issn\b|doi\b|https?:|corresponding author|received\b)|©|all rights reserved|\b\d{4}-\d{3}[\dX]\//i;

/** Footnotes printed under the abstract (corresponding author, PII, copyright) are notes. */
export function tidyFrontNotes(blocks: Block[]): void {
  // A title that ends mid-phrase ("... under") continues on the next short front line.
  const t = blocks.findIndex((b) => b.kind === 'title');
  const next = blocks[t + 1];
  if (t >= 0 && next?.kind === 'paragraph' && next.role === 'front' && next.text.split(' ').length <= 8) {
    const title = blocks[t] as Extract<Block, { kind: 'title' }>;
    if (/\b(under|of|the|and|in|for|to|on|with|a|an|from|by|versus|vs\.?|between|during|at|into)$/i.test(title.text) || /^\p{Ll}/u.test(next.text)) {
      title.text = `${title.text} ${next.text}`;
      blocks.splice(t + 1, 1);
    }
  }
  // An abstract that never ended (common on scans) spills into the body.
  let abstractChars = 0;
  for (const b of blocks) {
    if (b.kind !== 'paragraph' || b.role !== 'abstract') continue;
    if (abstractChars > 1800) b.role = 'body';
    abstractChars += b.text.length;
  }
  for (const b of blocks) if (b.kind === 'paragraph' && (b.role === 'abstract' || b.role === 'front') && FRONT_NOTE.test(b.text) && b.text.length < 400) b.role = 'note';
}

export function extractAbstract(blocks: Block[]): string | undefined {
  const parts = blocks.filter((b): b is Extract<Block, { kind: 'paragraph' }> => b.kind === 'paragraph' && b.role === 'abstract').map((b) => b.text);
  if (parts.length) return parts.join(' ').slice(0, 1500);
  const firstBody = blocks.find((b): b is Extract<Block, { kind: 'paragraph' }> => b.kind === 'paragraph' && b.role === 'body' && b.text.length > 200);
  return firstBody?.text.slice(0, 600);
}

const plainNumber = (t: string) => /^\d{1,2}\.?\s/.test(t) && !/^\d+\.\d/.test(t);

/**
 * Document-level heading clean-up: numbered "headings" that follow each other with nothing in
 * between are a list, and a heading repeated four or more times is a table's header row.
 */
export function tidyHeadings(blocks: Block[]): void {
  const toParagraph = (i: number) => {
    const b = blocks[i];
    if (b.kind === 'heading') blocks[i] = { kind: 'paragraph', role: 'body', text: b.text, page: b.page };
  };
  for (let i = 0; i < blocks.length; i++) {
    let j = i;
    while (j < blocks.length && blocks[j].kind === 'heading' && plainNumber((blocks[j] as { text: string }).text)) j++;
    if (j - i >= 2) for (let k = i; k < j; k++) toParagraph(k);
    i = Math.max(i, j - 1);
  }
  const counts = new Map<string, number>();
  for (const b of blocks) if (b.kind === 'heading') counts.set(b.text, (counts.get(b.text) ?? 0) + 1);
  blocks.forEach((b, i) => b.kind === 'heading' && (counts.get(b.text) ?? 0) >= 4 && !SECTION_KEYWORDS.test(b.text) && toParagraph(i));
  // A numbered section ("69.4 ...") appears once; later copies are running headers.
  const seen = new Set<string>();
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind !== 'heading' || !/^\d+\.\d+/.test(b.text)) continue;
    if (seen.has(b.text)) blocks.splice(i--, 1);
    else seen.add(b.text);
  }
}

const DATABASE_NOTICE = /^copyright of .{3,200} is the property of|may not be copied or emailed to multiple sites|download, or email articles for individual use/i;

/** Drops the copyright notice that article databases (EBSCO) append to the last page. */
export function dropDatabaseNotice(blocks: Block[]): Block[] {
  return blocks.filter((b) => !((b.kind === 'paragraph' || b.kind === 'heading') && DATABASE_NOTICE.test(b.text)));
}
