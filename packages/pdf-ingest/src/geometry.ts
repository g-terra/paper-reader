import type { Rect } from './types';

export const width = (r: Rect) => r.x1 - r.x0;
export const height = (r: Rect) => r.y1 - r.y0;
export const area = (r: Rect) => Math.max(0, width(r)) * Math.max(0, height(r));

export function union(a: Rect, b: Rect): Rect {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

export function expand(r: Rect, by: number): Rect {
  return { x0: r.x0 - by, y0: r.y0 - by, x1: r.x1 + by, y1: r.y1 + by };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
}

export function intersection(a: Rect, b: Rect): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Share of `inner` that lies inside `outer`. */
export function coverage(inner: Rect, outer: Rect): number {
  const a = area(inner);
  return a > 0 ? intersection(inner, outer) / a : 0;
}

export function horizontalOverlap(a: Rect, b: Rect): number {
  return Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
}

/** Applies a PDF affine matrix [a b c d e f] to a point. */
export function applyMatrix(m: number[], x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Multiplies two PDF matrices: the result applies `m2` first, then `m1`. */
export function multiply(m1: number[], m2: number[]): number[] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

/** Axis-aligned bounds of a rectangle after transformation by `m`. */
export function transformRect(m: number[], x0: number, y0: number, x1: number, y1: number): Rect {
  const pts = [applyMatrix(m, x0, y0), applyMatrix(m, x1, y0), applyMatrix(m, x0, y1), applyMatrix(m, x1, y1)];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))];
}

/** Groups rectangles that touch (after expanding by `gap`) into clusters. */
export function clusterRects<T extends { rect: Rect }>(items: T[], gap: number): T[][] {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const order = items.map((_, i) => i).sort((a, b) => items[a].rect.x0 - items[b].rect.x0);
  // Sweep along x so that this stays fast on pages with thousands of path segments.
  for (let oi = 0; oi < order.length; oi++) {
    const i = order[oi];
    const a = expand(items[i].rect, gap);
    for (let oj = oi + 1; oj < order.length; oj++) {
      const j = order[oj];
      if (items[j].rect.x0 > a.x1) break;
      if (intersects(a, items[j].rect)) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, T[]>();
  items.forEach((it, i) => {
    const root = find(i);
    const g = groups.get(root);
    if (g) g.push(it);
    else groups.set(root, [it]);
  });
  return [...groups.values()];
}
