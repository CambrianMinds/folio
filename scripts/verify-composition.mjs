import { chromium, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const b = await chromium.connectOverCDP(process.env.FOLIO_CDP_URL || 'http://127.0.0.1:9223');
const p = b
  .contexts()
  .flatMap((c) => c.pages())
  .find((p) => p.url().includes('1420') || p.url().includes('tauri.localhost'));
if (!p) throw Error('Start the native development application with debugging port 9223.');
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
const invoke = (command, args = {}) =>
  p.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), {
    command,
    args,
  });
const original = await invoke('load_preferences');
const doc = resolve('verification/Long specimen – spaces.md');
const bytes = readFileSync(doc);
const originalClipboard = await invoke('read_clipboard_text').catch(() => null);
await invoke('save_preferences', {
  preferences: {
    ...original,
    recent: [doc],
    layout: { ...original.layout, editor: true, inspector: true, width: 1600, height: 1000 },
    templates: {},
  },
});
const cdp = await p.context().newCDPSession(p);
await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: 1600,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});
await p.reload();
await expect(p.locator('.statusbar')).toContainText('Updated', { timeout: 30000 });
await p.getByText('More', { exact: true }).click();
await p.getByRole('button', { name: 'Long specimen – spaces.md' }).click();
await expect(p.locator('.statusbar')).toContainText('Updated', { timeout: 30000 });
if (!(await p.locator('.inspector').count()))
  await p.getByRole('button', { name: 'Inspector', exact: true }).click();
