# Paper Reader

A Kindle-style reader for academic papers. Drop in a PDF (digital or scanned) and it is turned into
reflowable, comfortable text with figures, tables and equations kept as images. Works on phones,
tablets and desktops, installs to the home screen, and keeps everything on your device.

## Features

- **Import any paper PDF**, including scans. Pages without a usable text layer are read with OCR
  (Tesseract, running in the browser). Two-page scanned spreads are detected and split into pages.
- **Rebuilds the reading flow**: multi-column layouts, paragraphs that run across columns and pages,
  de-hyphenation, section headings, abstract, references and captions. Running headers, footers,
  page numbers and arXiv stamps are removed.
- **Keeps the pictures**: figures (vector or raster), ruled tables and display equations are cropped
  from the page and shown inline with their captions. Tap a figure to zoom.
- **Kindle-like reader**: Paper, Sepia, Sage, Dusk and Night themes; Literata, Source Serif,
  Atkinson Hyperlegible, Inter or system fonts; text size, line spacing, margins, justification;
  page-turn mode (tap or swipe) or continuous scroll; two pages side by side on iPad landscape.
- **Navigation**: contents with sections, figures and tables; position slider; minutes left;
  original page numbers; a view of the original PDF page for anything the reflow can't capture.
- **Library**: covers, reading progress, "continue reading", search and sort.
- **One library for all your devices**: a small server on your computer keeps the papers in a folder
  (`~/PaperReader` by default) and serves the app on your network, so the iPad, the phone and the
  laptop all see the same papers and reading positions.

## Layout

```
apps/web               React + TypeScript + Vite app (Tailwind CSS v4 + Material UI v7)
apps/server            Node server (no dependencies): serves the app and stores the library
packages/pdf-ingest    The PDF to reading-blocks pipeline (pdf.js + Tesseract.js)
fixtures               Sample papers (two-column, scanned, scanned spreads) and their generator
e2e                    Playwright scripts that import the fixtures and take screenshots
```

## Getting started

Needs Node 20+ and pnpm.

```bash
pnpm install
pnpm start        # builds the app and serves it on http://papers.local:4300
pnpm dev          # development: Vite with hot reload (run `pnpm serve` alongside for the library API)
pnpm test         # unit tests for the layout engine
```

`pnpm start` prints the addresses it is reachable on. On a Mac it announces `papers.local` over
Bonjour, so any iPad, iPhone or computer on the same Wi-Fi can open `http://papers.local:4300`
(the Mac's own name, `http://<computer-name>.local:4300`, works too). It is plain http, meant for
your home network only; there is no login.

| Setting           | Default        | What it does                                  |
| ----------------- | -------------- | --------------------------------------------- |
| `PORT`            | `4300`         | Port to listen on                             |
| `PAPERS_DIR`      | `~/PaperReader`| Library folder (one sub-folder per paper)     |
| `PAPERS_HOSTNAME` | `papers`       | Bonjour name to announce; empty turns it off  |

Each paper folder holds `paper.json` (title, authors, reading position), `content.json` (the
reflowed text), `images/`, `cover` and `original.pdf`. Removing a paper in the app moves its folder
to `.trash` inside the library folder.

PDF import (including OCR) still runs in the browser of the device you import from; the result is
uploaded to the server. The OCR engine, its English language data and the pdf.js fonts are copied
from `node_modules` into `apps/web/public` by `apps/web/scripts/copy-assets.mjs` before `dev` and
`build`, so nothing is fetched from a CDN.

## How the import works

1. **Per page**, pdf.js gives the text runs (with font, size and position) and the drawing
   operations. Drawing operations are scanned for embedded images, vector drawings and ruled
   tables, which become figure candidates.
2. **Scanned pages** (no usable text, mostly one big image) are rendered and OCR'd. Two-page
   spreads are split at the gutter. Inked areas not covered by recognised words become figures,
   and lines the OCR can't read (usually equations) are kept as images.
3. **Lines and columns**: words are grouped into rows, column gutters are found from where rows
   are consistently empty, and rows are split at the gutters.
4. **Document clean-up**: repeated headers and footers and page numbers are dropped, the body text
   size and line spacing are measured, and figure regions absorb nearby small text (axis labels,
   legends).
5. **Reading order and blocks**: lines are ordered column by column between full-width elements,
   display equations are detected, and lines are joined into paragraphs and headings. Captions are
   attached to their figures. Title, authors and abstract are taken from the first page.
6. Figures are cropped from a high-resolution render and uploaded with the text to the library server.

## Testing with the fixtures

```bash
python3 fixtures/make_fixtures.py      # regenerate the sample PDFs (needs reportlab, pillow, pypdfium2)
pnpm start &
node e2e/ingest-dump.mjs fixtures/two-column-paper.pdf /tmp/out   # print the extracted blocks
node e2e/screens.mjs /tmp/screens                                  # phone / iPad screenshots
```
