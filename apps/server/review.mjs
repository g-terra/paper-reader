// Claude review: after a paper is imported, Claude Code (the `claude` command on this computer, signed
// in with the owner's own plan) compares the converted text with the original PDF pages and fixes
// what the converter got wrong: OCR mistakes, broken paragraphs, running headers, headings, reading
// order, captions. It works a few pages at a time; every answer is checked before it is used, and
// the converter's own output is kept as content.original.json so the review can be undone.
//
// If Claude Code is not installed (or PAPER_REVIEW=off), papers are simply left as converted.
//
//   CLAUDE_BIN            command to run (default "claude")
//   PAPER_REVIEW          "off" turns the review off
//   PAPER_REVIEW_MODEL    model to ask for (default: whatever Claude Code uses)
//   PAPER_REVIEW_PAGES    pages per request (default 6)

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

const ENABLED = !/^(off|0|false|no)$/i.test(process.env.PAPER_REVIEW || '');
const MODEL = process.env.PAPER_REVIEW_MODEL || '';
const PAGES_PER_CHUNK = Math.max(1, Number(process.env.PAPER_REVIEW_PAGES) || 6);
const CHUNK_TIMEOUT = 15 * 60 * 1000;
const ROLES = new Set(['body', 'abstract', 'front', 'caption', 'reference', 'note']);

/** Runs a command and collects its output. Never rejects. */
function run(cmd, args, { cwd, input, timeout }) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let done = false;
    let child;
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r);
    };
    try {
      child = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
    } catch (e) {
      return finish({ code: -1, out, err: String(e?.message || e) });
    }
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish({ code: -1, out, err: 'Timed out' });
    }, timeout);
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (err += c));
    child.on('error', (e) => finish({ code: -1, out, err: e.message }));
    child.on('close', (code) => finish({ code, out, err }));
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
  });
}

