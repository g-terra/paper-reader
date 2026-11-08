import { alpha, createTheme } from '@mui/material';
import type { ReaderTheme } from './themes';

export function buildMuiTheme(t: ReaderTheme) {
  return createTheme({
    palette: {
      mode: t.dark ? 'dark' : 'light',
      primary: { main: t.accent },
      secondary: { main: t.muted },
      background: { default: t.bg, paper: t.surface },
      text: { primary: t.fg, secondary: t.muted },
      divider: t.border,
    },
    shape: { borderRadius: 14 },
    typography: {
      fontFamily: "'Inter Variable', system-ui, -apple-system, 'Segoe UI', sans-serif",
      button: { textTransform: 'none', fontWeight: 600 },
      h1: { fontFamily: "'Literata Variable', Georgia, serif" },
      h2: { fontFamily: "'Literata Variable', Georgia, serif" },
      h3: { fontFamily: "'Literata Variable', Georgia, serif" },
      h4: { fontFamily: "'Literata Variable', Georgia, serif", fontWeight: 600 },
      h5: { fontFamily: "'Literata Variable', Georgia, serif", fontWeight: 600 },
      h6: { fontFamily: "'Literata Variable', Georgia, serif", fontWeight: 600 },
    },
    components: {
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundColor: alpha(t.bg, 0.86),
            color: t.fg,
            backdropFilter: 'saturate(1.4) blur(14px)',
            WebkitBackdropFilter: 'saturate(1.4) blur(14px)',
            boxShadow: 'none',
            borderBottom: `1px solid ${t.border}`,
          },
        },
      },
      MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { borderRadius: 999 } } },
      MuiFab: { styleOverrides: { root: { boxShadow: `0 8px 24px ${alpha('#000', t.dark ? 0.5 : 0.18)}` } } },
      MuiDrawer: { styleOverrides: { paper: { backgroundColor: t.surface } } },
      MuiDialog: { styleOverrides: { paper: { backgroundColor: t.bg } } },
      MuiTooltip: { defaultProps: { enterDelay: 500 } },
      MuiToggleButton: { styleOverrides: { root: { textTransform: 'none' } } },
      MuiLinearProgress: { styleOverrides: { root: { borderRadius: 999, backgroundColor: alpha(t.fg, 0.1) } } },
    },
  });
}
