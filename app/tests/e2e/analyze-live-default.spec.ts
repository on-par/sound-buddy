import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp } from './e2e-helpers';

// #1646: the Analyze Live-default contract, locked end to end. This is the
// third attempt (after #1485 and its regressions), so the spec encodes the
// product rule directly rather than any one implementation of it:
//
//   1. A fresh launch — no room mic ever configured — lands on Analyze with
//      Live selected (never File) and the room RTA on screen.
//   2. Activating Live never navigates to Settings; it stays on the Analyze
//      live measurement.
//   3. Entering Analyze from another tab defaults to Live again.
//   4. File stays an explicit, secondary control.
//
// Every launch here is a fresh userData dir with NO secondary measurement
// device configured, the exact state a new install boots into and the state
// every prior fix forgot. launchApp() stubs start/stop-measurement (logging
// each call to globalThis.__sbMeasurementCalls), so no real mic is touched.
// Fully IPC-stubbed — deliberately NOT in playwright.config.ts's MEDIA_SPECS,
// so it runs under SB_E2E_STUBBED_ONLY=1 CI and ./scripts/verify.sh.

type MeasurementCall = { kind: 'start'; device?: string; channel?: number } | { kind: 'stop' };

async function measurementCalls(electronApp: ElectronApplication): Promise<MeasurementCall[]> {
  return electronApp.evaluate(
    () => (globalThis as unknown as { __sbMeasurementCalls?: MeasurementCall[] }).__sbMeasurementCalls ?? [],
  );
}

// A room-mic meter tick on the 48-point grid the RTA renders from.
const RTA_GRID_LEN = 48;
const ROOM_CH = {
  index: 0, name: 'Room', rms: -30, peak: -12, clipping: false, centroid: 1000, rolloff: 0,
  bands: { sub_bass: -40, bass: -34, low_mid: -28, mid: -24, high_mid: -32, presence: -44, brilliance: -60 },
  curve: new Array(RTA_GRID_LEN).fill(-30),
};

async function sendRoomMeterTick(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }, ch) => {
    BrowserWindow.getAllWindows()[0].webContents.send('measurement-event', { type: 'meter', ts: 0, channels: [ch] });
  }, ROOM_CH);
}

// The Live-default contract, asserted as one unit everywhere it must hold.
async function expectLiveRtaOnAnalyze(electronApp: ElectronApplication, window: Page): Promise<void> {
  // Never Settings, never the old two-choice entry dialog.
  await expect(window.locator('#settings-dialog')).toBeHidden();
  await expect(window.locator('#settings-pane-audio')).toBeHidden();
  await expect(window.locator('#analyze-entry-dialog')).toBeHidden();

  // Live is the selected mode, File is not.
  await expect(window.locator('#analyze-mode-live')).toHaveAttribute('aria-pressed', 'true');
  await expect(window.locator('#analyze-mode-file')).toHaveAttribute('aria-pressed', 'false');
  await expect(window.locator('#analyze-file-dropzone')).toBeHidden();

  // The Analyze live island is the stage and it is listening.
  await expect(window.locator('body')).toHaveClass(/analyze-listening/);
  await expect(window.locator('#analyze-live-island')).toBeVisible();
  await expect(window.locator('#analyze-live-eq-stop')).toBeVisible();

  // The RTA itself paints from the room stream.
  await sendRoomMeterTick(electronApp);
  await expect(window.locator('#analyze-live-island .eq-pane-primary')).toContainText('Room —');
  await expect(window.locator('#analyze-live-island .veq-chart svg')).toBeVisible();
}

for (const tier of [
  { name: 'Advanced', env: {} },
  { name: 'Simple', env: { SOUND_BUDDY_ADVANCED_FEATURES: '0' } },
]) {
  test.describe(`Analyze defaults to Live with the RTA (#1646), ${tier.name} mode, no room mic configured`, () => {
    let electronApp: ElectronApplication;
    let window: Page;

    test.beforeAll(async () => {
      ({ electronApp, window } = await launchApp(tier.env));
    });

    test.afterAll(async () => {
      await electronApp.close();
    });

    test('AC: fresh launch lands on Analyze with Live selected (not File) and the RTA visible', async () => {
      await expect(window.locator('#nav-analyze')).toHaveClass(/\bactive\b/);
      await expectLiveRtaOnAnalyze(electronApp, window);

      // With no room mic configured, the listen runs on the system default
      // input (empty device), not a Settings detour.
      await expect(async () => {
        const starts = (await measurementCalls(electronApp)).filter((c) => c.kind === 'start');
        expect(starts.length).toBeGreaterThanOrEqual(1);
        expect(starts[0]).toMatchObject({ kind: 'start', device: '' });
      }).toPass();
    });

    test('AC: File is a secondary control, and activating Live returns to the RTA without opening Settings', async () => {
      await window.locator('#analyze-mode-file').click();
      await expect(window.locator('#analyze-mode-file')).toHaveAttribute('aria-pressed', 'true');
      await expect(window.locator('#analyze-file-dropzone')).toBeVisible();
      await expect(window.locator('#analyze-live-eq-stop')).toBeHidden();

      await window.locator('#analyze-mode-live').click();
      await expectLiveRtaOnAnalyze(electronApp, window);
      await expect(window.locator('#nav-analyze')).toHaveClass(/\bactive\b/);
    });

    test('AC: re-entering Analyze from another tab defaults to Live with the RTA, never Settings', async () => {
      await window.locator('#analyze-mode-file').click();
      await expect(window.locator('#analyze-mode-file')).toHaveAttribute('aria-pressed', 'true');

      // Leave Analyze for any other visible workspace tab, then come back.
      await window.locator('.mode-tab:not(#nav-analyze):visible').first().click();
      await expect(window.locator('body')).not.toHaveClass(/analyze-listening/);

      await window.locator('#nav-analyze').click();
      await expectLiveRtaOnAnalyze(electronApp, window);
    });
  });
}
