import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import * as path from 'path';
import { launchApp } from './e2e-helpers';

// Recent Services list (#147): the last 10 persisted report-card summaries,
// newest-first, loadable into the report card view without re-running any
// analysis. launchApp() already stubs list-analysis-summaries to the empty
// state (see e2e-helpers.ts); each test that needs data re-stubs it here.

let electronApp: ElectronApplication;
let window: Page;

function summary(overrides: Partial<{
  date: string;
  sourceFilename: string;
  gradeLetter: string;
  score: number;
  recordingType: string;
  topFixes: string[];
}> = {}) {
  return {
    date: '2026-07-01T09:00:00.000Z',
    sourceFilename: 'sermon.wav',
    gradeLetter: 'B',
    score: 84,
    recordingType: 'Music',
    topFixes: ['Reduce low mids', 'Raise speech presence'],
    ...overrides,
  };
}

async function stubSummaries(summaries: ReturnType<typeof summary>[]) {
  await electronApp.evaluate(({ ipcMain }, list) => {
    ipcMain.removeHandler('list-analysis-summaries');
    ipcMain.handle('list-analysis-summaries', () => ({ success: true, summaries: list }));
  }, summaries);
}

// Switching to a tab other than 'recent' first guarantees the next click on
// the Recent tab is a real mode change, so its (re)load-every-visit handler
// actually fires (the mode-tab click handler no-ops when mode === currentMode).
async function openRecentTab() {
  await window.locator('.mode-tab[data-mode="dir"]').click();
  await window.locator('.mode-tab[data-mode="recent"]').click();
}

