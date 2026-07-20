import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import * as path from 'path';
import { launchApp, loadAndAnalyze, FAKE_ANALYSIS, DEDUCTING_ANALYSIS } from './e2e-helpers';

// #263: "save this mix's tone as your target" CTA — a one-click surface of the
// existing free profileFromMeasuredCurve path (already reachable via the
// harder-to-find "Create new curve…" editor), shown after a strong (A/B)
// grade. Mirrors report-card-grading.spec.ts's "creates a custom ideal curve
// from the current analysis" test but through the new CTA instead of the
// curve-editor dialog.

let electronApp: ElectronApplication;
let window: Page;
const fixturePath = () => path.join(__dirname, '..', 'fixtures', 'silence.wav');

test.describe('Sound Buddy E2E — report card save-target CTA', () => {
  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp());
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test('one-click saves a strong-grading mix as a custom target curve', async () => {
    await window.locator('.mode-tab[data-mode="reportcard"]').click();
    await loadAndAnalyze(window, fixturePath());
    await expect(window.locator('#rc-content')).toBeVisible();

    await expect(window.locator('#rc-save-target')).toBeVisible();
    await expect(window.locator('#rc-save-target-btn')).toContainText('Save this mix’s tone as your target');

    await window.locator('#rc-save-target-btn').click();

    // The new custom profile appears in the IDEAL dropdown, exactly as it
    // would via "Create new curve…" — same upsert/persist path, no new logic.
    await expect(window.locator('#ideal-profile-select')).toHaveValue(/^custom:/);
    await expect(window.locator('#ideal-profile-select')).toContainText('Target from silence');

    await expect(window.locator('#rc-save-target-btn')).toContainText('Saved as a target curve');
    await expect(window.locator('#rc-save-target-btn')).toBeDisabled();

    // C-and-below grades don't offer the CTA — restore afterward so later specs
    // in other files still see the default clean fixture.
    await electronApp.evaluate(({ ipcMain }, analysis) => {
      ipcMain.removeHandler('analyze-file');
      ipcMain.handle('analyze-file', () => ({ success: true, data: analysis }));
    }, DEDUCTING_ANALYSIS);

    await loadAndAnalyze(window, fixturePath());
    await expect(window.locator('#rc-save-target')).toHaveCount(0);

    await electronApp.evaluate(({ ipcMain }, analysis) => {
      ipcMain.removeHandler('analyze-file');
      ipcMain.handle('analyze-file', () => ({ success: true, data: analysis }));
    }, FAKE_ANALYSIS);
    await loadAndAnalyze(window, fixturePath());
  });
});
