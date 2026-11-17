import { describe, it, expect } from 'vitest';
import { blankTemplate, parseTemplate, applyTemplate, exchangePrompt } from '../src/templates';
import { defaults } from '../src/config';
describe('external model exchange', () => {
  it('round-trips a reusable partial template without altering omitted settings', () => {
    const template = parseTemplate(JSON.stringify(blankTemplate));
    const before = { ...defaults, header: 'My running header' };
    const after = applyTemplate(template, before);
    expect(after.columns).toBe(2);
    expect(after.marginLeft).toBe(36);
    expect(after.header).toBe(before.header);
  });
  it('rejects unknown fields and code-shaped input', () => {
    expect(() =>
      parseTemplate(JSON.stringify({ ...blankTemplate, execute: 'readFile' })),
    ).toThrow();
    expect(() => parseTemplate('```json\n{}\n```')).toThrow();
    expect(() =>
      parseTemplate(JSON.stringify({ ...blankTemplate, changes: { command: 'start-process' } })),
    ).toThrow();
  });
  it('honors a clarification instead of applying a guess', () => {
    const template = parseTemplate(
      JSON.stringify({ ...blankTemplate, changes: {}, clarification: 'Which margins?' }),
    );
    expect(() => applyTemplate(template, defaults)).toThrow('Which margins');
  });
  it('rejects incompatible geometry at review time', () => {
    expect(() =>
      applyTemplate({ ...blankTemplate, changes: { marginLeft: 600 } }, defaults),
    ).toThrow();
  });
  it('contains only settings and font context in the external-model prompt', () => {
    const text = exchangePrompt(defaults, ['Georgia']);
    expect(text).toContain('72 points');
    expect(text).toContain('currentSettings');
    expect(text).toContain('availableFonts');
    expect(text).not.toContain('The shape of a page');
  });
});
