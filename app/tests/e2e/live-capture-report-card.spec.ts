import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp } from './e2e-helpers';

// Session report card from a live-capture session (#261): Stop Capture builds
// a card from the whole accumulated liveWindows buffer (not just the rolling
// last-window preview), grades it, and persists it to history tagged as a
// live-capture source. Split into its own file (following report-card-basics
// .spec.ts / live-capture.spec.ts's pattern) so it can run as a standalone
// Electron session.

let electronApp: ElectronApplication;
let window: Page;

// Live 'window' ticks arrive over the 'live-event' channel from the main
// process (distinct from the 'meter' ticks live-capture.spec.ts pushes) —
// these are what accumulate into the liveWindows buffer the session report
// card is built from.
async function sendWindowTick(electronApp: ElectronApplication, n: number) {
  await electronApp.evaluate(({ BrowserWindow }, windowNum) => {
    BrowserWindow.getAllWindows()[0].webContents.send('live-event', {
      type: 'window',
      window: windowNum,
      masking: [],
      channels: [
        { name: 'Vocals', rms: -18, peak: -6, clipping: false, centroid: 2400,
          bands: { sub_bass: -58, bass: -30, low_mid: -24, mid: -12, high_mid: -20, presence: -28, brilliance: -80 } },
        { name: 'Band', rms: -22, peak: -9, clipping: false, centroid: 300,
          bands: { sub_bass: -20, bass: -10, low_mid: -26, mid: -30, high_mid: -34, presence: -40, brilliance: -50 } },
      ],
    });
  }, n);
}

async function stubSaveAnalysisSummary(electronApp: ElectronApplication) {
  await electronApp.evaluate(({ ipcMain }) => {
    (globalThis as Record<string, unknown>).__savedSummaries = [];
    ipcMain.removeHandler('save-analysis-summary');
    ipcMain.handle('save-analysis-summary', (_e, payload) => {
      (globalThis as Record<string, unknown[]>).__savedSummaries.push(payload);
      return { success: true, file: 'live-session.json' };
    });
  });
}

async function savedSummaries(electronApp: ElectronApplication): Promise<Array<Record<string, unknown>>> {
  return electronApp.evaluate(() => (globalThis as Record<string, unknown>).__savedSummaries) as Promise<
    Array<Record<string, unknown>>
  >;
}

async function startMonitorCapture() {
  await window.locator('.mode-tab[data-mode="live"]').click();
  await expect(window.locator('#tab-live')).toHaveClass(/active/);
  // Re-enumerate against the stubbed 8-channel device so the workspace has
  // its default strips (mirrors live-capture.spec.ts's beforeEach).
  await window.locator('#device-refresh-btn').click();
  await expect(window.locator('#spectrum-body .live-ch')).toHaveCount(2);
  await window.locator('#live-start-btn').click();
  await expect(window.locator('#live-stop-btn')).toBeVisible();
}

test.describe('Live-capture session report card (#261)', () => {
  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp());
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test('a monitor session with 3+ window ticks builds, shows, and persists a graded card', async () => {
    await stubSaveAnalysisSummary(electronApp);
    await startMonitorCapture();

    await sendWindowTick(electronApp, 1);
    await sendWindowTick(electronApp, 2);
    await sendWindowTick(electronApp, 3);

    await window.locator('#live-stop-btn').click();
    await expect(window.locator('#live-start-btn')).toBeVisible();

    await expect(window.locator('#rc-offer')).toBeVisible();
    await window.locator('#rc-offer-btn').click();

    await expect(window.locator('#reportcard-view')).toHaveClass(/active/);
    await expect(window.locator('#rc-content')).toBeVisible();
    await expect(window.locator('#rc-filename')).toContainText('Live capture');
    const grade = (await window.locator('#rc-ring .letter').textContent())?.trim();
    expect(['A', 'B', 'C', 'D', 'F']).toContain(grade);
    const score = (await window.locator('#rc-ring .score').textContent()) ?? '';
    expect(score).toMatch(/\d/);

    // persistSummary's save is fire-and-forget (an IPC round trip chained
    // behind a listAnalysisSummaries read, #259) — poll rather than assume
    // it has landed by the time the UI assertions above resolved.
    await expect.poll(async () => (await savedSummaries(electronApp)).length).toBe(1);
    const saved = await savedSummaries(electronApp);
    expect(saved[0].source).toBe('live');

    // Recent Services badges the persisted record as Live (#261). The real
    // save-analysis-summary handler stamps `date`; this stub didn't, so add
    // one before feeding the record back through list-analysis-summaries.
    await electronApp.evaluate(({ ipcMain }, s) => {
      ipcMain.removeHandler('list-analysis-summaries');
      ipcMain.handle('list-analysis-summaries', () => ({
        success: true,
        summaries: [{ ...s, date: '2026-07-20T00:00:00.000Z' }],
      }));
    }, saved[0]);
    await window.locator('.mode-tab[data-mode="dir"]').click();
    await window.locator('.mode-tab[data-mode="recent"]').click();
    const row = window.locator('#recent-list .recent-row').first();
    await expect(row.locator('.recent-source-live')).toHaveText('Live');
  });

  test('a monitor session with only 1 window tick degrades to "not enough data" (no crash, no save)', async () => {
    await stubSaveAnalysisSummary(electronApp);
    await startMonitorCapture();

    await sendWindowTick(electronApp, 1);

    await window.locator('#live-stop-btn').click();
    await expect(window.locator('#live-start-btn')).toBeVisible();

    await expect(window.locator('#rc-not-enough')).toBeVisible();
    await expect(window.locator('#rc-not-enough')).toContainText('Not enough data');
    await expect(window.locator('#rc-offer')).toBeHidden();
    expect(await savedSummaries(electronApp)).toHaveLength(0);

    // The app is still responsive — starting a fresh capture clears the state.
    await window.locator('#live-start-btn').click();
    await expect(window.locator('#live-stop-btn')).toBeVisible();
    await expect(window.locator('#rc-not-enough')).toBeHidden();
    await window.locator('#live-stop-btn').click();
  });
});
