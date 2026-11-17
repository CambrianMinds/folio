import { useCallback, useReducer, type SetStateAction } from 'react';
import type { Config } from './config';
export interface HistoryEntry {
  config: Config;
  label: string;
}
export interface History {
  present: Config;
  past: HistoryEntry[];
  future: HistoryEntry[];
  label: string;
  time: number;
}
type Action =
  | { type: 'set'; value: SetStateAction<Config>; label: string; time: number }
  | { type: 'undo' | 'redo' }
  | { type: 'reset'; value: Config };
export function historyReducer(state: History, action: Action): History {
  if (action.type === 'reset')
    return { present: action.value, past: [], future: [], label: 'Opened layout', time: 0 };
  if (action.type === 'undo') {
    const previous = state.past.at(-1);
    return previous
      ? {
          present: previous.config,
          label: previous.label,
          past: state.past.slice(0, -1),
          future: [{ config: state.present, label: state.label }, ...state.future],
          time: 0,
        }
      : state;
  }
  if (action.type === 'redo') {
    const next = state.future[0];
    return next
      ? {
          present: next.config,
          label: next.label,
          past: [...state.past, { config: state.present, label: state.label }],
          future: state.future.slice(1),
          time: 0,
        }
      : state;
  }
  if (action.type !== 'set') return state;
  const value = typeof action.value === 'function' ? action.value(state.present) : action.value;
  if (JSON.stringify(value) === JSON.stringify(state.present)) return state;
  const coalesce =
    action.label === 'Layout adjustment' &&
    state.label === action.label &&
    action.time - state.time < 500 &&
    state.past.length > 0;
  return {
    present: value,
    past: coalesce
      ? state.past
      : [...state.past, { config: state.present, label: state.label }].slice(-80),
    future: [],
    label: action.label,
    time: action.time,
  };
}
export function useLayoutHistory(initial: Config) {
  const [state, dispatch] = useReducer(historyReducer, {
    present: initial,
    past: [],
    future: [],
    label: 'Initial layout',
    time: 0,
  });
  const set = useCallback(
    (value: SetStateAction<Config>, label = 'Layout adjustment') =>
      dispatch({ type: 'set', value, label, time: Date.now() }),
    [],
  );
  const reset = useCallback((value: Config) => dispatch({ type: 'reset', value }), []);
  const undo = useCallback(() => dispatch({ type: 'undo' }), []),
    redo = useCallback(() => dispatch({ type: 'redo' }), []);
  return {
    config: state.present,
    set,
    reset,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    label: state.label,
  };
}
