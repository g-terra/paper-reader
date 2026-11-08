import type { PDFPageProxy } from './pdfjs';
import type { Rect } from './types';

/** iOS Safari refuses canvases above ~16.7M pixels; stay well below. */
export const MAX_CANVAS_PIXELS = 12_000_000;

export function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function releaseCanvas(c: HTMLCanvasElement): void {
  // Safari keeps canvas memory alive until the size is reset.
  c.width = 1;
  c.height = 1;
}

/** Picks a render scale that reaches `targetWidth` pixels without exceeding the pixel budget. */
export function fitScale(page: PDFPageProxy, targetWidth: number, maxPixels = MAX_CANVAS_PIXELS): number {
  const vp = page.getViewport({ scale: 1 });
  let scale = targetWidth / vp.width;
  const pixels = vp.width * vp.height * scale * scale;
  if (pixels > maxPixels) scale *= Math.sqrt(maxPixels / pixels);
  return scale;
}

export async function renderPage(page: PDFPageProxy, scale: number): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  return canvas;
}

export function cropCanvas(source: HTMLCanvasElement, rect: Rect, scale: number): HTMLCanvasElement {
  const x = Math.max(0, Math.floor(rect.x0 * scale));
  const y = Math.max(0, Math.floor(rect.y0 * scale));
  const w = Math.min(source.width - x, Math.ceil((rect.x1 - rect.x0) * scale));
  const h = Math.min(source.height - y, Math.ceil((rect.y1 - rect.y0) * scale));
  const out = createCanvas(Math.max(1, w), Math.max(1, h));
  out.getContext('2d')!.drawImage(source, x, y, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

export function canvasToBlob(c: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), type, quality),
  );
}
