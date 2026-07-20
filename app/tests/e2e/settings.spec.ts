import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp, withRetry } from './e2e-helpers';

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

    // The AI Engineer tab probes Ollama and (on demand) a hosted provider
    // over the network — stub both so the flow is testable anywhere. Config
    // persistence (llm-save-config / llm-get-config) stays REAL: the Ollama
    // path never touches safeStorage, and userData is isolated.
    //
    // withRetry guards against the same just-booted-process race documented
    // on launchApp() in e2e-helpers.ts — this runs immediately after it.
    await withRetry(() => electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('llm-detect-ollama');
      ipcMain.handle('llm-detect-ollama', () => ({ ok: true, models: ['llama3.2', 'qwen3:8b'] }));
      ipcMain.removeHandler('llm-test-provider');
      ipcMain.handle('llm-test-provider', (_e: unknown, opts: { apiKey?: string }) =>
        opts && opts.apiKey === 'sk-good'
          ? { ok: true }
          : { ok: false, reason: 'Authentication failed (HTTP 401) — check your key' });
    }));
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

  test('the gear opens the dialog on the Storage tab by default, and AI Engineer reveals the Ollama tab', async () => {
    await window.locator('#settings-btn').click();
    await expect(window.locator('#settings-dialog')).toBeVisible();
    await expect(window.locator('#settings-tab-btn-storage')).toHaveClass(/active/);
    await expect(window.locator('#settings-pane-storage')).toBeVisible();
    await window.locator('#settings-tab-btn-ai').click();
    await expect(window.locator('#settings-tab-btn-ai')).toHaveClass(/active/);
    await expect(window.locator('#ai-tab-btn-ollama')).toBeVisible();
  });

  test('gear opens the dialog with the Ollama tab active and detected models', async () => {
    await window.locator('#settings-btn').click();
    await window.locator('#settings-tab-btn-ai').click();
    await expect(window.locator('#ai-tab-btn-ollama')).toHaveClass(/active/);
    await expect(window.locator('#ai-ollama-status')).toContainText('Ollama detected — 2 models');
    await expect(window.locator('#ai-ollama-model option')).toHaveCount(2);
  });

  test('Escape closes the dialog', async () => {
    await window.locator('#settings-btn').click();
    await expect(window.locator('#settings-dialog')).toBeVisible();
    await window.keyboard.press('Escape');
    await expect(window.locator('#settings-dialog')).toBeHidden();
  });

  // #202: the installed app version is visible in Settings — the About tab
  // (#204 unified Storage and AI Engineer under it, giving the version a
  // principled home instead of parking it in the AI Engineer dialog).
  test('the About tab shows the installed app version', async () => {
    await window.locator('#settings-btn').click();
    await window.locator('#settings-tab-btn-about').click();
    await expect(window.locator('#ai-dialog-version')).toContainText(/Sound Buddy \d+\.\d+\.\d+/);
  });

  test('API-key tab: custom provider reveals the base URL field', async () => {
    await window.locator('#settings-btn').click();
    await window.locator('#settings-tab-btn-ai').click();
    await window.locator('#ai-tab-btn-hosted').click();
    await expect(window.locator('#ai-baseurl-field')).toBeHidden();
    await window.locator('#ai-provider').selectOption('custom');
    await expect(window.locator('#ai-baseurl-field')).toBeVisible();
    await window.locator('#ai-provider').selectOption('anthropic');
    await expect(window.locator('#ai-baseurl-field')).toBeHidden();
  });

  test('test connection reports success and failure immediately', async () => {
    await window.locator('#settings-btn').click();
    await window.locator('#settings-tab-btn-ai').click();
    await window.locator('#ai-tab-btn-hosted').click();
    await window.locator('#ai-api-key').fill('sk-bad');
    await window.locator('#ai-test-btn').click();
    await expect(window.locator('#ai-test-result')).toHaveClass(/err/);
    await expect(window.locator('#ai-test-result')).toContainText('check your key');
    await window.locator('#ai-api-key').fill('sk-good');
    await window.locator('#ai-test-btn').click();
    await expect(window.locator('#ai-test-result')).toHaveClass(/ok/);
  });

  test('saving the Ollama path persists llm.json and updates the provider chip', async () => {
    await window.locator('#settings-btn').click();
    await window.locator('#settings-tab-btn-ai').click();
    await window.locator('#ai-ollama-model').selectOption('qwen3:8b');
    await window.locator('#settings-dialog-save').click();
    await expect(window.locator('#settings-dialog')).toBeHidden();
    // Enable-AI defaulted on for a first-time connect, so the panel is live.
    await expect(window.locator('#model-chip-text')).toHaveText('ollama · qwen3:8b');
    // Round-trip: reopening shows the saved model still selected.
    await window.locator('#settings-btn').click();
    await window.locator('#settings-tab-btn-ai').click();
    await expect(window.locator('#ai-ollama-model')).toHaveValue('qwen3:8b');
    await window.locator('#settings-dialog-cancel').click();
  });

  // The bridge round trip (TD-001 slice 3, #421): settingsStore.saveLlmConfig()
  // + updateSettings() write React state, and inline-app.js's subscriber
  // toggles body.ai-disabled off that same store — no direct DOM write by
  // the panel itself.
  test('saving with Enable AI checked removes body.ai-disabled', async () => {
    await window.locator('#settings-btn').click();
    await window.locator('#settings-tab-btn-ai').click();
    await window.locator('#ai-enable-toggle').check();
    await window.locator('#settings-dialog-save').click();
    await expect(window.locator('#settings-dialog')).toBeHidden();
    await expect(window.locator('body')).not.toHaveClass(/ai-disabled/);
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

  // #204: a storage-folder change and an AI Ollama-model change made in one
  // session both persist through a single shared Save.
  test('a storage-folder change and an AI model change in one session both persist through a single Save', async () => {
    const chosen = '/tmp/sb-e2e-storage-combined';
    await electronApp.evaluate(({ ipcMain }, dir) => {
      ipcMain.removeHandler('open-dir-dialog');
      ipcMain.handle('open-dir-dialog', () => dir);
    }, chosen);

    await window.locator('#settings-btn').click();
    await window.locator('#storage-change-btn').click();
    await expect(window.locator('#storage-path')).toHaveText(chosen);

    await window.locator('#settings-tab-btn-ai').click();
    await window.locator('#ai-ollama-model').selectOption('llama3.2');
    await window.locator('#settings-dialog-save').click();
    await expect(window.locator('#settings-dialog')).toBeHidden();

    await window.locator('#settings-btn').click();
    await expect(window.locator('#storage-path')).toHaveText(chosen);
    await window.locator('#settings-tab-btn-ai').click();
    await expect(window.locator('#ai-ollama-model')).toHaveValue('llama3.2');
    await window.locator('#settings-dialog-cancel').click();

    // Restore the default folder so later specs (and reruns) see a clean setting.
    await electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('open-dir-dialog');
    });
    await window.evaluate(() => (window as any).soundBuddy.updateSettings({ storageDir: '' }));
  });
});
