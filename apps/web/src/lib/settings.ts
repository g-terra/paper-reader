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
  /** Show two pages side by side on wide screens (iPad landscape, desktop). */
  spread: boolean;
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
  spread: true,
  invertFigures: false,
  showPageMarks: true,
  showProgress: false,
};

const KEY = 'paper-reader:settings';

function load(): ReaderSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
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
