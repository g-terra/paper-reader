import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from './pdfjs';
import { fitScale, renderPage } from './canvas';

export interface PdfAssets {
  /** Folder holding pdf.js standard fonts (for PDFs that do not embed Times, Helvetica, ...). */
  standardFontDataUrl?: string;
  /** Folder holding pdf.js character maps (needed for some CJK fonts). */
  cMapUrl?: string;
}

export const pdfAssets: PdfAssets = {};

export function configurePdfWorker(workerSrc: string, assets: PdfAssets = {}): void {
  GlobalWorkerOptions.workerSrc = workerSrc;
  Object.assign(pdfAssets, assets);
}

export function documentParams() {
  return {
    isEvalSupported: false,
    standardFontDataUrl: pdfAssets.standardFontDataUrl,
    cMapUrl: pdfAssets.cMapUrl,
    cMapPacked: true,
  };
}

export async function openPdf(data: Blob | ArrayBuffer): Promise<PDFDocumentProxy> {
  const buf = data instanceof Blob ? await data.arrayBuffer() : data.slice(0);
  return getDocument({ data: new Uint8Array(buf), ...documentParams() }).promise;
}

/**
 * Renders one page of the original PDF for the "original page" view. For split scans, `half`
 * crops to the left or right page of the spread.
 */
export async function renderPdfPage(
  doc: PDFDocumentProxy,
  pageNumber: number,
  targetWidth: number,
  half?: 'left' | 'right',
): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageNumber);
  const scale = fitScale(page, half ? targetWidth * 2 : targetWidth);
  const canvas = await renderPage(page, scale);
  if (!half) return canvas;
  const w = Math.floor(canvas.width / 2);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = canvas.height;
  out.getContext('2d')!.drawImage(canvas, half === 'left' ? 0 : canvas.width - w, 0, w, canvas.height, 0, 0, w, canvas.height);
  canvas.width = 1;
  canvas.height = 1;
  return out;
}

export type { PDFDocumentProxy };
