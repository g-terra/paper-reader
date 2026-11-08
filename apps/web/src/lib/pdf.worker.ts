// The pdf.js worker runs in its own global scope, so the page's polyfills don't reach it.
// Load them first, then the real worker (older iPads lack Promise.withResolvers, toHex, ...).
import '../polyfills';
import 'pdfjs-dist/legacy/build/pdf.worker.min.mjs';
