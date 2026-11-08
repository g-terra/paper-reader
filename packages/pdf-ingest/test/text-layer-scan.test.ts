import { describe, expect, it } from 'vitest';
import type { Line } from '../src/lines';
import { captionRegions, type PageInput } from '../src/layout';

const stats = { bodySize: 10, leading: 12 };
const PROSE = 'the students learned how to apply the postulate after many practice problems today';
function line(text: string, x0: number, x1: number, top: number, size = 10): Line {
  return { text, x0, x1, y0: top, y1: top + size, baseline: top + size * 0.8, size, bold: 0, italic: 0, math: 0, page: 1 } as unknown as Line;
}
function page(lines: Line[]): PageInput {
  return { page: 1, width: 500, height: 700, lines, graphics: [], gutters: [255], scanTextLayer: true };
}

describe('scans with a text layer', () => {
  it('crops a table from its caption down to the prose, across both columns', () => {
    const p = page([
      line('Table 1', 40, 70, 60),
      line('A Production System for Performing Addition', 40, 230, 72),
      line('P1. IF the goal is to add', 40, 240, 90, 8),
      line('P8. IF the goal is to iterate', 270, 470, 90, 8),
      line('THEN write the digit', 60, 200, 100, 8),
      line('THEN POP the goal', 290, 400, 100, 8),
      line(PROSE, 40, 245, 140),
      line(PROSE, 265, 470, 140),
    ]);
    captionRegions(p, stats, () => 'img-1');
    expect(p.presetRegions).toHaveLength(1);
    const r = p.presetRegions![0];
    expect(r.variant).toBe('table');
    expect(r.rect.x0).toBeLessThan(45);
    expect(r.rect.x1).toBeGreaterThan(465);
    expect(r.rect.y1).toBeLessThan(140);
    expect(p.lines.map((l) => l.text)).toEqual(['Table 1. A Production System for Performing Addition', PROSE, PROSE]);
  });

  it('ignores "Table 1." when it ends a sentence of running text', () => {
    const p = page([line(PROSE, 40, 245, 100), line('Table 1.', 40, 80, 112), line('THEN say MEN', 40, 120, 124, 8), line('THEN say noun', 40, 120, 134, 8)]);
    captionRegions(p, stats, () => 'img-1');
    expect(p.presetRegions ?? []).toHaveLength(0);
    expect(p.lines).toHaveLength(4);
  });
});
