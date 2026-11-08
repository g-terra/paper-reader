import { describe, expect, it } from 'vitest';
import type { Block } from '../src/types';
import { composeAccents, segmentToLine, type Glyph } from '../src/lines';
import { findAuthors, tidyFrontNotes, tidyHeadings } from '../src/layout';

const front = (text: string): Block => ({ kind: 'paragraph', role: 'front', text, page: 1 });
const g = (str: string, x: number, y: number, size: number): Glyph => ({ str, x, y, w: str.length * size * 0.5, size, bold: false, italic: false, math: false });

describe('front matter from real papers', () => {
  it('drops combined affiliation markers like "a,b" and "a,*"', () => {
    const line = segmentToLine([g('Tim Buszard', 100, 150, 10.5), g('a,b', 160, 145, 7), g('and Rich Masters', 170, 150, 10.5)], 1)!;
    expect(line.text).toBe('Tim Buszard and Rich Masters');
    const mori = segmentToLine([g('Shuji Mori', 100, 225, 13), g('a,*', 160, 220.5, 8.6), g(', Yoshio Ohtani', 172, 225, 13)], 1)!;
    expect(mori.text).toBe('Shuji Mori*, Yoshio Ohtani');
  });

  it('composes TeX accents', () => {
    expect(composeAccents('Cl´audio Janu´ario, S˜ao Jo˜ao, na¨ıve')).toBe('Cláudio Januário, São João, naïve');
    expect(composeAccents('``quoted')).toBe('``quoted');
  });

  it('reads authors after the title and skips labels, editors and affiliations', () => {
    const blocks: Block[] = [
      front('OPEN ACCESS'),
      front('EDITED BY'),
      front('Elizabeth Thomas, Université de Bourgogne, France'),
      { kind: 'title', text: 'Mutual interference', page: 1 },
      { kind: 'heading', level: 2, text: 'Annalena Monz, Kathrin Morbe, Markus Klein and Sabine Schaefer*', page: 1 },
      front('Institute of Sport Sciences, Saarland University, Saarbrücken, Germany'),
    ];
    expect(findAuthors(blocks)).toEqual({ names: ['Annalena Monz', 'Kathrin Morbe', 'Markus Klein', 'Sabine Schaefer'], indexes: [4] });
    const wulf: Block[] = [{ kind: 'title', text: 'Attentional focus', page: 1 }, front('Gabriele Wulf*'), front('Department of Kinesiology and Nutrition Sciences, University of Nevada, Las Vegas, NV, USA')];
    expect(findAuthors(wulf).names).toEqual(['Gabriele Wulf']);
    const anderson: Block[] = [{ kind: 'title', text: 'Acquisition', page: 1 }, front('John R. Anderson Carnegie-Mellon University')];
    expect(findAuthors(anderson).names).toEqual(['John R. Anderson']);
    const masters: Block[] = [{ kind: 'title', text: 'Knowledge', page: 1 }, front('R. S. W. Masters* Department of Psychology, University of York, Heslington, York YO1 5DD, UK')];
    expect(findAuthors(masters).names).toEqual(['R. S. W. Masters']);
  });

  it('joins a title that ends mid-phrase and moves footnotes out of the abstract', () => {
    const blocks: Block[] = [
      { kind: 'title', text: 'The breakdown of a complex motor skill under', page: 1 },
      front('pressure'),
      { kind: 'paragraph', role: 'abstract', text: 'We studied things.', page: 1 },
      { kind: 'paragraph', role: 'abstract', text: '* Corresponding author. Tel.: +81-426.', page: 1 },
    ];
    tidyFrontNotes(blocks);
    expect(blocks[0]).toMatchObject({ text: 'The breakdown of a complex motor skill under pressure' });
    expect(blocks.map((b) => (b.kind === 'paragraph' ? b.role : b.kind))).toEqual(['title', 'abstract', 'note']);
  });

  it('demotes numbered lists and repeated table headers', () => {
    const h = (text: string): Block => ({ kind: 'heading', level: 2, text, page: 1 });
    const blocks: Block[] = [h('1. Feet apart'), h('2. Lean forward'), h('3. Aim ball'), h('Discussion'), ...Array(4).fill(h('EF, IF')), ...Array(4).fill(h('Results'))];
    tidyHeadings(blocks);
    expect(blocks.map((b) => b.kind)).toEqual([...Array(3).fill('paragraph'), 'heading', ...Array(4).fill('paragraph'), ...Array(4).fill('heading')]);
    const echo: Block[] = [h('69.4 THE EMERGENCE'), { kind: 'paragraph', role: 'body', text: 'x', page: 1 }, h('69.4 THE EMERGENCE')];
    tidyHeadings(echo);
    expect(echo).toHaveLength(2);
  });
});
