import { it, expect } from 'vitest';
import { parseCommand } from '../src/commands';
import { defaults } from '../src/config';
const fonts = ['Georgia', 'Arial', 'Times New Roman'];
// A cross-product checks that combined clauses do not overwrite unrelated values.
for (const columns of [1, 2, 3])
  for (const [text, points] of [
    ['half-inch', 36],
    ['18 mm', (18 * 72) / 25.4],
    ['42 pt', 42],
  ] as const)
    for (const font of fonts)
      for (const size of [9, 11]) {
        const request = `Please use ${columns} columns, ${text} margins, ${font} ${size} point, and a thin gray rule. Keep everything else.`;
        it(request, () => {
          const before = {
            ...defaults,
            header: 'Unchanged header',
            footer: 'Unchanged footer',
            textColor: '#29384a',
            gutter: 24,
          };
          const result = parseCommand(request, before, fonts);
          expect(result.kind).toBe('layout');
          if (result.kind !== 'layout') return;
          for (const key of ['marginTop', 'marginBottom', 'marginLeft', 'marginRight'] as const)
            expect(result.config[key]).toBeCloseTo(points, 10);
          expect({
            ...result.config,
            marginTop: points,
            marginBottom: points,
            marginLeft: points,
            marginRight: points,
          }).toEqual({
            ...before,
            columns,
            marginTop: points,
            marginBottom: points,
            marginLeft: points,
            marginRight: points,
            bodyFont: font,
            fontSize: size,
            rule: true,
            ruleWidth: 0.4,
            ruleColor: '#808080',
          });
        });
      }
