import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp, renameHeader } from './e2e-helpers';

// Inline track definition (#189) — split out of e2e.spec.ts as its own file
// (#225). Own reload-driven beforeEach (mirroring "Named channel groups
// (#41)"), independent of the other Live capture tests: those mutate
// channelConfig/strip kind in ways that would otherwise leak into these tests
// if they shared a describe/session, so this stayed isolated even in the
// original single-file test suite.
// Per-channel input configuration moved out of the row into the right pane
// (#849) — these specs select a channel, then drive the pane's inspector.

let electronApp: ElectronApplication;
let window: Page;

// #727: device-refresh-btn relocated off the Live tab into Settings → Audio.
async function refreshDevices(win: Page): Promise<void> {
  await win.locator('#settings-btn').click();
  await win.locator('#settings-tab-btn-audio').click();
  await win.locator('#device-refresh-btn').click();
  await win.locator('#settings-dialog-done').click();
}

test.describe('Selected-channel input settings (#189, moved to the right pane in #849)', () => {
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

  const selectCh0 = () => window.locator('.daw-track-head[data-ch="0"] .daw-track-head-index').click();
  const pane = () => window.locator('#live-eq-pane');

  test('header label still round-trips', async () => {
    const ch0 = window.locator('.daw-track-head[data-ch="0"]');
    await renameHeader(window, ch0.locator('.daw-track-head-name'), 'Kick');
    await expect(ch0.locator('.daw-track-head-name')).toHaveText('Kick');
  });

  test('selecting a stereo pair updates the right pane', async () => {
    await selectCh0();
    await expect(pane().locator('.eq-pane-inspector-kind')).toHaveValue('mono');
    await expect(pane().locator('.eq-pane-inspector-source[data-field="a"]')).toHaveValue('0');
    await pane().locator('.eq-pane-inspector-kind').selectOption('stereo');
    await expect(pane().locator('.eq-pane-inspector-kind')).toHaveValue('stereo');
    await expect(pane().locator('.eq-pane-inspector-source')).toHaveCount(2);
  });

  test('selecting a mono input preserves the chosen source channel', async () => {
    await selectCh0();
    await pane().locator('.eq-pane-inspector-kind').selectOption('stereo');
    // Index-based (not value '2'): with a=0 already selected in field 'a',
    // Playwright's value-string matching against a select that shares its
    // option value range with a sibling select (field 'b') is unreliable in
    // this Electron/headless combination — index matching is not.
    await pane().locator('.eq-pane-inspector-source[data-field="a"]').selectOption({ index: 2 });
    await pane().locator('.eq-pane-inspector-kind').selectOption('mono');
    await expect(pane().locator('.eq-pane-inspector-source[data-field="a"]')).toHaveValue('2');
  });

  test('setting a source channel from the pane updates the strip', async () => {
    await selectCh0();
    await pane().locator('.eq-pane-inspector-source[data-field="a"]').selectOption('5');
    await expect(pane().locator('.eq-pane-inspector-source[data-field="a"]')).toHaveValue('5');
    await expect(pane().locator('.eq-pane-inspector-name')).not.toBeEmpty();
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
    await selectCh0();
    await expect(pane().locator('.eq-pane-inspector-source[data-field="a"] option')).toHaveCount(4);

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

  test('the pane kind and source controls freeze while a capture is running', async () => {
    await selectCh0();
    await window.locator('#daw-session-record').click();
    await window.locator('#settings-btn').click();
    await window.locator('#settings-tab-btn-audio').click();
    await expect(window.locator('#settings-audio-capture-lock-note')).toBeVisible();
    await window.locator('#settings-dialog-done').click();
    await expect(pane().locator('.eq-pane-inspector-kind')).toBeDisabled();
    await expect(pane().locator('.eq-pane-inspector-source').first()).toBeDisabled();

    await window.locator('#daw-session-record').click(); // stop → monitoring resumes (#776)
    // #776: always-monitoring — a record stop keeps the board live, so the
    // pane's kind/source selects stay disabled (monitoring locks config)
    // instead of re-enabling the way the old full stop did.
    await expect(pane().locator('.eq-pane-inspector-kind')).toBeDisabled();
    await expect(pane().locator('.eq-pane-inspector-source').first()).toBeDisabled();
  });
});
