import Dexie, { type EntityTable } from 'dexie';
import type { Block, PageRef } from '@paper-reader/pdf-ingest';

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
  cover: Blob;
  addedAt: number;
  lastOpenedAt?: number;
  /** Reading progress, 0..1. */
  progress: number;
  /** Index of the block at the top of the last screen read. */
  position: number;
}

export interface ContentRecord {
  paperId: string;
  blocks: Block[];
}

export interface ImageRecord {
  id: string;
  paperId: string;
  blob: Blob;
  width: number;
  height: number;
}

export interface FileRecord {
  paperId: string;
  blob: Blob;
}

export const db = new Dexie('paper-reader') as Dexie & {
  papers: EntityTable<PaperRecord, 'id'>;
  contents: EntityTable<ContentRecord, 'paperId'>;
  images: EntityTable<ImageRecord, 'id'>;
  files: EntityTable<FileRecord, 'paperId'>;
};

db.version(1).stores({
  papers: 'id, addedAt, lastOpenedAt, title',
  contents: 'paperId',
  images: 'id, paperId',
  files: 'paperId',
});

export async function deletePaper(id: string): Promise<void> {
  await db.transaction('rw', [db.papers, db.contents, db.images, db.files], async () => {
    await db.papers.delete(id);
    await db.contents.delete(id);
    await db.images.where('paperId').equals(id).delete();
    await db.files.delete(id);
  });
}

/** Asks the browser not to evict the library when storage runs low (important on iOS). */
export async function requestPersistentStorage(): Promise<void> {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    // Not supported: nothing to do.
  }
}
