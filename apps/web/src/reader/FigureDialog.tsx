import { useState } from 'react';
import { Dialog, IconButton } from '@mui/material';
import CloseRounded from '@mui/icons-material/CloseRounded';
import ZoomInRounded from '@mui/icons-material/ZoomInRounded';
import ZoomOutRounded from '@mui/icons-material/ZoomOutRounded';

interface Props {
  figure: { src: string; caption?: string } | null;
  onClose: () => void;
}

/** Full-screen figure viewer with zoom (pinch-zoom also works on touch screens). */
export function FigureDialog({ figure, onClose }: Props) {
  const [zoom, setZoom] = useState(1);
  return (
    <Dialog fullScreen open={!!figure} onClose={onClose} TransitionProps={{ onExited: () => setZoom(1) }}>
      {figure && (
        <div className="flex h-full flex-col bg-page">
          <div className="safe-top flex items-center justify-end gap-1 px-2 py-1">
            <IconButton onClick={() => setZoom((z) => Math.max(1, z - 0.5))} disabled={zoom <= 1} aria-label="Zoom out">
              <ZoomOutRounded />
            </IconButton>
            <IconButton onClick={() => setZoom((z) => Math.min(4, z + 0.5))} aria-label="Zoom in">
              <ZoomInRounded />
            </IconButton>
            <IconButton onClick={onClose} aria-label="Close">
              <CloseRounded />
            </IconButton>
          </div>
          <div className="min-h-0 flex-1 overflow-auto" style={{ touchAction: 'pan-x pan-y pinch-zoom' }} onDoubleClick={() => setZoom((z) => (z > 1 ? 1 : 2))}>
            <div className="flex min-h-full items-center justify-center p-4" style={{ width: `${zoom * 100}%` }}>
              <img src={figure.src} alt={figure.caption ?? 'Figure'} className="max-w-full rounded bg-white shadow-lg" style={{ maxHeight: zoom === 1 ? '100%' : undefined }} />
            </div>
          </div>
          {figure.caption && <div className="safe-bottom mx-auto max-w-3xl px-5 py-4 font-serif text-[14.5px] leading-relaxed text-ink/85">{figure.caption}</div>}
        </div>
      )}
    </Dialog>
  );
}
