import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

// Rig save/load/switch (#37). Rig persistence + IPC (#36) run for REAL against an
// isolated settings.json (a throwaway --user-data-dir), so these specs exercise
// the true round-trip. Only list-devices is stubbed, so the channel picker has
// hardware to offer and the missing-/small-device paths are reproducible anywhere.

const MAIN = path.join(__dirname, '..', 'dist', 'electron', 'main.js');
const USER_DATA = path.join(__dirname, '..', 'test-results', 'rigs-userdata');

const EIGHT_CH = [{ index: 0, name: 'Fake 8ch Interface', channels: 8, default_sr: 48000 }];
const TWO_CH = [{ index: 0, name: 'Tiny 2ch', channels: 2, default_sr: 48000 }];

async function stubDevices(app: ElectronApplication, devices: unknown) {
  await app.evaluate(({ ipcMain }, devs) => {
    ipcMain.removeHandler('list-devices');
    ipcMain.handle('list-devices', () => ({ success: true, micAccess: 'granted', devices: devs }));
  }, devices);
}

async function launch(devices: unknown): Promise<{ app: ElectronApplication; win: Page }> {
  const app = await electron.launch({ args: [MAIN, `--user-data-dir=${USER_DATA}`] });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  // Stub then reload so the boot-time loadDevices() sees the fake interface.
  await stubDevices(app, devices);
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await win.locator('.mode-tab[data-mode="live"]').click();
  return { app, win };
}

