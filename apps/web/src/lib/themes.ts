export type ThemeId = 'paper' | 'sepia' | 'sage' | 'dusk' | 'night';

export interface ReaderTheme {
  id: ThemeId;
  label: string;
  dark: boolean;
  /** Page background. */
  bg: string;
  /** Slightly different surface for bars, cards and sheets. */
  surface: string;
  fg: string;
  muted: string;
  accent: string;
  border: string;
}

// Low-contrast, warm palettes: easier on the eyes than pure black on pure white.
export const THEMES: Record<ThemeId, ReaderTheme> = {
  paper: { id: 'paper', label: 'Paper', dark: false, bg: '#fbf8f1', surface: '#f4efe4', fg: '#2a2724', muted: '#77706a', accent: '#9a5b2b', border: '#e4dccd' },
  sepia: { id: 'sepia', label: 'Sepia', dark: false, bg: '#f3e7ce', surface: '#eadbbd', fg: '#4f3b24', muted: '#86705a', accent: '#9c4f1f', border: '#dccaa6' },
  sage: { id: 'sage', label: 'Sage', dark: false, bg: '#e4ecdf', surface: '#d8e3d2', fg: '#2b3a2b', muted: '#5f705d', accent: '#3f6b4a', border: '#c6d3c0' },
  dusk: { id: 'dusk', label: 'Dusk', dark: true, bg: '#2b2925', surface: '#35322d', fg: '#ddd5c6', muted: '#a49b8b', accent: '#e0a96d', border: '#45413a' },
  night: { id: 'night', label: 'Night', dark: true, bg: '#0f0f0e', surface: '#1b1a18', fg: '#bdb6a9', muted: '#837d72', accent: '#c99a62', border: '#2a2926' },
};

export const THEME_ORDER: ThemeId[] = ['paper', 'sepia', 'sage', 'dusk', 'night'];
