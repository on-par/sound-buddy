import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { LICENSE_ENV, seedProLicense } from './license-fixture';

// Rig save/load/switch (#37). Rig persistence + IPC (#36) run for REAL against an
// isolated settings.json (a throwaway --user-data-dir), so these specs exercise
// the true round-trip. Only list-devices is stubbed, so the channel picker has
// hardware to offer and the missing-/small-device paths are reproducible anywhere.

const MAIN = path.join(__dirname, '..', 'dist', 'electron', 'main.js');
const USER_DATA = path.join(__dirname, '..', 'test-results', 'rigs-userdata');

const EIGHT_CH = [{ index: 0, name: 'Fake 8ch Interface', channels: 8, default_sr: 48000 }];
const TWO_CH = [{ index: 0, name: 'Tiny 2ch', channels: 2, default_sr: 48000 }];

// electronApplication.evaluate() is documented-flaky right when called
// immediately after launch (a known upstream Playwright+Electron issue since
// Electron 27: microsoft/playwright#33737) — the main-process execution
// context can be torn down and recreated while the app finishes booting,
// throwing "Execution context was destroyed, most likely because of a
// navigation" even though nothing in this app actually navigates. Sibling
// specs (momentum/purchase-path) incidentally dodge it because they assert on
// the renderer first, giving the context time to settle; this is the only
// caller of stubDevices() and it runs right after launch, so retry here
// instead of relying on assertion ordering elsewhere.
async function stubDevices(app: ElectronApplication, devices: unknown, attempt = 1): Promise<void> {
  try {
    await app.evaluate(({ ipcMain }, devs) => {
      ipcMain.removeHandler('list-devices');
      ipcMain.handle('list-devices', () => ({ success: true, micAccess: 'granted', devices: devs }));
    }, devices);
  } catch (err) {
    if (attempt >= 3) throw err;
    await stubDevices(app, devices, attempt + 1);
  }
}

