import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
import * as path from 'path';

let electronApp: ElectronApplication;
let window: Page;

const FAKE_ANALYSIS = {
  filePath: '/fake/test-fixtures/silence.wav',
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
      filename: '/fake/test-fixtures/silence.wav',
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
};

test.describe('Sound Buddy E2E', () => {
  test.beforeAll(async () => {
    electronApp = await electron.launch({
      args: [path.join(__dirname, '..', 'dist', 'electron', 'main.js')],
    });
    window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    // Real analysis requires sox/ffprobe/python3 + scripts/spectrum.py on PATH.
    // Stub the main-process IPC handler so the happy path is testable anywhere.
    await electronApp.evaluate(({ ipcMain }, analysis) => {
      ipcMain.removeHandler('analyze-file');
      ipcMain.handle('analyze-file', () => ({ success: true, data: analysis }));
    }, FAKE_ANALYSIS);
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test('app launches and shows header', async () => {
    await expect(window.locator('#logo-text')).toHaveText('SOUND BUDDY');
    await expect(window.locator('.mode-tab[data-mode="file"]')).toBeVisible();
    await expect(window.locator('.mode-tab[data-mode="dir"]')).toBeVisible();
    await expect(window.locator('.mode-tab[data-mode="live"]')).toBeVisible();
    await expect(window.locator('.mode-tab[data-mode="reportcard"]')).toBeVisible();
  });

  test('tab navigation shows the corresponding panel', async () => {
    await window.locator('.mode-tab[data-mode="file"]').click();
    await expect(window.locator('#tab-file')).toHaveClass(/active/);
    await expect(window.locator('#file-dropzone')).toBeVisible();

    await window.locator('.mode-tab[data-mode="reportcard"]').click();
    await expect(window.locator('#reportcard-view')).toHaveClass(/active/);
    await expect(window.locator('#rc-empty')).toBeVisible();

    await window.locator('.mode-tab[data-mode="file"]').click();
    await expect(window.locator('#reportcard-view')).not.toHaveClass(/active/);
    await expect(window.locator('#tab-file')).toHaveClass(/active/);
  });

  test('report card shows empty state before any analysis', async () => {
    await window.locator('.mode-tab[data-mode="reportcard"]').click();
    await expect(window.locator('#rc-empty')).toBeVisible();
    await expect(window.locator('#rc-empty')).toContainText('No analysis yet');
    await expect(window.locator('#rc-content')).toBeHidden();
  });

  test('analyzing a file populates the report card', async () => {
    await window.locator('.mode-tab[data-mode="file"]').click();

    // Load the fixture path directly, bypassing the native file-picker dialog.
    const fixturePath = path.join(__dirname, 'fixtures', 'silence.wav');
    await window.evaluate((fp) => {
      (window as unknown as { loadFile: (p: string) => void }).loadFile(fp);
    }, fixturePath);

    await expect(window.locator('#analyze-btn')).toBeEnabled();
    await window.locator('#analyze-btn').click();

    await expect(window.locator('#file-info')).toBeVisible();
    await expect(window.locator('#fi-name')).toHaveText('silence.wav');

    await window.locator('.mode-tab[data-mode="reportcard"]').click();
    await expect(window.locator('#rc-content')).toBeVisible();
    await expect(window.locator('#rc-empty')).toBeHidden();
  });

  test('report card renders grade, metrics table, and recommendations', async () => {
    await window.locator('.mode-tab[data-mode="reportcard"]').click();
    await expect(window.locator('#rc-content')).toBeVisible();

    const grade = (await window.locator('#rc-grade').textContent())?.trim();
    expect(['A', 'B', 'C', 'D', 'F']).toContain(grade);

    const metricNames = await window.locator('#rc-metrics-body tr td:first-child').allTextContents();
    expect(metricNames).toEqual(['RMS Level', 'Peak Level', 'Dynamic Range', 'Clipping', 'Spectral Centroid']);

    const recCount = await window.locator('#rc-recommendations li').count();
    expect(recCount).toBeGreaterThanOrEqual(1);
  });
});
