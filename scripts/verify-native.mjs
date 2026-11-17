import { chromium, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const page = browser
  .contexts()
  .flatMap((c) => c.pages())
  .find((p) => p.url().includes('1420') || p.url().includes('tauri.localhost'));
if (!page)
  throw Error(
    'Start Folio with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223',
  );
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const invoke = (command, args = {}) =>
  page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), {
    command,
    args,
  });
const original = await invoke('load_preferences');
await page.setViewportSize({
  width: 1366,
  height: 768,
});
const specimen = resolve('verification/Long specimen – spaces.md');
await invoke('save_preferences', {
  preferences: {
    ...original,
    recent: [specimen],
    layout: { ...original.layout, width: 1366, height: 768, zoom: 'width' },
  },
});
await page.reload();
await expect(page.locator('.statusbar')).toContainText('Updated', { timeout: 30000 });
if ((await page.locator('.inspector').count()) === 0)
  await page.getByRole('button', { name: 'Inspector', exact: true }).click();
await page.getByText('More', { exact: true }).click();
await page.getByRole('button', { name: 'Long specimen – spaces.md' }).click();
await expect(page.locator('.document-name')).toContainText('Long specimen');
await expect(page.locator('.statusbar')).toContainText('Updated', { timeout: 30000 });
const sourceBefore = await page.locator('.cm-content').innerText();
await page.getByLabel('Starting point').selectOption('Journal');
await expect(page.locator('.statusbar')).toContainText('Updated', { timeout: 30000 });
await expect(page.getByRole('button', { name: 'Export PDF', exact: true })).toBeEnabled();
await expect(page.getByRole('button', { name: '2 columns', exact: true })).toHaveAttribute(
  'aria-pressed',
  'true',
);
await page.screenshot({ path: 'verification/workspace-1366.png' });
await page.getByRole('button', { name: '3 columns', exact: true }).click();
await expect(page.locator('.statusbar')).toContainText('Updated', { timeout: 30000 });
await page.getByLabel('Vertical rule', { exact: true }).uncheck();
await expect(page.locator('.statusbar')).toContainText('Updated', { timeout: 30000 });
await page.getByLabel('Vertical rule', { exact: true }).check();
await expect(page.locator('.statusbar')).toContainText('Updated', { timeout: 30000 });
// Invalid geometry must retain the last successfully rendered PDF and block export.
const canvasCount = await page.locator('.pdf-page').count();
await page.getByLabel('Left', { exact: true }).fill('7');
await expect(page.locator('.error-banner')).toContainText('too narrow', { timeout: 10000 });
await expect(page.getByRole('button', { name: 'Export PDF', exact: true })).toBeDisabled();
expect(await page.locator('.pdf-page').count()).toBe(canvasCount);
await page.getByLabel('Left', { exact: true }).fill('0.583');
await expect(page.locator('.statusbar')).toContainText('Updated', { timeout: 30000 });
expect(await page.locator('.cm-content').innerText()).toBe(sourceBefore);
await page.getByRole('button', { name: 'Save', exact: true }).click();
await expect(page.locator('.save-state')).toHaveText('Saved', { timeout: 10000 });
const layout = JSON.parse(readFileSync(specimen.replace(/\.md$/, '.folio.json'), 'utf8'));
expect(layout.columns).toBe(3);
expect(layout.rule).toBe(true);
const diskSource = readFileSync(specimen, 'utf8');
expect(diskSource.includes('A full width title')).toBe(true);
await page.getByLabel('Zoom percentage').fill('100');
await page.getByLabel('Zoom percentage').press('Tab');
await page.getByRole('button', { name: 'Facing', exact: true }).click();
await expect(page.locator('.pages')).toHaveClass(/spread/);
await page.getByRole('button', { name: 'Facing', exact: true }).click();
await page.getByRole('button', { name: 'Inspector', exact: true }).click();
await expect(page.locator('.inspector')).toHaveCount(0);
await page.getByRole('button', { name: 'Inspector', exact: true }).click();
await page.evaluate(() =>
  window.__TAURI_INTERNALS__.invoke('plugin:window|set_size', {
    label: 'main',
    value: { Logical: { width: 1920, height: 1080 } },
  }),
);
await page.setViewportSize({
  width: 1920,
  height: 1080,
});
await page.getByLabel('Fit mode').selectOption('page');
await page.screenshot({ path: 'verification/workspace-1920.png' });
await page.getByRole('button', { name: 'Save preset…', exact: true }).click();
await page.getByLabel('Preset name').fill('Acceptance custom');
await page.locator('dialog').getByRole('button', { name: 'Save', exact: true }).click();
await expect(page.getByLabel('Starting point')).toHaveValue('Acceptance custom');
await page.getByRole('button', { name: 'Rename', exact: true }).click();
await page.getByLabel('Preset name').fill('Acceptance renamed');
await page.locator('dialog').getByRole('button', { name: 'Save', exact: true }).click();
await expect(page.getByLabel('Starting point')).toHaveValue('Acceptance renamed');
await page.getByRole('button', { name: 'Delete', exact: true }).click();
await page.locator('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
await expect(page.getByLabel('Starting point')).toHaveValue('Essay');
await invoke('save_preferences', { preferences: original });
if (errors.length) throw Error(errors.join('\n'));
writeFileSync(
  'verification/native-report.json',
  JSON.stringify(
    {
      passed: true,
      checks: [
        'native rendering',
        'open Unicode path',
        'preset reflow',
        'column rules',
        'error retains PDF',
        'invalid export blocked',
        'source preserved',
        'layout save',
        'zoom',
        'facing pages',
        'panel toggles',
        'custom preset save/rename/delete',
      ],
      javascriptErrors: errors,
    },
    null,
    2,
  ),
);
await browser.close();
console.log('Native WebView2 interaction checks passed.');
