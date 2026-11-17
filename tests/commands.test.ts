import { describe, it, expect } from 'vitest';
import { defaults } from '../src/config';
import { parseCommand, fitCandidates, validateModelPatch } from '../src/commands';
const fonts = ['Georgia', 'Arial', 'Times New Roman', 'Segoe UI'];
function layout(text: string) {
  const result = parseCommand(text, defaults, fonts);
  if (result.kind !== 'layout') throw Error('Expected layout');
  return result.config;
}
describe('local composition commands', () => {
  it('interprets the complete example without resetting unrelated settings', () => {
    const c = layout(
      'Two columns, half-inch margins, Georgia 11 point, and a thin gray rule between columns. Keep everything else.',
    );
    expect(c.columns).toBe(2);
    expect(c.marginLeft).toBe(36);
    expect(c.marginTop).toBe(36);
    expect(c.rule).toBe(true);
    expect(c.ruleColor).toBe('#808080');
    expect(c.fontSize).toBe(11);
    expect(c.header).toBe(defaults.header);
  });
  it('interprets relative changes visibly', () => {
    const c = layout('Widen the gutter slightly and make the headings less prominent.');
    expect(c.gutter).toBe(21);
    expect(c.headingScale).toBeCloseTo(1.15);
    expect(c.fontSize).toBe(11);
  });
  it('understands units, side margins, fonts and orientation', () => {
    const c = layout(
      'left margin 15 mm, right margin 20mm, gutter 12pt, headings in Segoe UI, body Times New Roman, landscape',
    );
    expect(c.marginLeft).toBeCloseTo((15 * 72) / 25.4);
    expect(c.marginRight).toBeCloseTo((20 * 72) / 25.4);
    expect(c.gutter).toBe(12);
    expect(c.headingFont).toBe('Segoe UI');
    expect(c.bodyFont).toBe('Times New Roman');
    expect(c.landscape).toBe(true);
  });
  it('removes rules and refuses ignored clauses', () => {
    expect(layout('no vertical rule').rule).toBe(false);
    expect(() => layout('two columns and dance like a penguin')).toThrow('interpret');
  });
  it('rejects impossible geometry', () =>
    expect(() => layout('four columns, 3 inch margins')).toThrow());
  it('parses a target with a lower bound', () =>
    expect(
      parseCommand(
        'Fit this into four pages, keeping body text at least 10 points.',
        defaults,
        fonts,
      ),
    ).toEqual({ kind: 'fit', pages: 4, minimum: 10 }));
  it('refuses model fields outside the layout schema', () => {
    expect(() => validateModelPatch({ title: 'rewrite source' }, defaults)).toThrow();
    expect(() => validateModelPatch({ columns: 100 }, defaults)).toThrow();
  });
  it('keeps fit candidates bounded and reaches the lower bound', () => {
    const candidates = fitCandidates(defaults, 9);
    expect(candidates.length).toBeLessThanOrEqual(40);
    expect(Math.min(...candidates.map((c) => c.fontSize))).toBe(9);
    for (const c of candidates) {
      expect(c.columns).toBe(defaults.columns);
      expect(c.marginLeft).toBe(defaults.marginLeft);
      expect(c.bodyFont).toBe(defaults.bodyFont);
    }
  });
});
