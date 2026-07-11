import { _electron as electron } from 'playwright';
import type { ElectronApplication, Page, Locator } from '@playwright/test';
import * as path from 'path';
import { LICENSE_ENV, seedProLicense } from '../license-fixture';

// Shared fixtures + launch helper for the e2e.spec.ts split (#225 — the
// original 1693-line file was split by user flow into app/tests/e2e/*.spec.ts).
// Every split file launches its OWN Electron instance (mirroring every other
// spec file in app/tests/) rather than sharing one continuous session, so each
// file re-establishes the same stubs the original single beforeAll installed.

// A 48-point log-spaced frequency-response curve (20 Hz–20 kHz), tilted bass-heavy
// so the acceptance "curve is higher at low frequencies" holds. Mirrors the shape
// spectrum.py emits so the renderer is exercised the same way as in production.
export const CURVE = (() => {
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
export const FRAMES = Array.from({ length: 6 }, (_, i) => ({
  t: i * 2,
  // A per-frame ripple whose phase shifts with i, so each frame has a distinct
  // spectral *shape* (not just a uniform dB offset the auto-ranged curve would
  // normalize away) — the scrubber redraw is then observable in the path data.
  db: CURVE.db.map((d, k) => d + Math.sin(k / 4 + i) * 6),
  rms: -18 + i,
  class: i % 2 === 0 ? 'music' : 'speech',
}));

export const FAKE_ANALYSIS = {
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

export const WORSHIP_SERVICE_ANALYSIS = {
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

export const WORSHIP_MUSIC_ANALYSIS = {
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
export const DEDUCTING_ANALYSIS = {
  ...FAKE_ANALYSIS,
  sox: { ...FAKE_ANALYSIS.sox, rmsDbfs: -26, dynamicRangeDb: 4 },
};

// A single-frame analysis (short file): the heatmap collapses to one column and
// the report card shows a single representative frame, without error.
export const SHORT_ANALYSIS = {
  ...FAKE_ANALYSIS,
  spectrum: { ...FAKE_ANALYSIS.spectrum, frames: [{ t: 0, db: CURVE.db, rms: -18, class: 'music' }] },
};

// Loads a fixture and runs analysis directly via the globals index.html exposes
// for exactly this purpose (see the "Global (used by smoke test + menu-open)"
// comment above loadFile in the source). Needed for every load after the very
// first successful analysis of the run: once a report card is showing,
// #file-dropzone/#analyze-btn live inside #rc-empty, which flips to
// display:none in favor of #rc-content (#203) — so they're no longer
// clickable. This mirrors the app's own "File > Open File…" menu action
// (sb.onMenuOpenFile), which is the only remaining production path that loads
// a new file once a report card is already on screen.
export async function loadAndAnalyze(window: Page, fp: string) {
  await window.evaluate((filePath) => {
    const w = window as unknown as { loadFile: (p: string) => void; runFileAnalysis: (p: string) => Promise<void> };
    w.loadFile(filePath);
    return w.runFileAnalysis(filePath);
  }, fp);
}

// Commit a new name into a workspace track header (contenteditable .live-ch-name).
export async function renameHeader(window: Page, head: Locator, value: string) {
  await head.click();
  await window.keyboard.press('ControlOrMeta+A');
  await window.keyboard.type(value);
  await window.keyboard.press('Enter');
}

// Every launchApp() call gets its own --user-data-dir suffix. The original
// single-file suite launched Electron exactly once, so one shared directory
// was fine; now that each split file (and each describe within settings.spec.ts)
// launches its own instance, reusing one directory raced the previous
// instance's on-disk teardown against the next launch (observed as
// "Execution context was destroyed" during the post-launch stub setup) —
// giving each launch a unique directory removes the shared state entirely.
let launchCounter = 0;

/**
 * Retry a flaky Electron-main-process call once after a short delay. Exported
 * so a spec file's own first post-launch electronApp.evaluate() (settings.spec.ts's
 * AI-provider beforeAll stubs, right after launchApp() returns) can use the same
 * guard against the just-booted-process race documented on launchApp() above.
 */
export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 250));
    return fn();
  }
}

/**
 * Launch a fresh Electron instance with the same baseline stubs the original
 * e2e.spec.ts installed once for its whole session: analyze-file returns
 * FAKE_ANALYSIS, list-devices reports one fake 8-channel interface, and
 * start-live/stop-live are no-ops that hand back a fixed session dir. Each
 * split spec file calls this in its own beforeAll so it can run standalone.
 */
export async function launchApp(): Promise<{ electronApp: ElectronApplication; window: Page }> {
  // Isolate the app's userData so persisting the ideal-profile choice (PRD 05)
  // writes to a throwaway settings.json rather than the developer's real one,
  // and so this launch never collides with another spec file's instance.
  launchCounter += 1;
  const userDataDir = path.join(
    __dirname, '..', '..', 'test-results',
    `e2e-userdata-${process.pid}-${launchCounter}`,
  );
  // Live/soundcheck flows are Pro features (#54): seed a license so their UI
  // is unlocked. The dedicated license.spec.ts covers the free tier + gating.
  seedProLicense(userDataDir);
  const electronApp = await electron.launch({
    args: [path.join(__dirname, '..', '..', 'dist', 'electron', 'main.js'), `--user-data-dir=${userDataDir}`],
    env: { ...process.env, ...LICENSE_ENV },
  });
  const window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  // Real analysis/capture require sox/ffprobe/python3 + a mic on PATH. Stub the
  // main-process IPC handlers so the happy paths are testable anywhere.
  //
  // This first evaluate() occasionally races a just-launched Electron instance
  // (observed in resource-constrained sandboxes as "Execution context was
  // destroyed, most likely because of a navigation" — pre-existing in the
  // original single-session e2e.spec.ts too, just rarer there since it only
  // launched once per run; splitting into per-file sessions rolls the dice
  // more often). Retry once after a short delay rather than failing the whole
  // file over a transient main-process hiccup.
  await withRetry(() => electronApp.evaluate(({ ipcMain }, analysis) => {
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

    // save-analysis-summary (#146) writes under the platform Music folder,
    // which --user-data-dir does NOT isolate — stub it so e2e runs (which fire
    // this on every loadAndAnalyze) never touch the developer's real disk.
    ipcMain.removeHandler('save-analysis-summary');
    ipcMain.handle('save-analysis-summary', () => ({ success: true }));

    // list-analysis-summaries (#147) reads from the same unisolated folder —
    // stub it to the empty state so specs that don't seed history see
    // "no analyses yet" rather than a real (or absent) disk read.
    ipcMain.removeHandler('list-analysis-summaries');
    ipcMain.handle('list-analysis-summaries', () => ({ success: true, summaries: [] }));
  }, FAKE_ANALYSIS));

  return { electronApp, window };
}
