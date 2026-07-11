import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import * as path from 'path';
import { launchApp, loadAndAnalyze, FAKE_ANALYSIS } from './e2e-helpers';

// Playback transport (#180) — split out of e2e.spec.ts (#225) as its own file.
// Every test here re-stubs analyze-file and calls loadAndAnalyze itself, so
// this describe was already fully self-contained in the original file and is
// safe to run as its own Electron session.

let electronApp: ElectronApplication;
let window: Page;

test.describe('playback transport (#180)', () => {
  // Unlike the other fixtures, playback needs the *real* fixture file on disk
  // (analyze-file is stubbed and never reads it) so the renderer's <audio>
  // element has something to actually decode and play.
  const realFixturePath = path.join(__dirname, '..', 'fixtures', 'silence.wav'); // 1.00s, real WAV

  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp());
  });

  test.afterAll(async () => {
    await electronApp.close();
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

    await window.locator('.mode-tab[data-mode="reportcard"]').click();
    await loadAndAnalyze(window, realFixturePath);

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

    // Seeking at/past the real duration must clamp instead of landing exactly
    // on it — Chromium treats currentTime === duration as end-of-file and
    // immediately re-fires 'ended', which would otherwise snap the seek back
    // to 0 and silently undo it (the bug this clamp exists to prevent).
    await window.evaluate(() => (window as unknown as { seekPlayback: (t: number) => void }).seekPlayback(999));
    await expect(playBtn).toHaveAttribute('aria-label', 'Play');
    const leftAfterOverseek = await playhead.evaluate((el) => (el as HTMLElement).style.left);
    expect(leftAfterOverseek).not.toBe('0%');
    expect(parseFloat(leftAfterOverseek)).toBeGreaterThan(80);

    // Reset the scrub selection so later tests start from the average state.
    await window.locator('#scrub-reset').click();
  });

  test('band bars, curve overlay, and window-average readout update in real time during playback (AW-4, #179)', async () => {
    const playbackFrames = FAKE_ANALYSIS.spectrum.frames.map((f, i) => ({ ...f, t: i * 0.15 }));
    await electronApp.evaluate(({ ipcMain }, analysis) => {
      ipcMain.removeHandler('analyze-file');
      ipcMain.handle('analyze-file', () => ({ success: true, data: analysis }));
    }, { ...FAKE_ANALYSIS, filePath: realFixturePath, spectrum: { ...FAKE_ANALYSIS.spectrum, frames: playbackFrames } });

    await window.locator('.mode-tab[data-mode="reportcard"]').click();
    await loadAndAnalyze(window, realFixturePath);

    const playBtn = window.locator('#spectro-play-btn');
    const readout = window.locator('#scrub-readout');
    const bars = () => window.locator('#spectrum-chart .veq-bar')
      .evaluateAll((els) => els.map((el) => (el as HTMLElement).style.height));

    await expect(readout).toHaveText('Whole-file average');
    await expect(window.locator('#spectrum-chart .eq-target-svg')).toBeVisible();
    const idleHeights = await bars();

    // Play — the bars start animating against the (still-visible, static)
    // level-matched target curve, and the readout switches to a live
    // class + rolling window-average, sourced from spectrum.frames.
    await playBtn.click();
    await expect(playBtn).toHaveClass(/playing/);
    await expect(readout).toContainText('Window avg', { timeout: 2000 });
    await expect(window.locator('#spectrum-chart .eq-target-svg')).toBeVisible();

    // At least one bar height changed from the whole-file average — the
    // real-time per-frame values are actually driving the bars, not a no-op.
    await expect.poll(async () => {
      const live = await bars();
      return live.some((h, i) => h !== idleHeights[i]);
    }, { timeout: 2000 }).toBe(true);

    // The 1-second fixture runs to completion on its own: end-of-file returns
    // the bars and readout to the whole-file average state and drops the
    // real-time overlay (mirrors the pause path, since both call stopPlaybackBandLoop).
    await expect(playBtn).toHaveAttribute('aria-label', 'Play', { timeout: 5000 });
    await expect(readout).not.toContainText('Window avg');
    await expect(readout).toHaveText('Whole-file average');
  });

  test('scrubbing the heatmap while playing seeks without leaving a stale pinned frame (#179)', async () => {
    const playbackFrames = FAKE_ANALYSIS.spectrum.frames.map((f, i) => ({ ...f, t: i * 0.15 }));
    await electronApp.evaluate(({ ipcMain }, analysis) => {
      ipcMain.removeHandler('analyze-file');
      ipcMain.handle('analyze-file', () => ({ success: true, data: analysis }));
    }, { ...FAKE_ANALYSIS, filePath: realFixturePath, spectrum: { ...FAKE_ANALYSIS.spectrum, frames: playbackFrames } });

    await window.locator('.mode-tab[data-mode="reportcard"]').click();
    await loadAndAnalyze(window, realFixturePath);

    const playBtn = window.locator('#spectro-play-btn');
    const readout = window.locator('#scrub-readout');
    const playhead = window.locator('#spectro-playhead');

    await playBtn.click();
    await expect(playBtn).toHaveClass(/playing/);

    // Click a heatmap column while the file is actively playing — this must
    // seek (the playhead jumps) without pinning a static frame the way the
    // same click would while paused (#179): a pin here would go stale the
    // instant playback advances past it, and show the WRONG frame's stats
    // once the user pauses, rather than wherever they actually paused.
    const heat = window.locator('#spectrum-heatmap');
    const box = await heat.boundingBox();
    await heat.click({ position: { x: Math.round(box!.width * (2.5 / 6)), y: 40 } });
    const seekedLeft = await playhead.evaluate((el) => (el as HTMLElement).style.left);
    expect(seekedLeft).not.toBe('0%');

    // Pausing right after must return to the whole-file average — not the
    // clicked column's static readout — proving no stale pin was left behind.
    await playBtn.click();
    await expect(playBtn).toHaveAttribute('aria-label', 'Play');
    await expect(readout).toHaveText('Whole-file average');
  });
});
