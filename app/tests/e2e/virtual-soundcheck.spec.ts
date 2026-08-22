import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp } from './e2e-helpers';

let electronApp: ElectronApplication;
let window: Page;

test.describe('Retired standalone Soundcheck tab (#1099)', () => {
  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp());
  });

  test.afterAll(async () => {
    await electronApp?.close();
  });

  test.beforeEach(async () => {
    await window.reload();
    await window.waitForLoadState('domcontentloaded');
  });

  test('keeps Soundcheck absent from navigation and DOM while Session remains the playback workspace', async () => {
    await expect(window.locator('.mode-tab[data-mode="soundcheck"]')).toHaveCount(0);
    await expect(window.locator('#tab-soundcheck')).toHaveCount(0);
    await expect(window.locator('#soundcheck-island')).toHaveCount(0);

    const sessionTab = window.locator('.mode-tab[data-mode="live"]');
    await expect(sessionTab).toBeVisible();
    await expect(sessionTab).toContainText('Session');
    await sessionTab.click();
    await expect(window.locator('#tab-live')).toBeVisible();
    await expect(window.locator('body')).toHaveClass(/live-active/);
  });
});