// A server started outside a terminal (login item, launchd) may not have the installer's folder on PATH.
const CANDIDATES = process.env.CLAUDE_BIN
  ? [process.env.CLAUDE_BIN]
  : ['claude', path.join(os.homedir(), '.local/bin/claude'), path.join(os.homedir(), '.claude/local/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'];
let BIN;
let lastMiss = 0;

/** True when the claude command is installed here. Re-checked while it is missing. */
export async function claudeAvailable() {
  if (!ENABLED) return false;
  if (BIN) return true;
  if (Date.now() - lastMiss < 60_000) return false;
  for (const c of CANDIDATES) {
    const r = await run(c, ['--version'], { timeout: 20_000 });
    if (r.code === 0) {
      BIN = c;
      console.log(`Claude review: using ${c} (${r.out.trim()})`);
      return true;
    }
  }
  lastMiss = Date.now();
  return false;
}

// ---------------------------------------------------------------------------------------------
// What Claude sees and returns

/** Splits the paper into runs of logical pages, each sent to Claude with its PDF pages. */
export function makeChunks(blocks, pages, perChunk = PAGES_PER_CHUNK) {
  const pageCount = Math.max(pages.length, ...blocks.map((b) => b.page || 1));
  const chunks = [];
  for (let first = 1; first <= pageCount; first += perChunk) {
    const last = Math.min(pageCount, first + perChunk - 1);
    const indices = [];
    blocks.forEach((b, i) => {
      const p = b.page || 1;
      if (p >= first && p <= last) indices.push(i);
    });
    if (!indices.length) continue;
    const pdfPages = [];
    for (let p = first; p <= last; p++) pdfPages.push(pages[p - 1]?.pdfPage ?? p);
    chunks.push({ first, last, indices, pdfFrom: Math.min(...pdfPages), pdfTo: Math.max(...pdfPages) });
  }
  return chunks;
}

function forClaude(b) {
  if (b.kind === 'figure') return { kind: 'figure', variant: b.variant, imageId: b.imageId, ...(b.caption ? { caption: b.caption } : {}), page: b.page };
  if (b.kind === 'heading') return { kind: 'heading', level: b.level, text: b.text, page: b.page };
  if (b.kind === 'paragraph') return { kind: 'paragraph', role: b.role, text: b.text, page: b.page };
  return { kind: b.kind, text: b.text, page: b.page };
}

export function buildPrompt(chunk, blocks, pages) {
  const range = chunk.pdfFrom === chunk.pdfTo ? String(chunk.pdfFrom) : `${chunk.pdfFrom}-${chunk.pdfTo}`;
  const spreads = [];
  for (let p = chunk.first; p <= chunk.last; p++) {
    const ref = pages[p - 1];
    if (ref?.half) spreads.push(`page ${p} is the ${ref.half} half of PDF page ${ref.pdfPage}`);
  }
  const pageWord = chunk.first === chunk.last ? `page ${chunk.first}` : `pages ${chunk.first} to ${chunk.last}`;
  return `You are proofreading the output of a PDF converter for an academic paper, so it reads well in an e-reader.

The original PDF is ./original.pdf in the current folder. Use the Read tool on it with pages "${range}" and compare those pages with the converted blocks below, which cover ${pageWord} of the paper.${spreads.length ? ` These are scans of two-page spreads: ${spreads.join('; ')}.` : ''}

Fix what the converter got wrong:
- OCR and extraction errors: wrong or missing characters, words split or run together, hyphens left from line breaks, ligatures, stray symbols.
- Paragraphs split in the wrong place or wrongly merged, and text in the wrong reading order (for example two columns interleaved).
- Running headers, footers, page numbers, journal banners, download notices and stray fragments mixed into the text: remove them.
- Headings: real section headings get kind "heading" (level 2 for sections, 3 for subsections, 4 below that); text wrongly marked as a heading becomes a paragraph.
- Paragraph roles: "body", "abstract", "front" (author names, affiliations, emails), "caption", "reference" (one per reference list entry), "note" (footnotes and small print).
- Figure, table and equation captions: correct the caption text.

Rules:
- Keep the authors' exact wording. Do not summarise, shorten, paraphrase, translate or add anything that is not on the page.
- Text that only appears inside a figure, table or equation image stays out of the paragraphs.
- Keep every figure block, with its imageId, exactly once and in the right place. You may change only its caption and page.
- Plain Unicode text only, no Markdown. Inline math may use Unicode symbols.
- If the blocks are already right, return them unchanged.

Answer with only this JSON and nothing else:
{"blocks": [ ... ]}
Each block is one of:
{"kind":"title","text":"...","page":N}
{"kind":"heading","level":2,"text":"...","page":N}
{"kind":"paragraph","role":"body","text":"...","page":N}
{"kind":"figure","imageId":"...","caption":"...","page":N}
where page is the page number (${chunk.first} to ${chunk.last}) the block starts on.

Converted blocks:
${JSON.stringify({ blocks: chunk.indices.map((i) => forClaude(blocks[i])) }, null, 1)}
`;
}

/** Pulls the JSON object out of Claude's answer, tolerating a code fence or a sentence around it. */
export function parseAnswer(text) {
  const fence = [...String(text).matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].pop();
  let s = fence ? fence[1] : String(text);
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('No JSON in answer');
  s = s.slice(start, end + 1);
  const value = JSON.parse(s);
  if (!value || !Array.isArray(value.blocks)) throw new Error('Answer has no blocks');
  return value.blocks;
}

const textLength = (list) => list.reduce((n, b) => n + (b.kind === 'figure' ? (b.caption || '').length : (b.text || '').length), 0);
const clean = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');

/**
 * Checks Claude's blocks against the original ones and returns them in the reader's format, or
 * throws if they can't be trusted (a figure lost or duplicated, text much shorter or longer).
 */
export function validateBlocks(answer, original, chunk) {
  const figures = new Map(original.filter((b) => b.kind === 'figure').map((b) => [b.imageId, b]));
  const seen = new Set();
  const out = [];
  let page = chunk.first;
  for (const raw of answer) {
    if (!raw || typeof raw !== 'object') continue;
    const p = Number(raw.page);
    if (Number.isInteger(p) && p >= chunk.first && p <= chunk.last) page = Math.max(page, p);
    if (raw.kind === 'figure') {
      const fig = figures.get(raw.imageId);
      if (!fig) throw new Error(`Unknown figure ${raw.imageId}`);
      if (seen.has(raw.imageId)) throw new Error(`Figure ${raw.imageId} used twice`);
      seen.add(raw.imageId);
      const next = { ...fig, page };
      if ('caption' in raw) {
        const c = clean(raw.caption);
        if (c) next.caption = c;
        else delete next.caption;
      }
      out.push(next);
      continue;
    }
    const text = clean(raw.text);
    if (!text) continue;
    if (raw.kind === 'title') out.push({ kind: 'title', text, page });
    else if (raw.kind === 'heading') out.push({ kind: 'heading', level: [2, 3, 4].includes(Number(raw.level)) ? Number(raw.level) : 2, text, page });
    else if (raw.kind === 'paragraph') out.push({ kind: 'paragraph', role: ROLES.has(raw.role) ? raw.role : 'body', text, page });
    else throw new Error(`Unknown block kind ${raw.kind}`);
  }
  for (const id of figures.keys()) if (!seen.has(id)) throw new Error(`Figure ${id} was dropped`);
  const before = textLength(original);
  const after = textLength(out);
  // Removing headers and footers shortens a page a little; anything far off means text was lost or invented.
  if (before > 300 && (after < before * 0.6 || after > before * 1.25)) throw new Error(`Text changed too much (${before} -> ${after} characters)`);
  if (before > 0 && !out.some((b) => b.kind !== 'figure')) throw new Error('All text was dropped');
  return out;
}

async function reviewChunk(dir, chunk, blocks, pages) {
  const args = ['-p', '--output-format', 'json', '--tools', 'Read', '--allowedTools', 'Read', '--permission-mode', 'dontAsk', '--strict-mcp-config', '--no-session-persistence'];
  if (MODEL) args.push('--model', MODEL);
  const r = await run(BIN, args, { cwd: dir, input: buildPrompt(chunk, blocks, pages), timeout: CHUNK_TIMEOUT });
  let result;
  try {
    result = JSON.parse(r.out);
  } catch {
    throw new Error(`Claude Code did not answer (${(r.err || r.out || `exit ${r.code}`).trim().slice(0, 300)})`);
  }
  if (result.is_error || result.subtype !== 'success') throw new Error(`Claude Code: ${String(result.result || result.subtype || 'error').slice(0, 300)}`);
  const original = chunk.indices.map((i) => blocks[i]);
  return validateBlocks(parseAnswer(result.result), original, chunk);
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------------------------
// Queue: one paper at a time, so a batch import doesn't flood the owner's plan.

/**
 * @param {object} lib
 * @param {(id: string) => string} lib.paperDir
 * @param {(file: string) => Promise<any>} lib.readJson
 * @param {(file: string, value: any) => Promise<void>} lib.writeJson
 * @param {(id: string, fn: (paper: any) => void) => Promise<any>} lib.mutatePaper
 */
export function createReviewer(lib) {
  const queue = [];
  let busy = false;

  const setStatus = (id, review) => lib.mutatePaper(id, (p) => void (p.review = { ...(p.review || {}), ...review }));

  async function reviewPaper(id) {
    const dir = lib.paperDir(id);
    const originalFile = path.join(dir, 'content.original.json');
    const contentFile = path.join(dir, 'content.json');
    const hasOriginal = await fs.stat(originalFile).then(() => true, () => false);
    const { blocks } = await lib.readJson(hasOriginal ? originalFile : contentFile);
    const paper = await lib.readJson(path.join(dir, 'paper.json'));
    const pages = paper.pages || [];
    const chunks = makeChunks(blocks, pages);
    await setStatus(id, { status: 'running', startedAt: Date.now(), done: 0, total: chunks.length, error: undefined });

    const result = [];
    let changed = 0;
    let failed = 0;
    let lastError;
    for (const [n, chunk] of chunks.entries()) {
      const original = chunk.indices.map((i) => blocks[i]);
      try {
        const fixed = await reviewChunk(dir, chunk, blocks, pages);
        if (!same(fixed, original)) changed++;
        result.push(...fixed);
      } catch (e) {
        failed++;
        lastError = e.message;
        console.warn(`Claude review of ${id}, pages ${chunk.first}-${chunk.last}: ${e.message}`);
        result.push(...original);
        // Nothing is working (signed out, usage limit): stop instead of failing every page.
        if (failed === n + 1 && failed >= 2) break;
      }
      await setStatus(id, { done: n + 1 });
    }
    // Blocks on pages no chunk covered (shouldn't happen) are kept as they were.
    const covered = new Set(chunks.flatMap((c) => c.indices));
    blocks.forEach((b, i) => !covered.has(i) && result.push(b));
    if (result.length < blocks.length && failed === chunks.length) {
      // Every chunk failed and the loop stopped early: keep the paper exactly as converted.
      result.length = 0;
      result.push(...blocks);
    }

    if (!changed) {
      await setStatus(id, { status: failed ? 'failed' : 'done', finishedAt: Date.now(), changedSections: 0, failedSections: failed, error: failed ? lastError : undefined });
      return;
    }
    if (!hasOriginal) await fs.copyFile(contentFile, originalFile);
    const current = await lib.readJson(contentFile);
    await lib.writeJson(contentFile, { ...current, blocks: result });
    await lib.mutatePaper(id, (p) => {
      const oldCount = p.blockCount || blocks.length;
      p.blockCount = result.length;
      // Keep the reader roughly where it was if reading already started.
      if (p.position > 0) p.position = Math.min(result.length - 1, Math.round((p.position * result.length) / oldCount));
      const title = result.find((b) => b.kind === 'title');
      if (title?.text) p.title = title.text;
      p.review = { ...(p.review || {}), status: 'done', finishedAt: Date.now(), changedSections: changed, failedSections: failed, error: failed ? lastError : undefined };
    });
  }

  async function pump() {
    if (busy) return;
    busy = true;
    try {
      while (queue.length) {
        const id = queue.shift();
        try {
          if (!(await claudeAvailable())) {
            await setStatus(id, { status: 'unavailable' }).catch(() => {});
            continue;
          }
          await reviewPaper(id);
          console.log(`Claude review of ${id} finished.`);
        } catch (e) {
          console.warn(`Claude review of ${id} failed: ${e.message}`);
          await setStatus(id, { status: 'failed', finishedAt: Date.now(), error: e.message }).catch(() => {});
        }
      }
    } finally {
      busy = false;
    }
  }

  return {
    /** Queues a paper for review. Returns false (and leaves the paper alone) when Claude Code isn't here. */
    async enqueue(id) {
      if (!(await claudeAvailable())) return false;
      if (!queue.includes(id)) {
        queue.push(id);
        await setStatus(id, { status: 'queued', queuedAt: Date.now() });
      }
      void pump();
      return true;
    },
    /** Puts the converter's own text back. */
    async undo(id) {
      const dir = lib.paperDir(id);
      const originalFile = path.join(dir, 'content.original.json');
      const { blocks } = await lib.readJson(originalFile);
      const current = await lib.readJson(path.join(dir, 'content.json'));
      await lib.writeJson(path.join(dir, 'content.json'), { ...current, blocks });
      return lib.mutatePaper(id, (p) => {
        const oldCount = p.blockCount || blocks.length;
        p.blockCount = blocks.length;
        if (p.position > 0) p.position = Math.min(blocks.length - 1, Math.round((p.position * blocks.length) / oldCount));
        const title = blocks.find((b) => b.kind === 'title');
        if (title?.text) p.title = title.text;
        p.review = { status: 'undone', finishedAt: Date.now() };
      });
    },
    isQueued: (id) => queue.includes(id),
  };
}
