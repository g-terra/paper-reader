import { useCallback, useEffect, useState } from 'react';
import type { ThemeId } from './themes';

export type FontId = 'literata' | 'source-serif' | 'atkinson' | 'inter' | 'system';

export const FONTS: Record<FontId, { label: string; css: string }> = {
  literata: { label: 'Literata', css: "'Literata Variable', Georgia, serif" },
  'source-serif': { label: 'Source Serif', css: "'Source Serif 4 Variable', Georgia, serif" },
  atkinson: { label: 'Atkinson', css: "'Atkinson Hyperlegible', system-ui, sans-serif" },
  inter: { label: 'Inter', css: "'Inter Variable', system-ui, sans-serif" },
  system: { label: 'System', css: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif" },
};

export interface ReaderSettings {
  theme: ThemeId;
  font: FontId;
  /** Base text size in px. */
  fontSize: number;
  lineHeight: number;
  margin: 'narrow' | 'normal' | 'wide';
  justify: boolean;
  mode: 'paged' | 'scroll';
  /** Pages side by side on one screen; 'auto' shows two on wide landscape screens. */
  pagesOnScreen: 'auto' | 1 | 2 | 3;
  /** Old setting, replaced by pagesOnScreen (false meant one page). */
  spread?: boolean;
  /** Invert figures in dark themes so diagrams are not glaring white boxes. */
  invertFigures: boolean;
  showPageMarks: boolean;
  /** Show the chapter and reading progress under the text while reading. */
  showProgress: boolean;
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  theme: 'paper',
  font: 'literata',
  fontSize: 19,
  lineHeight: 1.6,
  margin: 'normal',
  justify: true,
  mode: 'paged',
  pagesOnScreen: 'auto',
  invertFigures: false,
  showPageMarks: true,
  showProgress: false,
};

const KEY = 'paper-reader:settings';
const PAGED_ONCE = 'paper-reader:paged-default-v1';

function load(): ReaderSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ReaderSettings>;
      const saved = { ...DEFAULT_SETTINGS, ...parsed } as ReaderSettings;
      if (parsed.pagesOnScreen === undefined && parsed.spread === false) saved.pagesOnScreen = 1;
      // Pages became the main way to read (sheets, page numbers). Switch every device to it once;
      // Scroll can still be picked again under Text and theme.
      if (!localStorage.getItem(PAGED_ONCE)) {
        saved.mode = 'paged';
        localStorage.setItem(PAGED_ONCE, '1');
        localStorage.setItem(KEY, JSON.stringify(saved));
      }
      return saved;
    }
  } catch {
    // Storage unavailable (private mode): use defaults.
  }
  const s = { ...DEFAULT_SETTINGS };
  if (typeof window !== 'undefined') {
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) s.theme = 'dusk';
    if (window.innerWidth < 640) s.fontSize = 17;
  }
  return s;
}

const listeners = new Set<(s: ReaderSettings) => void>();
let current: ReaderSettings = load();

export function useSettings(): [ReaderSettings, (patch: Partial<ReaderSettings>) => void] {
  const [s, setS] = useState(current);
  useEffect(() => {
    listeners.add(setS);
    return () => {
      listeners.delete(setS);
    };
  }, []);
  const update = useCallback((patch: Partial<ReaderSettings>) => {
    current = { ...current, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(current));
    } catch {
      // Ignore: settings just won't persist.
    }
    listeners.forEach((l) => l(current));
  }, []);
  return [s, update];
}
