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

    expect(await openFileDialogCallCount(electronApp)).toBe(0);

    // AC2: Load file… tears the live listen down before the picker opens.
    const fixturePath = path.join(__dirname, '..', 'fixtures', 'silence.wav');
    await stubOpenFileDialogTracked(electronApp, fixturePath);

    await window.locator('#analyze-live-eq-choose-file').click();

    await expect(window.locator('#rc-filename')).toHaveText('silence.wav');
    expect(await openFileDialogCallCount(electronApp)).toBe(1);
    await expect(window.locator('#analyze-live-eq-stop')).toBeHidden();
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
