import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import * as path from 'path';
import { launchApp, loadAndAnalyze } from './e2e-helpers';

// First slice of the former e2e.spec.ts "Sound Buddy E2E" describe (#225):
// app boot, tab navigation, and the empty/loaded/cleared report-card states.
// Each test here calls loadAndAnalyze itself, so this file is self-contained
// and safe to run as its own Electron session.

let electronApp: ElectronApplication;
let window: Page;

test.describe('Sound Buddy E2E — report card basics', () => {
  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp());
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test('app launches and shows header', async () => {
    await expect(window.locator('#logo-text')).toHaveText('Sound Buddy');
    await expect(window.locator('.mode-tab[data-mode="dir"]')).toBeVisible();
    await expect(window.locator('.mode-tab[data-mode="live"]')).toBeVisible();
    await expect(window.locator('.mode-tab[data-mode="reportcard"]')).toBeVisible();
  });

  test('tab navigation shows the corresponding panel', async () => {
    // The app boots on the Report Card tab (#203) — the file-loading dropzone
    // now lives inside its empty state, not a standalone File tab.
    await expect(window.locator('#reportcard-view')).toHaveClass(/active/);
    await expect(window.locator('#rc-empty')).toBeVisible();
    await expect(window.locator('#file-dropzone')).toBeVisible();

    await window.locator('.mode-tab[data-mode="dir"]').click();
    await expect(window.locator('#reportcard-view')).not.toHaveClass(/active/);
    await expect(window.locator('#tab-dir')).toHaveClass(/active/);

    await window.locator('.mode-tab[data-mode="reportcard"]').click();
    await expect(window.locator('#reportcard-view')).toHaveClass(/active/);
    await expect(window.locator('#rc-empty')).toBeVisible();
  });

  test('directory mode Analyze All is disabled with a v1.1 note, not a fake action (#127)', async () => {
    await window.locator('.mode-tab[data-mode="dir"]').click();
    await expect(window.locator('#tab-dir')).toHaveClass(/active/);
    await expect(window.locator('#analyze-dir-btn')).toBeDisabled();
    await expect(window.locator('#tab-dir .dir-note')).toContainText('v1.1');
  });

  test('report card shows empty state before any analysis', async () => {
    await window.locator('.mode-tab[data-mode="reportcard"]').click();
    await expect(window.locator('#rc-empty')).toBeVisible();
    // The empty state is the file-loading form itself now (#203), not a
    // placeholder message pointing at a separate File tab.
    await expect(window.locator('#file-dropzone')).toContainText('Drop audio file here');
    await expect(window.locator('#analyze-btn')).toBeDisabled();
    await expect(window.locator('#rc-content')).toBeHidden();
  });

  test('playback transport is absent (disabled/idle) before any analysis is loaded (#180)', async () => {
    await window.locator('.mode-tab[data-mode="reportcard"]').click();
    await expect(window.locator('#spectro-play-btn')).toHaveCount(0);
  });

  test('analyzing a file populates the report card', async () => {
    await window.locator('.mode-tab[data-mode="reportcard"]').click();

    // Load the fixture path directly, bypassing the native file-picker dialog.
    const fixturePath = path.join(__dirname, '..', 'fixtures', 'silence.wav');
    await window.evaluate((fp) => {
      (window as unknown as { loadFile: (p: string) => void }).loadFile(fp);
    }, fixturePath);

    await expect(window.locator('#analyze-btn')).toBeEnabled();
    await window.locator('#analyze-btn').click();

    // Success flips the empty state (dropzone/Analyze form) over to the
    // rendered card (#203) — no separate tab switch needed to see it, and the
    // filename now shows in the card's own header instead of the dropzone.
    await expect(window.locator('#rc-content')).toBeVisible();
    await expect(window.locator('#rc-empty')).toBeHidden();
    await expect(window.locator('#rc-filename')).toHaveText('silence.wav');
  });

  test('Clear returns to the empty/dropzone state to load a different file (#206)', async () => {
    await window.locator('.mode-tab[data-mode="reportcard"]').click();
    // A prior test already produced a report card, which hides the dropzone
    // behind #rc-content — load this file directly via the globals (see
    // loadAndAnalyze) so the card is guaranteed on screen.
    const fixturePath = path.join(__dirname, '..', 'fixtures', 'silence.wav');
    await loadAndAnalyze(window, fixturePath);
    await expect(window.locator('#rc-content')).toBeVisible();
    await expect(window.locator('#rc-empty')).toBeHidden();

    // The Clear control is only meaningful once a card is showing — it's
    // disabled in the empty state and enabled alongside Export PDF here.
    const clearBtn = window.locator('#reportcard-clear-btn');
    await expect(clearBtn).toBeVisible();
    await expect(clearBtn).toBeEnabled();

    await clearBtn.click();

    // Clear flips the card back to the empty/dropzone state, so the next file
    // can be loaded in-window without File > Open File… (#206).
    await expect(window.locator('#rc-empty')).toBeVisible();
    await expect(window.locator('#rc-content')).toBeHidden();
    await expect(window.locator('#file-dropzone')).toContainText('Drop audio file here');
    await expect(window.locator('#analyze-btn')).toBeDisabled();
    // The toolbar controls reset too — Clear is a no-op without a card, and
    // there's nothing to print from the empty state.
    await expect(clearBtn).toBeDisabled();
    await expect(window.locator('#reportcard-print-btn')).toBeDisabled();
  });

  test('Clear does not resurrect a stale live-capture card from an earlier session (#206)', async () => {
    // Simulate a finished live-capture session: a 'window' tick (not just a
    // meter tick) is what accumulates into the liveWindows buffer that backs
    // the live report card fallback.
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('live-event', {
        type: 'window',
        window: 1,
        channels: [{
          name: 'Vocals', rms: -18, peak: -6, clipping: false, centroid: 2400,
          bands: { sub_bass: -58, bass: -30, low_mid: -24, mid: -12, high_mid: -20, presence: -28, brilliance: -80 },
        }],
      });
    });

    await window.locator('.mode-tab[data-mode="reportcard"]').click();
    const fixturePath = path.join(__dirname, '..', 'fixtures', 'silence.wav');
    await loadAndAnalyze(window, fixturePath);
    await expect(window.locator('#rc-content')).toBeVisible();

    await window.locator('#reportcard-clear-btn').click();

    // Without resetting the stale liveWindows buffer, getReportCardSource()
    // falls through to the old live window and #rc-content stays showing
    // (with a "Live capture — …" filename) instead of the empty state.
    await expect(window.locator('#rc-empty')).toBeVisible();
    await expect(window.locator('#rc-content')).toBeHidden();
  });
});
