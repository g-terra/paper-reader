import { useEffect, useMemo } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { CssBaseline, GlobalStyles, StyledEngineProvider, ThemeProvider } from '@mui/material';
import { buildMuiTheme } from './lib/muiTheme';
import { THEMES } from './lib/themes';
import { useSettings } from './lib/settings';
import { LibraryPage } from './pages/LibraryPage';
import { ReaderPage } from './pages/ReaderPage';
import { ImportTray } from './components/ImportTray';

export function App() {
  const [settings] = useSettings();
  const theme = THEMES[settings.theme];
  const muiTheme = useMemo(() => buildMuiTheme(theme), [theme]);

  // Expose the palette as CSS variables so Tailwind utilities and the reader CSS share it.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--r-bg', theme.bg);
    root.style.setProperty('--r-surface', theme.surface);
    root.style.setProperty('--r-fg', theme.fg);
    root.style.setProperty('--r-muted', theme.muted);
    root.style.setProperty('--r-accent', theme.accent);
    root.style.setProperty('--r-border', theme.border);
    root.classList.toggle('dark-theme', theme.dark);
    root.classList.toggle('light-theme', !theme.dark);
    root.classList.toggle('invert-figures', settings.invertFigures);
    root.style.colorScheme = theme.dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.bg);
  }, [theme, settings.invertFigures]);

  return (
    <StyledEngineProvider enableCssLayer>
      {/* Emotion injects its styles first, so it must also declare the layer order first. */}
      <GlobalStyles styles="@layer theme, base, mui, components, utilities;" />
      <ThemeProvider theme={muiTheme}>
        <CssBaseline enableColorScheme />
        <HashRouter>
          <Routes>
            <Route path="/" element={<LibraryPage />} />
            <Route path="/read/:id" element={<ReaderPage />} />
          </Routes>
          <ImportTray />
        </HashRouter>
      </ThemeProvider>
    </StyledEngineProvider>
  );
}
