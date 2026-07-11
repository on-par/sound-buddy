import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp } from './e2e-helpers';

// Live capture workspace controls — split out of e2e.spec.ts as its own file
// (#225): "Workspace arm controls (#191)" and "Persistent track workspace
// (#188)", previously nested inside the "Live capture (PRD 06)" describe in
// live-capture.spec.ts. Every test shares the same beforeEach as that file
// (mode-tab click + #device-refresh-btn), which resets the workspace to its
// 2-strip device default before each test — so despite the "Persistent track
// workspace" tests reading like a running total (2 → 3 → 1 → 0 → 8), each one
// actually starts from that same reset baseline and is independent, which is
// what makes it safe to run this file as its own Electron session.

let electronApp: ElectronApplication;
let window: Page;

// Two live channels with distinct spectral shapes: Vocals is mid-heavy,
// Band is bass-heavy. Band keys are snake_case (LIVE_BAND_KEYS).
const LIVE_CHANNELS = [
  { name: 'Vocals', rms: -18, peak: -6, clipping: false, centroid: 2400,
    bands: { sub_bass: -58, bass: -30, low_mid: -24, mid: -12, high_mid: -20, presence: -28, brilliance: -80 } },
  { name: 'Band', rms: -22, peak: -9, clipping: false, centroid: 300,
    bands: { sub_bass: -20, bass: -10, low_mid: -26, mid: -30, high_mid: -34, presence: -40, brilliance: -50 } },
];

// Live meter ticks arrive over the 'live-event' channel from the main
// process; push one directly so the meters render without a real capture.
async function sendLiveTick(channels: unknown) {
  await electronApp.evaluate(({ BrowserWindow }, chs) => {
    BrowserWindow.getAllWindows()[0].webContents.send('live-event', { type: 'meter', channels: chs });
  }, channels);
}

