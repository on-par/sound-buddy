import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp, renameHeader } from './e2e-helpers';

// Inline track definition (#189) — split out of e2e.spec.ts as its own file
// (#225). Own reload-driven beforeEach (mirroring "Named channel groups
// (#41)"), independent of the other Live capture tests: those mutate
// channelConfig/strip kind in ways that would otherwise leak into these tests
// if they shared a describe/session, so this stayed isolated even in the
// original single-file test suite.

let electronApp: ElectronApplication;
let window: Page;

test.describe('Inline track definition (#189)', () => {
  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp());
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test.beforeEach(async () => {
    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.locator('.mode-tab[data-mode="live"]').click();
    await window.locator('#device-refresh-btn').click();
    await expect(window.locator('#spectrum-body .live-ch')).toHaveCount(2);
  });

  test('header label still round-trips with the definition cluster present', async () => {
    const ch0 = window.locator('.live-ch[data-ch="0"]');
    await renameHeader(window, ch0.locator('.live-ch-name'), 'Kick');
    await expect(ch0.locator('.live-ch-name')).toHaveText('Kick');
  });

  test('toggling the header kind select to stereo reveals a second source picker, defaulted to the next free channel', async () => {
    const ch0 = window.locator('.live-ch[data-ch="0"]');
    await expect(ch0.locator('.live-ch-src')).toHaveCount(1);
    await ch0.locator('.live-ch-kind').selectOption('stereo');
    await expect(ch0.locator('.live-ch-src')).toHaveCount(2);
    await expect(ch0.locator('.live-ch-src').nth(0)).toHaveValue('0');
    await expect(ch0.locator('.live-ch-src').nth(1)).toHaveValue('1');
  });

  test('toggling back to mono collapses to a single source picker, preserving the source channel', async () => {
    const ch0 = window.locator('.live-ch[data-ch="0"]');
    await ch0.locator('.live-ch-kind').selectOption('stereo');
    // Stereo legs use compact numeric labels, so match by {value} explicitly
    // — a bare string matches both value and label and "2" collides with the
    // option one channel over (value="1", label "2").
    await ch0.locator('.live-ch-src').nth(0).selectOption({ value: '2' });
    await ch0.locator('.live-ch-kind').selectOption('mono');
    await expect(ch0.locator('.live-ch-src')).toHaveCount(1);
    await expect(ch0.locator('.live-ch-src')).toHaveValue('2');
  });

  test('setting a source channel from the header updates the strip', async () => {
    const ch0 = window.locator('.live-ch[data-ch="0"]');
    await ch0.locator('.live-ch-src[data-field="a"]').selectOption('5');
    await expect(ch0.locator('.live-ch-src[data-field="a"]')).toHaveValue('5');
  });

  test('the source picker is bounded by the device channel count', async () => {
    await electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('list-devices');
      ipcMain.handle('list-devices', () => ({
        success: true,
        micAccess: 'granted',
        devices: [{ index: 0, name: 'Fake 4ch Interface', channels: 4, default_sr: 48000 }],
      }));
    });
    await window.locator('#device-refresh-btn').click();
    await expect(window.locator('#spectrum-body .live-ch')).toHaveCount(2);
    await expect(window.locator('.live-ch[data-ch="0"] .live-ch-src option')).toHaveCount(4);

    // Restore the 8ch stub other tests in the file rely on.
    await electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('list-devices');
      ipcMain.handle('list-devices', () => ({
        success: true,
        micAccess: 'granted',
        devices: [{ index: 0, name: 'Fake 8ch Interface', channels: 8, default_sr: 48000 }],
      }));
    });
  });

  test('the header kind and source controls freeze while a capture is running', async () => {
    await window.locator('#live-start-btn').click();
    await expect(window.locator('#capture-locked-note')).toBeVisible();
    const kindSels = window.locator('#spectrum-body .live-ch-kind');
    const srcSels = window.locator('#spectrum-body .live-ch-src');
    for (let i = 0; i < await kindSels.count(); i++) await expect(kindSels.nth(i)).toBeDisabled();
    for (let i = 0; i < await srcSels.count(); i++) await expect(srcSels.nth(i)).toBeDisabled();

    await window.locator('#live-stop-btn').click();
    await expect(window.locator('.live-ch[data-ch="0"] .live-ch-kind')).toBeEnabled();
  });
});
