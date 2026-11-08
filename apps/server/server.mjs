#!/usr/bin/env node
// Paper Reader server: serves the built web app over plain http on the local network and keeps the
// library (papers, extracted text, figures, original PDFs) in a folder on this computer.
//
//   PORT            port to listen on (default 4300)
//   PAPERS_DIR      where the library is kept (default ~/PaperReader)
//   PAPERS_HOSTNAME Bonjour name to announce, without .local (default "papers"; "" turns it off)
//   WEB_DIST        built web app to serve (default ../web/dist)

import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4300);
const LIBRARY = path.resolve(process.env.PAPERS_DIR || path.join(os.homedir(), 'PaperReader'));
const WEB = path.resolve(process.env.WEB_DIST || path.join(here, '../web/dist'));
const MDNS_NAME = process.env.PAPERS_HOSTNAME ?? 'papers';

const INCOMING = path.join(LIBRARY, '.incoming');
const TRASH = path.join(LIBRARY, '.trash');
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_UPLOAD = 1024 * 1024 * 1024; // 1 GB per file
const MAX_JSON = 64 * 1024 * 1024;
/** Fields of a paper that the reader may change after import. */
const EDITABLE = new Set(['progress', 'position', 'lastOpenedAt', 'title', 'authors']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf',
  '.gz': 'application/gzip',
  '.traineddata': 'application/octet-stream',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const exists = (p) => fs.stat(p).then(() => true, () => false);
const paperDir = (id) => path.join(LIBRARY, id);

function checkId(id) {
  if (!ID.test(id)) throw new HttpError(400, 'Bad id');
  return id;
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(data);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_JSON) throw new HttpError(413, 'Body too large');
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

/** Writes through a temp file so a crash never leaves half a paper.json behind. */
async function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value));
  await fs.rename(tmp, file);
}

