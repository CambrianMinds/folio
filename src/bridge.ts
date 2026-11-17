import { invoke } from '@tauri-apps/api/core';
import type { Config } from './config';
import type { LayoutTemplate } from './templates';
export interface Document {
  path: string;
  source: string;
  config: Config;
  warning: string | null;
}
export interface Preview {
  id: number;
  pdf: string;
  warnings: string[];
}
export interface Layout {
  editor: boolean;
  inspector: boolean;
  editorWidth: number;
  inspectorWidth: number;
  lineNumbers: boolean;
  wrap: boolean;
  zoom: string;
  spread: boolean;
  width?: number;
  height?: number;
}
export interface Preferences {
  recent: string[];
  presets: Record<string, Config>;
  layout: Partial<Layout> | null;
  exportDirectory: string | null;
  variations?: Record<string, Record<string, Config>>;
  modelPath?: string | null;
  templates?: Record<string, LayoutTemplate>;
}
export const native = !!window.__TAURI_INTERNALS__;
export const call = <T>(command: string, args?: Record<string, unknown>) =>
  invoke<T>(command, args);
declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}
