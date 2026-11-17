import { chromium, expect } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, renameSync, rmSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';

// Exercise the release executable and its bundled resources, including real native dialogs.
const executable = resolve(process.argv[2] ?? 'src-tauri/target/release/folio.exe');
const out = resolve('verification/organizer');
const port = Number(process.env.FOLIO_TEST_PORT ?? 9225);
execFileSync('python', ['scripts/organizer-fixtures.py', 'fixtures']);
for (const name of readdirSync(out)) {
  if (
    [
      'organized.pdf',
      'extracted.pdf',
      'with-compose.pdf',
      'unavailable.pdf',
      'large-organized.pdf',
      'ui-report.json',
      'failure.json',
      'failure.png',
    ].includes(name)
  )
    rmSync(join(out, name));
  if (name.startsWith('Folio-split-')) {
    const batch = resolve(out, name);
    if (!batch.startsWith(out + '\\'))
      throw Error('Batch cleanup escaped the verification directory.');
    rmSync(batch, { recursive: true });
  }
}
const child = spawn(executable, [], {
  windowsHide: true,
  env: {
    ...process.env,
    WEBVIEW2_USER_DATA_FOLDER: resolve('.downloads/organizer-webview'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
  },
});
let browser, page, preferences;
const errors = [];
const native = (command, args = {}) =>
  page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), {
    command,
    args,
  });
