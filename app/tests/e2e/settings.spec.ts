import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp } from './e2e-helpers';

// Unified Settings dialog (#204) — combines the AI provider settings (#76)
// and Storage settings (#91) dialogs into one tabbed modal opened from a
// single header gear. Split out of e2e.spec.ts as its own file (#225), both
// sections were already effectively standalone in the original single-file
// suite; #204 folds them into one describe block sharing one launchApp().
// #1023 (epic #1000): rewritten around the shipped instant-apply workflow —
// every persistence scenario changes a control with no Save click and
// proves the change survives a close + reopen.

let electronApp: ElectronApplication;
let window: Page;

// Sub-pixel device-ratio noise: two boundingBox() reads of a card that did
// not move can differ by a fraction of a pixel, so compare with a tolerance
// instead of exact equality (constitution: no float compare without epsilon).
const BOX_EPSILON_PX = 1;

// The preload bridge (app/electron/preload.ts) is injected onto window at
// runtime; the Playwright process has no ambient type for it, so declare the
// two members these specs use rather than casting to `any`.
interface SettingsBridge {
  getSettings(): Promise<Record<string, unknown>>;
  updateSettings(patch: Record<string, unknown>): Promise<unknown>;
}

async function persistedSetting(page: Page, key: string): Promise<unknown> {
  return page.evaluate(
    async (k) =>
      (await (window as unknown as { soundBuddy: SettingsBridge }).soundBuddy.getSettings())[k],
    key,
  );
}

