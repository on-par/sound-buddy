import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import * as path from 'path';
import { launchApp } from './e2e-helpers';

// The Analyze tab's entry point, driven end to end (#1480, updated for
// #1485's inverted default). #1485 made a configured secondary measurement
// device the Analyze tab's sole precondition for live listening — in both
// Simple and Advanced mode — with the two-choice AnalyzeEntryDialog as the
// no-device fallback and Listen live as its primary, focused affordance. No
// nav click may ever open the native file dialog by itself; file load stays
// available as an explicit second action (the dialog's "Choose file…", the
// live-EQ island's "Load file…", the Report Card toolbar's load button) that
// tears an active listen down first. This is the named e2e gate
// ModeTabs.tsx's handleClick c8-ignore points at.
//
// Fully IPC-stubbed (start-measurement/stop-measurement here, everything
// else via e2e-helpers' launchApp defaults) — deliberately NOT added to
// playwright.config.ts's MEDIA_SPECS, so it still runs under
// SB_E2E_STUBBED_ONLY=1 CI.

async function stubMeasurementIpc(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('start-measurement');
    ipcMain.handle('start-measurement', () => ({ success: true, micAccess: 'granted' }));
    ipcMain.removeHandler('stop-measurement');
    ipcMain.handle('stop-measurement', () => ({ success: true }));
  });
}

// #1524: records every start-measurement payload and every stop-measurement
// call into a globalThis array so a test can assert the stop-before-start
// restart order when switching channels.
type MeasurementCallLog = ({ kind: 'start'; channel?: number } | { kind: 'stop' })[];

async function stubMeasurementIpcWithLog(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ ipcMain }) => {
    (globalThis as unknown as { __measurementCalls: MeasurementCallLog }).__measurementCalls = [];
    ipcMain.removeHandler('start-measurement');
    ipcMain.handle('start-measurement', (_event, opts: { channel?: number }) => {
      (globalThis as unknown as { __measurementCalls: MeasurementCallLog }).__measurementCalls.push({
        kind: 'start',
        channel: opts?.channel,
      });
      return { success: true, micAccess: 'granted' };
    });
    ipcMain.removeHandler('stop-measurement');
    ipcMain.handle('stop-measurement', () => {
      (globalThis as unknown as { __measurementCalls: MeasurementCallLog }).__measurementCalls.push({ kind: 'stop' });
      return { success: true };
    });
  });
}

async function measurementCalls(electronApp: ElectronApplication): Promise<MeasurementCallLog> {
  return electronApp.evaluate(
    () => (globalThis as unknown as { __measurementCalls?: MeasurementCallLog }).__measurementCalls ?? [],
  );
}

// Tracks open-file-dialog invocations so a test can assert the native picker
// was (or was not) reached, without racing a real dialog.showOpenDialog call.
async function stubOpenFileDialogTracked(electronApp: ElectronApplication, result: string | null): Promise<void> {
  await electronApp.evaluate(({ ipcMain }, r) => {
    ipcMain.removeHandler('open-file-dialog');
    (globalThis as unknown as { __openFileDialogCalls: number }).__openFileDialogCalls = 0;
    ipcMain.handle('open-file-dialog', () => {
      (globalThis as unknown as { __openFileDialogCalls: number }).__openFileDialogCalls += 1;
      return r;
    });
  }, result);
}

async function openFileDialogCallCount(electronApp: ElectronApplication): Promise<number> {
  return electronApp.evaluate(
    () => (globalThis as unknown as { __openFileDialogCalls?: number }).__openFileDialogCalls ?? 0
  );
}

