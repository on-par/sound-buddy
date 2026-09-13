import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import * as path from 'path';
import { launchApp, loadAndAnalyze } from './e2e-helpers';

let electronApp: ElectronApplication;
let window: Page;

test.describe('Ideal curve editor visual EQ', () => {
  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp());
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test('edits the ideal curve by dragging nodes on the EQ surface', async () => {
    const fixture = path.join(__dirname, '..', 'fixtures', 'silence.wav');
    await window.locator('.mode-tab[data-mode="reportcard"]').click();
    await loadAndAnalyze(window, fixture);
    await window.locator('#ideal-profile-select').selectOption('flat');
    await window.locator('#ideal-curve-edit-btn').click();

    const dialog = window.locator('#curve-dialog');
    const node = window.locator('.curve-editor-eq-node').nth(3);
    await expect(dialog).toBeVisible();
    await expect(window.locator('#curve-editor-preview input[type="range"]')).toHaveCount(0);
    await expect(window.locator('#curve-editor-preview .curve-band-num')).toHaveCount(0);
    await expect(window.locator('.curve-editor-eq-node')).toHaveCount(7);
    await expect(window.locator('.curve-editor-eq-line polyline')).toBeAttached();

    const before = await node.getAttribute('aria-label');
    const box = await node.boundingBox();
    if (!box) throw new Error('missing EQ node box');
    await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await window.mouse.down();
    await window.mouse.move(box.x + box.width / 2, box.y - 40, { steps: 8 });
    await window.mouse.up();

    await expect(node).not.toHaveAttribute('aria-label', before ?? '');
  });
});
