import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
import * as path from 'path';

let electronApp: ElectronApplication;
let window: Page;

// A 48-point log-spaced frequency-response curve (20 Hz–20 kHz), tilted bass-heavy
// so the acceptance "curve is higher at low frequencies" holds. Mirrors the shape
// spectrum.py emits so the renderer is exercised the same way as in production.
const CURVE = (() => {
  const N = 48;
  const freqs: number[] = [];
  const db: number[] = [];
  for (let i = 0; i < N; i++) {
    const f = 20 * Math.pow(20000 / 20, i / (N - 1));
    freqs.push(Math.round(f));
    // ~ -18 dB at 20 Hz sloping down to ~ -48 dB at 20 kHz, with a little ripple.
    db.push(-18 - 30 * (i / (N - 1)) + Math.sin(i / 2) * 1.5);
  }
  return { freqs, db };
})();

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
    curve: CURVE,
    // Classification (PRD 04) so the ideal-profile overlay + comparison (PRD 05)
    // default from content type.
    contentType: 'speech',
  },
};

test.describe('Sound Buddy E2E', () => {
  test.beforeAll(async () => {
    // Isolate the app's userData so persisting the ideal-profile choice (PRD 05)
    // writes to a throwaway settings.json rather than the developer's real one.
    const userDataDir = path.join(__dirname, '..', 'test-results', 'e2e-userdata');
    electronApp = await electron.launch({
      args: [path.join(__dirname, '..', 'dist', 'electron', 'main.js'), `--user-data-dir=${userDataDir}`],
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
    await expect(window.locator('#logo-text')).toHaveText('Sound Buddy');
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
    // The redesign shows the loaded file name in the dropzone title, not a separate row.
    await expect(window.locator('#file-dropzone .dz-title')).toHaveText('silence.wav');

    await window.locator('.mode-tab[data-mode="reportcard"]').click();
    await expect(window.locator('#rc-content')).toBeVisible();
    await expect(window.locator('#rc-empty')).toBeHidden();
  });

  test('spectrum panel renders the frequency-response curve', async () => {
    await window.locator('.mode-tab[data-mode="file"]').click();

    // The analyzer SVG with the gold curve path is present.
    const svg = window.locator('#spectrum-body svg.sb-spectrum-curve');
    await expect(svg).toBeVisible();
    await expect(svg.locator('path.sb-curve-line')).toHaveCount(1);

    // Logarithmic frequency X axis labeled with decade markers.
    const xLabels = await svg.locator('text.sb-x-label').allTextContents();
    for (const l of ['20', '100', '1k', '10k']) expect(xLabels).toContain(l);

    // Vertical axis is labeled in dB (auto-ranged numeric ticks).
    expect(await svg.locator('text.sb-y-label').count()).toBeGreaterThanOrEqual(1);

    // The old horizontal band meters are no longer the file-view spectrum.
    await expect(window.locator('#spectrum-body .bm-track')).toHaveCount(0);

    // Header label matches the rendered visualization.
    await expect(window.locator('#spectrum-title')).toHaveText('Spectrum · Curve');
  });

  test('missing spectrum curve degrades to band meters without error', async () => {
    // Render a spectrum with no `curve` — the fallback path must not throw.
    const errors: string[] = [];
    window.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await window.evaluate(() => {
      (window as unknown as { renderSpectrum: (s: unknown) => void }).renderSpectrum({
        bands: { subBass: -20, bass: -18, lowMid: -22, mid: -16, highMid: -25, presence: -30, brilliance: -35 },
        spectralCentroid: 1200,
      });
    });
    await expect(window.locator('#spectrum-body .meter-card')).toBeVisible();
    await expect(window.locator('#spectrum-body svg.sb-spectrum-curve')).toHaveCount(0);
    // Header falls back to the meters label so it matches the fallback view.
    await expect(window.locator('#spectrum-title')).toHaveText('Spectrum · Meters');
    expect(errors).toEqual([]);
  });

  test('report card renders grade, metrics table, and recommendations', async () => {
    await window.locator('.mode-tab[data-mode="reportcard"]').click();
    await expect(window.locator('#rc-content')).toBeVisible();

    // Grade is now rendered as an SVG ring with the letter in the center.
    const grade = (await window.locator('#rc-ring .letter').textContent())?.trim();
    expect(['A', 'B', 'C', 'D', 'F']).toContain(grade);

    // Peak Level leads the metrics table in the redesign (clipping is the headline metric).
    const metricNames = await window.locator('#rc-metrics-body tr td:first-child .mt-metric').allTextContents();
    expect(metricNames).toEqual(['Peak Level', 'RMS Level', 'Dynamic Range', 'Clipping', 'Spectral Centroid']);

    const recCount = await window.locator('#rc-recommendations .rc-rec').count();
    expect(recCount).toBeGreaterThanOrEqual(1);
  });

  test('spectrum overlays a dashed ideal target, defaulting from content type', async () => {
    // Cycle back through the file tab so the real analysis (with its curve) is
    // re-rendered — the prior test left the panel on the curve-less meters path.
    await window.locator('.mode-tab[data-mode="reportcard"]').click();
    await window.locator('.mode-tab[data-mode="file"]').click();

    // The dashed ideal target is overlaid on the analyzer curve.
    const svg = window.locator('#spectrum-body svg.sb-spectrum-curve');
    await expect(svg).toBeVisible();
    await expect(svg.locator('path.sb-curve-line')).toHaveCount(1);
    await expect(svg.locator('path.sb-target-line')).toHaveCount(1);

    // Speech content ⇒ the default target is the speech profile.
    await expect(window.locator('#ideal-profile-wrap')).toBeVisible();
    await expect(window.locator('#ideal-profile-select')).toHaveValue('');
    await expect(window.locator('.spectrum-legend')).toContainText('Speech / podcast');

    // A match score is shown on the curve legend.
    await expect(window.locator('.spectrum-legend .sl-score .num')).toHaveText(/^\d{1,3}$/);
  });

  test('choosing a profile overrides the default and shows the WAV stub disabled', async () => {
    await window.locator('.mode-tab[data-mode="file"]').click();

    // The "Load ideal mix (WAV)…" option exists but is disabled (coming soon).
    const wavOption = window.locator('#ideal-profile-select option[value="__wav"]');
    await expect(wavOption).toHaveText(/Load ideal mix \(WAV\)/);
    await expect(wavOption).toBeDisabled();

    await window.locator('#ideal-profile-select').selectOption('flat');
    await expect(window.locator('.spectrum-legend')).toContainText('Flat / neutral');

    // Report card reflects the override with a match score + deviation curve.
    await window.locator('.mode-tab[data-mode="reportcard"]').click();
    await expect(window.locator('#rc-profile-section')).toBeVisible();
    await expect(window.locator('#rc-profile .rcp-score .num')).toHaveText(/^\d{1,3}$/);
    await expect(window.locator('#rc-profile .rcp-dev svg')).toBeVisible();
  });
});
