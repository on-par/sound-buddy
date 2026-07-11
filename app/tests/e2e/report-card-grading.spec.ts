import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import * as path from 'path';
import {
  launchApp,
  loadAndAnalyze,
  FAKE_ANALYSIS,
  WORSHIP_SERVICE_ANALYSIS,
  WORSHIP_MUSIC_ANALYSIS,
  DEDUCTING_ANALYSIS,
  SHORT_ANALYSIS,
} from './e2e-helpers';

// Final slice of the former e2e.spec.ts "Sound Buddy E2E" describe (#225):
// the report card's grade/why/recommendations rendering, the worship-service
// content-type handling, and the ideal-curve overlay. Several of these tests
// deliberately build on the state left by the one before (matching the
// original file's order) — keep them in this order and in this one file.

let electronApp: ElectronApplication;
let window: Page;
const fixturePath = () => path.join(__dirname, '..', 'fixtures', 'silence.wav');

test.describe('Sound Buddy E2E — report card grading', () => {
  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp());
  });

  test.afterAll(async () => {
    await electronApp.close();
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
    // This file runs standalone (its own Electron session), so — unlike the
    // original single-session file, where the prior "playback transport"
    // describe left the default FAKE_ANALYSIS loaded — load it explicitly here.
    await loadAndAnalyze(window, fixturePath());
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

    await window.locator('.mode-tab[data-mode="reportcard"]').click();
    await loadAndAnalyze(window, fixturePath());

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
    await loadAndAnalyze(window, fixturePath());
  });

  test('worship service recordings avoid the false quiet report-card verdict', async () => {
    await electronApp.evaluate(({ ipcMain }, analysis) => {
      ipcMain.removeHandler('analyze-file');
      ipcMain.handle('analyze-file', () => ({ success: true, data: analysis }));
    }, WORSHIP_SERVICE_ANALYSIS);

    await window.locator('.mode-tab[data-mode="reportcard"]').click();
    await loadAndAnalyze(window, fixturePath());

    await expect(window.locator('#rc-rec-type')).toContainText('Dynamic Service');
    await expect(window.locator('#rc-rec-type')).not.toContainText('Quiet');
    await expect(window.locator('#rc-recommendations')).not.toContainText('too quiet');

    // .spectrum-legend lives in the shared spectrum panel beside the report
    // card, not a separate File tab (#203) — no navigation needed to see it.
    await expect(window.locator('.spectrum-legend')).toContainText('Worship service');

    await electronApp.evaluate(({ ipcMain }, analysis) => {
      ipcMain.removeHandler('analyze-file');
      ipcMain.handle('analyze-file', () => ({ success: true, data: analysis }));
    }, WORSHIP_MUSIC_ANALYSIS);

    await loadAndAnalyze(window, fixturePath());

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

    await window.locator('.mode-tab[data-mode="reportcard"]').click();
    await loadAndAnalyze(window, fixturePath());

    // Heatmap collapses to a single column; the scrubber still starts on average.
    await expect(window.locator('#spectrum-heatmap .hm-col')).toHaveCount(1);
    await expect(window.locator('#scrub-readout')).toHaveText('Whole-file average');

    // Report card renders with a single representative frame, no error.
    await expect(window.locator('#rc-frames-section')).toBeVisible();
    await expect(window.locator('#rc-frame-curves .rc-frame')).toHaveCount(1);
  });

  test('spectrum overlays a dashed ideal target, defaulting from content type', async () => {
    await electronApp.evaluate(({ ipcMain }, analysis) => {
      ipcMain.removeHandler('analyze-file');
      ipcMain.handle('analyze-file', () => ({ success: true, data: analysis }));
    }, FAKE_ANALYSIS);

    await window.locator('.mode-tab[data-mode="reportcard"]').click();
    await loadAndAnalyze(window, fixturePath());

    // Cycle away and back through another mode so the real analysis (with its
    // curve) is re-rendered — the prior test left the panel on the curve-less
    // meters path. 'dir' and 'reportcard' both route spectrum rendering
    // through the same syncSpectrumForMode → renderSpectrum path the old File
    // tab used, so this reproduces the original round trip now that File is
    // gone (#203).
    await window.locator('.mode-tab[data-mode="dir"]').click();
    await window.locator('.mode-tab[data-mode="reportcard"]').click();

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
    await window.locator('.mode-tab[data-mode="reportcard"]').click();

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
});
