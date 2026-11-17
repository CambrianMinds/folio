import {
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  existsSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const root = resolve('src-tauri/resources/licenses');
mkdirSync(root, { recursive: true });
const packages = [];
function copyNotices(dir, out) {
  mkdirSync(out, { recursive: true });
  for (const item of readdirSync(dir, { withFileTypes: true }))
    if (item.isFile() && /^(LICENSE|COPYING|NOTICE|COPYRIGHT)/i.test(item.name))
      copyFileSync(join(dir, item.name), join(out, item.name));
}
function scan(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.name.startsWith('@')) {
      scan(path);
      continue;
    }
    const file = join(path, 'package.json');
    if (!existsSync(file)) continue;
    const p = JSON.parse(readFileSync(file, 'utf8'));
    packages.push({
      ecosystem: 'npm',
      name: p.name,
      version: p.version,
      license: p.license || 'See upstream notices',
      repository: p.repository,
    });
    copyNotices(path, join(root, 'npm', p.name.replaceAll('/', '_')));
    if (existsSync(join(path, 'node_modules'))) scan(join(path, 'node_modules'));
  }
}
scan(resolve('node_modules'));
const metadata = JSON.parse(
  execFileSync(
    join(process.env.USERPROFILE, '.cargo/bin/cargo.exe'),
    ['metadata', '--locked', '--format-version', '1', '--manifest-path', 'src-tauri/Cargo.toml'],
    { maxBuffer: 30e6, encoding: 'utf8' },
  ),
);
for (const p of metadata.packages) {
  packages.push({
    ecosystem: 'cargo',
    name: p.name,
    version: p.version,
    license: p.license,
    repository: p.repository,
  });
  copyNotices(resolve(p.manifest_path, '..'), join(root, 'rust', p.name + '-' + p.version));
}
writeFileSync('DEPENDENCIES.json', JSON.stringify(packages, null, 2) + '\n');
copyFileSync('DEPENDENCIES.json', join(root, 'DEPENDENCIES.json'));
copyFileSync('THIRD-PARTY-NOTICES.md', join(root, 'FOLIO-THIRD-PARTY-NOTICES.md'));
console.log(`Collected notices for ${packages.length} dependencies.`);
