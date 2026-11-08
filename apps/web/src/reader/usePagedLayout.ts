import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface PagedLayout {
  /** Width of one screen of text (one or two columns), in px. */
  width: number;
  height: number;
  gap: number;
  columns: 1 | 2;
  /** Horizontal distance between two screens. */
  stride: number;
  /** Width of one page (column) of text and the distance between two pages. */
  colW: number;
  colStride: number;
  padX: number;
  padTop: number;
  padBottom: number;
  /** Draw each page as a sheet of paper (tablets and desktops). */
  sheets: boolean;
  sheetPadX: number;
  /** Space between a sheet and the edge of the screen. */
  sheetInset: number;
  numberHeight: number;
}

interface Options {
  enabled: boolean;
  /** Changes to any of these values trigger a re-layout. */
  deps: unknown[];
  spread: boolean;
  margin: 'narrow' | 'normal' | 'wide';
  fontSize: number;
  lineHeight: number;
}

export function computeLayout(
  vw: number,
  vh: number,
  o: Pick<Options, 'spread' | 'margin' | 'fontSize'> & { lineHeight?: number },
): PagedLayout {
  const phone = vw < 640;
  const base = { narrow: 0.6, normal: 1.0, wide: 1.6 }[o.margin];
  let padX = Math.round((phone ? 18 : 40) * base);
  const columns: 1 | 2 = o.spread && vw >= 900 && vw > vh * 1.05 ? 2 : 1;
  let gap = columns === 2 ? Math.max(48, padX * 2) : padX * 2;
  // Keep lines to a comfortable measure (roughly 70 characters).
  const maxMeasure = o.fontSize * 36;
  const measure = (vw - padX * 2 - (columns - 1) * gap) / columns;
  if (measure > maxMeasure) {
    if (columns === 1) {
      padX = Math.floor((vw - maxMeasure) / 2);
      gap = padX * 2;
    } else {
      // Share the spare room between the side margins and the gutter. The gutter must be at least
      // as wide as a side margin (plus room for the page sheet), or the next page would peek in.
      padX = Math.floor((vw - maxMeasure * 2 - 64) / 3);
      gap = padX + 64;
    }
  }
  const width = Math.max(200, vw - padX * 2);
  const colW = (width - (columns - 1) * gap) / columns;

  // On a tablet or desktop each page is drawn as a sheet of paper; on a phone the screen is the page.
  // A sheet must not reach into the screen from the neighbouring pages either.
  const sheetPadX = Math.floor(Math.min(padX - 12, gap / 2 - 10, gap - padX - 8, 44));
  const sheets = !phone && sheetPadX >= 16;
  const OUTSIDE = 16; // space between a sheet and the edge of the screen
  const NUMBER = 26; // room for the page number under the text
  const minTop = sheets ? OUTSIDE + 30 : phone ? 14 : 24;
  const minBottom = sheets ? OUTSIDE + NUMBER + 14 : NUMBER + (phone ? 8 : 14);

  // Make the page a whole number of body lines tall, so the last line on a page is never cut, and
  // share what is left over evenly above and below.
  const line = o.fontSize * (o.lineHeight ?? 1.6);
  const avail = vh - minTop - minBottom;
  const height = Math.max(200, line > 0 ? Math.floor(avail / line) * line : avail);
  const extra = Math.max(0, vh - minTop - minBottom - height);
  const padTop = minTop + Math.floor(extra / 2);
  const padBottom = vh - padTop - height;
  return {
    width,
    height,
    gap,
    columns,
    stride: width + gap,
    colW,
    colStride: colW + gap,
    padX,
    padTop,
    padBottom,
    sheets,
    sheetPadX,
    sheetInset: OUTSIDE,
    numberHeight: NUMBER,
  };
}

/**
 * Lays the content out in CSS columns and turns it into discrete screens ("pages"), like an
 * e-reader. Returns the page count and helpers to map blocks to pages.
 */
export function usePagedLayout(viewport: React.RefObject<HTMLDivElement | null>, content: React.RefObject<HTMLDivElement | null>, o: Options) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [pages, setPages] = useState(1);
  const [bookPages, setBookPages] = useState(1);
  const [version, setVersion] = useState(0);
  const relayoutTimer = useRef<number | undefined>(undefined);

  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewport]);

  const layout = computeLayout(size.w, size.h, o);

  const countPages = useCallback(() => {
    const c = content.current;
    if (!c || !o.enabled) return;
    const sentinel = c.querySelector<HTMLElement>('[data-end]');
    if (!sentinel) return;
    const left = sentinel.getBoundingClientRect().left - c.getBoundingClientRect().left;
    const n = Math.max(1, Math.floor(left / layout.stride + 1e-3) + 1);
    setPages(n);
    setBookPages(Math.max(1, Math.floor(left / layout.colStride + 1e-3) + 1));
    setVersion((v) => v + 1);
  }, [content, layout.stride, layout.colStride, o.enabled]);

  useLayoutEffect(() => {
    countPages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countPages, size.w, size.h, ...o.deps]);

  useEffect(() => {
    let cancelled = false;
    document.fonts?.ready.then(() => !cancelled && countPages());
    return () => {
      cancelled = true;
    };
  }, [countPages]);

  /** Re-count after images finish loading (debounced). */
  const scheduleRelayout = useCallback(() => {
    window.clearTimeout(relayoutTimer.current);
    relayoutTimer.current = window.setTimeout(countPages, 120);
  }, [countPages]);

  const pageOfBlock = useCallback(
    (index: number): number => {
      const c = content.current;
      const el = c?.querySelector<HTMLElement>(`[data-b="${index}"]`);
      if (!c || !el) return 0;
      const rect = el.getClientRects()[0] ?? el.getBoundingClientRect();
      const left = rect.left - c.getBoundingClientRect().left;
      return Math.max(0, Math.floor((left + 2) / layout.stride));
    },
    [content, layout.stride],
  );

  /** First block that starts on, or runs into, the given page. */
  const firstBlockOnPage = useCallback(
    (page: number): number => {
      const c = content.current;
      if (!c) return 0;
      const base = c.getBoundingClientRect().left;
      const els = Array.from(c.querySelectorAll<HTMLElement>('[data-b]'));
      const start = page * layout.stride;
      const end = start + layout.stride;
      // Binary search on the start position, then step back for blocks that run over.
      let lo = 0;
      let hi = els.length - 1;
      let found = els.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const r = els[mid].getClientRects()[0] ?? els[mid].getBoundingClientRect();
        if (r.left - base + 2 >= start) {
          found = mid;
          hi = mid - 1;
        } else lo = mid + 1;
      }
      if (found > 0) {
        const prev = els[found - 1];
        const rects = Array.from(prev.getClientRects());
        if (rects.some((r) => r.left - base + 2 >= start && r.left - base < end)) found -= 1;
      }
      return Number(els[found]?.dataset.b ?? 0);
    },
    [content, layout.stride],
  );

  return { layout, pages, bookPages, version, pageOfBlock, firstBlockOnPage, scheduleRelayout, ready: size.w > 0 };
}
