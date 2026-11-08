import { useNavigate } from 'react-router-dom';
import { Button, IconButton, LinearProgress, Paper, Slide } from '@mui/material';
import CloseRounded from '@mui/icons-material/CloseRounded';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded';
import { cancelJob, clearFinished, dismissJob, useImportJobs } from '../lib/importer';

/** Floating panel that shows the import queue (bottom right on tablets, full width on phones). */
export function ImportTray() {
  const jobs = useImportJobs();
  const navigate = useNavigate();
  const active = jobs.filter((j) => j.status === 'queued' || j.status === 'working').length;

  return (
    <Slide direction="up" in={jobs.length > 0} mountOnEnter unmountOnExit>
      <Paper
        elevation={8}
        className="safe-bottom fixed inset-x-3 bottom-3 z-[1300] overflow-hidden sm:left-auto sm:w-[380px]"
        sx={{ borderRadius: 4, border: 1, borderColor: 'divider' }}
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <div className="text-sm font-semibold">{active ? `Importing ${active} ${active === 1 ? 'paper' : 'papers'}` : 'Import finished'}</div>
          {!active && (
            <Button size="small" onClick={clearFinished}>
              Close
            </Button>
          )}
        </div>
        <ul className="max-h-[40vh] overflow-y-auto">
          {jobs.map((j) => (
            <li key={j.id} className="border-b border-line px-4 py-3 last:border-b-0">
              <div className="flex items-center gap-2">
                {j.status === 'done' && <CheckCircleRounded fontSize="small" color="success" />}
                {j.status === 'error' && <ErrorOutlineRounded fontSize="small" color="error" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium">{j.fileName}</div>
                  <div className="truncate text-xs text-muted">{j.error ?? j.message}</div>
                </div>
                {j.status === 'done' && j.paperId && (
                  <Button
                    size="small"
                    onClick={() => {
                      dismissJob(j.id);
                      navigate(`/read/${j.paperId}`);
                    }}
                  >
                    Read
                  </Button>
                )}
                <IconButton
                  size="small"
                  aria-label={j.status === 'working' || j.status === 'queued' ? 'Cancel import' : 'Dismiss'}
                  onClick={() => (j.status === 'working' || j.status === 'queued' ? cancelJob(j.id) : dismissJob(j.id))}
                >
                  <CloseRounded fontSize="small" />
                </IconButton>
              </div>
              {(j.status === 'working' || j.status === 'queued') && (
                <LinearProgress
                  className="mt-2"
                  variant={j.status === 'queued' ? 'indeterminate' : 'determinate'}
                  value={Math.round(j.progress * 100)}
                  sx={{ height: 5, opacity: j.status === 'queued' ? 0.4 : 1 }}
                />
              )}
            </li>
          ))}
        </ul>
      </Paper>
    </Slide>
  );
}
