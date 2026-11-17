import { it, expect } from 'vitest';
import { historyReducer, type History } from '../src/history';
import { defaults } from '../src/config';
it('undoes a command atomically and restores it on redo', () => {
  const initial: History = { present: defaults, past: [], future: [], label: 'Initial', time: 0 };
  const changed = historyReducer(initial, {
    type: 'set',
    value: { ...defaults, columns: 2, rule: true },
    label: 'Command',
    time: 1,
  });
  const undone = historyReducer(changed, { type: 'undo' });
  expect(undone.present).toEqual(defaults);
  expect(historyReducer(undone, { type: 'redo' }).present).toEqual(changed.present);
});
it('clears redo after a new change and resets between documents', () => {
  let h: History = { present: defaults, past: [], future: [], label: 'Initial', time: 0 };
  h = historyReducer(h, { type: 'set', value: { ...defaults, columns: 2 }, label: 'A', time: 1 });
  h = historyReducer(h, { type: 'undo' });
  h = historyReducer(h, { type: 'set', value: { ...defaults, gutter: 30 }, label: 'B', time: 2 });
  expect(h.future).toHaveLength(0);
  expect(historyReducer(h, { type: 'reset', value: defaults }).past).toHaveLength(0);
});
