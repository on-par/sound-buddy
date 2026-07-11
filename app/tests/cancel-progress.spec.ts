import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { NO_TRIAL_ENV } from './license-fixture';

// Cancel button + coarse stage progress during file analysis (#125). Runs for
// REAL against an isolated --user-data-dir (NO_TRIAL_ENV), with the
// analyze-file/cancel-analysis IPC stubbed so the renderer wiring can be
// driven without sox/ffprobe/python: analyze-file hangs until cancel-analysis
// resolves it (mirroring the real handler's cancellable-in-flight shape),
// and separately a normal stub proves completion dismisses the affordance.

const MAIN = path.join(__dirname, '..', 'dist', 'electron', 'main.js');
const USER_DATA = path.join(__dirname, '..', 'test-results', 'cancel-progress-userdata');
const FAKE_FILE = '/fake/cancel-progress.wav';

const FAKE_ANALYSIS = {
  filePath: FAKE_FILE,
  sox: { rmsDbfs: -18, peakDbfs: -0.5, dynamicRangeDb: 12, clipping: false },
  ffprobe: { format: { filename: FAKE_FILE } },
  spectrum: {
    bands: { subBass: -20, bass: -18, lowMid: -22, mid: -16, highMid: -25, presence: -30, brilliance: -35 },
    spectralCentroid: 1200,
    curve: null,
    frames: [],
    contentType: 'speech',
  },
};

let app: ElectronApplication;
let win: Page;

async function launch(): Promise<void> {
  app = await electron.launch({
    args: [MAIN, `--user-data-dir=${USER_DATA}`],
    env: { ...process.env, ...NO_TRIAL_ENV },
  });
  win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('#license-badge')).toHaveText(/FREE|PRO/);
}

async function loadFakeFile(): Promise<void> {
  await win.locator('.mode-tab[data-mode="reportcard"]').click();
  await win.evaluate((fp) => {
    (window as unknown as { loadFile: (p: string) => void }).loadFile(fp);
  }, FAKE_FILE);
  await expect(win.locator('#analyze-btn')).toBeEnabled();
}

test.describe.serial('Cancel + stage progress during analysis (#125)', () => {
  test.beforeAll(() => {
    fs.rmSync(USER_DATA, { recursive: true, force: true });
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test('stage labels + Cancel appear during analysis; Cancel returns the UI to idle', async () => {
    await launch();

    // Stub analyze-file so it hangs (never resolves) until cancel-analysis
    // fires — the resolver + sender live on globalThis in the main process so
    // the cancel-analysis stub can reach back into the pending run.
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('analyze-file');
      ipcMain.removeHandler('cancel-analysis');
      ipcMain.handle('analyze-file', (event) => {
        const wc = event.sender;
        (globalThis as Record<string, unknown>).__cancelProgressSender = wc;
        wc.send('analysis-progress', { stage: 'reading', status: 'start' });
        wc.send('analysis-progress', { stage: 'levels', status: 'start' });
        wc.send('analysis-progress', { stage: 'spectrum', status: 'start' });
        return new Promise((resolve) => {
          (globalThis as Record<string, unknown>).__resolveAnalyze = resolve;
        });
      });
      ipcMain.handle('cancel-analysis', () => {
        const resolve = (globalThis as Record<string, unknown>).__resolveAnalyze as
          | ((v: unknown) => void)
          | undefined;
        const wc = (globalThis as Record<string, unknown>).__cancelProgressSender as
          | { send: (ch: string, d: unknown) => void }
          | undefined;
        if (!resolve) return { success: false };
        wc?.send('analysis-progress', { status: 'cancelled' });
        resolve({ success: false, cancelled: true });
        (globalThis as Record<string, unknown>).__resolveAnalyze = undefined;
        return { success: true };
      });
    });

    await loadFakeFile();
    await win.locator('#analyze-btn').click();

    // AC: stage labels + Cancel visible while analysis is in flight.
    await expect(win.locator('#spectrum-body .stage-row[data-stage="reading"]')).toContainText('Reading file');
    await expect(win.locator('#spectrum-body .stage-row[data-stage="levels"]')).toContainText('Measuring levels');
    await expect(win.locator('#spectrum-body .stage-row[data-stage="spectrum"]')).toContainText('Analyzing spectrum');
    await expect(win.locator('#analysis-cancel-btn')).toBeVisible();
    await expect(win.locator('#analyze-btn')).toBeDisabled();

    // AC: clicking Cancel returns the UI to idle — spinner/stepper gone,
    // Analyze re-enabled, no report card rendered.
    await win.locator('#analysis-cancel-btn').click();
    await expect(win.locator('#analysis-cancel-btn')).toBeHidden();
    await expect(win.locator('#analyze-btn')).toBeEnabled();
    await expect(win.locator('#analyze-btn')).toHaveText(/^Analyze$/);
    await expect(win.locator('#rc-content')).toBeHidden();
    // !currentAnalysis proxy — the Clear button only enables once an analysis lands.
    await expect(win.locator('#reportcard-clear-btn')).toBeDisabled();
  });

  test('a normal completion dismisses the progress affordance and renders the card', async () => {
    await app.evaluate(({ ipcMain }, analysis) => {
      ipcMain.removeHandler('analyze-file');
      ipcMain.handle('analyze-file', () => ({ success: true, data: analysis }));
    }, FAKE_ANALYSIS);

    await win.locator('#analyze-btn').click();
    await expect(win.locator('#rc-content')).toBeVisible();
    await expect(win.locator('#analysis-cancel-btn')).toBeHidden();
  });
});