test.describe.serial('Rigs — save / load / switch', () => {
  let app: ElectronApplication;
  let win: Page;

  test.beforeAll(() => {
    fs.rmSync(USER_DATA, { recursive: true, force: true });
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test('Save As… captures the current setup as a new, active rig', async () => {
    ({ app, win } = await launch(EIGHT_CH));

    // Pick the real device (Default Device stores an empty deviceName), switch to
    // Record mode, dial the sliders, and make the first strip stereo.
    await win.locator('#device-select').selectOption('0');
    await win.locator('#live-mode button[data-mode="record"]').click();
    await win.evaluate(() => {
      const set = (id: string, v: string) => {
        const el = document.getElementById(id) as HTMLInputElement;
        el.value = v;
        el.dispatchEvent(new Event('input'));
      };
      set('meter-interval', '200');
      set('window-secs', '5');
      set('llm-interval', '120');
    });
    await win.locator('.chcfg-kind').first().selectOption('stereo');

    await win.locator('#rig-saveas-btn').click();
    await expect(win.locator('#rig-dialog')).toBeVisible();
    await win.locator('#rig-dialog-input').fill('Main Board');
    await win.locator('#rig-dialog-ok').click();

    await expect(win.locator('#rig-select option:checked')).toHaveText('Main Board');

    const rigs = await win.evaluate(() => (window as any).soundBuddy.listRigs());
    expect(rigs).toHaveLength(1);
    expect(rigs[0]).toMatchObject({
      name: 'Main Board',
      deviceName: 'Fake 8ch Interface',
      mode: 'record',
      intervalMs: 200,
      windowSecs: 5,
      llmIntervalMs: 120000,
    });
    expect(rigs[0].channelConfig.length).toBeGreaterThanOrEqual(2);
    expect(rigs[0].channelConfig[0]).toMatchObject({ kind: 'stereo' });
  });

  test('rig is preselected and applied after an app restart', async () => {
    await app.close();
    ({ app, win } = await launch(EIGHT_CH));

    // No manual selection: the active rig is restored on boot.
    await expect(win.locator('#rig-select option:checked')).toHaveText('Main Board');
    expect(await win.locator('#device-select').inputValue()).toBe('0');
    await expect(win.locator('#live-mode button[data-mode="record"]')).toHaveClass(/active/);
    expect(await win.locator('#meter-interval').inputValue()).toBe('200');
    expect(await win.locator('#window-secs').inputValue()).toBe('5');
    expect(await win.locator('#llm-interval').inputValue()).toBe('120');
  });

  test('loading a rig whose device is absent shows a fallback and does not auto-start', async () => {
    const id = await win.evaluate(async () => {
      const sb = (window as any).soundBuddy;
      const s = await sb.saveRig({
        name: 'Scarlett Rig',
        deviceName: 'Scarlett 18i20',
        channelConfig: [{ kind: 'mono', a: 0, b: 0 }],
        mode: 'monitor',
        recordDir: '',
        intervalMs: 100,
        windowSecs: 3,
        llmIntervalMs: 60000,
      });
      const rig = s.rigs.find((r: any) => r.name === 'Scarlett Rig');
      await sb.setActiveRig(rig.id);
      return rig.id;
    });
    expect(id).toBeTruthy();

    await win.reload();
    await win.waitForLoadState('domcontentloaded');
    await win.locator('.mode-tab[data-mode="live"]').click();

    await expect(win.locator('#rig-select option:checked')).toHaveText('Scarlett Rig');
    await expect(win.locator('#live-status')).toContainText('not found');
    expect(await win.locator('#device-select').inputValue()).toBe('');
    // Not auto-started: Start visible, Stop hidden.
    await expect(win.locator('#live-start-btn')).toBeVisible();
    await expect(win.locator('#live-stop-btn')).toBeHidden();
  });

  test('loading a rig with out-of-range channels clamps them without throwing', async () => {
    // Re-stub to a 2-channel device, then persist a rig that assumed 18 channels.
    await stubDevices(app, TWO_CH);
    await win.evaluate(async () => {
      const sb = (window as any).soundBuddy;
      const s = await sb.saveRig({
        name: 'Big Board',
        deviceName: 'Tiny 2ch',
        channelConfig: [
          { kind: 'stereo', a: 8, b: 9 },
          { kind: 'mono', a: 0, b: 0 },
        ],
        mode: 'monitor',
        recordDir: '',
        intervalMs: 100,
        windowSecs: 3,
        llmIntervalMs: 60000,
      });
      const rig = s.rigs.find((r: any) => r.name === 'Big Board');
      await sb.setActiveRig(rig.id);
    });

    await win.reload();
    await win.waitForLoadState('domcontentloaded');
    await win.locator('.mode-tab[data-mode="live"]').click();

    await expect(win.locator('#rig-select option:checked')).toHaveText('Big Board');
    await expect(win.locator('#live-status')).toContainText('out of range');
    // Both strips still render (nothing thrown); the stereo legs were clamped.
    await expect(win.locator('#chcfg-list .chcfg-row')).toHaveCount(2);
  });

  test('deleting a rig removes it from the picker and from listRigs()', async () => {
    await win.locator('#rig-select').selectOption({ label: 'Big Board' });
    await win.locator('#rig-delete-btn').click();
    await expect(win.locator('#rig-dialog')).toBeVisible();
    await win.locator('#rig-dialog-ok').click();

    const rigs = await win.evaluate(() => (window as any).soundBuddy.listRigs());
    expect(rigs.find((r: any) => r.name === 'Big Board')).toBeUndefined();
    await expect(win.locator('#rig-select option', { hasText: 'Big Board' })).toHaveCount(0);
  });

  test('the rig picker locks while a capture is running and unlocks on stop', async () => {
    // Stub capture so no real device/python is needed; switching rigs mid-capture
    // would desync the UI from the running stream, so the controls must lock.
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('start-live');
      ipcMain.handle('start-live', () => ({ success: true }));
      ipcMain.removeHandler('stop-live');
      ipcMain.handle('stop-live', () => ({ success: true }));
    });
    await win.reload();
    await win.waitForLoadState('domcontentloaded');
    await win.locator('.mode-tab[data-mode="live"]').click();

    await win.locator('#live-start-btn').click();
    await expect(win.locator('#rig-select')).toBeDisabled();
    await expect(win.locator('#rig-saveas-btn')).toBeDisabled();

    await win.locator('#live-stop-btn').click();
    await expect(win.locator('#rig-select')).toBeEnabled();
    await expect(win.locator('#rig-saveas-btn')).toBeEnabled();
  });
});
