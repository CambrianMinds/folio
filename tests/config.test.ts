import { describe, it, expect } from 'vitest';
import { defaults, presets, validateConfig, configSchema, unitFactor } from '../src/config';
describe('document layouts', () => {
  it('validates every built-in preset', () => {
    for (const c of Object.values(presets)) expect(validateConfig(c)).toEqual(c);
  });
  it('rejects impossible printable areas and gutters', () => {
    expect(() => validateConfig({ ...defaults, marginLeft: 600 })).toThrow('narrow');
    expect(() => validateConfig({ ...defaults, columns: 2, rule: true, gutter: 1 })).toThrow(
      'gutter',
    );
  });
  it('migrates unversioned layouts with defaults', () =>
    expect(configSchema.parse({})).toEqual(defaults));
  it('refuses unsupported future schemas', () =>
    expect(() => configSchema.parse({ schemaVersion: 2 })).toThrow());
  it('keeps unit conversions reversible', () => {
    for (const f of Object.values(unitFactor)) expect((54 / f) * f).toBeCloseTo(54);
  });
});
