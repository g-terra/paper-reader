/** A rectangle in page space: points, origin top-left, y grows downwards. */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type BlockRole =
  | 'body'
  | 'abstract'
  | 'front' // author names, affiliations, emails on the title page
  | 'caption'
  | 'reference'
  | 'note'; // footnotes and other small print

export type Block =
  | { kind: 'title'; text: string; page: number }
  | { kind: 'heading'; level: 2 | 3 | 4; text: string; page: number }
  | { kind: 'paragraph'; text: string; page: number; role: BlockRole }
  | {
      kind: 'figure';
      imageId: string;
      page: number;
      /** Size of the crop on the original page, in points. */
      width: number;
      height: number;
      caption?: string;
      /** Display equations are sized relative to the text, figures fill the column. */
      variant: 'figure' | 'table' | 'equation';
    };

export interface PageRef {
  /** 1-based page number in the PDF file. */
  pdfPage: number;
  /** Set when a scanned two-page spread was split into two logical pages. */
  half?: 'left' | 'right';
  /** True when the text of this page came from OCR. */
  ocr: boolean;
}

export interface ExtractedImage {
  id: string;
  blob: Blob;
  width: number;
  height: number;
}

export interface PaperMeta {
  title: string;
  authors: string[];
  abstract?: string;
  /** Number of logical pages (scanned spreads count as two). */
  pageCount: number;
  pages: PageRef[];
  kind: 'digital' | 'scanned' | 'mixed';
  /** Body text size in points, used to size equations relative to the text. */
  bodyFontSize: number;
}

export interface IngestResult {
  meta: PaperMeta;
  blocks: Block[];
  images: ExtractedImage[];
  cover: Blob;
}

export interface IngestProgress {
  stage: 'opening' | 'reading' | 'ocr' | 'layout' | 'done';
  page?: number;
  pageCount?: number;
  /** 0..1 overall estimate. */
  fraction: number;
  message: string;
}

export interface OcrAssets {
  workerPath?: string;
  corePath?: string;
  langPath?: string;
  /** Language code(s) for OCR, e.g. "eng" or "eng+por". */
  lang?: string;
}

export interface IngestOptions {
  fileName?: string;
  onProgress?: (p: IngestProgress) => void;
  ocr?: OcrAssets;
  /** Force OCR on every page, even if it has a text layer. */
  forceOcr?: boolean;
  signal?: AbortSignal;
}
