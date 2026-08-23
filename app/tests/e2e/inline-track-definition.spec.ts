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

// #727: device-refresh-btn relocated off the Live tab into Settings → Audio.
async function refreshDevices(win: Page): Promise<void> {
  await win.locator('#settings-btn').click();
  await win.locator('#settings-tab-btn-audio').click();
  await win.locator('#device-refresh-btn').click();
  await win.locator('#settings-dialog-done').click();
}

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
    await refreshDevices(window);
    await expect(window.locator('#spectrum-body .daw-track-head')).toHaveCount(2);
  });

  test('header label still round-trips with the definition cluster present', async () => {
    const ch0 = window.locator('.daw-track-head[data-ch="0"]');
    await renameHeader(window, ch0.locator('.daw-track-head-name'), 'Kick');
    await expect(ch0.locator('.daw-track-head-name')).toHaveText('Kick');
  });

  test('selecting a stereo pair updates the compact input selector', async () => {
    const ch0 = window.locator('.daw-track-head[data-ch="0"]');
    await expect(ch0.locator('.daw-track-head-input')).toHaveValue('mono:0');
    await ch0.locator('.daw-track-head-input').selectOption('stereo:0,1');
    await expect(ch0.locator('.daw-track-head-input')).toHaveValue('stereo:0,1');
  });

  test('selecting a mono input preserves the chosen source channel', async () => {
    const ch0 = window.locator('.daw-track-head[data-ch="0"]');
    await ch0.locator('.daw-track-head-input').selectOption('stereo:2,3');
    await ch0.locator('.daw-track-head-input').selectOption('mono:2');
    await expect(ch0.locator('.daw-track-head-input')).toHaveValue('mono:2');
  });

  test('setting a source channel from the header updates the strip', async () => {
    const ch0 = window.locator('.daw-track-head[data-ch="0"]');
    await ch0.locator('.daw-track-head-input').selectOption('mono:5');
    await expect(ch0.locator('.daw-track-head-input')).toHaveValue('mono:5');
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
    await refreshDevices(window);
    await expect(window.locator('#spectrum-body .daw-track-head')).toHaveCount(2);
    await expect(window.locator('.daw-track-head[data-ch="0"] .daw-track-head-input option')).toHaveCount(6);

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
    await window.locator('#daw-session-record').click();
    await window.locator('#settings-btn').click();
    await window.locator('#settings-tab-btn-audio').click();
    await expect(window.locator('#settings-audio-capture-lock-note')).toBeVisible();
    await window.locator('#settings-dialog-done').click();
    const inputSels = window.locator('#spectrum-body .daw-track-head-input');
    for (let i = 0; i < await inputSels.count(); i++) await expect(inputSels.nth(i)).toBeDisabled();

    await window.locator('#daw-session-record').click(); // stop → monitoring resumes (#776)
    // #776: always-monitoring — a record stop keeps the board live, so the
    // header kind stays disabled (monitoring locks config) instead of
    // re-enabling the way the old full stop did.
    await expect(window.locator('.daw-track-head[data-ch="0"] .daw-track-head-input')).toBeDisabled();
  });
});
