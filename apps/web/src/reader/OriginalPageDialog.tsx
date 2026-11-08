import { useEffect, useRef, useState } from 'react';
import { CircularProgress, Dialog, IconButton } from '@mui/material';
import CloseRounded from '@mui/icons-material/CloseRounded';
import ChevronLeftRounded from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import ZoomInRounded from '@mui/icons-material/ZoomInRounded';
import ZoomOutRounded from '@mui/icons-material/ZoomOutRounded';
import { openPdf, renderPdfPage, type PDFDocumentProxy } from '@paper-reader/pdf-ingest';
import { fileUrl, type PaperRecord } from '../lib/db';
import { pageLabel } from './BlocksView';

interface Props {
  paper: PaperRecord;
  /** Logical page to show, or null when closed. */
  page: number | null;
  onChange: (page: number) => void;
  onClose: () => void;
}

/** Shows the page exactly as it is in the PDF, for anything the reflowed text can't capture. */
export function OriginalPageDialog({ paper, page, onChange, onClose }: Props) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [src, setSrc] = useState<string>();
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string>();
  const box = useRef<HTMLDivElement>(null);
  const open = page !== null;

  useEffect(() => {
    if (!open || doc) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(fileUrl(paper.id));
      if (!res.ok) return setError('The original PDF is not stored for this paper.');
      const d = await openPdf(await res.blob());
      if (cancelled) void d.destroy();
      else setDoc(d);
    })().catch((e) => setError(String(e?.message ?? e)));
    return () => {
      cancelled = true;
    };
  }, [open, doc, paper.id]);

  useEffect(() => () => void doc?.destroy(), [doc]);

  useEffect(() => {
    if (!doc || page === null) return;
    let cancelled = false;
    let url: string | undefined;
    setSrc(undefined);
    const ref = paper.pages[page - 1] ?? { pdfPage: page };
    const width = Math.min(2400, (box.current?.clientWidth ?? 900) * Math.min(2.5, window.devicePixelRatio || 1) * 1.4);
    renderPdfPage(doc, ref.pdfPage, width, ref.half)
      .then(
        (canvas) =>
          new Promise<void>((resolve) =>
            canvas.toBlob((b) => {
              canvas.width = canvas.height = 1;
              if (b && !cancelled) {
                url = URL.createObjectURL(b);
                setSrc(url);
              }
              resolve();
            }, 'image/png'),
          ),
      )
      .catch((e) => setError(String(e?.message ?? e)));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [doc, page, paper.pages]);

  const total = paper.pages.length || paper.pageCount;
  return (
    <Dialog fullScreen open={open} onClose={onClose}>
      <div className="flex h-full flex-col bg-surface">
        <div className="safe-top flex items-center gap-1 border-b border-line bg-page px-2 py-1">
          <IconButton onClick={onClose} aria-label="Close">
            <CloseRounded />
          </IconButton>
          <div className="flex-1 text-center text-sm font-medium tabular-nums">
            Original page {page !== null ? pageLabel(paper.pages, page) : ''} <span className="text-muted">of {paper.pages[total - 1]?.pdfPage ?? total}</span>
          </div>
          <IconButton onClick={() => setZoom((z) => Math.max(1, z - 0.5))} disabled={zoom <= 1} aria-label="Zoom out">
            <ZoomOutRounded />
          </IconButton>
          <IconButton onClick={() => setZoom((z) => Math.min(3, z + 0.5))} aria-label="Zoom in">
            <ZoomInRounded />
          </IconButton>
        </div>
        <div ref={box} className="relative min-h-0 flex-1 overflow-auto" style={{ touchAction: 'pan-x pan-y pinch-zoom' }}>
          {error ? (
            <div className="p-8 text-center text-muted">{error}</div>
          ) : src ? (
            <div className="mx-auto p-3 sm:p-6" style={{ width: `${zoom * 100}%`, maxWidth: zoom === 1 ? 980 : undefined }}>
              <img src={src} alt={`Page ${page}`} className="w-full rounded-sm bg-white shadow-xl [.dark-theme_&]:brightness-[0.85]" />
            </div>
          ) : (
            <div className="grid h-full place-items-center">
              <CircularProgress size={28} />
            </div>
          )}
        </div>
        <div className="safe-bottom flex items-center justify-center gap-6 border-t border-line bg-page py-1.5">
          <IconButton disabled={!page || page <= 1} onClick={() => page && onChange(page - 1)} aria-label="Previous page">
            <ChevronLeftRounded />
          </IconButton>
          <IconButton disabled={!page || page >= total} onClick={() => page && onChange(page + 1)} aria-label="Next page">
            <ChevronRightRounded />
          </IconButton>
        </div>
      </div>
    </Dialog>
  );
}