for (const selector of [
  '.source-editor .cm-scroller',
  '.inspector-scroll',
  '.current-preview .page-workspace',
]) {
  await expect
    .poll(() => p.locator(selector).evaluate((el) => el.scrollHeight > el.clientHeight))
    .toBe(true);
  await p.locator(selector).evaluate((el) => {
    el.scrollTop = 100;
  });
  await expect.poll(() => p.locator(selector).evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await p.locator(selector).evaluate((el) => {
    el.scrollTop = 0;
  });
}
await p.getByLabel('Starting point').selectOption('Essay');
await expect(p.locator('.statusbar')).toContainText('Updated', { timeout: 30000 });
await p.getByRole('button', { name: 'Describe a change…', exact: true }).click();
const request = p.getByLabel('Describe a layout change');
await request.fill(
  'Two columns, half-inch margins, Georgia 11 point, and a thin gray rule between columns. Keep everything else.',
);
await p.getByRole('button', { name: 'Interpret', exact: true }).click();
await expect(p.locator('.command-plan')).toContainText('Local command parser');
await p.getByRole('button', { name: 'Apply changes', exact: true }).click();
await expect(p.locator('.statusbar')).toContainText('Updated', { timeout: 30000 });
await expect(p.getByLabel('Left', { exact: true })).toHaveValue('0.5');
await p.getByRole('button', { name: 'Undo layout', exact: true }).click();
await expect(p.getByRole('button', { name: '1 column', exact: true })).toHaveAttribute(
  'aria-pressed',
  'true',
);
await p.getByRole('button', { name: 'Redo layout', exact: true }).click();
await expect(p.locator('.statusbar')).toContainText('Updated', { timeout: 30000 });
await p.getByRole('button', { name: 'Guides', exact: true }).click();
await expect(p.locator('.page-guides').first()).toBeVisible();
await p.getByRole('button', { name: 'Compare', exact: true }).click();
await expect(p.locator('.baseline-preview .pdf-page').first()).toBeVisible({ timeout: 10000 });
await p.locator('.baseline-preview .page-workspace').evaluate((el) => {
  el.scrollTop = 100;
});
await expect
  .poll(() => p.locator('.baseline-preview .page-workspace').evaluate((el) => el.scrollTop))
  .toBeGreaterThan(0);
await p.getByRole('button', { name: 'Compare', exact: true }).click();
await p.getByLabel('Variation name', { exact: true }).fill('Acceptance composition');
await p.getByRole('button', { name: 'Save variation', exact: true }).click();
await request.fill('gutter 24pt');
await p.getByRole('button', { name: 'Interpret', exact: true }).click();
await p.getByRole('button', { name: 'Apply changes', exact: true }).click();
await expect(p.locator('.statusbar')).toContainText('Updated', { timeout: 30000 });
await p.getByRole('button', { name: 'Load', exact: true }).click();
await expect(p.locator('.statusbar')).toContainText('Updated', { timeout: 30000 });
await p.getByText('External model templates', { exact: true }).click();
await expect
  .poll(() => p.locator('.composition-tools').evaluate((el) => el.scrollHeight > el.clientHeight))
  .toBe(true);
const template = {
  format: 'folio.layout-template',
  version: 1,
  name: 'Acceptance external',
  requirements: 'Use a 24 point gutter; keep everything else.',
  changes: { gutter: 24 },
};
await p.getByLabel('Template JSON', { exact: true }).fill(JSON.stringify(template));
await p.getByRole('button', { name: 'Review changes', exact: true }).click();
await expect(p.locator('.command-plan')).toContainText('External template: Acceptance external');
await p.getByRole('button', { name: 'Apply changes', exact: true }).click();
await expect(p.locator('.statusbar')).toContainText('Updated', { timeout: 30000 });
await expect(p.getByLabel('Left', { exact: true })).toHaveValue('0.5');
await p.getByRole('button', { name: 'Save template', exact: true }).click();
await expect(p.getByLabel('Saved templates', { exact: true })).toHaveValue('Acceptance external');
await p.getByRole('button', { name: 'Copy LLM instructions', exact: true }).click();
await expect(p.locator('.template-panel')).toContainText('Copied LLM instructions');
expect(await invoke('read_clipboard_text')).toContain('currentSettings');
await invoke('copy_text', { text: JSON.stringify(template) });
await p.getByRole('button', { name: 'Paste JSON', exact: true }).click();
await expect(p.getByLabel('Template JSON', { exact: true })).toHaveValue(JSON.stringify(template));
await p
  .getByLabel('Template JSON', { exact: true })
  .fill(JSON.stringify({ ...template, changes: { execute: 'bad' } }));
await p.getByRole('button', { name: 'Review changes', exact: true }).click();
await expect(p.locator('.template-panel')).toContainText('Unrecognized');
await p.getByLabel('Template JSON', { exact: true }).fill(JSON.stringify(template));
await p.getByRole('button', { name: 'Save', exact: true }).click();
await expect(p.locator('.save-state')).toHaveText('Saved', { timeout: 10000 });
expect(readFileSync(doc)).toEqual(bytes);
const config = JSON.parse(readFileSync(doc.replace(/\.md$/, '.folio.json'), 'utf8'));
expect(config.gutter).toBe(24);
expect(config.marginLeft).toBe(36);
expect(config.fontSize).toBe(11);
await p.getByLabel('Target pages', { exact: true }).fill('100');
await p.getByRole('button', { name: 'Find a fit', exact: true }).click();
await expect(p.locator('.command-plan')).toContainText('Tested PDF:', { timeout: 30000 });
await p.getByRole('button', { name: 'Checks', exact: false }).click();
await expect(p.locator('.publishing-checks')).toContainText('page', { timeout: 30000 });
await p.getByRole('button', { name: 'Editor', exact: true }).click();
await p.getByRole('button', { name: 'Inspector', exact: true }).click();
await p.screenshot({ path: 'verification/composition-workspace.png' });
await expect
  .poll(async () => Object.keys((await invoke('load_preferences')).templates || {}))
  .toContain('Acceptance external');
await invoke('save_preferences', { preferences: original });
if (originalClipboard !== null) await invoke('copy_text', { text: originalClipboard });
expect(errors).toEqual([]);
writeFileSync(
  'verification/composition-report.json',
  JSON.stringify(
    {
      passed: true,
      checks: [
        'natural-language interpretation',
        'single-step undo/redo',
        'page guides',
        'before/after PDFs',
        'named variations',
        'JSON review',
        'partial settings preserve omitted fields',
        'saved templates',
        'clipboard instructions and JSON',
        'unknown-field rejection',
        'source unchanged',
        'PDF-based target fit',
        'publishing checks',
      ],
      errors,
    },
    null,
    2,
  ),
);
console.log('Composition and external-template native checks passed.');
await b.close();
