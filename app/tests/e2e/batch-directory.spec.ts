import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import * as path from 'path';
import { launchApp, FAKE_ANALYSIS, WORSHIP_SERVICE_ANALYSIS } from './e2e-helpers';

// Batch-analyze a folder of whole-mix recordings (#270): the Directory tab's
// folder picker + Analyze All button run the existing single-file analyze
// pipeline sequentially over every file found, rendering one row per result.
// Stubbed spec (SB_E2E_STUBBED_ONLY-safe): open-dir-dialog and analyze-file
// are stubbed (fixture folder path; a canned result keyed by filePath, same
// removeHandler/handle pattern as every other spec, see e2e-helpers.ts).
// list-folder-audio is left REAL (never stubbed by launchApp()), so the real
// folder scan runs against the fixtures folder below. save-analysis-summary/
// list-analysis-summaries are backed by a plain in-memory array instead of
// launchApp()'s default no-op stubs (real storage.ts is unisolated across
// spec files, and electronApp.evaluate's main-process context has no
// `require`) — this still exercises the real save → list → Recent-tab round
// trip end to end; storage.ts's own disk read/write is covered separately by
// storage.test.ts.

let electronApp: ElectronApplication;
let window: Page;

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures', 'batch');
const GOOD_1 = path.join(FIXTURES_DIR, '01-sunday-am.wav');
const BROKEN = path.join(FIXTURES_DIR, '02-broken.wav');
const GOOD_2 = path.join(FIXTURES_DIR, '03-wednesday-night.wav');
const BROKEN_ERROR = "ffprobe exited 1 — the file may be corrupt or an unsupported format.";

test.describe('Sound Buddy E2E — batch-analyze a folder (#270)', () => {
  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp());

    await electronApp.evaluate(({ ipcMain }, opts) => {
      ipcMain.removeHandler('open-dir-dialog');
      ipcMain.handle('open-dir-dialog', () => opts.fixturesDir);

      ipcMain.removeHandler('analyze-file');
      ipcMain.handle('analyze-file', (_event: unknown, fileOpts: { filePath: string }) =>
        opts.analyses[fileOpts.filePath] ?? { success: false, error: 'unexpected fixture path' });

      // launchApp()'s default stubs no-op these two (real storage.ts is
      // unisolated across spec files, and this main-process evaluate context
      // has no `require` to reach the compiled module directly) — an
      // in-memory array still exercises the real save → list → Recent-tab
      // round trip; storage.ts's own disk read/write has its own test suite.
      const history: Array<Record<string, unknown>> = [];
      ipcMain.removeHandler('save-analysis-summary');
      ipcMain.handle('save-analysis-summary', (_event: unknown, payload: Record<string, unknown>) => {
        history.unshift({ date: new Date().toISOString(), ...payload });
        return { success: true, file: `${history.length}.json` };
      });
      ipcMain.removeHandler('list-analysis-summaries');
      ipcMain.handle('list-analysis-summaries', () => ({
        success: true,
        summaries: history.slice(0, 10),
      }));
    }, {
      fixturesDir: FIXTURES_DIR,
      analyses: {
        [GOOD_1]: { success: true, data: FAKE_ANALYSIS },
        [BROKEN]: { success: false, error: BROKEN_ERROR },
        [GOOD_2]: { success: true, data: WORSHIP_SERVICE_ANALYSIS },
      },
    });
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test('analyzes every file in the chosen folder, one row per file — a broken file does not abort the rest', async () => {
    await window.locator('.mode-tab[data-mode="dir"]').click();
    await expect(window.locator('#dir-analyze-btn')).toBeDisabled();

    await window.locator('#dir-choose-btn').click();
    await expect(window.locator('#dir-path')).toHaveText(FIXTURES_DIR);
    await expect(window.locator('#dir-analyze-btn')).toBeEnabled();

    await window.locator('#dir-analyze-btn').click();

    const rows = window.locator('#dir-results .recent-row');
    await expect(rows).toHaveCount(3);
    await expect(window.locator('#dir-progress')).toContainText('2 analyzed');
    await expect(window.locator('#dir-progress')).toContainText("1 couldn't be read");
    await expect(window.locator('#dir-analyze-btn')).toBeEnabled();

    await expect(rows.nth(0).locator('.dir-name')).toHaveText('01-sunday-am.wav');
    await expect(rows.nth(0).locator('.recent-grade')).not.toHaveText('—');

    await expect(rows.nth(1).locator('.dir-name')).toHaveText('02-broken.wav');
    await expect(rows.nth(1).locator('.recent-grade')).toHaveClass(/batch-failed/);
    await expect(rows.nth(1).locator('.recent-grade')).toHaveText('—');
    await expect(rows.nth(1).locator('.batch-error')).toHaveText(BROKEN_ERROR);

    await expect(rows.nth(2).locator('.dir-name')).toHaveText('03-wednesday-night.wav');
    await expect(rows.nth(2).locator('.recent-grade')).not.toHaveText('—');

    // History persistence AC: the two successful analyses were really saved
    // (via saveAnalysisSummary) and are read back (via listAnalysisSummaries)
    // on the Recent tab — the same round trip a single-file analysis takes.
    await window.locator('.mode-tab[data-mode="recent"]').click();
    await expect(window.locator('#recent-list .recent-row')).toHaveCount(2);
    await expect(window.locator('#recent-empty')).toBeHidden();
  });
});
