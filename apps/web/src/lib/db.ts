import { useSyncExternalStore } from 'react';
import type { Block, PageRef } from '@paper-reader/pdf-ingest';

// The library lives on the computer that serves the app (see apps/server), in a folder of plain
// files, so every phone, tablet and browser that opens the reader sees the same papers and the
// same reading positions. This module is the only place that talks to that server.

export interface PaperRecord {
  id: string;
  title: string;
  authors: string[];
  abstract?: string;
  fileName: string;
  fileSize: number;
  pageCount: number;
  pages: PageRef[];
  kind: 'digital' | 'scanned' | 'mixed';
  bodyFontSize: number;
  blockCount: number;
  coverType: string;
  addedAt: number;
  lastOpenedAt?: number;
  /** Reading progress, 0..1. */
  progress: number;
  /** Index of the block at the top of the last screen read. */
  position: number;
}

export interface NewPaper {
  paper: PaperRecord;
  blocks: Block[];
  cover: Blob;
  file: Blob;
  images: { id: string; blob: Blob; width: number; height: number }[];
}

const api = (p: string) => new URL(`api/${p}`, document.baseURI).href;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(api(path), { cache: 'no-store', ...init });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      // Not JSON.
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export const coverUrl = (p: PaperRecord) => api(`papers/${p.id}/cover`);
export const imageUrl = (paperId: string, imageId: string) => api(`papers/${paperId}/images/${imageId}`);
export const fileUrl = (paperId: string) => api(`papers/${paperId}/file`);

// --- Library list, shared by every component that shows it ---------------------------------------

export interface LibraryState {
  papers?: PaperRecord[];
  error?: string;
}

let state: LibraryState = {};
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

function set(next: LibraryState) {
  state = next;
  listeners.forEach((l) => l());
}

export function refreshLibrary(): Promise<void> {
  inflight ??= request<PaperRecord[]>('papers')
    .then((papers) => set({ papers }))
    .catch((e: Error) => set({ papers: state.papers, error: `Can't reach the library server (${e.message}).` }))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

function patchLocal(id: string, patch: Partial<PaperRecord> | null) {
  if (!state.papers) return;
  set({
    ...state,
    papers: patch === null ? state.papers.filter((p) => p.id !== id) : state.papers.map((p) => (p.id === id ? { ...p, ...patch } : p)),
  });
}

export function useLibrary(): LibraryState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      if (listeners.size === 1) {
        void refreshLibrary();
        // Other devices may have added papers or read further: catch up when the tab comes back.
        const onVisible = () => document.visibilityState === 'visible' && void refreshLibrary();
        document.addEventListener('visibilitychange', onVisible);
        stopWatching = () => document.removeEventListener('visibilitychange', onVisible);
      }
      return () => {
        listeners.delete(cb);
        if (!listeners.size) stopWatching?.();
      };
    },
    () => state,
  );
}
let stopWatching: (() => void) | undefined;

// --- Single papers -----------------------------------------------------------------------------

export async function getPaper(id: string): Promise<PaperRecord | null> {
  try {
    return await request<PaperRecord>(`papers/${id}`);
  } catch (e) {
    if (/not found/i.test((e as Error).message)) return null;
    throw e;
  }
}

export async function getContent(id: string): Promise<Block[]> {
  return (await request<{ blocks: Block[] }>(`papers/${id}/content`)).blocks;
}

export async function updatePaper(id: string, patch: Partial<Pick<PaperRecord, 'progress' | 'position' | 'lastOpenedAt'>>): Promise<void> {
  patchLocal(id, patch);
  await request(`papers/${id}`, jsonInit('PATCH', patch));
}

export async function deletePaper(id: string): Promise<void> {
  await request(`papers/${id}`, { method: 'DELETE' });
  patchLocal(id, null);
}

/** Uploads a freshly imported paper: binary parts first, then the record that makes it visible. */
export async function savePaper(p: NewPaper, signal?: AbortSignal): Promise<void> {
  const id = p.paper.id;
  const put = (part: string, blob: Blob) =>
    request(`uploads/${id}/${part}`, { method: 'PUT', body: blob, headers: { 'content-type': blob.type || 'application/octet-stream' }, signal });
  try {
    await put('file', p.file);
    await put('cover', p.cover);
    // A few at a time: papers can have dozens of figures.
    const queue = [...p.images];
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        for (let im = queue.shift(); im; im = queue.shift()) await put(`images/${im.id}`, im.blob);
      }),
    );
    const images = p.images.map((im) => ({ id: im.id, width: im.width, height: im.height, type: im.blob.type || 'image/png' }));
    await request('papers', { ...jsonInit('POST', { paper: p.paper, blocks: p.blocks, images }), signal });
  } catch (e) {
    void fetch(api(`uploads/${id}`), { method: 'DELETE' }).catch(() => {});
    throw e;
  }
  await refreshLibrary();
}
