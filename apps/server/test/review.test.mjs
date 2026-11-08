import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeChunks, parseAnswer, validateBlocks } from '../review.mjs';

const para = (text, page = 1) => ({ kind: 'paragraph', role: 'body', text, page });
const fig = { kind: 'figure', imageId: 'img-1', page: 1, width: 100, height: 80, caption: 'Figure 1. Gaze', variant: 'figure' };
const chunk = { first: 1, last: 2 };

test('chunks follow logical pages and map spreads to PDF pages', () => {
  const blocks = [para('a', 1), para('b', 2), para('c', 3), para('d', 4)];
  const pages = [{ pdfPage: 1, half: 'left' }, { pdfPage: 1, half: 'right' }, { pdfPage: 2, half: 'left' }, { pdfPage: 2, half: 'right' }];
  const chunks = makeChunks(blocks, pages, 2);
  assert.deepEqual(chunks.map((c) => [c.first, c.last, c.pdfFrom, c.pdfTo, c.indices]), [[1, 2, 1, 1, [0, 1]], [3, 4, 2, 2, [2, 3]]]);
});

test('answers in a code fence are parsed', () => {
  assert.deepEqual(parseAnswer('Here you go:\n```json\n{"blocks":[{"kind":"title","text":"T","page":1}]}\n```'), [{ kind: 'title', text: 'T', page: 1 }]);
  assert.throws(() => parseAnswer('Sorry, I cannot.'));
});

test('valid fixes are kept and figures keep their image data', () => {
  const original = [para('Expert rnartial artists', 1), fig];
  const out = validateBlocks([{ kind: 'paragraph', role: 'body', text: 'Expert martial  artists', page: 1 }, { kind: 'figure', imageId: 'img-1', caption: 'Figure 1. Gaze.', page: 2 }], original, chunk);
  assert.deepEqual(out, [para('Expert martial artists', 1), { ...fig, caption: 'Figure 1. Gaze.', page: 2 }]);
});

test('dropped or duplicated figures are rejected', () => {
  assert.throws(() => validateBlocks([para('x')], [para('x'), fig], chunk), /dropped/);
  assert.throws(() => validateBlocks([fig, fig], [fig], chunk), /twice/);
  assert.throws(() => validateBlocks([{ ...fig, imageId: 'nope' }], [fig], chunk), /Unknown figure/);
});

test('answers that lose or invent lots of text are rejected', () => {
  const long = 'word '.repeat(100);
  assert.throws(() => validateBlocks([para('short summary')], [para(long)], chunk), /changed too much/);
  assert.throws(() => validateBlocks([para(long + long)], [para(long)], chunk), /changed too much/);
});

test('unknown roles become body and pages stay inside the chunk', () => {
  const out = validateBlocks([{ kind: 'paragraph', role: 'weird', text: 'a', page: 9 }, { kind: 'heading', level: 7, text: 'H', page: 2 }], [para('a'), para('H')], chunk);
  assert.deepEqual(out, [para('a', 1), { kind: 'heading', level: 2, text: 'H', page: 2 }]);
});
