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
    // Classification (PRD 04) so the ideal-profile overlay + comparison (PRD 05)
    // default from content type.
    contentType: 'speech',
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
    // Isolate the app's userData so persisting the ideal-profile choice (PRD 05)
    // writes to a throwaway settings.json rather than the developer's real one.
    const userDataDir = path.join(__dirname, '..', 'test-results', 'e2e-userdata');
    electronApp = await electron.launch({
      args: [path.join(__dirname, '..', 'dist', 'electron', 'main.js'), `--user-data-dir=${userDataDir}`],
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

    test('record mode captures a session and stops cleanly', async () => {
      await window.locator('#live-mode button[data-mode="record"]').click();
      await window.locator('#live-start-btn').click();
      await expect(window.locator('#live-stop-btn')).toBeVisible();
      await expect(window.locator('#live-indicator .live-txt')).toHaveText('REC');

      await window.locator('#live-stop-btn').click();
      // Stop returns to the idle state. stop-live now yields a session folder
      // rather than a single WAV, so the legacy single-file "Analyze it?" offer
      // no longer fires — the session banner/analyze flow arrives with the UI in
      // #43. Guard the interim: the offer must not appear.
      await expect(window.locator('#live-start-btn')).toBeVisible();
      await expect(window.locator('#rec-offer')).toBeHidden();
    });
  });
});
