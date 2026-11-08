import { useState } from 'react';
import { Box, Chip, IconButton, LinearProgress, ListItemIcon, Menu, MenuItem, Tooltip } from '@mui/material';
import MoreVertRounded from '@mui/icons-material/MoreVertRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import DocumentScannerOutlined from '@mui/icons-material/DocumentScannerOutlined';
import AutoFixHighRounded from '@mui/icons-material/AutoFixHighRounded';
import { coverUrl, reviewInProgress, type PaperRecord } from '../lib/db';
import { authorLine } from '../lib/format';

interface Props {
  paper: PaperRecord;
  onOpen: () => void;
  onDelete: () => void;
  onDetails: () => void;
}

export function PaperCard({ paper, onOpen, onDelete, onDetails }: Props) {
  const cover = coverUrl(paper);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const pct = Math.round(paper.progress * 100);

  return (
    <div className="group relative flex flex-col">
      <button
        type="button"
        onClick={onOpen}
        className="relative block aspect-[3/4] w-full overflow-hidden rounded-xl border border-line bg-surface text-left shadow-[0_1px_2px_rgba(0,0,0,0.06),0_8px_24px_-12px_rgba(0,0,0,0.25)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(0,0,0,0.08),0_16px_32px_-12px_rgba(0,0,0,0.3)] focus-visible:outline-2 focus-visible:outline-accent"
        aria-label={`Open ${paper.title}`}
      >
        {cover && <img src={cover} alt="" className="h-full w-full object-cover object-top opacity-95 [.dark-theme_&]:opacity-80" draggable={false} />}
        {paper.kind !== 'digital' && (
          <Tooltip title={paper.kind === 'scanned' ? 'Scanned paper: text was recognised with OCR' : 'Some pages were scanned and read with OCR'}>
            <Chip
              size="small"
              icon={<DocumentScannerOutlined sx={{ fontSize: 14 }} />}
              label={paper.kind === 'scanned' ? 'Scan' : 'Part scan'}
              sx={{ position: 'absolute', top: 8, left: 8, bgcolor: 'background.default', fontSize: 11, height: 22 }}
            />
          </Tooltip>
        )}
        {reviewInProgress(paper) && (
          <Tooltip title="Claude is proofreading the converted text against the PDF">
            <Chip
              size="small"
              icon={<AutoFixHighRounded sx={{ fontSize: 14 }} />}
              label={paper.review?.status === 'running' && paper.review.total ? `Proofreading ${paper.review.done ?? 0}/${paper.review.total}` : 'Proofreading soon'}
              sx={{ position: 'absolute', bottom: pct > 0 ? 22 : 8, right: 8, bgcolor: 'background.default', fontSize: 11, height: 22 }}
            />
          </Tooltip>
        )}
        {pct > 0 && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/45 to-transparent px-2.5 pt-6 pb-2">
            <LinearProgress variant="determinate" value={pct} sx={{ height: 4, bgcolor: 'rgba(255,255,255,0.35)', '& .MuiLinearProgress-bar': { bgcolor: '#fff' } }} />
          </div>
        )}
      </button>
      <div className="mt-2.5 flex items-start gap-1">
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <div className="line-clamp-2 font-serif text-[15px] leading-snug font-semibold text-ink">{paper.title}</div>
          <div className="mt-0.5 truncate text-[12.5px] text-muted">
            {authorLine(paper.authors, 2) || `${paper.pageCount} pages`}
            {pct > 0 && <span> · {pct}%</span>}
          </div>
        </button>
        <IconButton size="small" aria-label="More" onClick={(e) => setAnchor(e.currentTarget)} sx={{ mt: -0.5, mr: -1, color: 'text.secondary' }}>
          <MoreVertRounded fontSize="small" />
        </IconButton>
      </div>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        <MenuItem
          onClick={() => {
            setAnchor(null);
            onDetails();
          }}
        >
          <ListItemIcon>
            <InfoOutlined fontSize="small" />
          </ListItemIcon>
          Details
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchor(null);
            onDelete();
          }}
          sx={{ color: 'error.main' }}
        >
          <ListItemIcon>
            <DeleteOutlineRounded fontSize="small" color="error" />
          </ListItemIcon>
          Remove from library
        </MenuItem>
      </Menu>
    </div>
  );
}

export function CardSkeleton() {
  return (
    <Box className="flex flex-col">
      <div className="aspect-[3/4] w-full animate-pulse rounded-xl bg-surface" />
      <div className="mt-2.5 h-4 w-4/5 animate-pulse rounded bg-surface" />
      <div className="mt-1.5 h-3 w-1/2 animate-pulse rounded bg-surface" />
    </Box>
  );
}
