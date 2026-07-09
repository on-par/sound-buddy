import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
import * as path from 'path';
import { LICENSE_ENV, seedProLicense } from './license-fixture';

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
    // Classification (PRD 04) so the ideal-profile overlay + comparison (PRD 05)
    // default from content type.
    contentType: 'speech',
  },
};

const WORSHIP_SERVICE_ANALYSIS = {
  ...FAKE_ANALYSIS,
  sox: {
    ...FAKE_ANALYSIS.sox,
    rmsDbfs: -26.76,
    peakDbfs: -6.21,
    dynamicRangeDb: 20.55,
  },
  spectrum: {
    ...FAKE_ANALYSIS.spectrum,
    contentType: 'mixed',
  },
};

const WORSHIP_MUSIC_ANALYSIS = {
  ...WORSHIP_SERVICE_ANALYSIS,
  sox: {
    ...WORSHIP_SERVICE_ANALYSIS.sox,
    rmsDbfs: -27.8,
    peakDbfs: -11.5,
    dynamicRangeDb: 16.3,
  },
  spectrum: {
    ...WORSHIP_SERVICE_ANALYSIS.spectrum,
    contentType: 'music',
  },
};

// A source that violates exactly the RMS and DR rules (#133): whole-file RMS
// below the acceptable band and a compressed dynamic range, everything else
// clean. Grades a C with a two-item "Why this grade" breakdown.
const DEDUCTING_ANALYSIS = {
  ...FAKE_ANALYSIS,
  sox: { ...FAKE_ANALYSIS.sox, rmsDbfs: -26, dynamicRangeDb: 4 },
};

// A single-frame analysis (short file): the heatmap collapses to one column and
// the report card shows a single representative frame, without error.
const SHORT_ANALYSIS = {
  ...FAKE_ANALYSIS,
  spectrum: { ...FAKE_ANALYSIS.spectrum, frames: [{ t: 0, db: CURVE.db, rms: -18, class: 'music' }] },
};

