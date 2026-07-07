import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { LICENSE_ENV, makeLicenseKey, seedProLicense } from './license-fixture';

// License gating (#54), run for REAL against an isolated license.json in a
// throwaway --user-data-dir: free tier locks (badge, tab locks, upgrade cards),
// key entry unlocks mid-session without a restart, invalid/expired keys show
// clear messaging without locking anything, and grace shows the banner.

const MAIN = path.join(__dirname, '..', 'dist', 'electron', 'main.js');
const USER_DATA = path.join(__dirname, '..', 'test-results', 'license-userdata');
const DAY_MS = 24 * 60 * 60 * 1000;

let app: ElectronApplication;
let win: Page;

async function launch(): Promise<void> {
  app = await electron.launch({
    args: [MAIN, `--user-data-dir=${USER_DATA}`],
    env: { ...process.env, ...LICENSE_ENV },
  });
  win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  // Boot resolves the license async; the badge is populated either way.
  await expect(win.locator('#license-badge')).toHaveText(/FREE|PRO/);
}

test.describe.serial('License gating (#54)', () => {
  test.beforeAll(() => {
    fs.rmSync(USER_DATA, { recursive: true, force: true });
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test('free tier: FREE badge, locked tabs show upgrade cards, report card stays free', async () => {
    await launch();

    await expect(win.locator('#license-badge')).toHaveText('FREE');
    await expect(win.locator('body')).toHaveClass(/not-pro/);

    // Gated tabs carry a lock glyph and open to an upgrade card, not controls.
    await expect(win.locator('.mode-tab[data-mode="live"] .tab-lock')).toBeVisible();
    await expect(win.locator('.mode-tab[data-mode="soundcheck"] .tab-lock')).toBeVisible();
    await win.locator('.mode-tab[data-mode="live"]').click();
    await expect(win.locator('#tab-live .pro-gate')).toBeVisible();
    await expect(win.locator('#live-start-btn')).toBeHidden();
    await expect(win.locator('#rig-bar #rig-select')).toBeHidden();
    await win.locator('.mode-tab[data-mode="soundcheck"]').click();
    await expect(win.locator('#tab-soundcheck .pro-gate')).toBeVisible();
    await expect(win.locator('#sc-play-btn')).toBeHidden();

    // The free funnel is untouched: File tab + Report Card fully work.
    await win.locator('.mode-tab[data-mode="reportcard"]').click();
    await expect(win.locator('#reportcard-view')).toBeVisible();
  });

  test('an invalid key shows clear messaging and locks nothing', async () => {
    await win.locator('#license-badge').click();
    await expect(win.locator('#license-dialog')).toBeVisible();
    await win.locator('#license-key-input').fill('SB1.not.real');
    await win.locator('#license-activate-btn').click();

    await expect(win.locator('#license-dialog-error')).toBeVisible();
    await expect(win.locator('#license-badge')).toHaveText('FREE');
    // Nothing was persisted.
    expect(fs.existsSync(path.join(USER_DATA, 'license.json'))).toBe(false);
  });

  test('an expired key is refused with messaging (not stored)', async () => {
    const expired = makeLicenseKey({
      kind: 'subscription',
      expiresAt: new Date(Date.now() - 30 * DAY_MS).toISOString(),
    });
    await win.locator('#license-key-input').fill(expired);
    await win.locator('#license-activate-btn').click();

    await expect(win.locator('#license-dialog-error')).toContainText('expired');
    await expect(win.locator('#license-badge')).toHaveText('FREE');
    expect(fs.existsSync(path.join(USER_DATA, 'license.json'))).toBe(false);
  });

  test('a valid key unlocks all gated features immediately — no restart', async () => {
    const key = makeLicenseKey({
      kind: 'subscription',
      email: 'engineer@church.test',
      expiresAt: new Date(Date.now() + 365 * DAY_MS).toISOString(),
    });
    await win.locator('#license-key-input').fill(key);
    await win.locator('#license-activate-btn').click();

    await expect(win.locator('#license-dialog')).toBeHidden();
    await expect(win.locator('#license-badge')).toHaveText('PRO');
    await expect(win.locator('body')).not.toHaveClass(/not-pro/);

    // Same session: the Live tab now shows real controls, locks are gone.
    await expect(win.locator('.mode-tab[data-mode="live"] .tab-lock')).toBeHidden();
    await win.locator('.mode-tab[data-mode="live"]').click();
    await expect(win.locator('#tab-live .pro-gate')).toBeHidden();
    await expect(win.locator('#live-start-btn')).toBeVisible();
    await expect(win.locator('#rig-bar #rig-select')).toBeVisible();

    // And it persisted for the next launch.
    const stored = JSON.parse(fs.readFileSync(path.join(USER_DATA, 'license.json'), 'utf8'));
    expect(stored.key).toBe(key);
  });

  test('Remove key reverts to the free tier without locking the app', async () => {
    await win.locator('#license-badge').click();
    await expect(win.locator('#license-remove-btn')).toBeVisible();
    await win.locator('#license-remove-btn').click();

    await expect(win.locator('#license-badge')).toHaveText('FREE');
    expect(fs.existsSync(path.join(USER_DATA, 'license.json'))).toBe(false);
    await win.locator('#license-close-btn').click();
    // Free again, not locked: report card still reachable.
    await win.locator('.mode-tab[data-mode="reportcard"]').click();
    await expect(win.locator('#reportcard-view')).toBeVisible();
  });

  test('a key inside its 7-day grace window keeps Pro and shows the banner', async () => {
    await app.close();
    seedProLicense(USER_DATA, {
      kind: 'subscription',
      expiresAt: new Date(Date.now() - 2 * DAY_MS).toISOString(),
    });
    await launch();

    await expect(win.locator('#license-badge')).toHaveText('PRO · GRACE');
    await expect(win.locator('#license-banner')).toBeVisible();
    await expect(win.locator('#license-banner-text')).toContainText('expired');
    // Still Pro during grace.
    await win.locator('.mode-tab[data-mode="live"]').click();
    await expect(win.locator('#live-start-btn')).toBeVisible();
  });

  test('past the grace window the app reverts to free — data kept, nothing locked', async () => {
    await app.close();
    seedProLicense(USER_DATA, {
      kind: 'subscription',
      expiresAt: new Date(Date.now() - 30 * DAY_MS).toISOString(),
    });
    await launch();

    await expect(win.locator('#license-badge')).toHaveText('FREE');
    await expect(win.locator('#license-banner')).toBeHidden();
    await win.locator('.mode-tab[data-mode="live"]').click();
    await expect(win.locator('#tab-live .pro-gate')).toBeVisible();
    // The dialog explains, rather than a silent lock.
    await win.locator('#license-badge').click();
    await expect(win.locator('#license-dialog-status')).toContainText('expired');
    await win.locator('#license-close-btn').click();
  });

  test('a lifetime key (#90) is Pro with no expiry mechanics', async () => {
    await app.close();
    seedProLicense(USER_DATA, { kind: 'lifetime', email: 'founder@church.test' });
    await launch();

    await expect(win.locator('#license-badge')).toHaveText('PRO');
    await expect(win.locator('#license-banner')).toBeHidden();
    await win.locator('#license-badge').click();
    await expect(win.locator('#license-dialog-status')).toContainText('lifetime');
  });
});
