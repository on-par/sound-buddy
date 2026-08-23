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
// instead of relying on assertion ordering elsewhere. Retry only the
// documented race, not arbitrary failures, so a genuine break (e.g. a typo in
// the stub) still surfaces immediately instead of being masked.
const STUB_DEVICES_ATTEMPTS = 5;
const STUB_DEVICES_RETRY_DELAY_MS = 250;

async function stubDevices(app: ElectronApplication, devices: unknown): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await app.evaluate(({ ipcMain }, devs) => {
        ipcMain.removeHandler('list-devices');
        ipcMain.handle('list-devices', () => ({ success: true, micAccess: 'granted', devices: devs }));
      }, devices);
      return;
    } catch (err) {
      const isContextDestroyed =
        err instanceof Error && err.message.includes('Execution context was destroyed');
      if (!isContextDestroyed || attempt >= STUB_DEVICES_ATTEMPTS) throw err;
      await new Promise((resolve) => setTimeout(resolve, STUB_DEVICES_RETRY_DELAY_MS));
    }
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
  // Wait for the app shell to finish booting (mode tabs rendered) before the
  // first main-process evaluate — domcontentloaded fires before the renderer
  // boot script (and #117's startup license work) has settled, which is the
  // window where playwright#33737 destroys the main-process context.
  await win.locator('.mode-tab[data-mode="live"]').waitFor();
  // Stub then reload so the boot-time loadDevices() sees the fake interface.
  await stubDevices(app, devices);
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await win.locator('.mode-tab[data-mode="live"]').click();
  return { app, win };
}

// #727: the rig picker, input device + refresh, and meter-rate/window
// sliders relocated off the Live tab into Settings → Audio, so every
// interaction with them now goes through the Settings dialog first.
async function openAudioSettings(win: Page): Promise<void> {
  await win.locator('#settings-btn').click();
  await win.locator('#settings-tab-btn-audio').click();
  await expect(win.locator('#settings-pane-audio')).toBeVisible();
}

async function closeSettings(win: Page): Promise<void> {
  await win.locator('#settings-dialog-done').click();
  await expect(win.locator('#settings-dialog')).toBeHidden();
}

async function assignGroupFromInspector(win: Page, channelIndex: number, groupName: string): Promise<void> {
  const strip = win.locator('#spectrum-body .daw-track-head').nth(channelIndex);
  await strip.locator('.daw-track-head-index').click();
  await expect(strip).toHaveClass(/selected/);
  const groupSelect = win.locator('.eq-pane-classification-group');
  await expect(groupSelect).toBeVisible();
  await groupSelect.selectOption({ label: groupName });
}

