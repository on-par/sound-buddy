import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import * as path from 'path';
import { launchApp } from './e2e-helpers';

// The Analyze tab's "Listen live" entry point, driven end to end (#1480).
// #1483 already narrowed analyze-entry.ts's shouldOfferListenLive to
// advancedFeaturesEnabled alone and ModeTabs.tsx already passes exactly that
// predicate into resolveModeSwitch — but no spec drove #nav-analyze itself,
// so the defect (ModeTabs handing across a line-check-specific predicate)
// could have shipped again with every downstream unit suite still green.
// This is the named e2e gate ModeTabs.tsx's handleClick c8-ignore points at.
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

test.describe('Analyze tab Listen live entry point (#1480), Advanced features on', () => {
  let electronApp: ElectronApplication;
  let window: Page;

  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp());
    await stubMeasurementIpc(electronApp);
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test('AC: routes to Settings > Audio when no room mic is selected', async () => {
    await stubOpenFileDialogTracked(electronApp, null);

    await window.locator('#nav-analyze').click();
    await expect(window.locator('#analyze-entry-dialog')).toBeVisible();

    await window.locator('#analyze-entry-listen-live').click();
    await expect(window.locator('#analyze-entry-dialog')).toBeHidden();
    await expect(window.locator('#settings-dialog')).toBeVisible();
    await expect(window.locator('#settings-pane-audio')).toBeVisible();

    expect(await openFileDialogCallCount(electronApp)).toBe(0);

    await window.locator('#settings-dialog-done').click();
    await expect(window.locator('#settings-dialog')).toBeHidden();
  });

  test('AC: reaches the live-EQ view directly, without loading a file, when a room mic is selected', async () => {
    await stubOpenFileDialogTracked(electronApp, null);

    await window.locator('#settings-btn').click();
    await window.locator('#settings-tab-btn-audio').click();
    await expect(window.locator('#settings-pane-audio')).toBeVisible();
    await window.locator('#secondary-measurement-device').selectOption('0');
    await window.locator('#settings-dialog-done').click();
    await expect(window.locator('#settings-dialog')).toBeHidden();

    await window.locator('#nav-analyze').click();
    await expect(window.locator('#analyze-entry-dialog')).toBeVisible();

    await window.locator('#analyze-entry-listen-live').click();
    await expect(window.locator('#analyze-entry-dialog')).toBeHidden();
    await expect(window.locator('#analyze-live-eq-stop')).toBeVisible();
    await expect(window.locator('body')).toHaveClass(/analyze-listening/);

    expect(await openFileDialogCallCount(electronApp)).toBe(0);

    await window.locator('#analyze-live-eq-stop').click();
    await expect(window.locator('#analyze-live-eq-stop')).toBeHidden();
  });
});

test.describe('Analyze tab Listen live entry point (#1480), Advanced features off (Simple mode)', () => {
  let electronApp: ElectronApplication;
  let window: Page;
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'silence.wav');

  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp({ SOUND_BUDDY_ADVANCED_FEATURES: '0' }));
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test('AC: opens the file chooser in one click and never offers Listen live', async () => {
    await stubOpenFileDialogTracked(electronApp, fixturePath);

    await window.locator('#nav-analyze').click();

    await expect(window.locator('#rc-filename')).toHaveText('silence.wav');
    await expect(window.locator('#analyze-entry-dialog')).toBeHidden();
    expect(await openFileDialogCallCount(electronApp)).toBe(1);
  });
});
