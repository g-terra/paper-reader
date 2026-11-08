import { memo } from 'react';
import type { Block, PageRef } from '@paper-reader/pdf-ingest';

interface Props {
  blocks: Block[];
  pages: PageRef[];
  images: Map<string, string>;
  bodyFontSize: number;
  showPageMarks: boolean;
  onImageClick: (imageId: string, caption?: string) => void;
  onImageLoad: () => void;
}

export function pageLabel(pages: PageRef[], logical: number): string {
  const ref = pages[logical - 1];
  if (!ref) return String(logical);
  return ref.half ? `${ref.pdfPage}${ref.half === 'left' ? 'a' : 'b'}` : String(ref.pdfPage);
}

/** Renders the reflowed paper. Every block carries data-b=<index> so the reader can locate it. */
export const BlocksView = memo(function BlocksView({ blocks, pages, images, bodyFontSize, showPageMarks, onImageClick, onImageLoad }: Props) {
  const out: React.ReactNode[] = [];
  let lastPage = 0;
  blocks.forEach((b, i) => {
    if (showPageMarks && b.page > lastPage && lastPage > 0) {
      out.push(
        <span key={`m${i}`} className="b-mark" aria-hidden="true">
          {pageLabel(pages, b.page)}
        </span>,
      );
    }
    lastPage = Math.max(lastPage, b.page);
    switch (b.kind) {
      case 'title':
        out.push(
          <h1 key={i} data-b={i} className="b-title">
            {b.text}
          </h1>,
        );
        break;
      case 'heading': {
        const Tag = `h${b.level}` as 'h2' | 'h3' | 'h4';
        out.push(
          <Tag key={i} data-b={i} className="b-heading">
            {b.text}
          </Tag>,
        );
        break;
      }
      case 'paragraph':
        out.push(
          <p key={i} data-b={i} className={`b-p b-${b.role}`}>
            {b.text}
          </p>,
        );
        break;
      case 'figure': {
        const src = images.get(b.imageId);
        if (!src) break;
        const scale = b.variant === 'equation' ? 1 : 1.12;
        const widthEm = (b.width / Math.max(4, bodyFontSize)) * scale;
        out.push(
          <figure key={i} data-b={i} className={`b-figure ${b.variant}`}>
            <img
              src={src}
              alt={b.caption ?? (b.variant === 'equation' ? 'Equation' : 'Figure')}
              loading="eager"
              decoding="async"
              style={{ width: `min(100%, ${widthEm.toFixed(2)}em)`, aspectRatio: `${b.width} / ${b.height}` }}
              onLoad={onImageLoad}
              onClick={b.variant === 'equation' ? undefined : (e) => (e.stopPropagation(), onImageClick(b.imageId, b.caption))}
              draggable={false}
            />
            {b.caption && <figcaption>{b.caption}</figcaption>}
          </figure>,
        );
        break;
      }
    }
  });
  return <>{out}</>;
});
