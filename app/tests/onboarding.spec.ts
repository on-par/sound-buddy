import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchElectron } from './launch-electron';
import * as path from 'path';
import * as fs from 'fs';

// First-run onboarding (#69), run for REAL against a throwaway --user-data-dir:
// a brand-new user sees the welcome overlay, one click analyzes the bundled demo
// recording through the normal pipeline, and the report card appears
// automatically — no settings, no file picker. The flow shows exactly once
// (localStorage gate), so a relaunch or an explicit skip never nags again.

const MAIN = path.join(__dirname, '..', 'dist', 'electron', 'main.js');
const USER_DATA = path.join(__dirname, '..', 'test-results', 'onboarding-userdata');
const SILENCE = path.join(__dirname, 'fixtures', 'silence.wav');

let app: ElectronApplication;
let win: Page;

async function launch(): Promise<void> {
  app = await launchElectron({ args: [MAIN, `--user-data-dir=${USER_DATA}`] });
  win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
}

async function launchWithAdvancedEnvOverrideCleared(): Promise<void> {
  const env = { ...process.env };
  delete env.SOUND_BUDDY_ADVANCED_FEATURES;
  app = await launchElectron({ args: [MAIN, `--user-data-dir=${USER_DATA}`], env });
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

  test('Simple mode onboarding points users at the Report Card dropzone or Analyze', async () => {
    fs.rmSync(USER_DATA, { recursive: true, force: true });
    fs.mkdirSync(USER_DATA, { recursive: true });
    fs.writeFileSync(path.join(USER_DATA, 'settings.json'), JSON.stringify({ advancedFeaturesEnabled: false }, null, 2));
    await launchWithAdvancedEnvOverrideCleared();

    const copy = win.locator('#onboarding-copy');
    await expect(copy).toHaveText("Drop last Sunday's recording on the Report Card panel - or click Analyze - and Sound Buddy hands back a report card telling you what to fix.");
    await expect(copy).toContainText('report card');
    await expect(copy).toContainText('Report Card');
    await expect(copy).toContainText('Analyze');
  });

  test('Simple mode hides advanced tabs but leaves their buttons mounted', async () => {
    fs.rmSync(USER_DATA, { recursive: true, force: true });
    fs.mkdirSync(USER_DATA, { recursive: true });
    fs.writeFileSync(path.join(USER_DATA, 'settings.json'), JSON.stringify({ advancedFeaturesEnabled: false }, null, 2));
    await launch();

    await expect(win.locator('body')).toHaveClass(/simple-mode/);
    await expect(win.locator('#nav-history')).toBeVisible();
    await expect(win.locator('.mode-tab[data-mode="reportcard"]')).toBeVisible();
    await expect(win.locator('#nav-analyze')).toBeVisible();

    for (const mode of ['dir', 'live', 'console', 'recent', 'guide', 'ringout']) {
      const tab = win.locator(`.mode-tab[data-mode="${mode}"]`);
      await expect(tab).toHaveCount(1);
      await expect(tab).toBeHidden();
    }
  });

  test('Simple mode Analyze opens the native file choice directly', async () => {
    fs.rmSync(USER_DATA, { recursive: true, force: true });
    fs.mkdirSync(USER_DATA, { recursive: true });
    fs.writeFileSync(path.join(USER_DATA, 'settings.json'), JSON.stringify({ advancedFeaturesEnabled: false }, null, 2));
    await launchWithAdvancedEnvOverrideCleared();
    await app.evaluate(({ ipcMain }, fixturePath) => {
      ipcMain.removeHandler('open-file-dialog');
      ipcMain.handle('open-file-dialog', () => fixturePath);
      ipcMain.removeHandler('analyze-file');
      ipcMain.handle('analyze-file', () => ({
        success: true,
        data: {
          filePath: fixturePath,
          sox: {
            samplesRead: 96000,
            lengthSeconds: 1,
            scaledBy: 2147483647,
            maximumAmplitude: 0.5,
            minimumAmplitude: -0.5,
            midlineAmplitude: 0,
            meanNorm: 0.1,
            meanAmplitude: 0,
            rmsAmplitude: 0.1,
            maximumDelta: 0.01,
            minimumDelta: -0.01,
            meanDelta: 0,
            rmsDelta: 0.005,
            roughFrequency: 440,
            volumeAdjustment: 1,
            rmsDbfs: -18,
            peakDbfs: -6,
            dynamicRangeDb: 12,
            clipping: false,
          },
          ffprobe: {
            format: {
              filename: fixturePath,
              formatName: 'wav',
              formatLongName: 'WAV / WAVE (Waveform Audio)',
              durationSeconds: 1,
              sizeBytes: 192044,
              bitRate: 1536000,
              tags: {},
            },
            stream: {
              codecName: 'pcm_s16le',
              codecLongName: 'PCM signed 16-bit little-endian',
              channels: 2,
              channelLayout: 'stereo',
              sampleRate: 48000,
              bitDepth: 16,
              bitRate: 1536000,
              durationSeconds: 1,
            },
          },
          spectrum: {
            bands: {
              subBass: -20,
              bass: -18,
              lowMid: -22,
              mid: -16,
              highMid: -25,
              presence: -30,
              brilliance: -35,
            },
            spectralCentroid: 1200,
            spectralRolloff85: 4000,
            dynamicRange: 12,
          },
        },
      }));
    }, SILENCE);

    await expect(win.locator('body')).toHaveClass(/simple-mode/);
    await win.locator('#onboarding-skip').click();
    await expect(win.locator('#onboarding-dialog')).toBeHidden();
    await expect(win.locator('#analyze-source-picker')).toHaveCount(0);
    await win.locator('#nav-analyze').click();

    await expect(win.locator('#analyze-source-picker')).toHaveCount(0);
    await expect(win.locator('#reportcard-view')).toHaveClass(/active/);
    await expect(win.locator('#rc-content')).toBeVisible();
    await expect(win.locator('#rc-filename')).toHaveText('silence.wav');
    await expect(win.locator('.mode-tab[data-mode="reportcard"]')).toHaveClass(/active/);
    await expect(win.locator('#nav-analyze')).not.toHaveClass(/active/);
  });
});
