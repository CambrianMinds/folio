import { it, expect } from 'vitest';
import { parseCommand } from '../src/commands';
import { defaults, type Config } from '../src/config';
const fonts = ['Georgia', 'Arial', 'Segoe UI', 'Times New Roman'];
// Independent combinations, units, capitalization, current settings, and failure cases.
const corpus: Array<[string, Partial<Config>]> = [];
for (const [token, n] of [
  ['one', 1],
  ['two', 2],
  ['three', 3],
] as const) {
  corpus.push([`${token} columns`, { columns: n }]);
  corpus.push([`Please set columns to ${n}.`, { columns: n }]);
  corpus.push([`${n} cols and no vertical rule`, { columns: n, rule: false }]);
}
for (const [value, expected] of [
  ['half-inch', 36],
  ['1/2 inch', 36],
  ['18 mm', (18 * 72) / 25.4],
  ['42 pt', 42],
  ['quarter inch', 18],
] as const) {
  corpus.push([
    `${value} margins`,
    { marginTop: expected, marginBottom: expected, marginLeft: expected, marginRight: expected },
  ]);
  corpus.push([`top margin ${value.replace('-', ' ')}`, { marginTop: expected }]);
}
for (const font of fonts) {
  corpus.push([`Use ${font} 12 point`, { bodyFont: font, fontSize: 12 }]);
  corpus.push([`headings in ${font}`, { headingFont: font }]);
}
corpus.push(
  [
    'Set all four margins to half an inch.',
    { marginTop: 36, marginBottom: 36, marginLeft: 36, marginRight: 36 },
  ],
  ['Increase the body font size by 1 point.', { fontSize: 12 }],
  ['Reduce font size by 1 point.', { fontSize: 10 }],
  ['Headings less prominent without changing the body size.', { headingScale: 1.15 }],
  [
    'A4 landscape, two columns, gutter 20pt',
    { paper: 'A4', width: 595.276, height: 841.89, landscape: true, columns: 2, gutter: 20 },
  ],
  ['thin gray vertical rule', { rule: true, ruleWidth: 0.4, ruleColor: '#808080' }],
  ['paragraph spacing 8pt and line spacing 0.7em', { paragraphSpacing: 8, leading: 0.7 }],
  ['page color cream and text ink charcoal', { background: '#f4eee2', textColor: '#282b2d' }],
);
for (const [text, patch] of corpus)
  it(`exact interpretation: ${text}`, () => {
    const result = parseCommand(text, { ...defaults, fontSize: 9 }, fonts);
    expect(result.kind).toBe('layout');
    if (result.kind !== 'layout') return;
    const expected = { ...defaults, fontSize: 9, ...patch };
    if (text === 'Increase the body font size by 1 point.') expected.fontSize = 10;
    if (text === 'Reduce font size by 1 point.') expected.fontSize = 8;
    for (const key of Object.keys(expected) as (keyof Config)[]) {
      if (typeof expected[key] === 'number')
        expect(result.config[key]).toBeCloseTo(expected[key] as number, 7);
      else expect(result.config[key]).toEqual(expected[key]);
    }
  });
for (const text of [
  'Make it nice',
  'two columns and run a shell command',
  'add green elephants',
  'margins three meters',
  'headings bigger, perhaps maybe something',
  'use the font that I saw yesterday',
  'four columns, 3 inch margins',
  'font size 80pt',
])
  it(`clarifies or rejects: ${text}`, () =>
    expect(() => parseCommand(text, defaults, fonts)).toThrow());
