import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { LICENSE_ENV, seedTrial } from './license-fixture';

// First-launch Pro trial (#61), run for REAL against an isolated license.json
// in a throwaway --user-data-dir: a brand-new user boots straight into Pro with
// a countdown badge, the nudge appears at the right milestone, and once the
// 14 days elapse the app gates smoothly with an upgrade card (report card free).

const MAIN = path.join(__dirname, '..', 'dist', 'electron', 'main.js');
const USER_DATA = path.join(__dirname, '..', 'test-results', 'trial-userdata');

let app: ElectronApplication;
let win: Page;

async function launch(): Promise<void> {
  app = await electron.launch({
    args: [MAIN, `--user-data-dir=${USER_DATA}`],
    env: { ...process.env, ...LICENSE_ENV },
  });
  win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('#license-badge')).toHaveText(/FREE|PRO|Pro trial/);
}

test.describe.serial('First-launch Pro trial (#61)', () => {
  test.afterEach(async () => {
    await app?.close();
  });

  test('a brand-new user boots into a Pro trial — countdown badge, unlocked features', async () => {
    fs.rmSync(USER_DATA, { recursive: true, force: true });
    await launch();

    // Countdown badge, and the app is fully Pro (no gating).
    await expect(win.locator('#license-badge')).toHaveText('Pro trial — 14 days left');
    await expect(win.locator('body')).not.toHaveClass(/not-pro/);
    await expect(win.locator('.mode-tab[data-mode="live"] .tab-lock')).toBeHidden();
    await win.locator('.mode-tab[data-mode="live"]').click();
    await expect(win.locator('#live-start-btn')).toBeVisible();

    // The trial stamp was persisted for the countdown to roll forward.
    const stored = JSON.parse(fs.readFileSync(path.join(USER_DATA, 'license.json'), 'utf8'));
    expect(typeof stored.trialStartedAt).toBe('string');
  });

  test('day 3: the gentle subscription nudge appears', async () => {
    fs.rmSync(USER_DATA, { recursive: true, force: true });
    seedTrial(USER_DATA, 3); // started 3 days ago
    await launch();

    await expect(win.locator('#license-badge')).toHaveText('Pro trial — 11 days left');
    await expect(win.locator('#trial-banner')).toBeVisible();
    await expect(win.locator('#trial-banner-text')).toContainText('Start your subscription');
    // Dismissing it hides the banner (and won't nag again — localStorage).
    await win.locator('#trial-banner-dismiss').click();
    await expect(win.locator('#trial-banner')).toBeHidden();
  });

  test('day 14+: gating engages with an upgrade card, report card stays free', async () => {
    fs.rmSync(USER_DATA, { recursive: true, force: true });
    seedTrial(USER_DATA, 20); // trial long over
    await launch();

    await expect(win.locator('#license-badge')).toHaveText('FREE');
    await expect(win.locator('body')).toHaveClass(/not-pro/);
    // Upgrade card in the trial banner.
    await expect(win.locator('#trial-banner')).toBeVisible();
    await expect(win.locator('#trial-banner-text')).toContainText('trial has ended');
    // Gated surfaces revert to their pro-gates.
    await win.locator('.mode-tab[data-mode="live"]').click();
    await expect(win.locator('#tab-live .pro-gate')).toBeVisible();
    await expect(win.locator('#live-start-btn')).toBeHidden();
    // The free funnel is untouched.
    await win.locator('.mode-tab[data-mode="reportcard"]').click();
    await expect(win.locator('#reportcard-view')).toBeVisible();
  });
});