test.describe('Sound Buddy E2E — recent services (#147)', () => {
  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp());
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test('shows the empty state when there is no history', async () => {
    await openRecentTab();
    await expect(window.locator('#recent-empty')).toBeVisible();
    await expect(window.locator('#recent-list .recent-row')).toHaveCount(0);
  });

  test('renders a populated list newest-first with grade, date, and filename', async () => {
    // list-analysis-summaries (the real main-process handler, unit-tested in
    // storage.test.ts) always returns records newest-first — the renderer
    // trusts that order rather than re-sorting, so the stub mirrors it.
    await stubSummaries([
      summary({ date: '2026-07-03T09:00:00.000Z', sourceFilename: 'newest.wav', gradeLetter: 'A' }),
      summary({ date: '2026-07-02T09:00:00.000Z', sourceFilename: 'middle.wav', gradeLetter: 'B' }),
      summary({ date: '2026-07-01T09:00:00.000Z', sourceFilename: 'older.wav', gradeLetter: 'C' }),
    ]);
    await openRecentTab();

    await expect(window.locator('#recent-empty')).toBeHidden();
    const rows = window.locator('#recent-list .recent-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0).locator('.dir-name')).toHaveText('newest.wav');
    await expect(rows.nth(0).locator('.recent-grade')).toHaveText('A');
    await expect(rows.nth(1).locator('.dir-name')).toHaveText('middle.wav');
    await expect(rows.nth(2).locator('.dir-name')).toHaveText('older.wav');
  });

  test('caps the rendered list at 10 rows even if more come back over IPC', async () => {
    const many = Array.from({ length: 13 }, (_, i) =>
      summary({
        date: `2026-07-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
        sourceFilename: `file-${i}.wav`,
      }));
    await stubSummaries(many);
    await openRecentTab();

    await expect(window.locator('#recent-list .recent-row')).toHaveCount(10);
  });

  test('clicking a row loads the stored grade/score/filename/date with no analysis run', async () => {
    await electronApp.evaluate(({ ipcMain }) => {
      (globalThis as unknown as { __analyzeFileCalls: number }).__analyzeFileCalls = 0;
      ipcMain.removeHandler('analyze-file');
      ipcMain.handle('analyze-file', () => {
        (globalThis as unknown as { __analyzeFileCalls: number }).__analyzeFileCalls += 1;
        return { success: true, data: null };
      });
    });

    await stubSummaries([
      summary({ date: '2026-07-05T14:30:00.000Z', sourceFilename: 'worship.wav', gradeLetter: 'A', score: 96 }),
    ]);
    await openRecentTab();

    await window.locator('#recent-list .recent-row').first().click();

    // The row click routes through the same tab, so the report-card view
    // takes over the screen exactly as it does after a real analysis.
    await expect(window.locator('#reportcard-view')).toHaveClass(/active/);
    await expect(window.locator('#rc-content')).toBeVisible();
    await expect(window.locator('#rc-empty')).toBeHidden();
    await expect(window.locator('#rc-filename')).toHaveText('worship.wav');
    await expect(window.locator('#rc-ring .letter')).toHaveText('A');
    await expect(window.locator('#rc-ring .score')).toContainText('96');
    await expect(window.locator('#rc-date')).toHaveText(new Date('2026-07-05T14:30:00.000Z').toLocaleString());

    // Sections that need raw analysis data the stored summary doesn't have
    // are hidden rather than rendered empty.
    await expect(window.locator('#rc-metrics-section')).toBeHidden();
    await expect(window.locator('#rc-why-section')).toBeHidden();
    await expect(window.locator('#rc-bands-section')).toBeHidden();
    await expect(window.locator('#rc-frames-section')).toBeHidden();
    await expect(window.locator('#rc-profile-section')).toBeHidden();

    // Recommendations still render straight from the stored topFixes.
    await expect(window.locator('#rc-recommendations .rc-rec')).toHaveCount(2);

    // Never re-ran analysis — the stored record is all that backed the card.
    const analyzeFileCalls = await electronApp.evaluate(() =>
      (globalThis as unknown as { __analyzeFileCalls: number }).__analyzeFileCalls);
    expect(analyzeFileCalls).toBe(0);

    // Clear is disabled — there is no file backing this card to clear.
    await expect(window.locator('#reportcard-clear-btn')).toBeDisabled();
  });

  test('a crafted gradeLetter cannot break out of the style attribute or inject markup', async () => {
    // gradeLetter is read back off a disk-stored record — historyDir() can be
    // a user-configured, synced/shared storage folder (#91), so a record
    // written by another install (or a hand-edited file) isn't fully trusted.
    // Neither the list row nor the loaded report card should ever parse a
    // crafted gradeLetter as markup.
    const payload = '"><img src=x id=xss-probe onerror="window.__xssFired=true">';
    await stubSummaries([summary({ sourceFilename: 'crafted.wav', gradeLetter: payload })]);
    await openRecentTab();

    await expect(window.locator('#recent-list .recent-row')).toHaveCount(1);
    await expect(window.locator('#xss-probe')).toHaveCount(0);
    await expect(window.locator('.recent-grade')).toHaveText(payload);

    await window.locator('#recent-list .recent-row').first().click();
    await expect(window.locator('#rc-content')).toBeVisible();
    await expect(window.locator('#xss-probe')).toHaveCount(0);
    await expect(window.locator('#rc-ring .letter')).toHaveText(payload);

    const fired = await window.evaluate(() => (window as unknown as { __xssFired?: boolean }).__xssFired);
    expect(fired).toBeUndefined();
  });

  test('a history record with a missing gradeLetter does not crash the report card render', async () => {
    // Bypasses storage.ts's own shape validation (unit-tested separately) to
    // exercise the renderer's own defensive fallback in gradeRingHTML — the
    // two guards are independent layers against the same malformed-record risk.
    await electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('list-analysis-summaries');
      ipcMain.handle('list-analysis-summaries', () => ({
        success: true,
        summaries: [{
          date: '2026-07-01T00:00:00.000Z', sourceFilename: 'weird.wav',
          score: 70, recordingType: 'Music', topFixes: [],
        }],
      }));
    });

    const pageErrors: string[] = [];
    window.on('pageerror', (e) => pageErrors.push(String(e)));

    await openRecentTab();
    await window.locator('#recent-list .recent-row').first().click();

    await expect(window.locator('#rc-content')).toBeVisible();
    await expect(window.locator('#rc-filename')).toHaveText('weird.wav');
    expect(pageErrors).toEqual([]);
  });

  test('loading a history entry resets a stale File-tab dropzone/Analyze state (#206)', async () => {
    await stubSummaries([summary({ sourceFilename: 'worship.wav' })]);

    // Load (without analyzing) a file first, so the dropzone shows "loaded"
    // and Analyze is enabled — the exact state loadHistoryEntry must reset,
    // otherwise Analyze would silently no-op on a null currentFilePath later.
    const fixturePath = path.join(__dirname, '..', 'fixtures', 'silence.wav');
    await window.evaluate((fp) => {
      (window as unknown as { loadFile: (p: string) => void }).loadFile(fp);
    }, fixturePath);
    await expect(window.locator('#file-dropzone')).toHaveClass(/loaded/);
    await expect(window.locator('#analyze-btn')).toBeEnabled();

    await openRecentTab();
    await window.locator('#recent-list .recent-row').first().click();
    await expect(window.locator('#rc-content')).toBeVisible();

    await expect(window.locator('#file-dropzone')).not.toHaveClass(/loaded/);
    await expect(window.locator('#file-dropzone')).toContainText('Drop audio file here');
    await expect(window.locator('#analyze-btn')).toBeDisabled();
  });
});