test.describe('Sound Buddy E2E', () => {
  test.beforeAll(async () => {
    // Isolate the app's userData so persisting the ideal-profile choice (PRD 05)
    // writes to a throwaway settings.json rather than the developer's real one.
    const userDataDir = path.join(__dirname, '..', 'test-results', 'e2e-userdata');
    // Live/soundcheck flows are Pro features (#54): seed a license so their UI
    // is unlocked. The dedicated license.spec.ts covers the free tier + gating.
    seedProLicense(userDataDir);
    electronApp = await electron.launch({
      args: [path.join(__dirname, '..', 'dist', 'electron', 'main.js'), `--user-data-dir=${userDataDir}`],
      env: { ...process.env, ...LICENSE_ENV },
    });
    window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    // Real analysis/capture require sox/ffprobe/python3 + a mic on PATH. Stub the
    // main-process IPC handlers so the happy paths are testable anywhere.
    await electronApp.evaluate(({ ipcMain }, analysis) => {
      ipcMain.removeHandler('analyze-file');
      ipcMain.handle('analyze-file', () => ({ success: true, data: analysis }));

      // A fake 8-channel interface so the channel picker has something to offer.
      ipcMain.removeHandler('list-devices');
      ipcMain.handle('list-devices', () => ({
        success: true,
        micAccess: 'granted',
        devices: [{ index: 0, name: 'Fake 8ch Interface', channels: 8, default_sr: 48000 }],
      }));

      // Record mode now captures a multitrack session: stop-live returns the
      // session *folder* (once session.json exists), not a single WAV. The
      // Live-tab session UI lands in #43, so stop just completes cleanly here.
      ipcMain.removeHandler('start-live');
      ipcMain.handle('start-live', () => ({ success: true }));
      ipcMain.removeHandler('stop-live');
      ipcMain.handle('stop-live', () => ({
        success: true,
        sessionDir: '/tmp/sound-buddy-20260702-101500',
      }));
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

  test('playback transport is absent (disabled/idle) before any analysis is loaded (#180)', async () => {
    await window.locator('.mode-tab[data-mode="file"]').click();
    await expect(window.locator('#spectro-play-btn')).toHaveCount(0);
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

  test('report card and spectrum share one screen after analysis (#177)', async () => {
    // The post-analysis screen no longer hides the spectrum for the report card:
    // with the Report Card tab active, both the spectrum curve and the report
    // card content are visible simultaneously — no tab switch to see one or the
    // other. The Source panel folds away (body.rc-active) so both get room.
    await window.locator('.mode-tab[data-mode="file"]').click();
    const fixturePath = path.join(__dirname, 'fixtures', 'silence.wav');
    await window.evaluate((fp) => {
      (window as unknown as { loadFile: (p: string) => void }).loadFile(fp);
    }, fixturePath);
    await expect(window.locator('#analyze-btn')).toBeEnabled();
    await window.locator('#analyze-btn').click();

    await window.locator('.mode-tab[data-mode="reportcard"]').click();

    // The report card is rendered…
    await expect(window.locator('#rc-content')).toBeVisible();
    // …and the spectrum bars are still on screen beside it, not hidden.
    await expect(window.locator('#spectrum-body .veq-bar').first()).toBeVisible();
    // The workspace was not swapped out (#177): it stays in the layout, and the
    // Source panel is collapsed to give the two views room.
    await expect(window.locator('#workspace')).toBeVisible();
    await expect(window.locator('body')).toHaveClass(/rc-active/);
    await expect(window.locator('#source-panel')).toBeHidden();
  });

  test('spectrum panel renders uniform-width EQ bars (AW-2, #178)', async () => {
    await window.locator('.mode-tab[data-mode="file"]').click();

    // Seven upright bars, one per frequency band, laid out left (lowest) to right.
    const bars = window.locator('#spectrum-chart .veq-bar');
    await expect(bars).toHaveCount(7);
    const boxes = await bars.evaluateAll(els => els.map(el => (el as HTMLElement).getBoundingClientRect()));
    for (let i = 1; i < boxes.length; i++) expect(boxes[i].left).toBeGreaterThan(boxes[i - 1].left);

    // Every bar has the same width.
    const widths = boxes.map(b => Math.round(b.width));
    for (const w of widths) expect(w).toBe(widths[0]);

    // Each bar keeps its existing per-band color (distinct across the 7 bands).
    const colors = await bars.evaluateAll(els => els.map(el => getComputedStyle(el as HTMLElement).backgroundColor));
    expect(new Set(colors).size).toBe(7);

    // Band-name labels replace the old frequency-decade axis, low → high.
    await expect(window.locator('#spectrum-chart .veq-label')).toHaveCount(7);
    await expect(window.locator('#spectrum-chart .veq-label').first()).toHaveText('Sub Bass');
    await expect(window.locator('#spectrum-chart .veq-label').last()).toHaveText('Brilliance');

    // The old horizontal band meters are no longer the file-view spectrum.
    await expect(window.locator('#spectrum-body .bm-track')).toHaveCount(0);

    // Header label matches the rendered visualization.
    await expect(window.locator('#spectrum-title')).toHaveText('Spectrum · Curve');
  });

  test('EQ bar height reflects the measured band level', async () => {
    await window.locator('.mode-tab[data-mode="file"]').click();

    // FAKE_ANALYSIS.spectrum.bands: mid (-16) is the loudest of the 7; brilliance
    // (-35) is quieter but still above DIM_DB (-60), so nothing is dimmed here.
    const mid = window.locator('#spectrum-chart .veq-bar[data-band="mid"]');
    const brilliance = window.locator('#spectrum-chart .veq-bar[data-band="brilliance"]');
    const midH = parseFloat(await mid.evaluate(el => (el as HTMLElement).style.height));
    const brillianceH = parseFloat(await brilliance.evaluate(el => (el as HTMLElement).style.height));
    expect(midH).toBeGreaterThan(brillianceH);
    await expect(mid).toHaveClass(/loud/);
    await expect(window.locator('#spectrum-chart .veq-bar.dim')).toHaveCount(0);
  });

  test('time-sampled spectrogram scrubber redraws the AW-2 bars', async () => {
    await window.locator('.mode-tab[data-mode="file"]').click();

    // Heatmap strip under the bars: one column per frame (6 in the fixture).
    await expect(window.locator('#spectrum-heatmap svg')).toBeVisible();
    await expect(window.locator('#spectrum-heatmap .hm-col')).toHaveCount(6);
    await expect(window.locator('#scrub-readout')).toHaveText('Whole-file average');

    const barHeights = () => window.locator('#spectrum-chart .veq-bar')
      .evaluateAll(els => els.map(el => (el as HTMLElement).style.height));

    // Clicking a time column redraws the bars for that frame.
    const avgHeights = await barHeights();
    await window.locator('#spectrum-heatmap').click({ position: { x: 20, y: 40 } });
    await expect(window.locator('#scrub-readout')).toContainText('t =');
    await expect(window.locator('#spectrum-heatmap .hm-col.sel')).toHaveCount(1);
    const frameHeights = await barHeights();
    expect(frameHeights).not.toEqual(avgHeights);
    // Still 7 uniform-width bars — the scrub redraw stays within AW-2's model.
    await expect(window.locator('#spectrum-chart .veq-bar')).toHaveCount(7);

    // "▶ Average" reset restores the whole-file bars exactly.
    await window.locator('#scrub-reset').click();
    await expect(window.locator('#scrub-readout')).toHaveText('Whole-file average');
    await expect(window.locator('#spectrum-heatmap .hm-col.sel')).toHaveCount(0);
    expect(await barHeights()).toEqual(avgHeights);
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

  test.describe('playback transport (#180)', () => {
    // Unlike the other fixtures, playback needs the *real* fixture file on disk
    // (analyze-file is stubbed and never reads it) so the renderer's <audio>
    // element has something to actually decode and play.
    const realFixturePath = path.join(__dirname, 'fixtures', 'silence.wav'); // 1.00s, real WAV

    test.afterAll(async () => {
      // Restore the default fake-path fixture so later tests start fresh.
      await electronApp.evaluate(({ ipcMain }, analysis) => {
        ipcMain.removeHandler('analyze-file');
        ipcMain.handle('analyze-file', () => ({ success: true, data: analysis }));
      }, FAKE_ANALYSIS);
      await window.locator('.mode-tab[data-mode="file"]').click();
      await window.evaluate((fp) => {
        (window as unknown as { loadFile: (p: string) => void }).loadFile(fp);
      }, realFixturePath);
      await window.locator('#analyze-btn').click();
    });

    test('play, pause, seek via spectrogram, and end-of-file all drive the playhead + time readout', async () => {
      // The fixture's stock FRAMES span 0-10s (built for the fake 1s-duration
      // metadata, never actually played). Real playback needs frame timestamps
      // that fit inside the *real* fixture's actual 1.00s duration, or seeking
      // to a frame lands past the end and clamps to exactly `duration` — which
      // Chromium treats as reaching the end and re-fires `ended`.
      const playbackFrames = FAKE_ANALYSIS.spectrum.frames.map((f, i) => ({ ...f, t: i * 0.15 }));
      await electronApp.evaluate(({ ipcMain }, analysis) => {
        ipcMain.removeHandler('analyze-file');
        ipcMain.handle('analyze-file', () => ({ success: true, data: analysis }));
      }, { ...FAKE_ANALYSIS, filePath: realFixturePath, spectrum: { ...FAKE_ANALYSIS.spectrum, frames: playbackFrames } });

      await window.locator('.mode-tab[data-mode="file"]').click();
      await window.evaluate((fp) => {
        (window as unknown as { loadFile: (p: string) => void }).loadFile(fp);
      }, realFixturePath);
      await window.locator('#analyze-btn').click();

      const playBtn = window.locator('#spectro-play-btn');
      const time = window.locator('#spectro-time');

      // Idle state: Play icon, elapsed 0:00 against the real 1-second duration.
      await expect(playBtn).toBeVisible();
      await expect(playBtn).toHaveAttribute('aria-label', 'Play');
      await expect(time).toHaveText('0:00 / 0:01');

      // Play — the button flips to Pause and playback starts.
      await playBtn.click();
      await expect(playBtn).toHaveAttribute('aria-label', 'Pause');
      await expect(playBtn).toHaveClass(/playing/);

      // The 1-second fixture runs to completion on its own: end-of-file resets
      // the playhead to the start and returns the transport to idle Play.
      await expect(playBtn).toHaveAttribute('aria-label', 'Play', { timeout: 5000 });
      await expect(playBtn).not.toHaveClass(/playing/);
      await expect(time).toHaveText(/^0:00 \//);

      // Seeking via the spectrogram column moves the playhead without resuming
      // playback (the button stays in the idle Play state). Frame index 4 of 6
      // (t=0.6s) is comfortably inside the 1s duration.
      const heat = window.locator('#spectrum-heatmap');
      const box = await heat.boundingBox();
      await heat.click({ position: { x: Math.round(box!.width * (4.5 / 6)), y: 40 } });
      await expect(window.locator('#spectrum-heatmap .hm-col.sel')).toHaveCount(1);
      await expect(window.locator('#scrub-readout')).toContainText('t = 0:00.6');
      await expect(playBtn).toHaveAttribute('aria-label', 'Play');
      const playhead = window.locator('#spectro-playhead');
      await expect(playhead).toBeVisible();
      const left = await playhead.evaluate((el) => (el as HTMLElement).style.left);
      expect(left).not.toBe('0%');

      // Reset the scrub selection so later tests start from the average state.
      await window.locator('#scrub-reset').click();
    });
  });

  test('missing spectrum curve degrades to the same uniform-width bars without error', async () => {
    // Render a spectrum with no `curve` — the fallback path must not throw, and
    // (AW-2) must render the same bar visualization as the curve path.
    const errors: string[] = [];
    window.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await window.evaluate(() => {
      (window as unknown as { renderSpectrum: (s: unknown) => void }).renderSpectrum({
        bands: { subBass: -20, bass: -18, lowMid: -22, mid: -16, highMid: -25, presence: -30, brilliance: -35 },
        spectralCentroid: 1200,
      });
    });
    const bars = window.locator('#spectrum-chart .veq-bar');
    await expect(bars).toHaveCount(7);
    const widths = await bars.evaluateAll(els => els.map(el => Math.round((el as HTMLElement).getBoundingClientRect().width)));
    for (const w of widths) expect(w).toBe(widths[0]);
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

    // Each row shows its config-sourced target beside the value (#132). RMS reads
    // the acceptable band; Clipping has no config target so it renders an em dash.
    const targets = await window.locator('#rc-metrics-body tr .mt-target').allTextContents();
    expect(targets).toHaveLength(5);
    expect(targets[1]).toBe('-20 to -14 dBFS'); // RMS Level
    expect(targets[3]).toBe('—'); // Clipping — no target in config

    const recCount = await window.locator('#rc-recommendations .rc-rec').count();
    expect(recCount).toBeGreaterThanOrEqual(1);
  });

  test('"Why this grade" shows the positive no-deductions state for a clean grade (#133)', async () => {
    // The default fixture grades an A (in-band RMS, healthy DR, balanced bands),
    // so the breakdown is the explicit positive state — never a blank box.
    await window.locator('.mode-tab[data-mode="reportcard"]').click();
    await expect(window.locator('#rc-content')).toBeVisible();
    await expect(window.locator('#rc-why .rc-why-none')).toBeVisible();
    await expect(window.locator('#rc-why')).toContainText('No deductions');
    await expect(window.locator('#rc-why .rc-why-row')).toHaveCount(0);
  });

  test('"Why this grade" lists exactly the rules that fired, measured vs target (#133)', async () => {
    // RMS below the acceptable band + a compressed DR → exactly two deductions,
    // each naming the rule, its measured value, and the config-sourced target.
    await electronApp.evaluate(({ ipcMain }, analysis) => {
      ipcMain.removeHandler('analyze-file');
      ipcMain.handle('analyze-file', () => ({ success: true, data: analysis }));
    }, DEDUCTING_ANALYSIS);

    const fixturePath = path.join(__dirname, 'fixtures', 'silence.wav');
    await window.locator('.mode-tab[data-mode="file"]').click();
    await window.evaluate((fp) => {
      (window as unknown as { loadFile: (p: string) => void }).loadFile(fp);
    }, fixturePath);
    await window.locator('#analyze-btn').click();

    await window.locator('.mode-tab[data-mode="reportcard"]').click();
    const rows = window.locator('#rc-why .rc-why-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('RMS out of band');
    await expect(rows.nth(0)).toContainText('-26.0 dBFS');
    await expect(rows.nth(0)).toContainText('-20 to -14 dBFS');
    await expect(rows.nth(1)).toContainText('Dynamic range too low');
    await expect(rows.nth(1)).toContainText('≥ 6 dB');
    // With deductions present, the positive state is absent.
    await expect(window.locator('#rc-why .rc-why-none')).toHaveCount(0);

    // Restore the default clean fixture and re-render so later tests start fresh.
    await electronApp.evaluate(({ ipcMain }, analysis) => {
      ipcMain.removeHandler('analyze-file');
      ipcMain.handle('analyze-file', () => ({ success: true, data: analysis }));
    }, FAKE_ANALYSIS);
    await window.locator('.mode-tab[data-mode="file"]').click();
    await window.evaluate((fp) => {
      (window as unknown as { loadFile: (p: string) => void }).loadFile(fp);
    }, fixturePath);
    await window.locator('#analyze-btn').click();
    await window.locator('.mode-tab[data-mode="reportcard"]').click();
  });

  test('worship service recordings avoid the false quiet report-card verdict', async () => {
    await electronApp.evaluate(({ ipcMain }, analysis) => {
      ipcMain.removeHandler('analyze-file');
      ipcMain.handle('analyze-file', () => ({ success: true, data: analysis }));
    }, WORSHIP_SERVICE_ANALYSIS);

    await window.locator('.mode-tab[data-mode="file"]').click();
    const fixturePath = path.join(__dirname, 'fixtures', 'silence.wav');
    await window.evaluate((fp) => {
      (window as unknown as { loadFile: (p: string) => void }).loadFile(fp);
    }, fixturePath);
    await window.locator('#analyze-btn').click();

    await window.locator('.mode-tab[data-mode="reportcard"]').click();
    await expect(window.locator('#rc-rec-type')).toContainText('Dynamic Service');
    await expect(window.locator('#rc-rec-type')).not.toContainText('Quiet');
    await expect(window.locator('#rc-recommendations')).not.toContainText('too quiet');

    await window.locator('.mode-tab[data-mode="file"]').click();
    await expect(window.locator('.spectrum-legend')).toContainText('Worship service');

    await electronApp.evaluate(({ ipcMain }, analysis) => {
      ipcMain.removeHandler('analyze-file');
      ipcMain.handle('analyze-file', () => ({ success: true, data: analysis }));
    }, WORSHIP_MUSIC_ANALYSIS);

    await window.evaluate((fp) => {
      (window as unknown as { loadFile: (p: string) => void }).loadFile(fp);
    }, fixturePath);
    await window.locator('#analyze-btn').click();

    await window.locator('.mode-tab[data-mode="reportcard"]').click();
    await expect(window.locator('#rc-rec-type')).toContainText('Dynamic Service');
    await expect(window.locator('#rc-recommendations')).not.toContainText('too quiet');
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

  test('spectrum overlays a dashed ideal target, defaulting from content type', async () => {
    await electronApp.evaluate(({ ipcMain }, analysis) => {
      ipcMain.removeHandler('analyze-file');
      ipcMain.handle('analyze-file', () => ({ success: true, data: analysis }));
    }, FAKE_ANALYSIS);

    await window.locator('.mode-tab[data-mode="file"]').click();
    const fixturePath = path.join(__dirname, 'fixtures', 'silence.wav');
    await window.evaluate((fp) => {
      (window as unknown as { loadFile: (p: string) => void }).loadFile(fp);
    }, fixturePath);
    await window.locator('#analyze-btn').click();

    // Cycle back through the file tab so the real analysis (with its curve) is
    // re-rendered — the prior test left the panel on the curve-less meters path.
    await window.locator('.mode-tab[data-mode="reportcard"]').click();
    await window.locator('.mode-tab[data-mode="file"]').click();

    // The measured bars remain, with the dashed ideal target overlaid on top.
    await expect(window.locator('#spectrum-chart .veq-bar')).toHaveCount(7);
    await expect(window.locator('#spectrum-chart path.sb-target-line')).toHaveCount(1);

    // Speech content ⇒ the default target is the speech profile.
    await expect(window.locator('#ideal-profile-wrap')).toBeVisible();
    await expect(window.locator('#ideal-profile-select')).toHaveValue('');
    await expect(window.locator('.spectrum-legend')).toContainText('Speech / podcast');

    // A match score is shown on the curve legend.
    await expect(window.locator('.spectrum-legend .sl-score .num')).toHaveText(/^\d{1,3}$/);
  });

  test('creates a custom ideal curve from the current analysis', async () => {
    await window.locator('.mode-tab[data-mode="file"]').click();

    await window.locator('#ideal-profile-select').selectOption('flat');
    await expect(window.locator('.spectrum-legend')).toContainText('Flat / neutral');

    await window.locator('#ideal-curve-edit-btn').click();
    await expect(window.locator('#curve-dialog')).toBeVisible();
    await window.locator('#curve-name').fill('Sanctuary reference');
    await window.locator('#curve-capture-btn').click();
    await expect(window.locator('#curve-dialog')).toBeHidden();

    await expect(window.locator('#ideal-profile-select')).toHaveValue(/^custom:/);
    await expect(window.locator('#ideal-profile-select')).toContainText('Sanctuary reference');
    await expect(window.locator('.spectrum-legend')).toContainText('Sanctuary reference');

    // Report card reflects the override with a match score + deviation curve.
    await window.locator('.mode-tab[data-mode="reportcard"]').click();
    await expect(window.locator('#rc-profile-section')).toBeVisible();
    await expect(window.locator('#rc-profile')).toContainText('Sanctuary reference');
    await expect(window.locator('#rc-profile .rcp-score .num')).toHaveText(/^\d{1,3}$/);
    await expect(window.locator('#rc-profile .rcp-dev svg')).toBeVisible();
  });

  test.describe('Live capture (PRD 06)', () => {
    test.beforeEach(async () => {
      await window.locator('.mode-tab[data-mode="live"]').click();
      await expect(window.locator('#tab-live')).toHaveClass(/active/);
      // Re-enumerate against the stubbed 8-channel device (the boot-time scan
      // ran before the stub was installed).
      await window.locator('#device-refresh-btn').click();
      await expect(window.locator('#chcfg-list .chcfg-row')).toHaveCount(2);
    });

    test('Monitor/Record toggle reveals the recording folder', async () => {
      const folderRow = window.locator('#record-folder-row');
      await expect(folderRow).toBeHidden();

      await window.locator('#live-mode button[data-mode="record"]').click();
      await expect(folderRow).toBeVisible();

      await window.locator('#live-mode button[data-mode="monitor"]').click();
      await expect(folderRow).toBeHidden();
    });

    test('channel picker adds up to the device channel count, with mono/stereo', async () => {
      const rows = window.locator('#chcfg-list .chcfg-row');
      await expect(rows).toHaveCount(2);
      await expect(window.locator('#chcfg-cap')).toHaveText('2 / 8 used');

      // Add a third mono strip.
      await window.locator('#chcfg-add').click();
      await expect(rows).toHaveCount(3);

      // Make the first strip stereo — a second channel select appears in the row.
      await rows.first().locator('select[data-field="kind"]').selectOption('stereo');
      await expect(rows.first().locator('select[data-field="b"]')).toBeVisible();
      await expect(window.locator('#chcfg-cap')).toHaveText('4 / 8 used');

      // Remove a strip.
      await rows.nth(2).locator('.chcfg-x').click();
      await expect(rows).toHaveCount(2);
    });

    // Two live channels with distinct spectral shapes: Vocals is mid-heavy,
    // Band is bass-heavy. Band keys are snake_case (LIVE_BAND_KEYS).
    const LIVE_CHANNELS = [
      { name: 'Vocals', rms: -18, peak: -6, clipping: false, centroid: 2400,
        bands: { sub_bass: -58, bass: -30, low_mid: -24, mid: -12, high_mid: -20, presence: -28, brilliance: -80 } },
      { name: 'Band', rms: -22, peak: -9, clipping: false, centroid: 300,
        bands: { sub_bass: -20, bass: -10, low_mid: -26, mid: -30, high_mid: -34, presence: -40, brilliance: -50 } },
    ];

    // Live meter ticks arrive over the 'live-event' channel from the main
    // process; push one directly so the meters render without a real capture.
    async function sendLiveTick(channels: unknown) {
      await electronApp.evaluate(({ BrowserWindow }, chs) => {
        BrowserWindow.getAllWindows()[0].webContents.send('live-event', { type: 'meter', channels: chs });
      }, channels);
    }

    test('live channels render as vertical-bar EQs with the shared analyzer arc', async () => {
      await sendLiveTick(LIVE_CHANNELS);

      await expect(window.locator('#spectrum-title')).toHaveText('Spectrum · Live EQ');
      const channels = window.locator('.sb-live-meters .live-ch');
      await expect(channels).toHaveCount(2);
      await expect(channels.first().locator('.live-ch-name')).toHaveText('Vocals');
      await expect(channels.nth(1).locator('.live-ch-name')).toHaveText('Band');

      // 7 upright bars per channel, ordered low→high left→right.
      const bars = channels.first().locator('.veq-bar');
      await expect(bars).toHaveCount(7);
      await expect(bars.first()).toHaveAttribute('data-band', 'subBass');
      await expect(bars.last()).toHaveAttribute('data-band', 'brilliance');
      const lefts = await bars.evaluateAll(els => els.map(el => parseFloat((el as HTMLElement).style.left)));
      for (let i = 1; i < lefts.length; i++) expect(lefts[i]).toBeGreaterThan(lefts[i - 1]);

      // The arc is the same component as the whole-mix quality view
      // (spectrumCurveSVG → .sb-spectrum-curve), one per channel, and its SVG
      // carries the dB reference scale; band labels sit under the bars.
      await expect(window.locator('.live-ch .sb-spectrum-curve')).toHaveCount(2);
      await expect(channels.first().locator('.sb-y-label').first()).toBeAttached();
      await expect(channels.first().locator('.veq-label')).toHaveCount(7);
      await expect(channels.first().locator('.veq-label').first()).toHaveText('Sub Bass');
    });

    // Per-strip collapse / fold (#40).
    test('collapse a single strip hides its bands; others stay expanded', async () => {
      await sendLiveTick(LIVE_CHANNELS);
      await window.locator('#live-expand-all').click(); // normalize from any prior test
      const ch0 = window.locator('.live-ch[data-ch="0"]');
      const ch1 = window.locator('.live-ch[data-ch="1"]');
      await expect(ch0.locator('.veq')).toBeVisible();

      await ch0.locator('.live-ch-fold').click();
      await expect(ch0).toHaveClass(/collapsed/);
      await expect(ch0.locator('.veq')).toBeHidden();
      await expect(ch0.locator('.veq-labels')).toBeHidden();
      // The header summary (name + RMS/peak) stays visible when collapsed.
      await expect(ch0.locator('.live-ch-name')).toBeVisible();
      await expect(ch0.locator('.live-ch-meta')).toBeVisible();
      // The other strip is untouched.
      await expect(ch1).not.toHaveClass(/collapsed/);
      await expect(ch1.locator('.veq')).toBeVisible();

      await ch0.locator('.live-ch-fold').click(); // toggles back open
      await expect(ch0).not.toHaveClass(/collapsed/);
      await expect(ch0.locator('.veq')).toBeVisible();
    });

    test('Collapse all then expand one leaves the rest collapsed', async () => {
      await sendLiveTick(LIVE_CHANNELS);
      await window.locator('#live-collapse-all').click();
      await expect(window.locator('.sb-live-meters .live-ch.collapsed')).toHaveCount(2);

      await window.locator('.live-ch[data-ch="0"] .live-ch-fold').click();
      await expect(window.locator('.live-ch[data-ch="0"]')).not.toHaveClass(/collapsed/);
      await expect(window.locator('.live-ch[data-ch="1"]')).toHaveClass(/collapsed/);

      await window.locator('#live-expand-all').click();
      await expect(window.locator('.sb-live-meters .live-ch.collapsed')).toHaveCount(0);
    });

    test('collapsed strip still reflects clipping, and stays collapsed across repaints', async () => {
      await sendLiveTick(LIVE_CHANNELS);
      await window.locator('#live-expand-all').click();
      const ch0 = window.locator('.live-ch[data-ch="0"]');
      await ch0.locator('.live-ch-fold').click();
      await expect(ch0).toHaveClass(/collapsed/);

      // A new window reporting clipping on channel 0 must light the clip dot
      // without re-expanding the strip.
      const clipping = LIVE_CHANNELS.map((c, i) => (i === 0 ? { ...c, clipping: true } : c));
      await sendLiveTick(clipping);
      await expect(ch0.locator('.live-ch-name')).toHaveClass(/clip/);
      await expect(ch0.locator('.live-ch-clip')).toBeVisible();
      await expect(ch0).toHaveClass(/collapsed/);
      await expect(ch0.locator('.veq')).toBeHidden();

      // Several more repaints — still collapsed.
      await sendLiveTick(LIVE_CHANNELS);
      await sendLiveTick(LIVE_CHANNELS);
      await expect(ch0).toHaveClass(/collapsed/);
      await window.locator('#live-expand-all').click(); // leave clean for later tests
    });

    test('bar height tracks level; loudest band is emphasized; silent bands dim', async () => {
      await sendLiveTick(LIVE_CHANNELS);
      await expect(window.locator('.live-ch[data-ch="0"] .veq-bar')).toHaveCount(7);

      const heightOf = async (band: string) =>
        parseFloat(await window.locator(`.live-ch[data-ch="0"] .veq-bar[data-band="${band}"]`).evaluate(el => (el as HTMLElement).style.height));
      const mid = await heightOf('mid'), bass = await heightOf('bass'), sub = await heightOf('subBass'), brill = await heightOf('brilliance');
      expect(mid).toBeGreaterThan(bass);       // -12 dB taller than -30 dB
      expect(bass).toBeGreaterThan(sub);       // -30 dB taller than -58 dB
      expect(brill).toBe(0);                   // ≤ DB_MIN clamps to the floor (min-height keeps it visible)

      const loud = window.locator('.live-ch[data-ch="0"] .veq-bar.loud');
      await expect(loud).toHaveCount(1);
      await expect(loud).toHaveAttribute('data-band', 'mid');
      await expect(window.locator('.live-ch[data-ch="0"] .veq-bar.dim')).toHaveAttribute('data-band', 'brilliance');

      // Numeric per-band readouts ride the bars; > -24 dBFS is emphasized hot.
      const vals = window.locator('.live-ch[data-ch="0"] .veq-val');
      await expect(vals).toHaveCount(7);
      await expect(vals.nth(3)).toHaveText('-12.0');
      await expect(vals.nth(3)).toHaveClass(/hot/);
      await expect(vals.nth(1)).not.toHaveClass(/hot/); // bass at -30
      await expect(vals.nth(6)).toHaveClass(/dim/);     // brilliance at the floor
    });

    test('silence gets no loudest-band emphasis', async () => {
      const silent = LIVE_CHANNELS.map(ch => ({
        ...ch,
        bands: Object.fromEntries(Object.keys(ch.bands).map(k => [k, -120])),
      }));
      await sendLiveTick(silent);
      await expect(window.locator('.veq-bar.dim')).toHaveCount(14); // all bands idle...
      await expect(window.locator('.veq-bar.loud')).toHaveCount(0); // ...none "loudest"
      await expect(window.locator('.veq-label.loud')).toHaveCount(0);

      // Signal returns → emphasis comes back.
      await sendLiveTick(LIVE_CHANNELS);
      await expect(window.locator('.live-ch[data-ch="0"] .veq-bar.loud')).toHaveAttribute('data-band', 'mid');
    });

    test('each channel has its own independent arc and loudest band', async () => {
      await sendLiveTick(LIVE_CHANNELS);
      // Bass-heavy channel emphasizes bass, not mid.
      await expect(window.locator('.live-ch[data-ch="1"] .veq-bar.loud')).toHaveAttribute('data-band', 'bass');
      // The two arcs are drawn from their own band values → different paths.
      const paths = await window.locator('.live-ch .sb-curve-line').evaluateAll(els => els.map(e => e.getAttribute('d')));
      expect(paths).toHaveLength(2);
      expect(paths[0]).not.toBe(paths[1]);
    });

    test('per-channel labels: config rename, live-header inline edit, and fallback (#39)', async () => {
      // Two backend channels that carry device names → the fallback path.
      const named = [
        { ...LIVE_CHANNELS[0], name: 'USB Audio 1' },
        { ...LIVE_CHANNELS[1], name: 'USB Audio 2' },
      ];
      await sendLiveTick(named);
      const heads = window.locator('.sb-live-meters .live-ch-name');
      const rowLabels = window.locator('#chcfg-list .chcfg-row .chcfg-label');

      // With no label yet, the header shows the backend device name, and the
      // config input previews it as a placeholder (not a value).
      await expect(heads.first()).toHaveText('USB Audio 1');
      await expect(rowLabels.first()).toHaveValue('');
      await expect(rowLabels.first()).toHaveAttribute('placeholder', 'USB Audio 1');

      // Rename from the channel config → the live header reflects it immediately.
      await rowLabels.first().fill('Kick');
      await expect(heads.first()).toHaveText('Kick');

      // Clearing the label falls back to the backend device name.
      await rowLabels.first().fill('');
      await expect(heads.first()).toHaveText('USB Audio 1');

      // Inline-edit the second strip's header → the config row's label input
      // (rebuilt from the channelConfig strip) reflects the write-back.
      await heads.nth(1).click();
      await window.keyboard.press('ControlOrMeta+A');
      await window.keyboard.type('SL Vox');
      await window.keyboard.press('Enter');
      await expect(heads.nth(1)).toHaveText('SL Vox');
      await expect(rowLabels.nth(1)).toHaveValue('SL Vox');

      // A fresh tick keeps the committed label (patch must not clobber it).
      await sendLiveTick(named);
      await expect(heads.nth(1)).toHaveText('SL Vox');
      await expect(heads.first()).toHaveText('USB Audio 1');

      // Focusing an unlabeled header and blurring without typing must NOT pin the
      // resolved fallback as an explicit label (would freeze the device name).
      await heads.first().click();
      await heads.nth(1).click(); // blur strip 0 by focusing elsewhere
      await expect(rowLabels.first()).toHaveValue('');

      // Escape cancels an in-progress inline rename (label stays unset).
      await heads.first().click();
      await window.keyboard.press('ControlOrMeta+A');
      await window.keyboard.type('Discarded');
      await window.keyboard.press('Escape');
      await expect(heads.first()).toHaveText('USB Audio 1');
      await expect(rowLabels.first()).toHaveValue('');

      // Labels are display-only: the stream.py channel tokens never carry them.
      const clean = [{ ...LIVE_CHANNELS[0], name: 'Ch 1' }, { ...LIVE_CHANNELS[1], name: 'Ch 2' }];
      await sendLiveTick(clean);
    });

    test('a new tick updates bars and arc in place', async () => {
      await sendLiveTick(LIVE_CHANNELS);
      const midBar = window.locator('.live-ch[data-ch="0"] .veq-bar[data-band="mid"]');
      await expect(midBar).toHaveClass(/loud/);
      const before = parseFloat(await midBar.evaluate(el => (el as HTMLElement).style.height));
      const arcLine = window.locator('.live-ch[data-ch="0"] .sb-curve-line');
      const arcBefore = await arcLine.getAttribute('d');
      // Mark the SVG node so we can prove the tick patches it rather than
      // rebuilding it (bars/arc keep their nodes → CSS transitions run).
      await window.locator('.live-ch[data-ch="0"] .sb-spectrum-curve').evaluate(el => el.setAttribute('data-marker', 'kept'));

      // Vocals goes bass-heavy: the mid bar shrinks and emphasis moves to bass.
      const next = [
        { ...LIVE_CHANNELS[0], bands: { ...LIVE_CHANNELS[0].bands, mid: -40, bass: -8 } },
        LIVE_CHANNELS[1],
      ];
      await sendLiveTick(next);
      await expect(window.locator('.live-ch[data-ch="0"] .veq-bar.loud')).toHaveAttribute('data-band', 'bass');
      const after = parseFloat(await midBar.evaluate(el => (el as HTMLElement).style.height));
      expect(after).toBeLessThan(before);
      // Arc re-shaped with the bars, on the same SVG node.
      await expect(arcLine).not.toHaveAttribute('d', arcBefore as string);
      await expect(window.locator('.live-ch[data-ch="0"] .sb-spectrum-curve')).toHaveAttribute('data-marker', 'kept');
    });

    test('record mode captures a session and offers to reveal the folder (#43)', async () => {
      await electronApp.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('reveal-path');
        ipcMain.handle('reveal-path', (_e, p) => {
          (globalThis as Record<string, unknown>).__revealed = p; return { success: true };
        });
      });
      await window.locator('#live-mode button[data-mode="record"]').click();
      await window.locator('#arm-all-btn').click(); // normalize armed state
      await window.locator('#live-start-btn').click();
      await expect(window.locator('#live-stop-btn')).toBeVisible();
      await expect(window.locator('#live-indicator .live-txt')).toHaveText('REC');

      await window.locator('#live-stop-btn').click();
      await expect(window.locator('#live-start-btn')).toBeVisible();
      // stop-live returns a sessionDir (stubbed) → the session offer appears and
      // "Open folder" reveals that dir via reveal-path.
      await expect(window.locator('#rec-offer')).toBeVisible();
      await expect(window.locator('#rec-offer-text')).toContainText('Session saved');
      await window.locator('#rec-offer-btn').click();
      const revealed = await electronApp.evaluate(() => (globalThis as Record<string, unknown>).__revealed);
      expect(revealed).toBe('/tmp/sound-buddy-20260702-101500');
      await expect(window.locator('#rec-offer')).toBeHidden();
    });

    test('Record mode with nothing armed blocks Start with a hint (#43)', async () => {
      await window.locator('#live-mode button[data-mode="record"]').click();
      await window.locator('#disarm-all-btn').click();
      await expect(window.locator('#arm-count')).toContainText('0 /');
      await window.locator('#live-start-btn').click();
      // No capture spawned: hint shown, Start still visible, Stop hidden.
      await expect(window.locator('#arm-hint')).toBeVisible();
      await expect(window.locator('#arm-hint')).toContainText('Arm at least one strip');
      await expect(window.locator('#live-start-btn')).toBeVisible();
      await expect(window.locator('#live-stop-btn')).toBeHidden();
      // Re-arm → Start works and the hint clears.
      await window.locator('#arm-all-btn').click();
      await window.locator('#live-start-btn').click();
      await expect(window.locator('#live-stop-btn')).toBeVisible();
      await expect(window.locator('#arm-hint')).toBeHidden();
      await window.locator('#live-stop-btn').click();
    });

    test('Record passes only the armed strips as arm tokens (#43)', async () => {
      await electronApp.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('start-live');
        ipcMain.handle('start-live', (_e, opts) => {
          (globalThis as Record<string, unknown>).__start = opts; return { success: true };
        });
      });
      await window.locator('#live-mode button[data-mode="record"]').click();
      await window.locator('#arm-all-btn').click();
      const arms = window.locator('#chcfg-list .chcfg-arm');
      const total = await arms.count();
      await arms.first().click(); // disarm strip 0
      await expect(arms.first()).toHaveAttribute('aria-pressed', 'false');

      await window.locator('#live-start-btn').click();
      await expect(window.locator('#live-stop-btn')).toBeVisible();
      const opts = (await electronApp.evaluate(
        () => (globalThis as Record<string, unknown>).__start,
      )) as { arm?: string[] };
      expect(opts.arm).toBeDefined();
      expect(opts.arm!.length).toBe(total - 1); // exactly one strip disarmed
      await window.locator('#live-stop-btn').click();
      // Restore the plain success stub for any later tests.
      await electronApp.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('start-live');
        ipcMain.handle('start-live', () => ({ success: true }));
      });
    });
  });

  test.describe('Virtual Soundcheck (#46)', () => {
    const SESSION_DIR = path.join(__dirname, 'fixtures', 'session');
    test.beforeEach(async () => {
      await electronApp.evaluate(({ ipcMain }, dir) => {
        ipcMain.removeHandler('list-output-devices');
        ipcMain.handle('list-output-devices', () => ({ devices: [
          { index: 0, name: 'Stereo Out', channels: 2 },
          { index: 1, name: 'MOTU 8ch', channels: 8 },
        ] }));
        ipcMain.removeHandler('open-dir-dialog');
        ipcMain.handle('open-dir-dialog', () => dir);
        // read-session is NOT stubbed — it reads the committed fixture session.json.
        ipcMain.removeHandler('start-playback');
        ipcMain.handle('start-playback', (_e, opts) => {
          (globalThis as Record<string, unknown>).__pb = opts; return { success: true };
        });
        ipcMain.removeHandler('stop-playback');
        ipcMain.handle('stop-playback', () => ({ success: true }));
      }, SESSION_DIR);
      await window.reload();
      await window.waitForLoadState('domcontentloaded');
      await window.locator('.mode-tab[data-mode="soundcheck"]').click();
    });

    async function sendPlaybackEvent(data: unknown) {
      await electronApp.evaluate(({ BrowserWindow }, d) => {
        BrowserWindow.getAllWindows()[0].webContents.send('playback-event', d);
      }, data);
    }

    test('Play is disabled until a session is loaded', async () => {
      await expect(window.locator('#sc-play-btn')).toBeDisabled();
      await window.locator('#sc-choose-btn').click();
      await expect(window.locator('#sc-play-btn')).toBeEnabled();
    });

    test('loads a session and lists tracks with labels, badges, routing', async () => {
      await window.locator('#sc-choose-btn').click();
      const tracks = window.locator('#sc-tracks .sc-track');
      await expect(tracks).toHaveCount(2);
      await expect(tracks.nth(0).locator('.sc-track-name')).toHaveText('Kick');
      await expect(tracks.nth(0).locator('.sc-badge')).toHaveText('Mono');
      await expect(tracks.nth(1).locator('.sc-track-name')).toHaveText('OH');
      await expect(tracks.nth(1).locator('.sc-badge')).toHaveText('Stereo');
      await expect(tracks.nth(0).locator('.sc-route')).toBeVisible();
    });

    test('routes on a big device, plays, updates transport + meters, stops', async () => {
      await window.locator('#sc-choose-btn').click();
      await window.locator('#sc-device-select').selectOption({ label: 'MOTU 8ch (8ch)' });
      await expect(window.locator('#sc-mixdown-notice')).toBeHidden();

      await window.locator('#sc-play-btn').click();
      await expect(window.locator('#sc-stop-btn')).toBeVisible();
      const opts = (await electronApp.evaluate(
        () => (globalThis as Record<string, unknown>).__pb,
      )) as { route?: string; sessionDir?: string };
      expect(opts.route).toBeTruthy();
      expect(opts.sessionDir).toContain('session');

      await sendPlaybackEvent({ type: 'progress', elapsed: 2, duration: 10 });
      await expect(window.locator('#sc-elapsed')).toContainText('0:02 / 0:10');
      await sendPlaybackEvent({ type: 'level', tracks: [
        { label: 'Kick', rms: -12, peak: -6, clipping: false },
        { label: 'OH', rms: -20, peak: -9, clipping: true },
      ] });
      const meters = window.locator('#spectrum-body .sc-meter');
      await expect(meters).toHaveCount(2);
      await expect(meters.nth(1)).toHaveClass(/clip/);

      await window.locator('#sc-stop-btn').click();
      await expect(window.locator('#sc-play-btn')).toBeVisible();
      await expect(window.locator('#sc-elapsed')).toBeHidden();
    });

    test('a too-small device shows the stereo-mixdown fallback notice', async () => {
      await window.locator('#sc-choose-btn').click();
      await window.locator('#sc-device-select').selectOption({ label: 'Stereo Out (2ch)' });
      await expect(window.locator('#sc-mixdown-notice')).toBeVisible();
      await expect(window.locator('#sc-mixdown-notice')).toContainText('stereo master');
      await window.locator('#sc-play-btn').click();
      await expect(window.locator('#sc-stop-btn')).toBeVisible();
      await window.locator('#sc-stop-btn').click();
    });

    test('an ended event resets the transport', async () => {
      await window.locator('#sc-choose-btn').click();
      await window.locator('#sc-play-btn').click();
      await expect(window.locator('#sc-stop-btn')).toBeVisible();
      await sendPlaybackEvent({ type: 'ended' });
      await expect(window.locator('#sc-play-btn')).toBeVisible();
      await expect(window.locator('#sc-stop-btn')).toBeHidden();
    });
  });

  test.describe('Named channel groups (#41)', () => {
    const CH = [
      { name: 'Vocals', rms: -18, peak: -6, clipping: false, centroid: 2400,
        bands: { sub_bass: -58, bass: -30, low_mid: -24, mid: -12, high_mid: -20, presence: -28, brilliance: -80 } },
      { name: 'Band', rms: -22, peak: -9, clipping: false, centroid: 300,
        bands: { sub_bass: -20, bass: -10, low_mid: -26, mid: -30, high_mid: -34, presence: -40, brilliance: -50 } },
    ];
    async function tick() {
      await electronApp.evaluate(({ BrowserWindow }, chs) => {
        BrowserWindow.getAllWindows()[0].webContents.send('live-event', { type: 'meter', channels: chs });
      }, CH);
    }
    async function makeGroup(name: string) {
      await window.locator('#new-group-btn').click();
      await window.locator('#rig-dialog-input').fill(name);
      await window.locator('#rig-dialog-ok').click();
    }
    test.beforeEach(async () => {
      await window.reload(); // reset in-memory groups between tests
      await window.waitForLoadState('domcontentloaded');
      await window.locator('.mode-tab[data-mode="live"]').click();
    });

    test('create a group, assign a strip, and it renders grouped in the live board', async () => {
      await makeGroup('Drums');
      await window.locator('.chcfg-row').nth(0).locator('.chcfg-group').selectOption({ label: 'Drums' });
      await tick();
      const board = window.locator('#spectrum-body .sb-live-meters');
      await expect(board.locator('.live-group-head')).toHaveCount(2); // Drums + Ungrouped
      await expect(board.locator('.live-group-head').first().locator('.live-group-name')).toHaveText('Drums');
      await expect(board.locator('.live-group-head.ungrouped .live-group-name')).toHaveText('Ungrouped');
      // The assigned strip (idx 0) sits before the Ungrouped header; idx 1 after.
      await expect(board.locator('.live-ch')).toHaveCount(2);
    });

    test('collapsing a group folds all its members, leaving others alone', async () => {
      await makeGroup('Drums');
      await window.locator('.chcfg-row').nth(0).locator('.chcfg-group').selectOption({ label: 'Drums' });
      await tick();
      await window.locator('.live-group-fold').first().click();
      await expect(window.locator('#spectrum-body .live-ch[data-ch="0"]')).toHaveClass(/collapsed/);
      await expect(window.locator('#spectrum-body .live-ch[data-ch="1"]')).not.toHaveClass(/collapsed/);
    });

    test('removing a strip from config drops it from its group (no dangling ref)', async () => {
      await makeGroup('Drums');
      await window.locator('.chcfg-row').nth(0).locator('.chcfg-group').selectOption({ label: 'Drums' });
      await window.locator('.chcfg-row').nth(1).locator('.chcfg-group').selectOption({ label: 'Drums' });
      await window.locator('.chcfg-row').nth(0).locator('.chcfg-x').click(); // remove strip 0
      // One row remains; former strip 1 remapped to index 0 and is STILL in Drums
      // (value "0" = group index of Drums) — no dangling reference to strip 0.
      await expect(window.locator('.chcfg-row')).toHaveCount(1);
      await expect(window.locator('.chcfg-row').nth(0).locator('.chcfg-group')).toHaveValue('0');
      // Live board (one channel now) renders the survivor under Drums, no Ungrouped.
      await electronApp.evaluate(({ BrowserWindow }, chs) => {
        BrowserWindow.getAllWindows()[0].webContents.send('live-event', { type: 'meter', channels: chs });
      }, [CH[0]]);
      const board = window.locator('#spectrum-body .sb-live-meters');
      await expect(board.locator('.live-ch')).toHaveCount(1);
      await expect(board.locator('.live-group-head.ungrouped')).toHaveCount(0);
    });
  });
  test.describe('AI provider settings (#76)', () => {
    test.beforeAll(async () => {
      // The dialog probes Ollama and (on demand) a hosted provider over the
      // network — stub both so the flow is testable anywhere. Config
      // persistence (llm-save-config / llm-get-config) stays REAL: the Ollama
      // path never touches safeStorage, and userData is isolated.
      await electronApp.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('llm-detect-ollama');
        ipcMain.handle('llm-detect-ollama', () => ({ ok: true, models: ['llama3.2', 'qwen3:8b'] }));
        ipcMain.removeHandler('llm-test-provider');
        ipcMain.handle('llm-test-provider', (_e: unknown, opts: { apiKey?: string }) =>
          opts && opts.apiKey === 'sk-good'
            ? { ok: true }
            : { ok: false, reason: 'Authentication failed (HTTP 401) — check your key' });
      });
    });

    test.afterEach(async () => {
      // Close the dialog if a failed assertion left it open.
      await window.evaluate(() => {
        (document.getElementById('ai-dialog') as HTMLElement).style.display = 'none';
      });
    });

    test('gear opens the dialog on the Ollama tab with detected models', async () => {
      await window.locator('#ai-settings-btn').click();
      await expect(window.locator('#ai-dialog')).toBeVisible();
      await expect(window.locator('#ai-tab-btn-ollama')).toHaveClass(/active/);
      await expect(window.locator('#ai-ollama-status')).toContainText('Ollama detected — 2 models');
      await expect(window.locator('#ai-ollama-model option')).toHaveCount(2);
    });

    test('API-key tab: custom provider reveals the base URL field', async () => {
      await window.locator('#ai-settings-btn').click();
      await window.locator('#ai-tab-btn-hosted').click();
      await expect(window.locator('#ai-baseurl-field')).toBeHidden();
      await window.locator('#ai-provider').selectOption('custom');
      await expect(window.locator('#ai-baseurl-field')).toBeVisible();
      await window.locator('#ai-provider').selectOption('anthropic');
      await expect(window.locator('#ai-baseurl-field')).toBeHidden();
    });

    test('test connection reports success and failure immediately', async () => {
      await window.locator('#ai-settings-btn').click();
      await window.locator('#ai-tab-btn-hosted').click();
      await window.locator('#ai-api-key').fill('sk-bad');
      await window.locator('#ai-test-btn').click();
      await expect(window.locator('#ai-test-result')).toHaveClass(/err/);
      await expect(window.locator('#ai-test-result')).toContainText('check your key');
      await window.locator('#ai-api-key').fill('sk-good');
      await window.locator('#ai-test-btn').click();
      await expect(window.locator('#ai-test-result')).toHaveClass(/ok/);
    });

    test('saving the Ollama path persists llm.json and updates the provider chip', async () => {
      await window.locator('#ai-settings-btn').click();
      await window.locator('#ai-ollama-model').selectOption('qwen3:8b');
      await window.locator('#ai-dialog-save').click();
      await expect(window.locator('#ai-dialog')).toBeHidden();
      // Enable-AI defaulted on for a first-time connect, so the panel is live.
      await expect(window.locator('#model-chip-text')).toHaveText('ollama · qwen3:8b');
      // Round-trip: reopening shows the saved model still selected.
      await window.locator('#ai-settings-btn').click();
      await expect(window.locator('#ai-ollama-model')).toHaveValue('qwen3:8b');
      await window.locator('#ai-dialog-cancel').click();
    });
  });

  // Storage settings (#91) — configurable location + informational disk usage,
  // and the locked "no usage caps" copy. The folder picker is a native dialog,
  // so stub open-dir-dialog to drive the change-folder flow deterministically.
  test.describe('Storage settings (#91)', () => {
    test.afterEach(async () => {
      await window.evaluate(() => {
        (document.getElementById('storage-dialog') as HTMLElement).style.display = 'none';
      });
    });

    test('the header button opens the dialog with the no-caps copy and disk usage', async () => {
      await window.locator('#storage-settings-btn').click();
      await expect(window.locator('#storage-dialog')).toBeVisible();
      await expect(window.locator('#storage-dialog .storage-unlimited')).toHaveText(
        'Unlimited recordings. Stored on your machine.',
      );
      // Usage line resolves from the informational IPC (never a limit).
      await expect(window.locator('#storage-usage')).toContainText('no limit');
      await expect(window.locator('#storage-path')).not.toHaveText('');
      await window.locator('#storage-cancel-btn').click();
      await expect(window.locator('#storage-dialog')).toBeHidden();
    });

    test('choosing a folder persists storageDir and survives a reopen', async () => {
      const chosen = '/tmp/sb-e2e-storage';
      await electronApp.evaluate(({ ipcMain }, dir) => {
        ipcMain.removeHandler('open-dir-dialog');
        ipcMain.handle('open-dir-dialog', () => dir);
      }, chosen);

      await window.locator('#storage-settings-btn').click();
      await window.locator('#storage-change-btn').click();
      await expect(window.locator('#storage-path')).toHaveText(chosen);
      await window.locator('#storage-save-btn').click();
      await expect(window.locator('#storage-dialog')).toBeHidden();

      // Reopen: get-storage-usage reflects the persisted folder.
      await window.locator('#storage-settings-btn').click();
      await expect(window.locator('#storage-path')).toHaveText(chosen);
      // Now that a custom folder is set, the reset action is offered.
      await expect(window.locator('#storage-reset-btn')).toBeVisible();
      await window.locator('#storage-cancel-btn').click();

      // Restore the default so later specs (and reruns) see a clean setting.
      await electronApp.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('open-dir-dialog');
      });
      await window.evaluate(() => (window as any).soundBuddy.updateSettings({ storageDir: '' }));
    });
  });
});
