import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  emptyHistory,
  parseRanges,
  reduceHistory,
  sourcePages,
  splitDocument,
  type DocumentState,
} from '../src/organizerModel';
const make = (): DocumentState => ({
  pages: [0, 1, 2, 3, 4].map((i) => ({ id: `p${i}`, sourceId: 'a', pageIndex: i, rotation: 0 })),
  splitAfter: [],
});
describe('logical organizer document', () => {
  it('inserts and merges sources in selected order', () => {
    const pages = sourcePages('b', [0, 1]);
    const state = applyCommand(make(), { type: 'insert', pages, at: 2 });
    expect(state.pages.map((p) => p.sourceId)).toEqual(['a', 'a', 'b', 'b', 'a', 'a', 'a']);
    expect(state.pages.slice(2, 4).map((p) => p.pageIndex)).toEqual([0, 1]);
  });
  it('moves noncontiguous selections preserving document order', () => {
    expect(
      applyCommand(make(), { type: 'move', ids: ['p3', 'p1'], at: 5 }).pages.map((p) => p.id),
    ).toEqual(['p0', 'p2', 'p4', 'p1', 'p3']);
    expect(
      applyCommand(make(), { type: 'move', ids: ['p3', 'p1'], at: 0 }).pages.map((p) => p.id),
    ).toEqual(['p1', 'p3', 'p0', 'p2', 'p4']);
  });
  it('duplicates immediately after the selected group with independent identities and rotations', () => {
    const rotated = applyCommand(make(), { type: 'rotate', ids: ['p1'], degrees: 90 });
    const state = applyCommand(rotated, {
      type: 'duplicate',
      ids: ['p3', 'p1'],
      newIds: ['c1', 'c3'],
    });
    expect(state.pages.map((p) => p.id)).toEqual(['p0', 'p1', 'p2', 'p3', 'c1', 'c3', 'p4']);
    expect(state.pages[4]).toEqual({ ...rotated.pages[1], id: 'c1' });
    expect(
      applyCommand(state, { type: 'rotate', ids: ['c1'], degrees: 90 }).pages[1].rotation,
    ).toBe(90);
  });
  it('deletes only logical pages and removes orphan split points', () => {
    const original = make();
    const split = applyCommand(original, { type: 'split', after: 'p1' });
    const next = applyCommand(split, { type: 'delete', ids: ['p1'] });
    expect(next.pages).toHaveLength(4);
    expect(next.splitAfter).toEqual([]);
    expect(original.pages).toHaveLength(5);
  });
  it('normalizes clockwise, counterclockwise and repeated rotations', () => {
    let state = make();
    for (const angle of [90, 180, 270, 0]) {
      state = applyCommand(state, { type: 'rotate', ids: ['p0'], degrees: 90 });
      expect(state.pages[0].rotation).toBe(angle);
    }
    expect(
      applyCommand(state, { type: 'rotate', ids: ['p0', 'p1'], degrees: -90 })
        .pages.slice(0, 2)
        .map((p) => p.rotation),
    ).toEqual([270, 270]);
  });
  it('undoes and redoes every supported operation including insertion and split points', () => {
    let history = emptyHistory();
    const commands = [
      { type: 'insert', pages: make().pages, at: 0 },
      { type: 'move', ids: ['p0'], at: 5 },
      { type: 'duplicate', ids: ['p1'], newIds: ['c1'] },
      { type: 'rotate', ids: ['c1'], degrees: 90 },
      { type: 'split', after: 'c1' },
      { type: 'delete', ids: ['p2'] },
    ] as const;
    for (const command of commands)
      history = reduceHistory(history, JSON.parse(JSON.stringify(command)));
    const final = history.present;
    for (let i = 0; i < commands.length; i++) history = reduceHistory(history, { type: 'undo' });
    expect(history.present).toEqual(emptyHistory().present);
    for (let i = 0; i < commands.length; i++) history = reduceHistory(history, { type: 'redo' });
    expect(history.present).toEqual(final);
    history = reduceHistory(history, { type: 'undo' });
    expect(reduceHistory(history, { type: 'rotate', ids: ['p0'], degrees: 90 }).future).toEqual([]);
  });
  it('parses one-based output ranges and validates invalid input', () => {
    expect(parseRanges('1-5, 8, 12-16', 16)).toEqual([0, 1, 2, 3, 4, 7, 11, 12, 13, 14, 15]);
    expect(parseRanges('2, 1-3, 2', 5)).toEqual([0, 1, 2]);
    for (const input of ['', '0', '1-6', '4-2', 'a', '1,,2', '1.5', '1-2-3'])
      expect(() => parseRanges(input, 5)).toThrow();
  });
  it('splits at page boundaries, supports single-page batches and ignores a trailing split', () => {
    const state = { ...make(), splitAfter: ['p1', 'p4'] };
    expect(splitDocument(state).map((p) => p.length)).toEqual([2, 3]);
    expect(splitDocument(state, true).map((p) => p.length)).toEqual([1, 1, 1, 1, 1]);
    expect(splitDocument({ pages: [], splitAfter: [] })).toEqual([]);
  });
  it('handles 500 pages without touching source PDFs', () => {
    const pages = sourcePages(
      'large',
      Array.from({ length: 500 }, (_, i) => i),
    );
    const state = applyCommand(
      { pages, splitAfter: [] },
      { type: 'move', ids: pages.slice(200, 300).map((p) => p.id), at: 0 },
    );
    expect(state.pages).toHaveLength(500);
    expect(state.pages[0].pageIndex).toBe(200);
    expect(new Set(state.pages.map((p) => p.id)).size).toBe(500);
  });
});