async function patchSettings(page: Page, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    (p) => (window as unknown as { soundBuddy: SettingsBridge }).soundBuddy.updateSettings(p),
    patch,
  );
}

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
      await window.locator('#settings-dialog-done').click();
    }
  });

  test('the dialog is mounted by the React settings island', async () => {
    await expect(window.locator('#settings-island #settings-dialog')).toHaveCount(1);
  });

  test('the gear opens the dialog on the General tab by default', async () => {
    await window.locator('#settings-btn').click();
    await expect(window.locator('#settings-dialog')).toBeVisible();
    await expect(window.locator('#settings-tab-btn-general')).toHaveClass(/active/);
    await expect(window.locator('#settings-pane-general')).toBeVisible();
  });

  test('Escape closes the dialog', async () => {
    await window.locator('#settings-btn').click();
    await window.locator('#settings-tab-btn-storage').click();
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

  // #1018 (epic #1000): the General tab's select controls persist on change
  // via settings-instant-apply.ts's commitInstantSetting — no Save click, and
  // the reopened dialog seeds its value straight from persisted settings.
  test('a grading-profile change persists with no Save click', async () => {
    await patchSettings(window, { gradingProfile: 'casual' });

    await window.locator('#settings-btn').click();
    await expect(window.locator('#settings-pane-general')).toBeVisible();
    await window.locator('#grading-profile-select').selectOption('broadcast');
    await expect.poll(() => persistedSetting(window, 'gradingProfile')).toBe('broadcast');
    await window.locator('#settings-dialog-done').click();
    await expect(window.locator('#settings-dialog')).toBeHidden();

    await window.locator('#settings-btn').click();
    await expect(window.locator('#grading-profile-select')).toHaveValue('broadcast');

    // Restore the default so later specs (and reruns) see a clean setting.
    await window.locator('#grading-profile-select').selectOption('casual');
    await expect.poll(() => persistedSetting(window, 'gradingProfile')).toBe('casual');
    await window.locator('#settings-dialog-done').click();
  });

  // #1019 (epic #1000): storage-folder changes persist instantly in both
  // directions — choosing a folder and resetting to the default — with no
  // Save click, and survive a close + reopen.
  test('the storage folder applies instantly in both directions', async () => {
    await patchSettings(window, { storageDir: '' });
    const chosen = '/tmp/sb-e2e-storage';
    await electronApp.evaluate(({ ipcMain }, dir) => {
      ipcMain.removeHandler('open-dir-dialog');
      ipcMain.handle('open-dir-dialog', () => dir);
    }, chosen);

    await window.locator('#settings-btn').click();
    await window.locator('#settings-tab-btn-storage').click();
    const defaultPath = await window.locator('#storage-path').textContent();
    await expect(window.locator('#storage-reset-btn')).toBeHidden();

    await window.locator('#storage-change-btn').click();
    await expect(window.locator('#storage-path')).toHaveText(chosen);
    await expect.poll(() => persistedSetting(window, 'storageDir')).toBe(chosen);
    await window.locator('#settings-dialog-done').click();
    await expect(window.locator('#settings-dialog')).toBeHidden();

    // Reopen: the folder survived the close, and the reset action is offered
    // now that a custom folder is set.
    await window.locator('#settings-btn').click();
    await window.locator('#settings-tab-btn-storage').click();
    await expect(window.locator('#storage-path')).toHaveText(chosen);
    await expect(window.locator('#storage-reset-btn')).toBeVisible();

    // Reset is itself an instant-apply action — no back-door updateSettings
    // restore is needed after this.
    await window.locator('#storage-reset-btn').click();
    await expect(window.locator('#storage-path')).toHaveText(defaultPath!);
    await expect.poll(() => persistedSetting(window, 'storageDir')).toBe('');
    await window.locator('#settings-dialog-done').click();

    await electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('open-dir-dialog');
    });
  });

  // #1020 (epic #1000): the church-name field debounces keystrokes into one
  // commit on blur — the first e2e coverage of createChurchNameCommitter's
  // flush() path.
  test('the church name persists on blur with no Save click', async () => {
    await patchSettings(window, { shareChurchName: '' });

    await window.locator('#settings-btn').click();
    await window.locator('#share-church-name-input').fill('E2E Community Chapel');
    // Blur by clicking the dialog title — fires SettingsPanel's onBlur ->
    // churchNameCommitter.flush(), which is deterministic. Do NOT wait out
    // the 400ms CHURCH_NAME_DEBOUNCE_MS timer; that's a flake generator.
    await window.locator('#settings-dialog-title').click();
    await expect
      .poll(() => persistedSetting(window, 'shareChurchName'))
      .toBe('E2E Community Chapel');
    await window.locator('#settings-dialog-done').click();
    await expect(window.locator('#settings-dialog')).toBeHidden();

    // The input's value is seeded by the dialog-open effect in
    // SettingsPanel.tsx (a snapshot, not a reactive binding), so reopening
    // before the persisted write above lands would show a stale value that
    // Playwright's auto-retry can never resolve — the poll above must gate
    // this reopen.
    await window.locator('#settings-btn').click();
    await expect(window.locator('#share-church-name-input')).toHaveValue('E2E Community Chapel');

    // Restore the default so later specs (and reruns) see a clean setting.
    await window.locator('#share-church-name-input').fill('');
    await window.locator('#settings-dialog-title').click();
    await expect.poll(() => persistedSetting(window, 'shareChurchName')).toBe('');
    await window.locator('#settings-dialog-done').click();
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
    await window.locator('#settings-dialog-done').click();
    await expect(window.locator('#settings-dialog')).toBeHidden();
  });

  // Opt-in anonymous usage counts (#145) — default-OFF persisted preference,
  // no collection/network code anywhere. Lives in the same Settings dialog.
  test('usage-signal toggle is off by default with honest copy', async () => {
    await window.locator('#settings-btn').click();
    await window.locator('#settings-tab-btn-privacy').click();
    await expect(window.locator('#usage-signal-toggle')).toBeVisible();
    await expect(window.locator('#usage-signal-toggle')).not.toBeChecked();
    await expect(window.locator('#usage-signal-note')).toContainText('anonymous');
    await expect(window.locator('#usage-signal-note')).toContainText('never audio');
    await window.locator('#settings-dialog-done').click();
  });

  // #1010: the compact Settings toggle chrome is CSS-only — the control is
  // still a native checkbox, so keyboard, AT and Playwright all drive it.
  test('the usage-signal toggle keeps native checkbox semantics', async () => {
    await window.locator('#settings-btn').click();
    await window.locator('#settings-tab-btn-privacy').click();
    const toggle = window.locator('#usage-signal-toggle');
    expect(await toggle.evaluate((el) => el.tagName)).toBe('INPUT');
    expect(await toggle.evaluate((el) => (el as HTMLInputElement).type)).toBe('checkbox');

    // A restyled-but-not-hidden input keeps a real hit target.
    const box = await toggle.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(0);
    expect(box?.height ?? 0).toBeGreaterThan(0);

    await toggle.focus();
    await window.keyboard.press('Space');
    await expect(toggle).toBeChecked();
    await window.keyboard.press('Space');
    await expect(toggle).not.toBeChecked();

    // The toggle now persists on change (#1018) — the two Space presses above
    // already landed it back on unchecked, so no ON preference leaks to later tests.
    await window.locator('#settings-dialog-done').click();
  });

  test('the dialog navigates via a left rail, with no horizontal tab strip', async () => {
    await window.locator('#settings-btn').click();
    await expect(window.locator('#settings-dialog .settings-rail')).toBeVisible();
    await expect(window.locator('#settings-dialog .settings-tabs')).toHaveCount(0);
    await expect(window.locator('#settings-tab-btn-general')).toHaveClass(/active/);
    await window.locator('#settings-tab-btn-labs').click();
    await expect(window.locator('#settings-tab-btn-labs')).toHaveClass(/active/);
    await expect(window.locator('#settings-tab-btn-general')).not.toHaveClass(/active/);
    await window.locator('#settings-dialog-done').click();
  });

  test('the card, rail and footer keep their geometry across a section switch', async () => {
    await window.locator('#settings-btn').click();
    const card = window.locator('.settings-dialog-card');
    const footer = window.locator('#settings-dialog .settings-footer');
    const before = { card: await card.boundingBox(), footer: await footer.boundingBox() };
    // Storage is the tallest section — the one that used to grow the card.
    await window.locator('#settings-tab-btn-storage').click();
    await expect(window.locator('#settings-pane-storage')).toBeVisible();
    const after = { card: await card.boundingBox(), footer: await footer.boundingBox() };
    expect(Math.abs(after.card!.height - before.card!.height)).toBeLessThanOrEqual(BOX_EPSILON_PX);
    expect(Math.abs(after.card!.width - before.card!.width)).toBeLessThanOrEqual(BOX_EPSILON_PX);
    expect(Math.abs(after.footer!.y - before.footer!.y)).toBeLessThanOrEqual(BOX_EPSILON_PX);
    await expect(window.locator('#settings-dialog-done')).toBeVisible();
    await window.locator('#settings-dialog-done').click();
  });

  // #1021: the footer's Cancel/Save pair is gone — Done is the only action.
  // Steps 4 and 7 (button count + role/name query) make this resistant to a
  // Save button reappearing under a new id.
  test('Done is the only dialog action', async () => {
    await window.locator('#settings-btn').click();
    await expect(window.locator('#settings-dialog-title')).toHaveText('Settings');
    await expect(window.locator('#settings-dialog-done')).toHaveText('Done');
    await expect(window.locator('#settings-dialog .rig-dialog-actions button')).toHaveCount(1);
    await expect(window.locator('#settings-dialog-save')).toHaveCount(0);
    await expect(window.locator('#settings-dialog-cancel')).toHaveCount(0);
    await expect(
      window.locator('#settings-dialog').getByRole('button', { name: /^(Save|Cancel)$/ }),
    ).toHaveCount(0);
    await window.locator('#settings-dialog-done').click();
  });

  // #1021 (epic #1000): every control is already persisted by the time any
  // close affordance runs, so each of Done, Escape, and the title-bar close
  // must leave an already-committed change intact.
  test('every close path keeps an instantly-applied change', async () => {
    await window.locator('#settings-btn').click();
    await window.locator('#settings-tab-btn-privacy').click();
    await window.locator('#usage-signal-toggle').check();
    await expect.poll(() => persistedSetting(window, 'usageSignalEnabled')).toBe(true);

    // Done.
    await window.locator('#settings-dialog-done').click();
    await expect(window.locator('#settings-dialog')).toBeHidden();
    await window.locator('#settings-btn').click();
    await window.locator('#settings-tab-btn-privacy').click();
    await expect(window.locator('#usage-signal-toggle')).toBeChecked();

    // Escape.
    await window.keyboard.press('Escape');
    await expect(window.locator('#settings-dialog')).toBeHidden();
    await window.locator('#settings-btn').click();
    await window.locator('#settings-tab-btn-privacy').click();
    await expect(window.locator('#usage-signal-toggle')).toBeChecked();

    // Title-bar close.
    await window.locator('#settings-dialog-close').click();
    await expect(window.locator('#settings-dialog')).toBeHidden();
    await window.locator('#settings-btn').click();
    await window.locator('#settings-tab-btn-privacy').click();
    await expect(window.locator('#usage-signal-toggle')).toBeChecked();

    // Restore the default-OFF preference so it cannot leak into later specs.
    await window.locator('#usage-signal-toggle').uncheck();
    await expect.poll(() => persistedSetting(window, 'usageSignalEnabled')).toBe(false);
    await window.locator('#settings-dialog-done').click();
  });
});
