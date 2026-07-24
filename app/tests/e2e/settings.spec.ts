import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp } from './e2e-helpers';

// Unified Settings dialog (#204) — combines the AI provider settings (#76)
// and Storage settings (#91) dialogs into one tabbed modal opened from a
// single header gear. Split out of e2e.spec.ts as its own file (#225), both
// sections were already effectively standalone in the original single-file
// suite; #204 folds them into one describe block sharing one launchApp().

let electronApp: ElectronApplication;
let window: Page;

test.describe('Settings dialog (#204)', () => {
  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp());
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test.afterEach(async () => {
    // Close the dialog if a failed assertion left it open. #settings-dialog is
    // React-owned (SettingsPanel.tsx, TD-001 slice 3, #421, #204) — an
    // imperative style write here would fight React's own re-render, so drive
    // it through the real close affordance instead.
    if (await window.locator('#settings-dialog').isVisible()) {
      await window.locator('#settings-dialog-cancel').click();
    }
  });

  test('the dialog is mounted by the React settings island', async () => {
    await expect(window.locator('#settings-island #settings-dialog')).toHaveCount(1);
  });

  test('the gear opens the dialog on the Storage tab by default', async () => {
    await window.locator('#settings-btn').click();
    await expect(window.locator('#settings-dialog')).toBeVisible();
    await expect(window.locator('#settings-tab-btn-storage')).toHaveClass(/active/);
    await expect(window.locator('#settings-pane-storage')).toBeVisible();
  });

  test('Escape closes the dialog', async () => {
    await window.locator('#settings-btn').click();
    await expect(window.locator('#settings-dialog')).toBeVisible();
    await window.keyboard.press('Escape');
    await expect(window.locator('#settings-dialog')).toBeHidden();
  });

  // #202: the installed app version is visible in Settings — the About tab
  // (#204 unified Storage and AI Engineer under it; the AI Engineer half was
  // removed by #657, giving the version a principled home on its own).
  test('the About tab shows the installed app version', async () => {
    await window.locator('#settings-btn').click();
    await window.locator('#settings-tab-btn-about').click();
    await expect(window.locator('#ai-dialog-version')).toContainText(/Sound Buddy \d+\.\d+\.\d+/);
  });

  test('the header button opens the dialog with the no-caps copy and disk usage', async () => {
    await window.locator('#settings-btn').click();
    await expect(window.locator('#settings-dialog')).toBeVisible();
    await expect(window.locator('#settings-dialog .storage-unlimited')).toHaveText(
      'Unlimited recordings. Stored on your machine.',
    );
    // Usage line resolves from the informational IPC (never a limit).
    await expect(window.locator('#storage-usage')).toContainText('no limit');
    await expect(window.locator('#storage-path')).not.toHaveText('');
    await window.locator('#settings-dialog-cancel').click();
    await expect(window.locator('#settings-dialog')).toBeHidden();
  });

  test('choosing a folder persists storageDir and survives a reopen', async () => {
    const chosen = '/tmp/sb-e2e-storage';
    await electronApp.evaluate(({ ipcMain }, dir) => {
      ipcMain.removeHandler('open-dir-dialog');
      ipcMain.handle('open-dir-dialog', () => dir);
    }, chosen);

    await window.locator('#settings-btn').click();
    await window.locator('#storage-change-btn').click();
    await expect(window.locator('#storage-path')).toHaveText(chosen);
    await window.locator('#settings-dialog-save').click();
    await expect(window.locator('#settings-dialog')).toBeHidden();

    // Reopen: get-storage-usage reflects the persisted folder.
    await window.locator('#settings-btn').click();
    await expect(window.locator('#storage-path')).toHaveText(chosen);
    // Now that a custom folder is set, the reset action is offered.
    await expect(window.locator('#storage-reset-btn')).toBeVisible();
    await window.locator('#settings-dialog-cancel').click();

    // Restore the default so later specs (and reruns) see a clean setting.
    await electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('open-dir-dialog');
    });
    await window.evaluate(() => (window as any).soundBuddy.updateSettings({ storageDir: '' }));
  });

  // Opt-in anonymous usage counts (#145) — default-OFF persisted preference,
  // no collection/network code anywhere. Lives in the same Settings dialog.
  test('usage-signal toggle is off by default with honest copy', async () => {
    await window.locator('#settings-btn').click();
    await expect(window.locator('#usage-signal-toggle')).toBeVisible();
    await expect(window.locator('#usage-signal-toggle')).not.toBeChecked();
    await expect(window.locator('#usage-signal-note')).toContainText('anonymous');
    await expect(window.locator('#usage-signal-note')).toContainText('never audio');
    await window.locator('#settings-dialog-cancel').click();
  });

  test('checking the usage-signal toggle persists across a reopen, then restores to off', async () => {
    await window.locator('#settings-btn').click();
    await window.locator('#usage-signal-toggle').check();
    await window.locator('#settings-dialog-save').click();
    await expect(window.locator('#settings-dialog')).toBeHidden();

    await window.locator('#settings-btn').click();
    await expect(window.locator('#usage-signal-toggle')).toBeChecked();

    // Restore the default-OFF state so no ON preference leaks into later tests.
    await window.locator('#usage-signal-toggle').uncheck();
    await window.locator('#settings-dialog-save').click();
    await expect(window.locator('#settings-dialog')).toBeHidden();

    await window.locator('#settings-btn').click();
    await expect(window.locator('#usage-signal-toggle')).not.toBeChecked();
    await window.locator('#settings-dialog-cancel').click();
  });

  // #204: a storage-folder change persists through the single shared Save
  // (originally paired with an AI Ollama-model change in the same session —
  // the AI half was removed by #657, this now covers storage-only).
  test('a storage-folder change persists through a single Save', async () => {
    const chosen = '/tmp/sb-e2e-storage-combined';
    await electronApp.evaluate(({ ipcMain }, dir) => {
      ipcMain.removeHandler('open-dir-dialog');
      ipcMain.handle('open-dir-dialog', () => dir);
    }, chosen);

    await window.locator('#settings-btn').click();
    await window.locator('#storage-change-btn').click();
    await expect(window.locator('#storage-path')).toHaveText(chosen);
    await window.locator('#settings-dialog-save').click();
    await expect(window.locator('#settings-dialog')).toBeHidden();

    await window.locator('#settings-btn').click();
    await expect(window.locator('#storage-path')).toHaveText(chosen);
    await window.locator('#settings-dialog-cancel').click();

    // Restore the default folder so later specs (and reruns) see a clean setting.
    await electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('open-dir-dialog');
    });
    await window.evaluate(() => (window as any).soundBuddy.updateSettings({ storageDir: '' }));
  });
});
