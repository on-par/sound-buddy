import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

// First-run onboarding (#69), run for REAL against a throwaway --user-data-dir:
// a brand-new user sees the welcome overlay, one click analyzes the bundled demo
// recording through the normal pipeline, and the report card appears
// automatically — no settings, no file picker. The flow shows exactly once
// (localStorage gate), so a relaunch or an explicit skip never nags again.

const MAIN = path.join(__dirname, '..', 'dist', 'electron', 'main.js');
const USER_DATA = path.join(__dirname, '..', 'test-results', 'onboarding-userdata');

let app: ElectronApplication;
let win: Page;

async function launch(): Promise<void> {
  app = await electron.launch({ args: [MAIN, `--user-data-dir=${USER_DATA}`] });
  win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
}

test.describe.serial('First-run onboarding (#69)', () => {
  test.afterEach(async () => {
    await app?.close();
  });

  test('a brand-new user goes from welcome overlay to report card in one click', async () => {
    fs.rmSync(USER_DATA, { recursive: true, force: true });
    await launch();

    // Welcome overlay is up, "what this does", with the one-click CTA.
    const dialog = win.locator('#onboarding-dialog');
    await expect(dialog).toBeVisible();
    await expect(win.locator('#onboarding-title')).toHaveText('Welcome to Sound Buddy');
    await expect(win.locator('#onboarding-copy')).toContainText('report card');
    const runBtn = win.locator('#onboarding-run');
    await expect(runBtn).toHaveText(/Run your first analysis/);

    // One click → progress indicator, then the report card appears automatically.
    await runBtn.click();
    await expect(win.locator('#onboarding-progress')).toBeVisible();

    // Report card view becomes active with real, populated content (the demo file).
    await expect(win.locator('#reportcard-view')).toHaveClass(/active/, { timeout: 20_000 });
    await expect(win.locator('#rc-content')).toBeVisible();
    await expect(win.locator('#rc-filename')).toHaveText('demo.wav');

    // Overlay is gone and the gate was persisted.
    await expect(dialog).toBeHidden();
    const ls = await win.evaluate(() => localStorage.getItem('sb-onboarding-seen-v1'));
    expect(ls).toBe('1');
  });

  test('once completed, a relaunch does not show onboarding again', async () => {
    // Reuses the same USER_DATA the previous test marked as seen (serial suite).
    await launch();
    await expect(win.locator('#onboarding-dialog')).toBeHidden();
  });

  test('skipping retires the flow without running an analysis', async () => {
    fs.rmSync(USER_DATA, { recursive: true, force: true });
    await launch();

    const dialog = win.locator('#onboarding-dialog');
    await expect(dialog).toBeVisible();
    await win.locator('#onboarding-skip').click();
    await expect(dialog).toBeHidden();

    // No analysis ran, and the seen flag persisted so it won't reappear.
    const ls = await win.evaluate(() => localStorage.getItem('sb-onboarding-seen-v1'));
    expect(ls).toBe('1');
  });
});
