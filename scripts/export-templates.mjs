import { buildSync } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
buildSync({
  entryPoints: ['scripts/export-templates.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: '.downloads/export-templates.mjs',
});
await import(pathToFileURL(resolve('.downloads/export-templates.mjs')).href);
