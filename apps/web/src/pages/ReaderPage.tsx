import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppBar, Button, IconButton, Slide, Slider, Toolbar, Tooltip } from '@mui/material';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import TocRounded from '@mui/icons-material/TocRounded';
import TextFieldsRounded from '@mui/icons-material/TextFieldsRounded';
import ChevronLeftRounded from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import ArticleOutlined from '@mui/icons-material/ArticleOutlined';
import type { Block } from '@paper-reader/pdf-ingest';
import { getContent, getPaper, imageUrl, updatePaper, type PaperRecord } from '../lib/db';
import { FONTS, useSettings } from '../lib/settings';
import { BlocksView, pageLabel } from '../reader/BlocksView';
import { usePagedLayout } from '../reader/usePagedLayout';
import { Sheet } from '../components/Sheet';
import { AppearanceControls } from '../components/AppearanceControls';
import { TableOfContents } from '../reader/TableOfContents';
import { FigureDialog } from '../reader/FigureDialog';
import { OriginalPageDialog } from '../reader/OriginalPageDialog';

const WORDS_PER_MINUTE = 230;

interface Loaded {
  paper: PaperRecord;
  blocks: Block[];
  images: Map<string, string>;
}

export function ReaderPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<Loaded | null | undefined>(undefined);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const paper = await getPaper(id);
      const blocks = paper ? await getContent(id) : null;
      if (cancelled) return;
      if (!paper || !blocks) return setData(null);
      const images = new Map<string, string>();
      for (const b of blocks) if (b.kind === 'figure') images.set(b.imageId, imageUrl(id, b.imageId));
      void updatePaper(id, { lastOpenedAt: Date.now() }).catch(() => {});
      setData({ paper, blocks, images });
    })().catch((e) => !cancelled && setError(String((e as Error)?.message ?? e)));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error)
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div>
          <div className="font-serif text-xl font-semibold">Couldn't open this paper</div>
          <div className="mt-2 text-sm text-muted">Is the reader still running on your Mac? ({error})</div>
          <Button sx={{ mt: 2 }} variant="contained" onClick={() => window.location.reload()}>
            Try again
          </Button>
        </div>
      </div>
    );
  if (data === undefined) return <div className="grid h-full place-items-center text-muted">Opening…</div>;
  if (data === null)
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div>
          <div className="font-serif text-xl font-semibold">This paper is not in your library</div>
          <Button sx={{ mt: 2 }} variant="contained" onClick={() => navigate('/')}>
            Back to library
          </Button>
        </div>
      </div>
    );
  return <Reader key={id} {...data} />;
}

