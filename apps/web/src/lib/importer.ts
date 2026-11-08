import { useSyncExternalStore } from 'react';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { configurePdfWorker, ingestPdf } from '@paper-reader/pdf-ingest';
import { db, requestPersistentStorage, type PaperRecord } from './db';
import { makeId } from './id';

configurePdfWorker(workerUrl, {
  standardFontDataUrl: new URL('pdfjs/standard_fonts/', document.baseURI).href,
  cMapUrl: new URL('pdfjs/cmaps/', document.baseURI).href,
});

export interface ImportJob {
  id: string;
  fileName: string;
  status: 'queued' | 'working' | 'done' | 'error' | 'cancelled';
  progress: number;
  message: string;
  paperId?: string;
  error?: string;
}

let jobs: ImportJob[] = [];
const files = new Map<string, File>();
const controllers = new Map<string, AbortController>();
const listeners = new Set<() => void>();
let running = false;

function emit() {
  jobs = [...jobs];
  listeners.forEach((l) => l());
}

function patch(id: string, p: Partial<ImportJob>) {
  jobs = jobs.map((j) => (j.id === id ? { ...j, ...p } : j));
  emit();
}

export function useImportJobs(): ImportJob[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => jobs,
  );
}

export function enqueueFiles(list: FileList | File[]): number {
  let added = 0;
  for (const file of Array.from(list)) {
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') continue;
    const id = makeId();
    files.set(id, file);
    jobs.push({ id, fileName: file.name, status: 'queued', progress: 0, message: 'Waiting' });
    added++;
  }
  if (added) {
    emit();
    void requestPersistentStorage();
    void run();
  }
  return added;
}

export function cancelJob(id: string) {
  controllers.get(id)?.abort();
  const job = jobs.find((j) => j.id === id);
  if (job?.status === 'queued') patch(id, { status: 'cancelled', message: 'Cancelled' });
}

export function dismissJob(id: string) {
  jobs = jobs.filter((j) => j.id !== id);
  files.delete(id);
  emit();
}

export function clearFinished() {
  jobs = jobs.filter((j) => j.status === 'queued' || j.status === 'working');
  emit();
}

async function run() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const job = jobs.find((j) => j.status === 'queued');
      if (!job) break;
      const file = files.get(job.id);
      if (!file) {
        patch(job.id, { status: 'error', error: 'File is no longer available' });
        continue;
      }
      const controller = new AbortController();
      controllers.set(job.id, controller);
      patch(job.id, { status: 'working', message: 'Opening PDF' });
      try {
        const data = await file.arrayBuffer();
        const result = await ingestPdf(data, {
          fileName: file.name,
          signal: controller.signal,
          ocr: { workerPath: new URL('ocr/worker.min.js', document.baseURI).href, corePath: new URL('ocr/', document.baseURI).href, langPath: new URL('ocr/', document.baseURI).href, lang: 'eng' },
          onProgress: (p) => patch(job.id, { progress: p.fraction, message: p.message }),
        });
        const paperId = makeId();
        const paper: PaperRecord = {
          id: paperId,
          title: result.meta.title,
          authors: result.meta.authors,
          abstract: result.meta.abstract,
          fileName: file.name,
          fileSize: file.size,
          pageCount: result.meta.pageCount,
          pages: result.meta.pages,
          kind: result.meta.kind,
          bodyFontSize: result.meta.bodyFontSize,
          blockCount: result.blocks.length,
          cover: result.cover,
          addedAt: Date.now(),
          progress: 0,
          position: 0,
        };
        await db.transaction('rw', [db.papers, db.contents, db.images, db.files], async () => {
          await db.papers.add(paper);
          await db.contents.add({ paperId, blocks: result.blocks });
          await db.images.bulkAdd(result.images.map((im) => ({ ...im, paperId })));
          await db.files.add({ paperId, blob: new Blob([data], { type: 'application/pdf' }) });
        });
        patch(job.id, { status: 'done', progress: 1, message: 'Added to your library', paperId });
      } catch (err) {
        const aborted = controller.signal.aborted || (err as Error)?.name === 'AbortError';
        console.error(err);
        patch(job.id, {
          status: aborted ? 'cancelled' : 'error',
          message: aborted ? 'Cancelled' : 'Could not import this file',
          error: aborted ? undefined : String((err as Error)?.message ?? err),
        });
      } finally {
        controllers.delete(job.id);
        files.delete(job.id);
      }
    }
  } finally {
    running = false;
  }
}