const dialog = (mode, ...paths) =>
  new Promise((resolveDialog, reject) => {
    const helper = spawn(
      'python',
      ['scripts/native-dialog.py', String(child.pid), mode, ...paths],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let output = '';
    helper.stdout.on('data', (data) => {
      output += data;
    });
    helper.stderr.on('data', (data) => {
      output += data;
    });
    helper.on('error', reject);
    helper.on('exit', (code) => (code === 0 ? resolveDialog() : reject(Error(output))));
  });
const exportTo = async (button, filename, shortcut = false) => {
  const helper = dialog('save', join(out, filename));
  if (shortcut) await page.keyboard.press('Control+e');
  else await button.click();
  await helper;
  await expect(page.locator('.organizer-status')).toContainText(`Exported ${join(out, filename)}`, {
    timeout: 30000,
  });
};
const count = (number) =>
  expect(page.locator('.organizer-status > span').first()).toHaveText(`${number} pages`, {
    timeout: 30000,
  });
const thumbnail = (number) =>
  page.locator('.thumbnail-button').filter({
    has: page.locator('.thumbnail-number', { hasText: new RegExp(`^${number}(?:\\s|$)`) }),
  });
try {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      break;
    } catch {
      await delay(500);
    }
  }
  if (!browser) throw Error('Packaged Folio did not start its test WebView.');
  page = browser.contexts()[0].pages()[0];
  await page.waitForURL(/tauri\.localhost/, { timeout: 30000 });
  await page.waitForFunction(() => !!window.__TAURI_INTERNALS__, { timeout: 30000 });
  page.on('pageerror', (error) => errors.push(String(error)));
  preferences = await native('load_preferences');
  await expect(page.locator('.statusbar')).toContainText('Updated', { timeout: 30000 });
  const markdown = await page.locator('.cm-content').innerText();
  await page.getByRole('button', { name: 'Organize', exact: true }).click();
  const picker = dialog('open', join(out, 'Report with spaces.pdf'), join(out, 'Appendix λ.pdf'));
  await page.locator('.organizer-grid').focus();
  await page.keyboard.press('Control+o');
  await picker;
  await count(5);
  await expect(page.locator('.thumbnail-paper img')).toHaveCount(5);
  // Opening a shorter second source must not invalidate later pages of the first.
  await thumbnail(3).dblclick();
  await expect(page.locator('.organizer-preview-page img')).toBeVisible();
  await page.keyboard.press('Escape');
  // Permanent PDF IDs can be shared by revisions with different page contents.
  await native('plugin:event|emit', {
    event: 'tauri://drag-drop',
    payload: { paths: [join(out, 'Revision-one.pdf')], position: { x: 400, y: 250 } },
  });
  await count(6);
  await expect(page.locator('.organizer-status button')).toHaveCount(0);
  await page.locator('.organizer-grid').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const revisionOne = page.getByRole('button', { name: /Output page 6,/ }).locator('img');
  await expect(revisionOne).toBeVisible();
  const firstRevisionImage = await revisionOne.getAttribute('src');
  await native('plugin:event|emit', {
    event: 'tauri://drag-drop',
    payload: { paths: [join(out, 'Revision-two.pdf')], position: { x: 400, y: 250 } },
  });
  await count(7);
  await expect(page.locator('.organizer-status button')).toHaveCount(0);
  await page.locator('.organizer-grid').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const revisionTwo = page.getByRole('button', { name: /Output page 7,/ }).locator('img');
  await expect(revisionTwo).toBeVisible();
  const imageHash = (image) => createHash('sha256').update(image).digest('hex');
  expect(imageHash(await revisionTwo.getAttribute('src'))).not.toBe(imageHash(firstRevisionImage));
  await page
    .locator('.organizer-toolbar')
    .getByRole('button', { name: 'Undo', exact: true })
    .click();
  await page
    .locator('.organizer-toolbar')
    .getByRole('button', { name: 'Undo', exact: true })
    .click();
  await count(5);
  await page.locator('.source-choice').filter({ hasText: 'Appendix' }).click();
  await page.getByLabel('Insert before output page', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Add pages', exact: true }).click();
  await count(7);
  await expect(thumbnail(2)).toHaveAttribute('aria-label', /Appendix.*source page 1/);
  await page
    .locator('.organizer-toolbar')
    .getByRole('button', { name: 'Undo', exact: true })
    .click();
  await count(5);
  await thumbnail(2).click();
  await thumbnail(4).click({ modifiers: ['Control'] });
  await expect(page.locator('.page-inspector-content')).toContainText('2 selected');
  const handle = await page.getByRole('button', { name: 'Move page 2', exact: true }).boundingBox();
  const first = await thumbnail(1).boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(first.x + 1, first.y + 70, { steps: 12 });
  await expect(page.locator('.page-insertion')).toBeVisible();
  await page.mouse.up();
  await expect(thumbnail(1)).toHaveAttribute('aria-label', /source page 2/);
  await expect(thumbnail(2)).toHaveAttribute('aria-label', /Appendix.*source page 1/);
  await page.getByRole('button', { name: 'Rotate right', exact: true }).click();
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await count(7);
  await page.getByRole('button', { name: 'Rotate right', exact: true }).click();
  await page.getByRole('button', { name: 'Rotate right', exact: true }).click();
  await page.locator('.organizer-grid').focus();
  await page.keyboard.press('Delete');
  await count(5);
  await page.keyboard.press('Control+z');
  await count(7);
  await page.keyboard.press('Control+y');
  await count(5);
  await page.keyboard.press('Control+Shift+z');
  await count(5);
  await page.keyboard.press('Control+z');
  await count(7);
  await thumbnail(5).click();
  await thumbnail(7).click({ modifiers: ['Shift'] });
  await expect(page.locator('.page-inspector-content')).toContainText('3 selected');
  await exportTo(page.getByRole('button', { name: 'Extract', exact: true }), 'extracted.pdf');
  await thumbnail(3).dblclick();
  await expect(page.getByRole('dialog', { name: 'Page preview' })).toBeVisible();
  await expect(page.locator('.organizer-preview-page img')).toBeVisible();
  await page.getByLabel('Preview zoom').fill('90');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByLabel('Preview page')).toHaveValue('4');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Page preview' })).not.toBeVisible();
  await page.getByLabel('Page ranges', { exact: true }).fill('0-99');
  await page.getByRole('button', { name: 'Select pages', exact: true }).click();
  await expect(page.locator('.organizer-error')).toContainText('between 1 and 7');
  await page.locator('.organizer-error').getByRole('button', { name: 'Dismiss' }).click();
  await page.locator('.organizer-grid').focus();
  await page.keyboard.press('Control+a');
  await expect(page.locator('.page-inspector-content')).toContainText('7 selected');
  await page.keyboard.press('Escape');
  await page.getByLabel('Page ranges', { exact: true }).fill('1-2, 7');
  await page.getByRole('button', { name: 'Select pages', exact: true }).click();
  await expect(page.locator('.page-inspector-content')).toContainText('3 selected');
  await expect(page.locator('.thumbnail-paper img')).toHaveCount(7);
  for (let index = 0; index < 7; index++) {
    const data = await page.locator('.thumbnail-paper img').nth(index).getAttribute('src');
    writeFileSync(
      join(out, `thumbnail-${index + 1}.png`),
      Buffer.from(data.split(',')[1], 'base64'),
    );
  }
  await page.getByLabel('Page ranges', { exact: true }).focus();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await count(7);
  await expect(page.locator('.page-inspector-content')).toContainText('3 selected');
  await exportTo(
    page.locator('.organizer-toolbar').getByRole('button', { name: 'Export PDF', exact: true }),
    'organized.pdf',
    true,
  );
  await page.getByRole('button', { name: 'Split', exact: true }).click();
  await page.getByRole('button', { name: 'Split after', exact: true }).nth(1).click();
  await page.getByRole('button', { name: 'Split after', exact: true }).nth(3).click();
  for (const title of ['Export 3 parts', 'One PDF per page']) {
    const folder = dialog('folder', out);
    await page.getByRole('button', { name: title, exact: true }).click();
    await folder;
    await expect(page.locator('.organizer-status')).toContainText('Exported', { timeout: 30000 });
    await expect(page.locator('.organizer-status button')).toHaveCount(0, { timeout: 30000 });
  }
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Compose', exact: true }).click();
  expect(await page.locator('.cm-content').innerText()).toBe(markdown);
  await page.getByRole('button', { name: 'Send to Organize', exact: true }).click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Append', exact: true }).click();
  await count(9);
  await exportTo(
    page.locator('.organizer-toolbar').getByRole('button', { name: 'Export PDF', exact: true }),
    'with-compose.pdf',
  );
  await page.getByRole('button', { name: 'Open in Compose', exact: true }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
  expect(await page.locator('.cm-content').innerText()).toBe(markdown);
  await page.getByRole('button', { name: 'Organize', exact: true }).click();
  await count(9);
  // A thumbnail itself can initiate a drag, including cancelling it with Escape.
  const dragPage = await thumbnail(1).boundingBox();
  await page.mouse.move(dragPage.x + 40, dragPage.y + 70);
  await page.mouse.down();
  await page.mouse.move(dragPage.x + 90, dragPage.y + 70, { steps: 8 });
  await expect(page.locator('.page-insertion')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('.page-insertion')).toHaveCount(0);
  await page.mouse.move(dragPage.x + 40, dragPage.y + 70);
  await page.mouse.down();
  await page.mouse.move(dragPage.x + 90, dragPage.y + 70, { steps: 8 });
  await expect(page.locator('.page-insertion')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.locator('.page-insertion')).toHaveCount(0);
  await page.mouse.up();
  await count(9);
  await page.getByRole('button', { name: 'Compose', exact: true }).click();
  await page.getByRole('button', { name: 'Send to Organize', exact: true }).click();
  await page
    .locator('dialog[open]')
    .getByRole('button', { name: 'Start new', exact: true })
    .click();
  await count(2);
  await page.locator('.organizer-grid').focus();
  await page.keyboard.press('Control+z');
  await count(9);
  // Route a native-window drop event through the same listener used by Explorer.
  await native('plugin:event|emit', {
    event: 'tauri://drag-drop',
    payload: { paths: [join(out, 'Appendix λ.pdf')], position: { x: 400, y: 250 } },
  });
  await count(11);
  await page
    .locator('.organizer-toolbar')
    .getByRole('button', { name: 'Undo', exact: true })
    .click();
  await count(9);
  renameSync(join(out, 'Report with spaces.pdf'), join(out, 'temporarily-moved.pdf'));
  try {
    const helper = dialog('save', join(out, 'unavailable.pdf'));
    await page
      .locator('.organizer-toolbar')
      .getByRole('button', { name: 'Export PDF', exact: true })
      .click();
    await helper;
    await expect(page.locator('.organizer-error')).toContainText('Restore the source file', {
      timeout: 30000,
    });
    expect(existsSync(join(out, 'unavailable.pdf'))).toBe(false);
  } finally {
    renameSync(join(out, 'temporarily-moved.pdf'), join(out, 'Report with spaces.pdf'));
  }
  await page.locator('.organizer-error').getByRole('button', { name: 'Dismiss' }).click();
  const corrupt = dialog('open', join(out, 'Corrupt.pdf'));
  await page
    .locator('.organizer-toolbar')
    .getByRole('button', { name: 'Add PDFs', exact: true })
    .click();
  await corrupt;
  await expect(page.locator('.organizer-error')).toContainText('PDF processing failed', {
    timeout: 30000,
  });
  await count(9);
  await page.locator('.organizer-error').getByRole('button', { name: 'Dismiss' }).click();
  const large = dialog('open', join(out, 'Large.pdf'));
  await page
    .locator('.organizer-toolbar')
    .getByRole('button', { name: 'Add PDFs', exact: true })
    .click();
  await large;
  await count(509);
  await page.locator('.organizer-grid').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(page.getByRole('button', { name: /Output page 509,/ })).toBeVisible();
  const lastPage = await page.getByRole('button', { name: /Output page 509,/ }).boundingBox();
  await page.mouse.move(lastPage.x + 30, lastPage.y + 60);
  await page.mouse.down();
  await page.mouse.move(lastPage.x + 60, lastPage.y + 60, { steps: 6 });
  await page.locator('.organizer-grid').evaluate((el) => {
    el.scrollTop = 0;
  });
  await expect(page.getByRole('button', { name: /Output page 1,/ })).toBeVisible();
  const destination = await page.getByRole('button', { name: /Output page 1,/ }).boundingBox();
  await page.mouse.move(destination.x + 1, destination.y + 60, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole('button', { name: /Output page 1,/ })).toHaveAttribute(
    'aria-label',
    /Large.pdf, source page 500/,
  );
  await page
    .locator('.organizer-toolbar')
    .getByRole('button', { name: 'Undo', exact: true })
    .click();
  await expect(page.getByRole('button', { name: /Output page 1,/ })).toHaveAttribute(
    'aria-label',
    /Report with spaces.pdf, source page 2/,
  );
  expect(await page.locator('.organizer-page').count()).toBeLessThan(60);
  await page.locator('.organizer-grid').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(page.getByRole('button', { name: /Output page 509,/ })).toBeVisible();
  // Separate native drop events during an import must both be retained.
  await native('plugin:event|emit', {
    event: 'tauri://drag-drop',
    payload: { paths: [join(out, 'Report with spaces.pdf')], position: { x: 400, y: 250 } },
  });
  await native('plugin:event|emit', {
    event: 'tauri://drag-drop',
    payload: { paths: [join(out, 'Appendix λ.pdf')], position: { x: 400, y: 250 } },
  });
  await count(514);
  await expect(page.locator('.organizer-status button')).toHaveCount(0);
  await page
    .locator('.organizer-toolbar')
    .getByRole('button', { name: 'Undo', exact: true })
    .click();
  await page
    .locator('.organizer-toolbar')
    .getByRole('button', { name: 'Undo', exact: true })
    .click();
  await count(509);
  await exportTo(
    page.locator('.organizer-toolbar').getByRole('button', { name: 'Export PDF', exact: true }),
    'large-organized.pdf',
  );
  await page.screenshot({ path: join(out, 'large-grid.png') });
  await page.getByRole('button', { name: /Output page 509,/ }).dblclick();
  await expect(page.locator('.organizer-preview-page img')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /Output page 509,/ })).toBeVisible();
  expect(errors).toEqual([]);
  execFileSync('python', ['scripts/organizer-fixtures.py', 'check'], { stdio: 'inherit' });
  writeFileSync(
    join(out, 'ui-report.json'),
    JSON.stringify(
      {
        executable,
        nativePickers: true,
        mountedPagesAt509: await page.locator('.organizer-page').count(),
        consoleErrors: errors,
        passed: true,
      },
      null,
      2,
    ),
  );
  console.log('Packaged Windows organizer workflow passed.');
} catch (error) {
  if (page) {
    await page.screenshot({ path: join(out, 'failure.png') }).catch(() => {});
    const diagnostic = await page
      .locator('.organizer')
      .innerText()
      .catch(() => 'Window unavailable');
    const previewInputs = await page
      .locator('.organizer-preview input')
      .evaluateAll((nodes) =>
        nodes.map((node) => ({ label: node.getAttribute('aria-label'), value: node.value })),
      );
    writeFileSync(
      join(out, 'failure.json'),
      JSON.stringify(
        { error: String(error), diagnostic, previewInputs, consoleErrors: errors },
        null,
        2,
      ),
    );
  }
  throw error;
} finally {
  if (page && preferences) await native('save_preferences', { preferences }).catch(() => {});
  if (page) await native('plugin:window|destroy', { label: 'main' }).catch(() => {});
  if (browser) await browser.close();
  child.kill();
}
