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

// Six time-sampled frames on the same 48-point grid as CURVE (PRD 03), so the
// heatmap renders >1 column and the scrubber has frames to select.
const FRAMES = Array.from({ length: 6 }, (_, i) => ({
  t: i * 2,
  // A per-frame ripple whose phase shifts with i, so each frame has a distinct
  // spectral *shape* (not just a uniform dB offset the auto-ranged curve would
  // normalize away) — the scrubber redraw is then observable in the path data.
  db: CURVE.db.map((d, k) => d + Math.sin(k / 4 + i) * 6),
  rms: -18 + i,
  class: i % 2 === 0 ? 'music' : 'speech',
}));

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
    frames: FRAMES,
  },
};

// A single-frame analysis (short file): the heatmap collapses to one column and
// the report card shows a single representative frame, without error.
const SHORT_ANALYSIS = {
  ...FAKE_ANALYSIS,
  spectrum: { ...FAKE_ANALYSIS.spectrum, frames: [{ t: 0, db: CURVE.db, rms: -18, class: 'music' }] },
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

  test('time-sampled spectrogram scrubber redraws the PRD 02 curve', async () => {
    await window.locator('.mode-tab[data-mode="file"]').click();

    // Heatmap strip under the curve: one column per frame (6 in the fixture).
    await expect(window.locator('#spectrum-heatmap svg')).toBeVisible();
    await expect(window.locator('#spectrum-heatmap .hm-col')).toHaveCount(6);
    await expect(window.locator('#scrub-readout')).toHaveText('Whole-file average');

    // Clicking a time column redraws the main curve for that frame.
    const avgPath = await window.locator('#spectrum-chart path.sb-curve-line').getAttribute('d');
    await window.locator('#spectrum-heatmap').click({ position: { x: 20, y: 40 } });
    await expect(window.locator('#scrub-readout')).toContainText('t =');
    await expect(window.locator('#spectrum-heatmap .hm-col.sel')).toHaveCount(1);
    const framePath = await window.locator('#spectrum-chart path.sb-curve-line').getAttribute('d');
    expect(framePath).not.toBe(avgPath);

    // "▶ Average" reset restores the whole-file curve exactly.
    await window.locator('#scrub-reset').click();
    await expect(window.locator('#scrub-readout')).toHaveText('Whole-file average');
    await expect(window.locator('#spectrum-heatmap .hm-col.sel')).toHaveCount(0);
    expect(await window.locator('#spectrum-chart path.sb-curve-line').getAttribute('d')).toBe(avgPath);
  });

  test('scrubbed frame survives leaving and returning to the file tab', async () => {
    await window.locator('.mode-tab[data-mode="file"]').click();
    await window.locator('#spectrum-heatmap').click({ position: { x: 20, y: 40 } });
    const scrubbed = await window.locator('#scrub-readout').textContent();
    expect(scrubbed).toContain('t =');

    // Round-trip through another tab and back — the selection must persist.
    await window.locator('.mode-tab[data-mode="reportcard"]').click();
    await window.locator('.mode-tab[data-mode="file"]').click();
    await expect(window.locator('#scrub-readout')).toHaveText(scrubbed!.trim());
    await expect(window.locator('#spectrum-heatmap .hm-col.sel')).toHaveCount(1);

    // Reset so later tests start from the average state.
    await window.locator('#scrub-reset').click();
    await expect(window.locator('#scrub-readout')).toHaveText('Whole-file average');
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

  test('report card shows a heatmap thumbnail and representative frame curves', async () => {
    await window.locator('.mode-tab[data-mode="reportcard"]').click();
    await expect(window.locator('#rc-content')).toBeVisible();

    await expect(window.locator('#rc-frames-section')).toBeVisible();
    await expect(window.locator('#rc-heatmap svg')).toBeVisible();
    // start / middle / loudest representative frames.
    await expect(window.locator('#rc-frame-curves .rc-frame')).toHaveCount(3);
    await expect(window.locator('#rc-frame-curves .rc-frame-tag').first()).toHaveText('Start');
  });

  test('short file falls back to a single frame without error', async () => {
    // Re-stub the handler to return a single-frame (short-file) analysis.
    await electronApp.evaluate(({ ipcMain }, analysis) => {
      ipcMain.removeHandler('analyze-file');
      ipcMain.handle('analyze-file', () => ({ success: true, data: analysis }));
    }, SHORT_ANALYSIS);

    await window.locator('.mode-tab[data-mode="file"]').click();
    const fixturePath = path.join(__dirname, 'fixtures', 'silence.wav');
    await window.evaluate((fp) => {
      (window as unknown as { loadFile: (p: string) => void }).loadFile(fp);
    }, fixturePath);
    await window.locator('#analyze-btn').click();

    // Heatmap collapses to a single column; the scrubber still starts on average.
    await expect(window.locator('#spectrum-heatmap .hm-col')).toHaveCount(1);
    await expect(window.locator('#scrub-readout')).toHaveText('Whole-file average');

    // Report card renders with a single representative frame, no error.
    await window.locator('.mode-tab[data-mode="reportcard"]').click();
    await expect(window.locator('#rc-frames-section')).toBeVisible();
    await expect(window.locator('#rc-frame-curves .rc-frame')).toHaveCount(1);
  });
});