function Reader({ paper, blocks, images }: Loaded) {
  const navigate = useNavigate();
  const [settings] = useSettings();
  const paged = settings.mode === 'paged';
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const anchor = useRef(Math.min(paper.position ?? 0, Math.max(0, blocks.length - 1)));
  const [anchorState, setAnchorState] = useState(anchor.current);
  const [page, setPage] = useState(0);
  const [chrome, setChrome] = useState(false);
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [panel, setPanel] = useState<'toc' | 'appearance' | null>(null);
  const [figure, setFigure] = useState<{ src: string; caption?: string } | null>(null);
  const [original, setOriginal] = useState<number | null>(null);
  const [scrollProgress, setScrollProgress] = useState(0);

  const font = FONTS[settings.font];
  const { layout, pages, bookPages, version, pageOfBlock, firstBlockOnPage, scheduleRelayout, ready } = usePagedLayout(viewport, content, {
    enabled: paged,
    spread: settings.spread,
    margin: settings.margin,
    fontSize: settings.fontSize,
    lineHeight: settings.lineHeight,
    deps: [settings.fontSize, settings.lineHeight, settings.font, settings.margin, settings.justify, settings.spread, settings.showPageMarks, settings.showProgress, paged],
  });

  // Words before each block, for the "time left" estimate.
  const wordsBefore = useMemo(() => {
    const acc: number[] = [];
    let n = 0;
    for (const b of blocks) {
      acc.push(n);
      if (b.kind === 'paragraph' || b.kind === 'heading' || b.kind === 'title') n += b.text.split(/\s+/).length;
    }
    acc.push(n);
    return acc;
  }, [blocks]);
  const totalWords = wordsBefore[wordsBefore.length - 1] || 1;

  const setAnchor = useCallback((i: number) => {
    anchor.current = i;
    setAnchorState(i);
  }, []);

  // After any re-layout, go back to the page holding the anchor block.
  useEffect(() => {
    if (!paged || !ready) return;
    setPage(Math.min(pageOfBlock(anchor.current), Math.max(0, pages - 1)));
  }, [version, paged, ready, pageOfBlock, pages]);

  // In scroll mode, restore the anchor once.
  useEffect(() => {
    if (paged) return;
    const el = content.current?.querySelector<HTMLElement>(`[data-b="${anchor.current}"]`);
    if (el && scroller.current) scroller.current.scrollTop = el.offsetTop - 24;
  }, [paged, settings.fontSize, settings.lineHeight, settings.font, settings.margin]);

  const goToPage = useCallback(
    (p: number) => {
      const next = Math.max(0, Math.min(pages - 1, p));
      setPage(next);
      setAnchor(firstBlockOnPage(next));
    },
    [pages, firstBlockOnPage, setAnchor],
  );

  const next = useCallback(() => {
    if (paged) goToPage(page + 1);
    else scroller.current?.scrollBy({ top: scroller.current.clientHeight * 0.88, behavior: 'smooth' });
  }, [paged, page, goToPage]);
  const prev = useCallback(() => {
    if (paged) goToPage(page - 1);
    else scroller.current?.scrollBy({ top: -scroller.current.clientHeight * 0.88, behavior: 'smooth' });
  }, [paged, page, goToPage]);

  const goToBlock = useCallback(
    (i: number) => {
      setAnchor(i);
      setPanel(null);
      const el = content.current?.querySelector<HTMLElement>(`[data-b="${i}"]`);
      if (paged) setPage(pageOfBlock(i));
      else if (el && scroller.current) scroller.current.scrollTo({ top: el.offsetTop - 24, behavior: 'smooth' });
      if (el) {
        el.classList.remove('flash');
        void el.offsetWidth;
        el.classList.add('flash');
      }
    },
    [paged, pageOfBlock, setAnchor],
  );

  // Keyboard: arrows, space, page keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (panel || figure || original !== null) return;
      if (e.target instanceof HTMLInputElement) return;
      if (['ArrowRight', 'PageDown', ' '].includes(e.key) && (paged || e.key !== ' ')) {
        e.preventDefault();
        next();
      } else if (['ArrowLeft', 'PageUp'].includes(e.key)) {
        e.preventDefault();
        prev();
      } else if (e.key === 'Escape') setChrome((c) => !c);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, paged, panel, figure, original]);

  // Save the reading position (debounced).
  const progress = paged ? (pages > 1 ? page / (pages - 1) : 1) : scrollProgress;
  useEffect(() => {
    const t = window.setTimeout(() => {
      void updatePaper(paper.id, { position: anchor.current, progress, lastOpenedAt: Date.now() }).catch(() => {});
    }, 400);
    return () => window.clearTimeout(t);
  }, [paper.id, progress, anchorState]);

  // Swipe to turn pages.
  const pointer = useRef<{ x: number; y: number; t: number; id: number; horizontal?: boolean } | null>(null);
  const suppressClick = useRef(false);
  const onPointerDown = (e: React.PointerEvent) => {
    if (!paged || e.button !== 0) return;
    pointer.current = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = pointer.current;
    if (!p || p.id !== e.pointerId) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (p.horizontal === undefined && Math.hypot(dx, dy) > 10) {
      p.horizontal = Math.abs(dx) > Math.abs(dy) * 1.2 && e.pointerType !== 'mouse';
      if (p.horizontal) setDragging(true);
    }
    if (p.horizontal) {
      // Resist at the first and last page.
      const atEdge = (dx > 0 && page === 0) || (dx < 0 && page === pages - 1);
      setDrag(atEdge ? dx * 0.25 : dx);
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const p = pointer.current;
    pointer.current = null;
    if (!p || !p.horizontal) return;
    suppressClick.current = true;
    const dx = e.clientX - p.x;
    const v = dx / Math.max(1, performance.now() - p.t);
    setDragging(false);
    setDrag(0);
    if (dx < -60 || v < -0.4) next();
    else if (dx > 60 || v > 0.4) prev();
  };

  const onTap = (e: React.MouseEvent) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (window.getSelection()?.toString()) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    if (chrome) {
      setChrome(false);
      return;
    }
    if (paged && x < 0.28) prev();
    else if (paged && x > 0.72) next();
    else setChrome(true);
  };

  const onScroll = () => {
    const s = scroller.current;
    const c = content.current;
    if (!s || !c) return;
    setScrollProgress(s.scrollHeight > s.clientHeight ? s.scrollTop / (s.scrollHeight - s.clientHeight) : 1);
    const els = c.querySelectorAll<HTMLElement>('[data-b]');
    let lo = 0;
    let hi = els.length - 1;
    let found = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (els[mid].offsetTop + els[mid].offsetHeight > s.scrollTop + 8) {
        found = mid;
        hi = mid - 1;
      } else lo = mid + 1;
    }
    const idx = Number(els[found]?.dataset.b ?? 0);
    if (idx !== anchor.current) setAnchor(idx);
  };

  const anchorBlock = blocks[anchorState];
  const origPage = anchorBlock ? anchorBlock.page : 1;
  const minutesLeft = Math.max(0, Math.round((totalWords - (wordsBefore[anchorState] ?? 0)) / WORDS_PER_MINUTE));
  const chapter = useMemo(() => {
    for (let i = anchorState; i >= 0; i--) {
      const b = blocks[i];
      if (b?.kind === 'heading' && b.level === 2) return b.text;
    }
    return '';
  }, [anchorState, blocks]);

  const cssVars = {
    '--reader-font': font.css,
    '--reader-size': `${settings.fontSize}px`,
    '--reader-lh': settings.lineHeight,
    '--reader-align': settings.justify ? 'justify' : 'left',
    '--reader-hyphens': settings.justify ? 'auto' : 'manual',
    '--page-h': `${layout.height}px`,
  } as React.CSSProperties;

  const pageTransform = `translate3d(${-page * layout.stride + drag}px,0,0)`;
  const pageTransition = dragging ? 'none' : 'transform 0.32s cubic-bezier(0.2, 0.7, 0.2, 1)';
  // Sheets and page numbers for the current screen and its neighbours (enough for a swipe).
  const sheetIndexes: number[] = [];
  for (let k = Math.max(0, (page - 1) * layout.columns); k < Math.min(bookPages, (page + 2) * layout.columns); k++) sheetIndexes.push(k);

  const blocksView = (
    <BlocksView
      blocks={blocks}
      pages={paper.pages}
      images={images}
      bodyFontSize={paper.bodyFontSize}
      showPageMarks={settings.showPageMarks}
      onImageClick={(imageId, caption) => {
        const src = images.get(imageId);
        if (src) setFigure({ src, caption });
      }}
      onImageLoad={scheduleRelayout}
    />
  );

  return (
    <div className="fixed inset-0 flex flex-col bg-page" style={cssVars} lang="en">
      {/* Reading area */}
      <div className={`safe-top relative min-h-0 flex-1${settings.showProgress ? '' : ' safe-bottom'}`}>
        {paged ? (
          <div
            ref={viewport}
            className="reader-viewport h-full w-full select-text"
            onClick={onTap}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {layout.sheets && <div className="reader-desk" />}
            <div style={{ position: 'absolute', left: layout.padX, top: layout.padTop, width: layout.width, height: layout.height }}>
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0"
                style={{ transform: pageTransform, transition: pageTransition, visibility: ready ? 'visible' : 'hidden' }}
              >
                {sheetIndexes.map((k) => (
                  <div key={k}>
                    {layout.sheets && (
                      <div
                        className="reader-sheet"
                        style={{
                          left: k * layout.colStride - layout.sheetPadX,
                          top: layout.sheetInset - layout.padTop,
                          width: layout.colW + layout.sheetPadX * 2,
                          height: layout.padTop + layout.height + layout.padBottom - layout.sheetInset * 2,
                        }}
                      />
                    )}
                    <div
                      className="reader-page-number"
                      style={{
                        left: k * layout.colStride,
                        top: layout.height,
                        width: layout.colW,
                        height: layout.padBottom - (layout.sheets ? layout.sheetInset : 0),
                      }}
                    >
                      {k + 1} / {bookPages}
                    </div>
                  </div>
                ))}
              </div>
              <div
                ref={content}
                className="reader-content paged"
                style={{
                  width: layout.width,
                  columnCount: layout.columns,
                  columnGap: layout.gap,
                  transform: pageTransform,
                  transition: pageTransition,
                  visibility: ready ? 'visible' : 'hidden',
                }}
              >
                {blocksView}
                <span data-end="" style={{ display: 'block', height: 1 }} />
              </div>
            </div>
          </div>
        ) : (
          <div ref={scroller} className="h-full overflow-y-auto overscroll-contain" onScroll={onScroll} onClick={onTap}>
            <div ref={viewport} className="mx-auto" style={{ maxWidth: settings.fontSize * 36 + layout.padX * 2, padding: `${layout.padTop + 56}px ${layout.padX}px 120px` }}>
              <div ref={content} className="reader-content">
                {blocksView}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Optional quiet footer. Off by default, so a page shows nothing but its text. */}
      {settings.showProgress && (
        <div className="safe-bottom pointer-events-none flex h-8 shrink-0 items-center justify-between px-5 text-[11.5px] text-muted tabular-nums sm:px-8">
          <span className="truncate pr-3">{chapter || paper.title}</span>
          <span className="shrink-0">
            {minutesLeft > 0 ? `${minutesLeft} min left · ` : ''}
            {Math.round(progress * 100)}%
          </span>
        </div>
      )}

      {/* Top bar */}
      <Slide in={chrome} direction="down">
        <AppBar position="fixed" className="safe-top">
          <Toolbar sx={{ gap: 0.5 }}>
            <Tooltip title="Library">
              <IconButton edge="start" onClick={() => navigate('/')} aria-label="Back to library">
                <ArrowBackRounded />
              </IconButton>
            </Tooltip>
            <div className="min-w-0 flex-1 px-1">
              <div className="truncate font-serif text-[15px] font-semibold">{paper.title}</div>
              {chapter && <div className="truncate text-xs text-muted">{chapter}</div>}
            </div>
            <Tooltip title="Contents">
              <IconButton onClick={() => setPanel('toc')} aria-label="Contents">
                <TocRounded />
              </IconButton>
            </Tooltip>
            <Tooltip title="Original page">
              <IconButton onClick={() => setOriginal(origPage)} aria-label="Show original page">
                <ArticleOutlined />
              </IconButton>
            </Tooltip>
            <Tooltip title="Text and theme">
              <IconButton edge="end" onClick={() => setPanel('appearance')} aria-label="Text and theme">
                <TextFieldsRounded />
              </IconButton>
            </Tooltip>
          </Toolbar>
        </AppBar>
      </Slide>

      {/* Bottom bar */}
      <Slide in={chrome} direction="up">
        <div className="safe-bottom fixed inset-x-0 bottom-0 z-[1100] border-t border-line bg-page/90 backdrop-blur-xl">
          <div className="mx-auto flex max-w-3xl items-center gap-2 px-3 pt-2 pb-3 sm:px-6">
            {paged && (
              <IconButton onClick={prev} disabled={page === 0} aria-label="Previous page">
                <ChevronLeftRounded />
              </IconButton>
            )}
            <div className="min-w-0 flex-1 px-2">
              {paged ? (
                <Slider size="small" min={1} max={Math.max(1, pages)} value={page + 1} onChange={(_, v) => goToPage((v as number) - 1)} aria-label="Page" />
              ) : (
                <Slider
                  size="small"
                  min={0}
                  max={1000}
                  value={Math.round(scrollProgress * 1000)}
                  onChange={(_, v) => {
                    const s = scroller.current;
                    if (s) s.scrollTop = ((v as number) / 1000) * (s.scrollHeight - s.clientHeight);
                  }}
                  aria-label="Position"
                />
              )}
              <div className="-mt-1 flex justify-between text-xs text-muted tabular-nums">
                <span>{paged ? `Page ${page * layout.columns + 1} of ${bookPages}` : `${Math.round(scrollProgress * 100)}%`}</span>
                <span>
                  Original page {pageLabel(paper.pages, origPage)} of {paper.pages[paper.pages.length - 1]?.pdfPage ?? paper.pageCount}
                </span>
              </div>
            </div>
            {paged && (
              <IconButton onClick={next} disabled={page >= pages - 1} aria-label="Next page">
                <ChevronRightRounded />
              </IconButton>
            )}
          </div>
        </div>
      </Slide>

      <Sheet open={panel === 'toc'} onClose={() => setPanel(null)} title="Contents" side="left" width={360}>
        <TableOfContents blocks={blocks} pages={paper.pages} current={anchorState} onSelect={goToBlock} />
      </Sheet>
      <Sheet open={panel === 'appearance'} onClose={() => setPanel(null)} title="Text and theme">
        <AppearanceControls compact />
      </Sheet>
      <FigureDialog figure={figure} onClose={() => setFigure(null)} />
      <OriginalPageDialog paper={paper} page={original} onChange={setOriginal} onClose={() => setOriginal(null)} />
    </div>
  );
}