test.describe('Live capture (PRD 06) — workspace controls', () => {
  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp());
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test.beforeEach(async () => {
    await window.locator('.mode-tab[data-mode="live"]').click();
    await expect(window.locator('#tab-live')).toHaveClass(/active/);
    // Re-enumerate against the stubbed 8-channel device (the boot-time scan
    // ran before the stub was installed).
    await window.locator('#device-refresh-btn').click();
    await expect(window.locator('#spectrum-body .live-ch')).toHaveCount(2);
  });

  // Workspace arm controls (#191): the record-arm cluster lives on the
  // main-pane track workspace, Record mode only. Drives #spectrum-body's
  // controls directly.
  test.describe('Workspace arm controls (#191)', () => {
    test('per-track toggle and toolbar cluster render only in Record mode', async () => {
      // Force Monitor explicitly — an earlier test in this describe may have
      // left liveMode as 'record'.
      await window.locator('#live-mode button[data-mode="monitor"]').click();
      await expect(window.locator('#spectrum-body .live-ch-arm')).toHaveCount(0);
      await expect(window.locator('#live-ws-arm-all')).toHaveCount(0);
      await expect(window.locator('#live-ws-disarm-all')).toHaveCount(0);
      await expect(window.locator('#live-ws-arm-count')).toHaveCount(0);

      await window.locator('#live-mode button[data-mode="record"]').click();
      await expect(window.locator('#spectrum-body .live-ch-arm')).toHaveCount(2);
      await expect(window.locator('#live-ws-arm-all')).toBeVisible();
      await expect(window.locator('#live-ws-disarm-all')).toBeVisible();
      await expect(window.locator('#live-ws-arm-count')).toContainText('2 / 2 armed');

      // Switching back to Monitor removes them again (JS-gated, not CSS).
      await window.locator('#live-mode button[data-mode="monitor"]').click();
      await expect(window.locator('#spectrum-body .live-ch-arm')).toHaveCount(0);
      await expect(window.locator('#live-ws-arm-all')).toHaveCount(0);
    });

    test('arming a single track from the workspace flips aria-pressed', async () => {
      await window.locator('#live-mode button[data-mode="record"]').click();
      const wsArm = window.locator('#spectrum-body .live-ch-arm').first();
      await expect(wsArm).toHaveAttribute('aria-pressed', 'true');

      await wsArm.click(); // disarm
      await expect(wsArm).toHaveAttribute('aria-pressed', 'false');
      await expect(window.locator('#live-ws-arm-count')).toContainText('1 / 2 armed');

      await wsArm.click(); // re-arm
      await expect(wsArm).toHaveAttribute('aria-pressed', 'true');
      await expect(window.locator('#live-ws-arm-count')).toContainText('2 / 2 armed');
    });

    test('workspace Arm all / Disarm all', async () => {
      await window.locator('#live-mode button[data-mode="record"]').click();
      const arms = window.locator('#spectrum-body .live-ch-arm');

      await window.locator('#live-ws-disarm-all').click();
      for (const arm of await arms.all()) await expect(arm).toHaveAttribute('aria-pressed', 'false');
      await expect(window.locator('#live-ws-arm-count')).toContainText('0 / 2 armed');

      await window.locator('#live-ws-arm-all').click();
      for (const arm of await arms.all()) await expect(arm).toHaveAttribute('aria-pressed', 'true');
      await expect(window.locator('#live-ws-arm-count')).toContainText('2 / 2 armed');
    });

    test('starting with nothing armed is blocked from the workspace controls too', async () => {
      await window.locator('#live-mode button[data-mode="record"]').click();
      await window.locator('#live-ws-disarm-all').click();
      await window.locator('#live-start-btn').click();
      await expect(window.locator('#arm-hint')).toBeVisible();
      await expect(window.locator('#arm-hint')).toContainText('Arm at least one strip');
      await expect(window.locator('#live-start-btn')).toBeVisible();
      await expect(window.locator('#live-stop-btn')).toBeHidden();
    });

    test('workspace arm controls lock while a capture is running', async () => {
      await window.locator('#live-mode button[data-mode="record"]').click();
      await window.locator('#live-start-btn').click();
      await expect(window.locator('#live-stop-btn')).toBeVisible();
      await sendLiveTick(LIVE_CHANNELS);

      const arms = window.locator('#spectrum-body .live-ch-arm');
      await expect(arms).toHaveCount(2);
      for (const arm of await arms.all()) await expect(arm).toBeDisabled();
      await expect(window.locator('#live-ws-arm-all')).toBeDisabled();
      await expect(window.locator('#live-ws-disarm-all')).toBeDisabled();

      await window.locator('#live-stop-btn').click();
    });
  });

  // Persistent main-pane track workspace (#188): configured tracks render in
  // #spectrum-body the moment the Live tab is active, idle or capturing, with
  // Add/remove available right there (not just the left rail).
  test.describe('Persistent track workspace (#188)', () => {
    test('configured tracks render as idle placeholders, not the "start capture" copy', async () => {
      const tracks = window.locator('#spectrum-body .sb-live-meters .live-ch');
      await expect(tracks).toHaveCount(2);
      await expect(window.locator('#spectrum-body')).not.toContainText('Start live capture to see the meters');
      await expect(window.locator('#live-ws-cap')).toHaveText('2 / 8 used');
    });

    test('Collapse all folds idle placeholder rows before any live tick has arrived', async () => {
      // Collapse all sizes itself off the strips actually on screen, not the
      // (still-null pre-tick) lastLiveChannels — regression coverage (#188).
      await window.locator('#live-collapse-all').click();
      await expect(window.locator('#spectrum-body .sb-live-meters .live-ch.collapsed')).toHaveCount(2);
      await window.locator('#live-expand-all').click();
      await expect(window.locator('#spectrum-body .sb-live-meters .live-ch.collapsed')).toHaveCount(0);
    });

    test('workspace Add track adds a strip', async () => {
      await window.locator('#live-ws-add').click();
      await expect(window.locator('#spectrum-body .sb-live-meters .live-ch')).toHaveCount(3);
      await expect(window.locator('#live-ws-cap')).toHaveText('3 / 8 used');
    });

    test('a workspace row remove prunes the strip', async () => {
      // removeChannelStrip() is the function .live-ch-x calls (pruneStrip
      // unit-tested in group-state.test.ts) — this also proves no dangling
      // group reference survives the removal.
      await window.locator('.sb-live-meters .live-ch .live-ch-x').first().click();
      await expect(window.locator('#spectrum-body .sb-live-meters .live-ch')).toHaveCount(1);
    });

    test('removing every track reveals the "Add your first track" empty state', async () => {
      const removeBtn = window.locator('.sb-live-meters .live-ch .live-ch-x').first();
      await removeBtn.click();
      await removeBtn.click();
      await expect(window.locator('#spectrum-body .sb-live-meters')).toHaveCount(0);
      await expect(window.locator('#spectrum-body')).toContainText('Add your first track');
      await expect(window.locator('#live-ws-add')).toBeVisible();
      await expect(window.locator('#live-ws-add')).toBeEnabled();

      // Start Capture must refuse an empty config rather than let stream.py
      // silently fall back to its own default channels (#188).
      await window.locator('#live-start-btn').click();
      await expect(window.locator('#arm-hint')).toBeVisible();
      await expect(window.locator('#arm-hint')).toContainText('Add at least one track');
      await expect(window.locator('#live-start-btn')).toBeVisible();
      await expect(window.locator('#live-stop-btn')).toBeHidden();
    });

    test('workspace Add disables at the device channel cap', async () => {
      for (let i = 0; i < 6; i++) await window.locator('#live-ws-add').click(); // 2 → 8
      await expect(window.locator('#live-ws-cap')).toHaveText('8 / 8 used');
      await expect(window.locator('#live-ws-add')).toBeDisabled();
    });

    test('workspace Add / remove are read-only while a capture is running', async () => {
      await window.locator('#live-start-btn').click();
      await expect(window.locator('#live-ws-add')).toBeDisabled();
      await expect(window.locator('.sb-live-meters .live-ch .live-ch-x').first()).toBeDisabled();
      await expect(window.locator('#capture-locked-note')).toBeVisible();

      await window.locator('#live-stop-btn').click();
      await expect(window.locator('#live-ws-add')).toBeEnabled();
    });
  });
});
