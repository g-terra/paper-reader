import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AppBar,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Fab,
  IconButton,
  InputBase,
  LinearProgress,
  ListItemIcon,
  Menu,
  MenuItem,
  Toolbar,
  Tooltip,
  useMediaQuery,
} from '@mui/material';
import AddRounded from '@mui/icons-material/AddRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import TuneRounded from '@mui/icons-material/TuneRounded';
import SortRounded from '@mui/icons-material/SortRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import UploadFileRounded from '@mui/icons-material/UploadFileRounded';
import MenuBookRounded from '@mui/icons-material/MenuBookRounded';
import { db, deletePaper, type PaperRecord } from '../lib/db';
import { enqueueFiles } from '../lib/importer';
import { CardSkeleton, PaperCard } from '../components/PaperCard';
import { Sheet } from '../components/Sheet';
import { AppearanceControls } from '../components/AppearanceControls';
import { useBlobUrl } from '../lib/useBlobUrl';
import { authorLine, fileSize, relativeTime } from '../lib/format';

type Sort = 'recent' | 'added' | 'title';
const SORT_LABEL: Record<Sort, string> = { recent: 'Recently read', added: 'Recently added', title: 'Title' };

export function LibraryPage() {
  const papers = useLiveQuery(() => db.papers.toArray(), []);
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>(() => (localStorage.getItem('paper-reader:sort') as Sort) || 'recent');
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null);
  const [appearance, setAppearance] = useState(false);
  const [toDelete, setToDelete] = useState<PaperRecord | null>(null);
  const [details, setDetails] = useState<PaperRecord | null>(null);
  const [dragging, setDragging] = useState(false);
  const phone = useMediaQuery('(max-width:640px)');

  const list = useMemo(() => {
    if (!papers) return undefined;
    const q = query.trim().toLowerCase();
    const filtered = q
      ? papers.filter((p) => p.title.toLowerCase().includes(q) || p.authors.some((a) => a.toLowerCase().includes(q)) || p.fileName.toLowerCase().includes(q))
      : papers;
    return [...filtered].sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title);
      if (sort === 'added') return b.addedAt - a.addedAt;
      return (b.lastOpenedAt ?? b.addedAt) - (a.lastOpenedAt ?? a.addedAt);
    });
  }, [papers, query, sort]);

  const current = useMemo(
    () => papers?.filter((p) => p.lastOpenedAt && p.progress > 0 && p.progress < 0.98).sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))[0],
    [papers],
  );

  const pick = () => input.current?.click();

  return (
    <div
      className="min-h-full"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        enqueueFiles(e.dataTransfer.files);
      }}
    >
      <input ref={input} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => e.target.files && (enqueueFiles(e.target.files), (e.target.value = ''))} />

      <AppBar position="sticky" className="safe-top">
        <Toolbar className="mx-auto w-full max-w-6xl gap-2" sx={{ minHeight: { xs: 60, sm: 68 } }}>
          <MenuBookRounded sx={{ color: 'primary.main' }} />
          <div className="mr-2 font-serif text-xl font-semibold tracking-tight">Papers</div>
          <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full border border-line bg-surface px-3.5 sm:max-w-md">
            <SearchRounded fontSize="small" className="text-muted" />
            <InputBase placeholder="Search title or author" value={query} onChange={(e) => setQuery(e.target.value)} sx={{ flex: 1, fontSize: 14.5 }} inputProps={{ 'aria-label': 'Search library' }} />
          </div>
          <div className="flex-1 max-sm:hidden" />
          <Tooltip title="Sort">
            <IconButton onClick={(e) => setSortAnchor(e.currentTarget)} aria-label="Sort">
              <SortRounded />
            </IconButton>
          </Tooltip>
          <Tooltip title="Reading appearance">
            <IconButton onClick={() => setAppearance(true)} aria-label="Reading appearance">
              <TuneRounded />
            </IconButton>
          </Tooltip>
          {!phone && (
            <Button variant="contained" startIcon={<AddRounded />} onClick={pick} sx={{ ml: 1, px: 2.5 }}>
              Add papers
            </Button>
          )}
        </Toolbar>
      </AppBar>

      <Menu anchorEl={sortAnchor} open={!!sortAnchor} onClose={() => setSortAnchor(null)}>
        {(Object.keys(SORT_LABEL) as Sort[]).map((k) => (
          <MenuItem
            key={k}
            onClick={() => {
              setSort(k);
              localStorage.setItem('paper-reader:sort', k);
              setSortAnchor(null);
            }}
          >
            <ListItemIcon>{sort === k && <CheckRounded fontSize="small" />}</ListItemIcon>
            {SORT_LABEL[k]}
          </MenuItem>
        ))}
      </Menu>

      <main className="mx-auto w-full max-w-6xl px-4 pt-5 pb-28 sm:px-6 sm:pt-8">
        {current && !query && <ContinueCard paper={current} onOpen={() => navigate(`/read/${current.id}`)} />}

        {list === undefined ? (
          <Grid>
            {Array.from({ length: 6 }, (_, i) => (
              <CardSkeleton key={i} />
            ))}
          </Grid>
        ) : papers && papers.length === 0 ? (
          <EmptyState onPick={pick} />
        ) : (
          <>
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="font-serif text-lg font-semibold">{query ? `Results for “${query}”` : 'Library'}</h2>
              <span className="text-sm text-muted">
                {list.length} {list.length === 1 ? 'paper' : 'papers'}
              </span>
            </div>
            <Grid>
              {list.map((p) => (
                <PaperCard key={p.id} paper={p} onOpen={() => navigate(`/read/${p.id}`)} onDelete={() => setToDelete(p)} onDetails={() => setDetails(p)} />
              ))}
            </Grid>
          </>
        )}
      </main>

      {phone && (
        <Fab color="primary" aria-label="Add papers" onClick={pick} sx={{ position: 'fixed', right: 20, bottom: 'calc(20px + env(safe-area-inset-bottom))' }}>
          <AddRounded />
        </Fab>
      )}

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[1400] grid place-items-center bg-page/80 backdrop-blur-sm">
          <div className="rounded-3xl border-2 border-dashed border-accent px-12 py-10 text-center">
            <UploadFileRounded sx={{ fontSize: 48, color: 'primary.main' }} />
            <div className="mt-2 font-serif text-xl font-semibold">Drop PDFs to add them</div>
          </div>
        </div>
      )}

      <Sheet open={appearance} onClose={() => setAppearance(false)} title="Reading appearance">
        <AppearanceControls />
      </Sheet>

      <Dialog open={!!toDelete} onClose={() => setToDelete(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Remove this paper?</DialogTitle>
        <DialogContent className="text-sm text-muted">“{toDelete?.title}” and your reading position will be removed from this device.</DialogContent>
        <DialogActions>
          <Button onClick={() => setToDelete(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={async () => {
              if (toDelete) await deletePaper(toDelete.id);
              setToDelete(null);
            }}
          >
            Remove
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!details} onClose={() => setDetails(null)} maxWidth="sm" fullWidth>
        {details && (
          <>
            <DialogTitle sx={{ fontFamily: 'var(--font-serif)', fontWeight: 600, lineHeight: 1.3 }}>{details.title}</DialogTitle>
            <DialogContent>
              {details.authors.length > 0 && <div className="mb-3 text-sm text-muted">{details.authors.join(', ')}</div>}
              {details.abstract && <p className="mb-4 font-serif text-[15px] leading-relaxed">{details.abstract}</p>}
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted">File</dt>
                <dd className="truncate">{details.fileName}</dd>
                <dt className="text-muted">Pages</dt>
                <dd>
                  {details.pageCount} · {fileSize(details.fileSize)}
                </dd>
                <dt className="text-muted">Source</dt>
                <dd>{details.kind === 'digital' ? 'Digital text' : details.kind === 'scanned' ? 'Scanned, text read with OCR' : 'Mixed: some pages read with OCR'}</dd>
                <dt className="text-muted">Added</dt>
                <dd>{new Date(details.addedAt).toLocaleString()}</dd>
              </dl>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDetails(null)}>Close</Button>
              <Button variant="contained" onClick={() => navigate(`/read/${details.id}`)}>
                Read
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 sm:gap-x-6 md:grid-cols-4 lg:grid-cols-5">{children}</div>;
}

function ContinueCard({ paper, onOpen }: { paper: PaperRecord; onOpen: () => void }) {
  const cover = useBlobUrl(paper.cover);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mb-9 flex w-full items-center gap-4 rounded-2xl border border-line bg-surface p-3.5 text-left transition hover:brightness-[0.98] sm:gap-6 sm:p-5"
    >
      {cover && <img src={cover} alt="" className="h-28 w-[84px] shrink-0 rounded-lg object-cover object-top shadow-md sm:h-36 sm:w-[108px] [.dark-theme_&]:opacity-80" />}
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold tracking-wide text-accent uppercase">Continue reading</div>
        <div className="mt-1 line-clamp-2 font-serif text-lg leading-snug font-semibold sm:text-xl">{paper.title}</div>
        <div className="mt-1 truncate text-sm text-muted">{authorLine(paper.authors)}</div>
        <div className="mt-3 flex items-center gap-3">
          <LinearProgress variant="determinate" value={paper.progress * 100} sx={{ flex: 1, height: 5, maxWidth: 260 }} />
          <span className="text-xs text-muted">
            {Math.round(paper.progress * 100)}% · {relativeTime(paper.lastOpenedAt)}
          </span>
        </div>
      </div>
    </button>
  );
}

function EmptyState({ onPick }: { onPick: () => void }) {
  return (
    <div className="mx-auto mt-6 max-w-lg text-center sm:mt-16">
      <div className="mx-auto grid h-20 w-20 place-items-center rounded-3xl bg-surface">
        <MenuBookRounded sx={{ fontSize: 40, color: 'primary.main' }} />
      </div>
      <h1 className="mt-6 font-serif text-2xl font-semibold sm:text-3xl">Your reading shelf is empty</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted">
        Add academic papers as PDFs. Text is reflowed into a comfortable, book-like page. Scanned papers are read with OCR, and figures, tables and equations are kept as
        images. Everything stays on this device.
      </p>
      <Button variant="contained" size="large" startIcon={<AddRounded />} onClick={onPick} sx={{ mt: 4, px: 3.5, py: 1.25 }}>
        Add PDF papers
      </Button>
      <div className="mt-3 text-xs text-muted max-sm:hidden">or drop files anywhere on this page</div>
    </div>
  );
}
