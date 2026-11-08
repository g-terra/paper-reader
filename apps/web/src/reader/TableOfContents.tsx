import type { Block, PageRef } from '@paper-reader/pdf-ingest';
import { pageLabel } from './BlocksView';

interface Props {
  blocks: Block[];
  pages: PageRef[];
  current: number;
  onSelect: (index: number) => void;
}

export function TableOfContents({ blocks, pages, current, onSelect }: Props) {
  const items = blocks
    .map((b, i) => ({ b, i }))
    .filter((x): x is { b: Extract<Block, { kind: 'heading' | 'title' }>; i: number } => x.b.kind === 'heading' || x.b.kind === 'title');
  const figures = blocks
    .map((b, i) => ({ b, i }))
    .filter((x): x is { b: Extract<Block, { kind: 'figure' }>; i: number } => x.b.kind === 'figure' && x.b.variant !== 'equation' && !!x.b.caption);
  let active = -1;
  for (const it of items) if (it.i <= current) active = it.i;

  if (!items.length) return <p className="py-6 text-sm text-muted">No sections were found in this paper.</p>;
  return (
    <nav aria-label="Table of contents">
      <ul className="-mx-2">
        {items.map(({ b, i }) => {
          const level = b.kind === 'title' ? 1 : b.level;
          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => onSelect(i)}
                className={`flex w-full items-baseline gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-ink/5 ${active === i ? 'bg-accent/12 text-accent' : ''}`}
                style={{ paddingLeft: 8 + Math.max(0, level - 2) * 16 }}
              >
                <span className={`min-w-0 flex-1 ${level <= 2 ? 'font-serif text-[15px] font-semibold' : 'text-[14px]'}`}>{b.text}</span>
                <span className="shrink-0 text-xs text-muted tabular-nums">{pageLabel(pages, b.page)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {figures.length > 0 && (
        <>
          <div className="mt-5 mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Figures and tables</div>
          <ul className="-mx-2">
            {figures.map(({ b, i }) => (
              <li key={i}>
                <button type="button" onClick={() => onSelect(i)} className="flex w-full items-baseline gap-3 rounded-lg px-2 py-1.5 text-left text-[13.5px] hover:bg-ink/5">
                  <span className="line-clamp-2 min-w-0 flex-1">{b.caption}</span>
                  <span className="shrink-0 text-xs text-muted tabular-nums">{pageLabel(pages, b.page)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </nav>
  );
}
