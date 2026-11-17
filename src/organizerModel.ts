export interface OrganizerPage {
  id: string;
  sourceId: string;
  pageIndex: number;
  rotation: number;
}
export interface DocumentState {
  pages: OrganizerPage[];
  splitAfter: string[];
}
export interface OrganizerHistory {
  present: DocumentState;
  past: DocumentState[];
  future: DocumentState[];
}
export type PageCommand =
  | { type: 'insert'; pages: OrganizerPage[]; at: number }
  | { type: 'move'; ids: string[]; at: number }
  | { type: 'delete'; ids: string[] }
  | { type: 'duplicate'; ids: string[]; newIds: string[] }
  | { type: 'rotate'; ids: string[]; degrees: number }
  | { type: 'split'; after: string }
  | { type: 'replace'; pages: OrganizerPage[] };
export const emptyHistory = (): OrganizerHistory => ({
  present: { pages: [], splitAfter: [] },
  past: [],
  future: [],
});
export function sourcePages(sourceId: string, indices: number[]): OrganizerPage[] {
  return indices.map((pageIndex) => ({
    id: crypto.randomUUID(),
    sourceId,
    pageIndex,
    rotation: 0,
  }));
}
export function applyCommand(state: DocumentState, command: PageCommand): DocumentState {
  let pages = state.pages;
  let splitAfter = state.splitAfter;
  const ids = new Set('ids' in command ? command.ids : []);
  switch (command.type) {
    case 'insert': {
      const at = Math.max(0, Math.min(pages.length, command.at));
      pages = [...pages.slice(0, at), ...command.pages, ...pages.slice(at)];
      break;
    }
    case 'move': {
      const group = pages.filter((p) => ids.has(p.id));
      const at = command.at - pages.slice(0, command.at).filter((p) => ids.has(p.id)).length;
      const rest = pages.filter((p) => !ids.has(p.id));
      pages = [...rest.slice(0, at), ...group, ...rest.slice(at)];
      break;
    }
    case 'delete':
      pages = pages.filter((p) => !ids.has(p.id));
      break;
    case 'duplicate': {
      const group = pages.filter((p) => ids.has(p.id));
      if (!group.length) return state;
      const at = pages.findIndex((p) => p.id === group[group.length - 1].id) + 1;
      const copies = group.map((p, i) => ({ ...p, id: command.newIds[i] }));
      pages = [...pages.slice(0, at), ...copies, ...pages.slice(at)];
      break;
    }
    case 'rotate':
      pages = pages.map((p) =>
        ids.has(p.id) ? { ...p, rotation: (p.rotation + command.degrees + 360) % 360 } : p,
      );
      break;
    case 'split':
      splitAfter = splitAfter.includes(command.after)
        ? splitAfter.filter((id) => id !== command.after)
        : [...splitAfter, command.after];
      break;
    case 'replace':
      return { pages: command.pages, splitAfter: [] };
  }
  const remaining = new Set(pages.map((p) => p.id));
  return { pages, splitAfter: splitAfter.filter((id) => remaining.has(id)) };
}
export function reduceHistory(
  history: OrganizerHistory,
  command: PageCommand | { type: 'undo' | 'redo' },
): OrganizerHistory {
  if (command.type === 'undo') {
    if (!history.past.length) return history;
    return {
      present: history.past[history.past.length - 1],
      past: history.past.slice(0, -1),
      future: [history.present, ...history.future],
    };
  }
  if (command.type === 'redo') {
    if (!history.future.length) return history;
    return {
      present: history.future[0],
      past: [...history.past, history.present],
      future: history.future.slice(1),
    };
  }
  const present = applyCommand(history.present, command as PageCommand);
  if (JSON.stringify(present) === JSON.stringify(history.present)) return history;
  return { present, past: [...history.past.slice(-99), history.present], future: [] };
}
export function parseRanges(input: string, count: number): number[] {
  if (!input.trim()) throw Error('Enter page numbers, such as 1-5, 8.');
  const pages = new Set<number>();
  for (const part of input.split(',')) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
    if (!match) throw Error('Use page numbers and ascending ranges, such as 1-5, 8.');
    const start = Number(match[1]),
      end = Number(match[2] ?? match[1]);
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 1 ||
      end > count ||
      end < start
    )
      throw Error(`Page ranges must be between 1 and ${count}.`);
    for (let n = start; n <= end; n++) pages.add(n - 1);
  }
  return [...pages].sort((a, b) => a - b);
}
export function splitDocument(state: DocumentState, individual = false): OrganizerPage[][] {
  const parts: OrganizerPage[][] = [];
  let part: OrganizerPage[] = [];
  const boundaries = new Set(state.splitAfter);
  for (const page of state.pages) {
    part.push(page);
    if (individual || boundaries.has(page.id)) {
      parts.push(part);
      part = [];
    }
  }
  if (part.length) parts.push(part);
  return parts;
}
