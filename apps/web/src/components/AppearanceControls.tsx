import { Box, Slider, Switch, ToggleButton, ToggleButtonGroup, Tooltip } from '@mui/material';
import FormatAlignJustifyRounded from '@mui/icons-material/FormatAlignJustifyRounded';
import FormatAlignLeftRounded from '@mui/icons-material/FormatAlignLeftRounded';
import ViewDayOutlined from '@mui/icons-material/ViewDayOutlined';
import AutoStoriesOutlined from '@mui/icons-material/AutoStoriesOutlined';
import CheckRounded from '@mui/icons-material/CheckRounded';
import TextDecreaseRounded from '@mui/icons-material/TextDecreaseRounded';
import TextIncreaseRounded from '@mui/icons-material/TextIncreaseRounded';
import { FONTS, useSettings, type FontId } from '../lib/settings';
import { THEMES, THEME_ORDER } from '../lib/themes';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-2.5">
      <div className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">{label}</div>
      {children}
    </div>
  );
}

/** Kindle-style "Aa" panel: theme, font, size, spacing, margins, layout. */
export function AppearanceControls({ compact = false }: { compact?: boolean }) {
  const [s, set] = useSettings();
  return (
    <div className="px-1">
      <Row label="Theme">
        <div className="flex gap-2.5">
          {THEME_ORDER.map((id) => {
            const t = THEMES[id];
            const selected = s.theme === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => set({ theme: id })}
                className="flex flex-1 flex-col items-center gap-1.5"
                aria-pressed={selected}
                aria-label={`${t.label} theme`}
              >
                <span
                  className="relative grid aspect-square w-full max-w-14 place-items-center rounded-full font-serif text-lg font-semibold transition"
                  style={{
                    background: t.bg,
                    color: t.fg,
                    boxShadow: selected ? `0 0 0 2px ${THEMES[s.theme].bg}, 0 0 0 4px ${THEMES[s.theme].accent}` : `inset 0 0 0 1px ${t.border}`,
                  }}
                >
                  {selected ? <CheckRounded fontSize="small" /> : 'Aa'}
                </span>
                <span className="text-[11.5px] text-muted">{t.label}</span>
              </button>
            );
          })}
        </div>
      </Row>

      <Row label="Font">
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {(Object.keys(FONTS) as FontId[]).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => set({ font: id })}
              className={`shrink-0 rounded-xl border px-3.5 py-2 text-[15px] transition ${s.font === id ? 'border-accent bg-accent/10 text-ink' : 'border-line text-ink/80'}`}
              style={{ fontFamily: FONTS[id].css }}
            >
              {FONTS[id].label}
            </button>
          ))}
        </div>
      </Row>

      <Row label="Text size">
        <div className="flex items-center gap-3">
          <TextDecreaseRounded fontSize="small" className="text-muted" />
          <Slider size="small" min={14} max={30} step={1} value={s.fontSize} onChange={(_, v) => set({ fontSize: v as number })} aria-label="Text size" />
          <TextIncreaseRounded className="text-muted" />
        </div>
      </Row>

      <div className={compact ? '' : 'grid grid-cols-2 gap-x-5'}>
        <Row label="Line spacing">
          <ToggleButtonGroup size="small" exclusive fullWidth value={s.lineHeight} onChange={(_, v) => v && set({ lineHeight: v })}>
            <ToggleButton value={1.35}>Tight</ToggleButton>
            <ToggleButton value={1.6}>Normal</ToggleButton>
            <ToggleButton value={1.9}>Loose</ToggleButton>
          </ToggleButtonGroup>
        </Row>
        <Row label="Margins">
          <ToggleButtonGroup size="small" exclusive fullWidth value={s.margin} onChange={(_, v) => v && set({ margin: v })}>
            <ToggleButton value="narrow">Narrow</ToggleButton>
            <ToggleButton value="normal">Normal</ToggleButton>
            <ToggleButton value="wide">Wide</ToggleButton>
          </ToggleButtonGroup>
        </Row>
        <Row label="Layout">
          <ToggleButtonGroup size="small" exclusive fullWidth value={s.mode} onChange={(_, v) => v && set({ mode: v })}>
            <ToggleButton value="paged">
              <AutoStoriesOutlined fontSize="small" sx={{ mr: 0.75 }} /> Pages
            </ToggleButton>
            <ToggleButton value="scroll">
              <ViewDayOutlined fontSize="small" sx={{ mr: 0.75 }} /> Scroll
            </ToggleButton>
          </ToggleButtonGroup>
        </Row>
        <Row label="Alignment">
          <ToggleButtonGroup size="small" exclusive fullWidth value={s.justify} onChange={(_, v) => v !== null && set({ justify: v })}>
            <ToggleButton value={true}>
              <FormatAlignJustifyRounded fontSize="small" sx={{ mr: 0.75 }} /> Justified
            </ToggleButton>
            <ToggleButton value={false}>
              <FormatAlignLeftRounded fontSize="small" sx={{ mr: 0.75 }} /> Left
            </ToggleButton>
          </ToggleButtonGroup>
        </Row>
      </div>

      <Box className="mt-1 divide-y divide-line border-t border-line">
        <Toggle label="Two pages side by side on wide screens" checked={s.spread} onChange={(v) => set({ spread: v })} />
        <Toggle label="Show original page numbers" checked={s.showPageMarks} onChange={(v) => set({ showPageMarks: v })} />
        <Tooltip title="Only applies to the Dusk and Night themes" placement="top-start">
          <div>
            <Toggle label="Invert figures in dark themes" checked={s.invertFigures} onChange={(v) => set({ invertFigures: v })} />
          </div>
        </Tooltip>
      </Box>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1.5 text-[14px]">
      <span>{label}</span>
      <Switch size="small" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
