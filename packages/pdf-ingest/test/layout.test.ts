import { describe, expect, it } from 'vitest';
import { buildLines, type Glyph } from '../src/lines';
import { assembleBlocks, detectColumns, documentStats, readingOrder, removeRunningElements, type PageInput } from '../src/layout';

/** Lays out words of a fake page: each entry is [text, x, baseline, size?, bold?]. */
function glyphs(rows: [string, number, number, number?, boolean?][]): Glyph[] {
  const out: Glyph[] = [];
  for (const [text, x0, y, size = 10, bold = false] of rows) {
    let x = x0;
    for (const word of text.split(' ')) {
      const w = word.length * size * 0.5;
      out.push({ str: word, x, y, w, size, bold, italic: false, math: false });
      x += w + size * 0.3;
    }
  }
  return out;
}

const PROSE = 'the model reads every line of the paper and keeps the order intact';

function twoColumnPage(page: number, extra: [string, number, number, number?, boolean?][] = []): PageInput {
  const rows: [string, number, number, number?, boolean?][] = [...extra];
  for (let i = 0; i < 30; i++) {
    rows.push([`left ${i} ${PROSE}`.slice(0, 48), 60, 120 + i * 12]);
    rows.push([`right ${i} ${PROSE}`.slice(0, 48), 320, 120 + i * 12]);
  }
  rows.push([String(page), 300, 770]);
  const { lines, gutters } = buildLines(glyphs(rows), page, 612);
  return { page, width: 612, height: 792, lines, gutters, graphics: [] };
}

describe('columns', () => {
  it('finds the gutter of a two-column page and reads left column first', () => {
    const p = twoColumnPage(1);
    expect(p.gutters.length).toBe(1);
    expect(p.gutters[0]).toBeGreaterThan(290);
    expect(p.gutters[0]).toBeLessThan(320);
    const items = readingOrder(p.lines, [], detectColumns(p.lines, p.gutters, p.width));
    const texts = items.map((i) => (i.type === 'line' ? i.line.text : ''));
    expect(texts.findIndex((t) => t.startsWith('right 0'))).toBeGreaterThan(texts.findIndex((t) => t.startsWith('left 29')));
  });

  it('does not invent a gutter on a single-column page', () => {
    const rows: [string, number, number][] = [];
    for (let i = 0; i < 40; i++) rows.push([`${PROSE} ${PROSE}`.slice(0, 90), 72, 100 + i * 12]);
    const { gutters } = buildLines(glyphs(rows), 1, 612);
    expect(gutters).toEqual([]);
  });
});

describe('running headers and page numbers', () => {
  it('removes repeated headers and page numbers', () => {
    const pages = [1, 2, 3].map((n) => twoColumnPage(n, [['Journal of Synthetic Papers', 60, 40, 8]]));
    removeRunningElements(pages);
    for (const p of pages) {
      expect(p.lines.some((l) => l.text.includes('Journal of Synthetic'))).toBe(false);
      expect(p.lines.some((l) => l.text === String(p.page))).toBe(false);
    }
  });
});

describe('blocks', () => {
  it('finds the title and numbered headings, and joins hyphenated words', () => {
    const rows: [string, number, number, number?, boolean?][] = [
      ['A Study of Reading', 150, 80, 18, true],
      ['1 Introduction', 72, 140, 12, true],
      ['This paragraph talks about the reading experi-', 72, 160],
      ['ence of people who read papers on tablets.', 72, 172],
      ['2 Method', 72, 200, 12, true],
      ['We describe the method here in one line.', 72, 220],
    ];
    const { lines, gutters } = buildLines(glyphs(rows), 1, 612);
    const page: PageInput = { page: 1, width: 612, height: 792, lines, gutters, graphics: [] };
    const stats = documentStats([page]);
    const items = readingOrder(page.lines, [], detectColumns(page.lines, gutters, 612));
    const { blocks, titleText } = assembleBlocks([{ page: 1, height: 792, items }], stats);
    expect(titleText).toBe('A Study of Reading');
    expect(blocks.filter((b) => b.kind === 'heading').map((b) => (b as { text: string }).text)).toEqual(['1 Introduction', '2 Method']);
    const para = blocks.find((b) => b.kind === 'paragraph' && b.text.includes('experience'));
    expect(para).toBeTruthy();
  });
});
