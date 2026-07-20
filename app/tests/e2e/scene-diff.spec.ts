import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import * as path from 'path';
import { launchApp } from './e2e-helpers';

// Scene-file diff (#264): the report-card empty state's second, optional
// #scene-dropzone drop target parses and diffs two dropped M32R .scn files
// with no CLI/terminal needed. Stubbed spec (SB_E2E_STUBBED_ONLY-safe): only
// open-file-dialog is stubbed (to hand back fixture paths in sequence,
// bypassing the native picker) — diff-scenes itself is left REAL, so the
// bundled scene-inspector CJS build and the fixture .scn files are exercised
// end-to-end, same rationale as cancel-progress.spec.ts's real-handler style.

let electronApp: ElectronApplication;
let window: Page;

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'scenes');
const BEFORE_SCN = path.join(FIXTURES, 'before.scn');
const AFTER_SCN = path.join(FIXTURES, 'after.scn');
const CORRUPT_SCN = path.join(FIXTURES, 'corrupt.scn');

async function stubOpenFileDialog(paths: string[]): Promise<void> {
  await electronApp.evaluate(({ ipcMain }, seq) => {
    ipcMain.removeHandler('open-file-dialog');
    let i = 0;
    ipcMain.handle('open-file-dialog', () => {
      const p = seq[i] ?? null;
      i += 1;
      return p;
    });
  }, paths);
}

test.describe('Sound Buddy E2E — scene-file diff (#264)', () => {
  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp());
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test('one scene shows "nothing to compare yet"; a second shows the top changes; a corrupt third shows an actionable error', async () => {
    await window.locator('.mode-tab[data-mode="reportcard"]').click();
    await stubOpenFileDialog([BEFORE_SCN, AFTER_SCN, CORRUPT_SCN]);

    // AC: only one .scn dropped — a clear "nothing to compare yet" state, not
    // an error and not a silent no-op.
    await window.locator('#scene-dropzone').click();
    await expect(window.locator('#rc-scene-changes')).toContainText('Nothing to compare yet');

    // AC: two .scn files (before/after) — the top 3 changes from the real
    // scene-inspector diff, with no CLI.
    await window.locator('#scene-dropzone').click();
    await expect(window.locator('#rc-scene-changes')).toContainText('Console changes');
    await expect(window.locator('.rc-scene-change')).toHaveCount(3);
    await expect(window.locator('#rc-scene-changes')).toContainText('+2 more');

    // AC: invalid/corrupt .scn input — a specific, actionable error, not a
    // crash or silent no-op. The third drop shifts the window to
    // [after.scn, corrupt.scn], so this exercises the parse-failure path.
    await window.locator('#scene-dropzone').click();
    await expect(window.locator('#rc-scene-changes')).toContainText("isn't a valid M32R scene file");
  });
});