async function sendFile(req, res, file, type, cache = 'no-cache') {
  let st;
  try {
    st = await fs.stat(file);
    if (!st.isFile()) throw new Error();
  } catch {
    throw new HttpError(404, 'Not found');
  }
  const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const headers = { 'content-type': type || 'application/octet-stream', 'cache-control': cache, etag, 'accept-ranges': 'bytes' };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : st.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : st.size - 1;
    start = Math.max(0, start);
    end = Math.min(end, st.size - 1);
    if (start > end) {
      res.writeHead(416, { 'content-range': `bytes */${st.size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return pipeline(createReadStream(file, { start, end }), res);
  }
  res.writeHead(200, { ...headers, 'content-length': st.size });
  if (req.method === 'HEAD') return res.end();
  return pipeline(createReadStream(file), res);
}

// ---------------------------------------------------------------------------------------------
// Library API

async function listPapers() {
  const entries = await fs.readdir(LIBRARY, { withFileTypes: true });
  const papers = [];
  for (const e of entries) {
    if (!e.isDirectory() || !ID.test(e.name)) continue;
    try {
      papers.push(await readJson(path.join(LIBRARY, e.name, 'paper.json')));
    } catch {
      // Not a paper folder (or a damaged one): skip it.
    }
  }
  return papers;
}

async function getPaper(id) {
  try {
    return await readJson(path.join(paperDir(id), 'paper.json'));
  } catch {
    throw new HttpError(404, 'Paper not found');
  }
}

/** Raw upload of one binary part of a paper that is being imported. */
async function receiveUpload(req, res, id, part, imageId) {
  const len = Number(req.headers['content-length'] || 0);
  if (len > MAX_UPLOAD) throw new HttpError(413, 'File too large');
  const dir = path.join(INCOMING, id, part === 'images' ? 'images' : '');
  await fs.mkdir(dir, { recursive: true });
  const name = part === 'images' ? imageId : part === 'file' ? 'original.pdf' : 'cover';
  const tmp = path.join(dir, `${name}.part`);
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_UPLOAD) req.destroy(new HttpError(413, 'File too large'));
  });
  await pipeline(req, createWriteStream(tmp));
  await fs.rename(tmp, path.join(dir, name));
  sendJson(res, 200, { ok: true, size });
}

/** Finishes an import: checks every uploaded part is there and moves the folder into the library. */
async function commitPaper(body) {
  const { paper, blocks, images } = body ?? {};
  if (!paper || typeof paper !== 'object' || !Array.isArray(blocks) || !Array.isArray(images)) throw new HttpError(400, 'Expected { paper, blocks, images }');
  const id = checkId(String(paper.id));
  const staging = path.join(INCOMING, id);
  if (await exists(paperDir(id))) throw new HttpError(409, 'A paper with this id already exists');
  for (const im of images) checkId(String(im.id));
  const needed = ['cover', 'original.pdf', ...images.map((im) => path.join('images', im.id))];
  for (const f of needed) {
    if (!(await exists(path.join(staging, f)))) throw new HttpError(400, `Missing upload: ${f}`);
  }
  await writeJson(path.join(staging, 'content.json'), { blocks });
  await writeJson(path.join(staging, 'images.json'), images.map((im) => ({ id: im.id, width: im.width, height: im.height, type: im.type || 'image/png' })));
  await writeJson(path.join(staging, 'paper.json'), paper);
  await fs.rename(staging, paperDir(id));
  return paper;
}

async function updatePaper(id, patch) {
  const paper = await getPaper(id);
  for (const [k, v] of Object.entries(patch ?? {})) if (EDITABLE.has(k)) paper[k] = v;
  await writeJson(path.join(paperDir(id), 'paper.json'), paper);
  return paper;
}

/** Removing a paper moves it to .trash in the library folder, so nothing is lost by a wrong tap. */
async function removePaper(id) {
  if (!(await exists(paperDir(id)))) throw new HttpError(404, 'Paper not found');
  await fs.mkdir(TRASH, { recursive: true });
  await fs.rename(paperDir(id), path.join(TRASH, `${id}-${Date.now()}`));
}

async function imageType(id, imageId) {
  try {
    const list = await readJson(path.join(paperDir(id), 'images.json'));
    return list.find((im) => im.id === imageId)?.type || 'image/png';
  } catch {
    return 'image/png';
  }
}

async function handleApi(req, res, parts) {
  // parts: ['api', 'papers', id?, sub?, subId?]  or  ['api', 'uploads', id, part, imageId?]
  const [, area, rawId, sub, subId] = parts;
  const m = req.method;
  if (area === 'health') return sendJson(res, 200, { ok: true, library: LIBRARY });

  if (area === 'uploads' && rawId && m === 'PUT') {
    const id = checkId(rawId);
    if (sub === 'images' && subId) return receiveUpload(req, res, id, 'images', checkId(subId));
    if (sub === 'cover' || sub === 'file') return receiveUpload(req, res, id, sub);
    throw new HttpError(404, 'Unknown upload');
  }
  if (area === 'uploads' && rawId && m === 'DELETE') {
    await fs.rm(path.join(INCOMING, checkId(rawId)), { recursive: true, force: true });
    return sendJson(res, 200, { ok: true });
  }

  if (area !== 'papers') throw new HttpError(404, 'Not found');
  if (!rawId) {
    if (m === 'GET') return sendJson(res, 200, await listPapers());
    if (m === 'POST') return sendJson(res, 201, await commitPaper(await readJsonBody(req)));
    throw new HttpError(405, 'Method not allowed');
  }
  const id = checkId(rawId);
  if (!sub) {
    if (m === 'GET') return sendJson(res, 200, await getPaper(id));
    if (m === 'PATCH') return sendJson(res, 200, await updatePaper(id, await readJsonBody(req)));
    if (m === 'DELETE') return (await removePaper(id), sendJson(res, 200, { ok: true }));
    throw new HttpError(405, 'Method not allowed');
  }
  if (m !== 'GET' && m !== 'HEAD') throw new HttpError(405, 'Method not allowed');
  const dir = paperDir(id);
  const immutable = 'private, max-age=31536000, immutable';
  if (sub === 'content') return sendFile(req, res, path.join(dir, 'content.json'), MIME['.json'], 'no-cache');
  if (sub === 'cover') {
    const p = await getPaper(id);
    return sendFile(req, res, path.join(dir, 'cover'), p.coverType || 'image/jpeg', immutable);
  }
  if (sub === 'file') return sendFile(req, res, path.join(dir, 'original.pdf'), MIME['.pdf'], immutable);
  if (sub === 'images' && subId) return sendFile(req, res, path.join(dir, 'images', checkId(subId)), await imageType(id, subId), immutable);
  throw new HttpError(404, 'Not found');
}

// ---------------------------------------------------------------------------------------------
// Static web app

async function handleStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(WEB, '.' + rel);
  if (!file.startsWith(WEB + path.sep)) throw new HttpError(403, 'Forbidden');
  const ext = path.extname(file).toLowerCase();
  // Vite puts content-hashed files in /assets: they never change, so let browsers keep them.
  const cache = rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  try {
    return await sendFile(req, res, file, MIME[ext], cache);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404 && !ext) return sendFile(req, res, path.join(WEB, 'index.html'), MIME['.html']);
    throw e;
  }
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  try {
    const { pathname } = new URL(req.url || '/', 'http://x');
    const parts = pathname.split('/').filter(Boolean);
    if (parts[0] === 'api') await handleApi(req, res, parts);
    else await handleStatic(req, res, pathname);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) sendJson(res, status, { error: e.message || 'Server error' });
    else res.destroy();
  } finally {
    if (process.env.LOG_REQUESTS) console.log(req.method, req.url, res.statusCode, `${Date.now() - started}ms`);
  }
});

// ---------------------------------------------------------------------------------------------
// LAN address and Bonjour name

function lanAddress() {
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (/^(lo|utun|awdl|llw|bridge|anpi|ap)/.test(name)) continue;
    for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return undefined;
}

let mdns;
let mdnsIp;
/**
 * Announces "<name>.local" with the Mac's own Bonjour responder (dns-sd -P), so any phone or
 * tablet on the same network can open http://<name>.local:<port>. Re-announced when the IP changes.
 */
function announce() {
  if (!MDNS_NAME || process.platform !== 'darwin') return;
  const ip = lanAddress();
  if (ip === mdnsIp && mdns && mdns.exitCode === null) return;
  mdns?.kill();
  mdnsIp = ip;
  if (!ip) return;
  mdns = spawn('dns-sd', ['-P', 'Paper Reader', '_http._tcp', 'local', String(PORT), `${MDNS_NAME}.local`, ip, 'path=/'], { stdio: 'ignore' });
  mdns.on('error', (e) => console.warn(`Could not announce ${MDNS_NAME}.local: ${e.message}`));
}

function shutdown() {
  mdns?.kill();
  server.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await fs.mkdir(INCOMING, { recursive: true });
if (!(await exists(path.join(WEB, 'index.html')))) {
  console.error(`No web build found at ${WEB}. Run "pnpm build" first (or use "pnpm start", which builds for you).`);
  process.exit(1);
}
// Imports that never finished (closed tab, lost Wi-Fi) leave a staging folder behind.
for (const e of await fs.readdir(INCOMING)) await fs.rm(path.join(INCOMING, e), { recursive: true, force: true });

server.listen(PORT, '0.0.0.0', () => {
  announce();
  setInterval(announce, 30_000).unref();
  const host = os.hostname().replace(/\.local$/, '');
  const ip = lanAddress();
  console.log(`Paper Reader is running. Library folder: ${LIBRARY}`);
  console.log(`  On this Mac:        http://localhost:${PORT}`);
  if (MDNS_NAME && process.platform === 'darwin') console.log(`  On your network:    http://${MDNS_NAME}.local:${PORT}`);
  console.log(`  Also:               http://${host}.local:${PORT}${ip ? `  or  http://${ip}:${PORT}` : ''}`);
});