async function launch(devices: unknown): Promise<{ app: ElectronApplication; win: Page }> {
  // Rigs are a Pro feature (#54): seed a license so the Live-tab UI is unlocked.
  seedProLicense(USER_DATA);
  const app = await electron.launch({
    args: [MAIN, `--user-data-dir=${USER_DATA}`],
    env: { ...process.env, ...LICENSE_ENV },
  });
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
    await win.locator('.live-ch-kind').first().selectOption('stereo');

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
    await expect(win.locator('#spectrum-body .live-ch')).toHaveCount(2);
  });

  test('per-channel labels round-trip through a rig save + relaunch (#39)', async () => {
    // Back to the 8-channel interface for a clean two-strip default config.
    await stubDevices(app, EIGHT_CH);
    await win.reload();
    await win.waitForLoadState('domcontentloaded');
    await win.locator('.mode-tab[data-mode="live"]').click();
    await win.locator('#device-refresh-btn').click();
    // Pick the real device before labelling (a device change re-seeds the config).
    await win.locator('#device-select').selectOption('0');
    await expect(win.locator('#spectrum-body .live-ch')).toHaveCount(2);

    // Name both strips (contenteditable workspace header), then save as a new,
    // active rig.
    const names = win.locator('#spectrum-body .live-ch .live-ch-name');
    async function renameHeader(idx: number, value: string) {
      await names.nth(idx).click();
      await win.keyboard.press('ControlOrMeta+A');
      await win.keyboard.type(value);
      await win.keyboard.press('Enter');
    }
    await renameHeader(0, 'Kick');
    await renameHeader(1, 'SL Vox');
    await win.locator('#rig-saveas-btn').click();
    await win.locator('#rig-dialog-input').fill('Labeled Board');
    await win.locator('#rig-dialog-ok').click();
    await expect(win.locator('#rig-select option:checked')).toHaveText('Labeled Board');

    // The persisted rig carries the labels in its channelConfig.
    const rigs = await win.evaluate(() => (window as any).soundBuddy.listRigs());
    const saved = rigs.find((r: any) => r.name === 'Labeled Board');
    expect(saved.channelConfig[0]).toMatchObject({ label: 'Kick' });
    expect(saved.channelConfig[1]).toMatchObject({ label: 'SL Vox' });

    // Relaunch: the active rig restores the labels into the workspace headers.
    await app.close();
    ({ app, win } = await launch(EIGHT_CH));
    await expect(win.locator('#rig-select option:checked')).toHaveText('Labeled Board');
    const restored = win.locator('#spectrum-body .live-ch .live-ch-name');
    await expect(restored.nth(0)).toHaveText('Kick');
    await expect(restored.nth(1)).toHaveText('SL Vox');
  });

  test('named groups round-trip through a rig save + relaunch (#41)', async () => {
    await stubDevices(app, EIGHT_CH);
    await win.reload();
    await win.waitForLoadState('domcontentloaded');
    await win.locator('.mode-tab[data-mode="live"]').click();
    await win.locator('#device-refresh-btn').click();
    await win.locator('#device-select').selectOption('0');
    await expect(win.locator('#spectrum-body .live-ch')).toHaveCount(2);

    // Create a group and assign both strips to it.
    await win.locator('#live-ws-new-group').click();
    await win.locator('#rig-dialog-input').fill('Drums');
    await win.locator('#rig-dialog-ok').click();
    await win.locator('#spectrum-body .live-ch').nth(0).locator('.live-ch-group').selectOption({ label: 'Drums' });
    await win.locator('#spectrum-body .live-ch').nth(1).locator('.live-ch-group').selectOption({ label: 'Drums' });

    // Save as an active rig; the persisted rig carries the group + members.
    await win.locator('#rig-saveas-btn').click();
    await win.locator('#rig-dialog-input').fill('Grouped Board');
    await win.locator('#rig-dialog-ok').click();
    await expect(win.locator('#rig-select option:checked')).toHaveText('Grouped Board');
    const rigs = await win.evaluate(() => (window as unknown as { soundBuddy: { listRigs: () => Promise<unknown[]> } }).soundBuddy.listRigs());
    const saved = (rigs as Array<{ name: string; groups?: unknown }>).find((r) => r.name === 'Grouped Board');
    expect(saved!.groups).toEqual([{ name: 'Drums', members: [0, 1] }]);

    // Relaunch: the active rig restores group membership (both strips show Drums).
    await app.close();
    ({ app, win } = await launch(EIGHT_CH));
    await expect(win.locator('#rig-select option:checked')).toHaveText('Grouped Board');
    const groups = win.locator('#spectrum-body .live-ch .live-ch-group');
    await expect(groups.nth(0)).toHaveValue('0');
    await expect(groups.nth(1)).toHaveValue('0');
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

  // Capture-config lock (#38).
  async function stubCapture(success: boolean) {
    await app.evaluate(({ ipcMain }, ok) => {
      ipcMain.removeHandler('start-live');
      ipcMain.handle('start-live', () => ({ success: ok, error: ok ? undefined : 'mic denied' }));
      ipcMain.removeHandler('stop-live');
      ipcMain.handle('stop-live', () => ({ success: true }));
    }, success);
    await win.reload();
    await win.waitForLoadState('domcontentloaded');
    await win.locator('.mode-tab[data-mode="live"]').click();
  }

  test('capture-config controls lock on Start and re-enable on Stop', async () => {
    await stubCapture(true);
    const locked = ['#device-select', '#device-refresh-btn', '#record-folder-btn',
      '#meter-interval', '#window-secs', '#llm-interval'];

    await win.locator('#live-start-btn').click();
    for (const sel of locked) {
      await expect(win.locator(sel)).toBeDisabled();
      await expect(win.locator(sel)).toHaveAttribute('aria-disabled', 'true');
    }
    await expect(win.locator('#live-mode button').first()).toBeDisabled();
    await expect(win.locator('#spectrum-body .live-ch-kind').first()).toBeDisabled();
    // The workspace toolbar's Add track is rebuilt (not just re-flagged) by
    // Start's renderLiveWorkspace() call, which runs AFTER setCaptureControlsLocked()
    // — the rebuilt markup bakes in `disabled` (via defDisabled) but not
    // aria-disabled, so only `disabled` is asserted here.
    await expect(win.locator('#live-ws-add')).toBeDisabled();
    await expect(win.locator('#capture-locked-note')).toBeVisible();

    await win.locator('#live-stop-btn').click();
    for (const sel of locked) {
      await expect(win.locator(sel)).toBeEnabled();
      await expect(win.locator(sel)).toHaveAttribute('aria-disabled', 'false');
    }
    await expect(win.locator('#live-mode button').first()).toBeEnabled();
    await expect(win.locator('#live-ws-add')).toBeEnabled();
    await expect(win.locator('#capture-locked-note')).toBeHidden();
  });

  test('a failed Start re-enables the config controls (no stuck lock)', async () => {
    await stubCapture(false);
    await win.locator('#live-start-btn').click();
    // startLive resolves { success:false } → stopLive() runs → controls unlocked.
    // (A failed start also swaps #spectrum-body to the error state, so the
    // workspace toolbar itself is gone — nothing there left to assert on.)
    await expect(win.locator('#device-select')).toBeEnabled();
    await expect(win.locator('#meter-interval')).toBeEnabled();
    await expect(win.locator('#capture-locked-note')).toBeHidden();
    await expect(win.locator('#live-start-btn')).toBeVisible();
  });

  test('the capture lock re-asserts idempotently on every config-changed callback', async () => {
    await stubCapture(true);
    await win.locator('#live-start-btn').click();
    // Start's renderLiveWorkspace() rebuilds the pane right after the initial
    // lock, so only `disabled` (baked into the rebuilt markup) is guaranteed
    // yet — see the aria-disabled note on the Start/Stop test above.
    await expect(win.locator('#spectrum-body .live-ch-kind').first()).toBeDisabled();
    // Every mutator (arm/rename/group/kind change) funnels through
    // renderChannelConfig() as its "config changed" callback; while a capture
    // is running it doesn't rebuild the workspace pane (that's owned by the
    // rAF tick, #188) but must re-assert the lock without erroring. With no
    // further rebuild after this point, aria-disabled now holds too.
    await win.evaluate(() => (window as unknown as { renderChannelConfig: () => void }).renderChannelConfig());
    await expect(win.locator('#spectrum-body .live-ch-kind').first()).toBeDisabled();
    await expect(win.locator('#spectrum-body .live-ch-kind').first()).toHaveAttribute('aria-disabled', 'true');
    await win.locator('#live-stop-btn').click();
  });
});