test.describe('Analyze tab entry point (#1485), Advanced features on', () => {
  let electronApp: ElectronApplication;
  let window: Page;

  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp());
    await stubMeasurementIpc(electronApp);
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test('AC: no room mic configured — offers the entry dialog with Listen live focused, routes to Settings > Audio', async () => {
    await stubOpenFileDialogTracked(electronApp, null);

    await window.locator('#nav-analyze').click();
    await expect(window.locator('#analyze-entry-dialog')).toBeVisible();
    await expect(window.locator('#analyze-entry-listen-live')).toBeFocused();

    await window.locator('#analyze-entry-listen-live').click();
    await expect(window.locator('#analyze-entry-dialog')).toBeHidden();
    await expect(window.locator('#settings-dialog')).toBeVisible();
    await expect(window.locator('#settings-pane-audio')).toBeVisible();

    expect(await openFileDialogCallCount(electronApp)).toBe(0);

    await window.locator('#settings-dialog-done').click();
    await expect(window.locator('#settings-dialog')).toBeHidden();
  });

  test('AC: room mic selected — goes straight to the live-EQ view, no dialog, no file picker (AC1)', async () => {
    await stubOpenFileDialogTracked(electronApp, null);

    await window.locator('#settings-btn').click();
    await window.locator('#settings-tab-btn-audio').click();
    await expect(window.locator('#settings-pane-audio')).toBeVisible();
    await window.locator('#secondary-measurement-device').selectOption('0');
    await window.locator('#settings-dialog-done').click();
    await expect(window.locator('#settings-dialog')).toBeHidden();

    await window.locator('#nav-analyze').click();
    await expect(window.locator('#analyze-entry-dialog')).toBeHidden();
    await expect(window.locator('#analyze-live-eq-stop')).toBeVisible();
    await expect(window.locator('body')).toHaveClass(/analyze-listening/);

    // #1496 AC1/AC2: the room-mic EQ is the primary stage — the 260px source
    // panel and the 640px report-card column fold away, so on the 1200px
    // default window the island spans nearly the whole workspace starting at
    // its left edge. Before #1496 it got ~520px (~43%) beside a 640px card.
    await expect(window.locator('#source-panel')).toBeHidden();
    await expect(window.locator('#reportcard-view')).toBeHidden();
    const bodyWidth = await window.evaluate(() => document.body.clientWidth);
    const island = await window.locator('#analyze-live-island').boundingBox();
    expect(island).not.toBeNull();
    expect(island!.width).toBeGreaterThanOrEqual(bodyWidth * 0.75);
    expect(island!.x).toBeLessThanOrEqual(40);

    expect(await openFileDialogCallCount(electronApp)).toBe(0);

    // AC2: Load file… tears the live listen down before the picker opens.
    const fixturePath = path.join(__dirname, '..', 'fixtures', 'silence.wav');
    await stubOpenFileDialogTracked(electronApp, fixturePath);

    await window.locator('#analyze-live-eq-choose-file').click();

    await expect(window.locator('#rc-filename')).toHaveText('silence.wav');
    expect(await openFileDialogCallCount(electronApp)).toBe(1);
    await expect(window.locator('#analyze-live-eq-stop')).toBeHidden();

    // #1487: the grade/pills/recommendations fold directly into Analyze
    // chrome — the file-derived result must still be visible here, without
    // switching to the separate Report Card tab (which stays folded away).
    await expect(window.locator('body')).toHaveClass(/analyze-listening/);
    await expect(window.locator('#reportcard-view')).toBeHidden();
    await expect(window.locator('.analyze-results-rail')).toBeVisible();
    await expect(window.locator('#arc-ring')).toBeVisible();
    await expect(window.locator('#arc-rec-type')).toBeVisible();

    // Switching to another workspace tab closes the Analyze stage.
    await window.locator('.mode-tab[data-mode="console"]').click();
    await expect(window.locator('body')).not.toHaveClass(/analyze-listening/);
  });

  // AC (#1522): Live ↔ File toggle keeps each mode's result — same result
  // shape, no cross-corruption. Live and File are equal-footing modes of one
  // Analyze tab; toggling between them must never clear or overwrite the
  // other mode's result (the bug this issue fixes: a file grade used to
  // permanently shadow a later live listen).
  //
  // Steps 5/6 of the spec plan (emitting a `measurement-event` window so the
  // rail shows a live-derived grade) are intentionally not driven here — the
  // window shape (LiveEvent ticks feeding secondaryWindows/
  // lastMeasurementChannels via liveCaptureStore.bindMeasurementEvents) isn't
  // exercised by any existing e2e spec, and hand-rolling it risks a flaky,
  // hard-to-maintain fixture. AC1 (Live mode reads liveSource only, even with
  // a file analysis present) is already covered directly and thoroughly by
  // analyze-results.test.ts and AnalyzeResultsPanel.test.ts. This e2e instead
  // covers the toggle's own behavior end to end: the File toggle never opens
  // the native picker, the dropzone renders and can trigger a real analysis,
  // switching to Live shows the listening empty state (never the file
  // grade), and switching back to File recovers the exact same file grade.
  test('AC (#1522): Live/File toggle switches mode without opening the file dialog, and File keeps its grade after a Live round trip', async () => {
    await window.locator('#settings-btn').click();
    await window.locator('#settings-tab-btn-audio').click();
    await window.locator('#secondary-measurement-device').selectOption('0');
    await window.locator('#settings-dialog-done').click();
    await expect(window.locator('#settings-dialog')).toBeHidden();

    await window.locator('#nav-analyze').click();
    await expect(window.locator('#analyze-live-eq-stop')).toBeVisible();

    const fixturePath = path.join(__dirname, '..', 'fixtures', 'silence.wav');
    await stubOpenFileDialogTracked(electronApp, fixturePath);

    await window.locator('#analyze-mode-file').click();
    await expect(window.locator('#analyze-mode-file')).toHaveAttribute('aria-pressed', 'true');
    await expect(window.locator('#analyze-file-dropzone')).toBeVisible();
    expect(await openFileDialogCallCount(electronApp)).toBe(0);

    await window.locator('#analyze-file-dropzone').click();
    await expect(window.locator('#arc-ring')).toBeVisible();
    await expect(window.locator('#arc-rec-type')).toBeVisible();
    expect(await openFileDialogCallCount(electronApp)).toBe(1);
    const fileGrade = await window.locator('#arc-ring').innerText();

    await window.locator('#analyze-mode-live').click();
    await expect(window.locator('#analyze-mode-live')).toHaveAttribute('aria-pressed', 'true');
    await expect(window.locator('#analyze-live-eq-stop')).toBeVisible();
    await expect(window.locator('#arc-empty')).toBeVisible();
    await expect(window.locator('#arc-empty')).toContainText('Listening');
    await expect(window.locator('#arc-ring')).toBeHidden();

    await window.locator('#analyze-mode-file').click();
    await expect(window.locator('#analyze-mode-file')).toHaveAttribute('aria-pressed', 'true');
    await expect(window.locator('#analyze-live-eq-stop')).toBeHidden();
    await expect(window.locator('#arc-ring')).toBeVisible();
    expect(await window.locator('#arc-ring').innerText()).toBe(fileGrade);
  });

  // AC (#1524): the single-select channel picker. list-devices (stubbed by
  // launchApp) always reports "Fake 8ch Interface" (8 channels), so choosing
  // it as the room-mic device is enough to make the picker appear.
  test('AC (#1524): channel picker lets a Pro user switch which input Analyze listens to', async () => {
    await stubMeasurementIpcWithLog(electronApp);

    await window.locator('#settings-btn').click();
    await window.locator('#settings-tab-btn-audio').click();
    await window.locator('#secondary-measurement-device').selectOption('0');
    await window.locator('#settings-dialog-done').click();
    await expect(window.locator('#settings-dialog')).toBeHidden();

    await window.locator('#nav-analyze').click();
    await expect(window.locator('#analyze-live-eq-stop')).toBeVisible();

    const picker = window.locator('#analyze-listen-channel');
    await expect(picker).toBeVisible();
    await expect(picker.locator('option')).toHaveCount(8);
    expect(await picker.getAttribute('multiple')).toBeNull();

    await picker.selectOption('2');
    await expect(async () => {
      const calls = await measurementCalls(electronApp);
      expect(calls.slice(-2)).toEqual([{ kind: 'stop' }, { kind: 'start', channel: 2 }]);
    }).toPass();

    await picker.selectOption('5');
    await expect(async () => {
      const calls = await measurementCalls(electronApp);
      expect(calls.slice(-2)).toEqual([{ kind: 'stop' }, { kind: 'start', channel: 5 }]);
    }).toPass();
  });
});

test.describe('Analyze tab entry point (#1485), Advanced features off (Simple mode)', () => {
  let electronApp: ElectronApplication;
  let window: Page;
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'silence.wav');

  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp({ SOUND_BUDDY_ADVANCED_FEATURES: '0' }));
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test('AC: never opens the file chooser automatically; offers the entry dialog with Listen live primary', async () => {
    await stubOpenFileDialogTracked(electronApp, fixturePath);

    await window.locator('#nav-analyze').click();

    expect(await openFileDialogCallCount(electronApp)).toBe(0);
    await expect(window.locator('#analyze-entry-dialog')).toBeVisible();

    await window.locator('#analyze-entry-choose-file').click();

    await expect(window.locator('#rc-filename')).toHaveText('silence.wav');
    expect(await openFileDialogCallCount(electronApp)).toBe(1);
  });
});
