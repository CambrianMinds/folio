import { cpSync, mkdirSync } from 'node:fs';
import './export-templates.mjs';
for (const folder of ['wasm', 'cmaps', 'standard_fonts']) {
  mkdirSync('public/pdfjs', { recursive: true });
  cpSync(`node_modules/pdfjs-dist/${folder}`, `public/pdfjs/${folder}`, { recursive: true });
}
