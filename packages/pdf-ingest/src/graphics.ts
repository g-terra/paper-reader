import { OPS } from './pdfjs';
import type { Rect } from './types';
import { area, clusterRects, height, multiply, transformRect, width } from './geometry';

interface Mark {
  rect: Rect;
  kind: 'image' | 'path';
}

const FILL_OPS = new Set<number>([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
const STROKE_OPS = new Set<number>([OPS.stroke, OPS.closeStroke]);
const IMAGE_OPS = new Set<number>([
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintImageMaskXObject,
  OPS.paintImageXObjectRepeat,
  OPS.paintSolidColorImageMask,
]);

function isWhite(color: unknown): boolean {
  return typeof color === 'string' && /^#(fff|ffffff)$/i.test(color);
}

export interface GraphicsSummary {
  /** Candidate figure areas, in viewport points (top-left origin). */
  regions: Rect[];
  /** Area share of the page covered by the largest embedded image (scans are close to 1). */
  largestImageShare: number;
  /** Font object ids used per text run are resolved by the caller; this lists image count. */
  imageCount: number;
}

/**
 * Walks a page's drawing operations and returns the areas that hold pictures: embedded images,
 * vector drawings (plots, diagrams) and ruled tables.
 */
export function scanGraphics(fnArray: number[], argsArray: unknown[][], viewportTransform: number[], pageW: number, pageH: number): GraphicsSummary {
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  let fill: unknown = '#000000';
  let stroke: unknown = '#000000';
  const colorStack: unknown[][] = [];
  const marks: Mark[] = [];
  const pageArea = pageW * pageH;
  let largestImageShare = 0;
  let imageCount = 0;
  const toView = (x0: number, y0: number, x1: number, y1: number) => transformRect(multiply(viewportTransform, ctm), x0, y0, x1, y1);

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i] as unknown[];
    switch (fn) {
      case OPS.save:
        stack.push(ctm);
        colorStack.push([fill, stroke]);
        break;
      case OPS.restore:
        ctm = stack.pop() ?? ctm;
        [fill, stroke] = colorStack.pop() ?? [fill, stroke];
        break;
      case OPS.transform:
        ctm = multiply(ctm, args as number[]);
        break;
      case OPS.paintFormXObjectBegin: {
        stack.push(ctm);
        colorStack.push([fill, stroke]);
        const m = args?.[0] as number[] | null;
        if (m && m.length === 6) ctm = multiply(ctm, m);
        break;
      }
      case OPS.paintFormXObjectEnd:
        ctm = stack.pop() ?? ctm;
        [fill, stroke] = colorStack.pop() ?? [fill, stroke];
        break;
      case OPS.setFillRGBColor:
        fill = args?.[0];
        break;
      case OPS.setStrokeRGBColor:
        stroke = args?.[0];
        break;
      case OPS.constructPath: {
        const paintOp = args?.[0] as number;
        const minMax = args?.[2] as ArrayLike<number> | null;
        if (!minMax || minMax.length < 4 || !Number.isFinite(minMax[0])) break;
        const fills = FILL_OPS.has(paintOp);
        const strokes = STROKE_OPS.has(paintOp) || paintOp === OPS.fillStroke || paintOp === OPS.eoFillStroke;
        if (!fills && !strokes) break; // clipping path or no-op
        if (fills && !strokes && isWhite(fill)) break; // white background boxes
        if (strokes && !fills && isWhite(stroke)) break;
        const r = toView(minMax[0], minMax[1], minMax[2], minMax[3]);
        if (area(r) > pageArea * 0.9) break; // page background
        marks.push({ rect: r, kind: 'path' });
        break;
      }
      default:
        if (IMAGE_OPS.has(fn)) {
          const r = toView(0, 0, 1, 1);
          const share = area(r) / pageArea;
          imageCount++;
          largestImageShare = Math.max(largestImageShare, share);
          if (width(r) > 8 && height(r) > 8) marks.push({ rect: r, kind: 'image' });
        }
    }
  }

  const regions: Rect[] = [];
  // Ruled tables (booktabs style): horizontal rules of the same width stacked above each other.
  const rules = marks.filter((m) => m.kind === 'path' && height(m.rect) < 2.5 && width(m.rect) > 60);
  const used = new Set<Mark>();
  for (const r of rules) {
    if (used.has(r)) continue;
    const group = rules.filter(
      (o) => !used.has(o) && Math.abs(o.rect.x0 - r.rect.x0) < 6 && Math.abs(o.rect.x1 - r.rect.x1) < 6 && Math.abs(o.rect.y0 - r.rect.y0) < 450,
    );
    if (group.length >= 2) {
      group.sort((a, b) => a.rect.y0 - b.rect.y0);
      // Split where consecutive rules are very far apart.
      let start = 0;
      for (let k = 1; k <= group.length; k++) {
        if (k === group.length || group[k].rect.y0 - group[k - 1].rect.y0 > 300) {
          const part = group.slice(start, k);
          if (part.length >= 2) {
            part.forEach((p) => used.add(p));
            regions.push({ x0: part[0].rect.x0, y0: part[0].rect.y0, x1: part[0].rect.x1, y1: part[part.length - 1].rect.y1 });
          }
          start = k;
        }
      }
    }
  }

  // Everything else: cluster nearby marks into drawings.
  const rest = marks.filter((m) => !used.has(m));
  for (const cluster of clusterRects(rest, 4)) {
    const rect = cluster.reduce<Rect>(
      (acc, m) => ({ x0: Math.min(acc.x0, m.rect.x0), y0: Math.min(acc.y0, m.rect.y0), x1: Math.max(acc.x1, m.rect.x1), y1: Math.max(acc.y1, m.rect.y1) }),
      { ...cluster[0].rect },
    );
    const hasImage = cluster.some((m) => m.kind === 'image');
    const allThin = cluster.every((m) => height(m.rect) < 2.5 || width(m.rect) < 2.5);
    if (width(rect) < 30 || height(rect) < 20) continue;
    if (!hasImage && cluster.length < 3 && allThin) continue; // a lone rule or underline
    if (!hasImage && cluster.length < 2 && area(rect) < 2500) continue;
    regions.push(rect);
  }
  return { regions, largestImageShare, imageCount };
}