// Stops any running capture via the renderer's own stop ceremony
// (LiveControls.tsx's stopCaptureIfRunning, bridged onto
// window.stopLiveCaptureIfRunning by App.tsx) — phase-agnostic, so it ends
// both a monitor session (auto-start) and a record session, and never takes
// stopLiveCapture's post-record resume-to-monitoring branch. Calls the one
// production implementation of that ordering rather than re-deriving it here
// — used instead of clicking #daw-session-record, whose idle press *promotes* a
// monitor session instead of stopping it (#757).
async function stopCaptureIfRunning(win: Page): Promise<void> {
  await win.evaluate(async () => {
    const w = window as unknown as {
      stopLiveCaptureIfRunning?: (rt: unknown) => Promise<void>;
      liveCaptureRuntime?: unknown;
    };
    await w.stopLiveCaptureIfRunning?.(w.liveCaptureRuntime);
  });
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

  // #728: with an active rig that resolves cleanly, landing on the Live tab
  // now legitimately auto-starts a REAL capture (this file doesn't stub
  // start-live/stop-live except in the two spots that explicitly need to,
  // so auto-start spawns the actual stream.py). Reloading the renderer
  // (win.reload()) does NOT stop a capture already running in the main
  // process — nothing else in this suite guarantees a test starts idle, so
  // a capture auto-started by one test (most commonly at a relaunch-to-
  // verify-persistence step, once the rig it's verifying resolves cleanly)
  // was carrying over and permanently locking device controls for every
  // test after it. stopLive() is a safe no-op when nothing is running (see
  // live-capture.ts's stop-live handler — it guards on `if (proc)`).
  test.afterEach(async () => {
    if (!win || win.isClosed()) return;
    try {
      // #757: the Session Record button is the sole transport, and its idle
      // press *promotes* a running monitor session rather than stopping it —
      // so cleanup can't just click Stop (an idle press would start
      // recording). Instead it drives the exact stopLiveCapture()
      // orchestration (LiveControls.tsx): flip stopping, stopCapture() flips
      // isCapturing + runs the stop IPC, then the runtime's
      // onCaptureStopping/onCaptureStopped hooks run the renderer-side side
      // effects (rig unlock, playhead freeze, session offers) — the same
      // before/after split the button's onStop uses, just phase-agnostic.
      await stopCaptureIfRunning(win);
    } catch {
      // Best-effort cleanup; a genuinely broken stop is the next test's
      // problem to surface, not something to hide a real failure behind here.
    }
  });

  test('Save As… captures the current setup as a new, active rig', async () => {
    ({ app, win } = await launch(EIGHT_CH));

    // Pick the real device (Default Device stores an empty deviceName), dial
    // the sliders (Settings → Audio), then make the first strip stereo. #757:
    // the Record-mode toggle is gone, so the saved rig carries the store's
    // always-monitor mode.
    await openAudioSettings(win);
    await win.locator('#device-select').selectOption('0');
    await win.evaluate(() => {
      // meter-interval/window-secs are React-controlled inputs (#725). React
      // patches each controlled <input>'s `value` property with its own
      // tracking setter so it can tell a real DOM mutation apart from a
      // change React itself just rendered; plain `el.value = v` goes through
      // that patched setter, so React's tracked "last known value" silently
      // updates too and it sees no difference when the input event arrives,
      // never firing onChange. Setting through the ORIGINAL native prototype
      // setter bypasses React's tracker, so the subsequent bubbling input
      // event is correctly seen as a real change (see the well-documented
      // React controlled-input testing gotcha, e.g. facebook/react#11488).
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value',
      )!.set!;
      const set = (id: string, v: string) => {
        const el = document.getElementById(id) as HTMLInputElement;
        nativeInputValueSetter.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('meter-interval', '200');
      set('window-secs', '5');
    });
    await closeSettings(win);
    await win.locator('.daw-track-head-input').first().selectOption('stereo:0,1');

    await openAudioSettings(win);
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
      mode: 'monitor',
      intervalMs: 200,
      windowSecs: 5,
    });
    expect(rigs[0].channelConfig.length).toBeGreaterThanOrEqual(2);
    expect(rigs[0].channelConfig[0]).toMatchObject({ kind: 'stereo' });
  });

  test('rig is preselected and applied after an app restart', async () => {
    await app.close();
    ({ app, win } = await launch(EIGHT_CH));

    // No manual selection: the active rig is restored on boot.
    await openAudioSettings(win);
    await expect(win.locator('#rig-select option:checked')).toHaveText('Main Board');
    expect(await win.locator('#device-select').inputValue()).toBe('0');
    expect(await win.locator('#meter-interval').inputValue()).toBe('200');
    expect(await win.locator('#window-secs').inputValue()).toBe('5');
    await closeSettings(win);
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
      });
      const rig = s.rigs.find((r: any) => r.name === 'Scarlett Rig');
      await sb.setActiveRig(rig.id);
      return rig.id;
    });
    expect(id).toBeTruthy();

    await win.reload();
    await win.waitForLoadState('domcontentloaded');
    await win.locator('.mode-tab[data-mode="live"]').click();

    await expect(win.locator('#live-status')).toContainText('not found');
    // Not auto-started: no capture running, so the Session Record button is
    // idle and enabled.
    await expect(win.locator('#live-indicator')).toBeHidden();
    await expect(win.locator('#daw-session-record')).toBeEnabled();

    await openAudioSettings(win);
    await expect(win.locator('#rig-select option:checked')).toHaveText('Scarlett Rig');
    expect(await win.locator('#device-select').inputValue()).toBe('');
    await closeSettings(win);
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
      });
      const rig = s.rigs.find((r: any) => r.name === 'Big Board');
      await sb.setActiveRig(rig.id);
    });

    await win.reload();
    await win.waitForLoadState('domcontentloaded');
    await win.locator('.mode-tab[data-mode="live"]').click();

    await expect(win.locator('#live-status')).toContainText('out of range');
    // Both strips still render (nothing thrown); the stereo legs were clamped.
    await expect(win.locator('#spectrum-body .daw-track-head')).toHaveCount(2);

    await openAudioSettings(win);
    await expect(win.locator('#rig-select option:checked')).toHaveText('Big Board');
    await closeSettings(win);
  });

  test('per-channel labels round-trip through a rig save + relaunch (#39)', async () => {
    // Back to the 8-channel interface for a clean two-strip default config.
    await stubDevices(app, EIGHT_CH);
    // Clear the active rig (carried over from an earlier test) so #728's
    // auto-start doesn't lock #device-refresh-btn before this test's own
    // device-refresh + reselect resets the config — order-independent
    // rather than relying on a leftover rig happening to not resolve.
    await win.evaluate(() => (window as any).soundBuddy.setActiveRig(null));
    await win.reload();
    await win.waitForLoadState('domcontentloaded');
    await win.locator('.mode-tab[data-mode="live"]').click();
    await openAudioSettings(win);
    await win.locator('#device-refresh-btn').click();
    // Pick the real device before labelling (a device change re-seeds the config).
    await win.locator('#device-select').selectOption('0');
    await closeSettings(win);
    await expect(win.locator('#spectrum-body .daw-track-head')).toHaveCount(2);

    // Name both strips (contenteditable workspace header), then save as a new,
    // active rig.
    const names = win.locator('#spectrum-body .daw-track-head .daw-track-head-name');
    async function renameHeader(idx: number, value: string) {
      await names.nth(idx).click();
      await win.keyboard.press('ControlOrMeta+A');
      await win.keyboard.type(value);
      await win.keyboard.press('Enter');
    }
    await renameHeader(0, 'Kick');
    await renameHeader(1, 'SL Vox');
    await openAudioSettings(win);
    await win.locator('#rig-saveas-btn').click();
    await win.locator('#rig-dialog-input').fill('Labeled Board');
    await win.locator('#rig-dialog-ok').click();
    await expect(win.locator('#rig-select option:checked')).toHaveText('Labeled Board');
    await closeSettings(win);

    // The persisted rig carries the labels in its channelConfig.
    const rigs = await win.evaluate(() => (window as any).soundBuddy.listRigs());
    const saved = rigs.find((r: any) => r.name === 'Labeled Board');
    expect(saved.channelConfig[0]).toMatchObject({ label: 'Kick' });
    expect(saved.channelConfig[1]).toMatchObject({ label: 'SL Vox' });

    // Relaunch: the active rig restores the labels into the workspace headers.
    await app.close();
    ({ app, win } = await launch(EIGHT_CH));
    await openAudioSettings(win);
    await expect(win.locator('#rig-select option:checked')).toHaveText('Labeled Board');
    await closeSettings(win);
    const restored = win.locator('#spectrum-body .daw-track-head .daw-track-head-name');
    await expect(restored.nth(0)).toHaveText('Kick');
    await expect(restored.nth(1)).toHaveText('SL Vox');
  });

  test('named groups round-trip through a rig save + relaunch (#41)', async () => {
    await stubDevices(app, EIGHT_CH);
    // Clear the active rig (carried over from an earlier test) so #728's
    // auto-start doesn't lock #device-refresh-btn before this test's own
    // device-refresh + reselect resets the config.
    await win.evaluate(() => (window as any).soundBuddy.setActiveRig(null));
    await win.reload();
    await win.waitForLoadState('domcontentloaded');
    await win.locator('.mode-tab[data-mode="live"]').click();
    await openAudioSettings(win);
    await win.locator('#device-refresh-btn').click();
    await win.locator('#device-select').selectOption('0');
    await closeSettings(win);
    await expect(win.locator('#spectrum-body .daw-track-head')).toHaveCount(2);

    // Create a group and assign both strips to it.
    await win.locator('#live-ws-new-group').click();
    await win.locator('#rig-dialog-input').fill('Drums');
    await win.locator('#rig-dialog-ok').click();
    await assignGroupFromInspector(win, 0, 'Drums');
    await assignGroupFromInspector(win, 1, 'Drums');

    // Save as an active rig; the persisted rig carries the group + members.
    await openAudioSettings(win);
    await win.locator('#rig-saveas-btn').click();
    await win.locator('#rig-dialog-input').fill('Grouped Board');
    await win.locator('#rig-dialog-ok').click();
    await expect(win.locator('#rig-select option:checked')).toHaveText('Grouped Board');
    await closeSettings(win);
    const rigs = await win.evaluate(() => (window as unknown as { soundBuddy: { listRigs: () => Promise<unknown[]> } }).soundBuddy.listRigs());
    const saved = (rigs as Array<{ name: string; groups?: unknown }>).find((r) => r.name === 'Grouped Board');
    expect(saved!.groups).toEqual([{ name: 'Drums', members: [0, 1] }]);

    // Relaunch: the active rig restores group membership (both strips show Drums).
    await app.close();
    ({ app, win } = await launch(EIGHT_CH));
    await openAudioSettings(win);
    await expect(win.locator('#rig-select option:checked')).toHaveText('Grouped Board');
    await closeSettings(win);
    await win.locator('#spectrum-body .daw-track-head').nth(0).locator('.daw-track-head-index').click();
    await expect(win.locator('.eq-pane-classification-group')).toHaveValue('0');
    await win.locator('#spectrum-body .daw-track-head').nth(1).locator('.daw-track-head-index').click();
    await expect(win.locator('.eq-pane-classification-group')).toHaveValue('0');
  });

  test('deleting a rig removes it from the picker and from listRigs()', async () => {
    await openAudioSettings(win);
    await win.locator('#rig-select').selectOption({ label: 'Big Board' });
    await win.locator('#rig-delete-btn').click();
    await expect(win.locator('#rig-dialog')).toBeVisible();
    await win.locator('#rig-dialog-ok').click();

    const rigs = await win.evaluate(() => (window as any).soundBuddy.listRigs());
    expect(rigs.find((r: any) => r.name === 'Big Board')).toBeUndefined();
    await expect(win.locator('#rig-select option', { hasText: 'Big Board' })).toHaveCount(0);
    await closeSettings(win);
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
    // This test drives Start/Stop manually to assert the lock/unlock
    // transition itself — clear the active rig (carried over from an
    // earlier test) so #728's auto-start doesn't beat it to Start.
    await win.evaluate(() => (window as any).soundBuddy.setActiveRig(null));
    await win.reload();
    await win.waitForLoadState('domcontentloaded');
    await win.locator('.mode-tab[data-mode="live"]').click();

    await win.locator('#daw-session-record').click();
    await openAudioSettings(win);
    await expect(win.locator('#rig-select')).toBeDisabled();
    await expect(win.locator('#rig-saveas-btn')).toBeDisabled();
    await closeSettings(win);

    // #776: a Record-button stop only demotes back to monitoring (rig picker
    // stays locked) — drive the stop ceremony directly for a genuinely full
    // stop, then the controls unlock.
    await win.locator('#daw-session-record').click();
    await stopCaptureIfRunning(win);
    await openAudioSettings(win);
    await expect(win.locator('#rig-select')).toBeEnabled();
    await expect(win.locator('#rig-saveas-btn')).toBeEnabled();
    await closeSettings(win);
  });

  // Capture-config lock (#38).
  async function stubCapture(success: boolean) {
    await app.evaluate(({ ipcMain }, ok) => {
      ipcMain.removeHandler('start-live');
      ipcMain.handle('start-live', () => ({ success: ok, error: ok ? undefined : 'mic denied' }));
      ipcMain.removeHandler('stop-live');
      ipcMain.handle('stop-live', () => ({ success: true }));
    }, success);
    // Every caller of this helper drives Start manually to assert the
    // lock behavior itself — clear the active rig (carried over from an
    // earlier test) so #728's auto-start doesn't beat it to Start.
    await win.evaluate(() => (window as any).soundBuddy.setActiveRig(null));
    await win.reload();
    await win.waitForLoadState('domcontentloaded');
    await win.locator('.mode-tab[data-mode="live"]').click();
  }

  test('capture-config controls lock on Start and re-enable on Stop', async () => {
    await stubCapture(true);
    const locked = ['#device-refresh-btn', '#record-folder-btn', '#meter-interval', '#window-secs'];

    await win.locator('#daw-session-record').click();
    await openAudioSettings(win);
    await expect(win.locator('#device-select')).toBeEnabled();
    await expect(win.locator('#device-select')).toHaveAttribute('aria-disabled', 'false');
    for (const sel of locked) {
      await expect(win.locator(sel)).toBeDisabled();
      await expect(win.locator(sel)).toHaveAttribute('aria-disabled', 'true');
    }
    await expect(win.locator('#settings-audio-capture-lock-note')).toBeVisible();
    await closeSettings(win);
    await expect(win.locator('#spectrum-body .daw-track-head-input').first()).toBeDisabled();
    // The workspace toolbar's Add track is rebuilt by Start's React board
    // re-render (TD-001 slice 6h, #711) — the rebuilt markup bakes in
    // `disabled` (derived from isCapturing) but not aria-disabled, so only
    // `disabled` is asserted here.
    await expect(win.locator('#live-ws-add')).toBeDisabled();
    await expect(win.locator('#live-ws-arm-all')).toBeDisabled();

    // #776: a Record-button stop only demotes back to monitoring (config stays
    // capture-locked) — drive the stop ceremony directly for a genuinely full
    // stop before asserting the controls re-enable.
    await win.locator('#daw-session-record').click();
    await stopCaptureIfRunning(win);
    await openAudioSettings(win);
    for (const sel of locked) {
      await expect(win.locator(sel)).toBeEnabled();
      await expect(win.locator(sel)).toHaveAttribute('aria-disabled', 'false');
    }
    await expect(win.locator('#settings-audio-capture-lock-note')).toBeHidden();
    await closeSettings(win);
    await expect(win.locator('#live-ws-add')).toBeEnabled();
    await expect(win.locator('#live-ws-arm-all')).toBeEnabled();
  });

  test('a failed Start re-enables the config controls (no stuck lock)', async () => {
    await stubCapture(false);
    await win.locator('#daw-session-record').click();
    // The idle Record press starts monitoring; startLive resolves
    // { success:false } → stopLive() runs → controls unlocked and the promote
    // never happens. (The failed start also swaps #spectrum-body to the error
    // state, so the workspace toolbar itself is gone — nothing there left to
    // assert on.)
    await openAudioSettings(win);
    await expect(win.locator('#device-select')).toBeEnabled();
    await expect(win.locator('#meter-interval')).toBeEnabled();
    await expect(win.locator('#settings-audio-capture-lock-note')).toBeHidden();
    await closeSettings(win);
    await expect(win.locator('#daw-session-record')).toBeEnabled();
  });

  test('the capture lock derives from store state on every re-render (no imperative re-assert needed)', async () => {
    await stubCapture(true);
    await win.locator('#daw-session-record').click();
    // Start's React board rebuild bakes in `disabled` (via the store-derived
    // stamps) but not aria-disabled, so only `disabled` is asserted here.
    await expect(win.locator('#spectrum-body .daw-track-head-input').first()).toBeDisabled();
    // Every config mutator funnels through the store; the board re-renders with
    // the disabled stamps re-derived from liveCaptureStore.isCapturing at render
    // time (TD-001 slice 6h, #711) — the old window.renderChannelConfig()
    // capture-lock re-assert is gone, and the lock still holds after a write.
    await win.evaluate(() => {
      (window as unknown as { rendererStores: { liveCapture: { getState: () => { setStripKind: (idx: number, kind: string) => void } } } }).rendererStores.liveCapture.getState().setStripKind(0, 'stereo');
    });
    await expect(win.locator('#spectrum-body .daw-track-head-input').first()).toBeDisabled();
    await win.locator('#daw-session-record').click();
  });
});
