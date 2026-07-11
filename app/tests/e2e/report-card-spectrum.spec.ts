import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import * as path from 'path';
import { launchApp, loadAndAnalyze } from './e2e-helpers';

// Second slice of the former e2e.spec.ts (#225): the spectrum panel rendered
// alongside the report card, and the time-sampled heatmap scrubber. The first
// test loads the fixture itself; the rest deliberately build on that same
// loaded state within this one session (matching the original file's order),
// so keep them in this order and in this one spec file.

let electronApp: ElectronApplication;
let window: Page;

test.describe('Sound Buddy E2E — report card spectrum', () => {
  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp());
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test('report card and spectrum share one screen after analysis (#177)', async () => {
    // The post-analysis screen no longer hides the spectrum for the report card:
    // with the Report Card tab active, both the spectrum curve and the report
    // card content are visible simultaneously — no tab switch to see one or the
    // other. The Source panel folds away (body.rc-active) so both get room.
    await window.locator('.mode-tab[data-mode="reportcard"]').click();
    const fixturePath = path.join(__dirname, '..', 'fixtures', 'silence.wav');
    await loadAndAnalyze(window, fixturePath);

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
    await window.locator('.mode-tab[data-mode="reportcard"]').click();

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
    await window.locator('.mode-tab[data-mode="reportcard"]').click();

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
    await window.locator('.mode-tab[data-mode="reportcard"]').click();

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

  test('scrubbed frame survives leaving and returning to the report card tab', async () => {
    await window.locator('.mode-tab[data-mode="reportcard"]').click();
    await window.locator('#spectrum-heatmap').click({ position: { x: 20, y: 40 } });
    const scrubbed = await window.locator('#scrub-readout').textContent();
    expect(scrubbed).toContain('t =');

    // Round-trip through another tab and back — the selection must persist.
    await window.locator('.mode-tab[data-mode="dir"]').click();
    await window.locator('.mode-tab[data-mode="reportcard"]').click();
    await expect(window.locator('#scrub-readout')).toHaveText(scrubbed!.trim());
    await expect(window.locator('#spectrum-heatmap .hm-col.sel')).toHaveCount(1);

    // Reset so later tests start from the average state.
    await window.locator('#scrub-reset').click();
    await expect(window.locator('#scrub-readout')).toHaveText('Whole-file average');
  });
});
