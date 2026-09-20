import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import * as path from 'path';
import { launchApp, loadAndAnalyze, LOW_GAIN_ANALYSIS, CLIPPING_ANALYSIS } from './e2e-helpers';

// Reproduces #1484: a long amber recording-type note ("Low Recording Gain —
// Mix is fine but USB record level is low. Raise console USB output toward
// -18 dBFS RMS.") used to render on one unbreakable line inheriting
// white-space:nowrap from the bare .pill rule, blow past .rc-rectype's
// max-width, and get chopped off by #reportcard-view's overflow:hidden with
// no ellipsis and no tooltip. This drives real recording-type analyses
// through the report card and measures real overflow + real computed styles
// in Chromium — the styles.test.ts source-order guard cannot see either.
//
// Fully IPC-stubbed via launchApp/analyze-file (no sox/ffprobe/python, no
// packaged .app), so it is deliberately NOT added to playwright.config.ts's
// MEDIA_SPECS and still runs under SB_E2E_STUBBED_ONLY=1 CI.

let electronApp: ElectronApplication;
let window: Page;
const fixturePath = () => path.join(__dirname, '..', 'fixtures', 'silence.wav');

async function showReportCard(w: Page, app: ElectronApplication, analysis: unknown) {
  await app.evaluate(({ ipcMain }, data) => {
    ipcMain.removeHandler('analyze-file');
    ipcMain.handle('analyze-file', () => ({ success: true, data }));
  }, analysis);
  await w.locator('.mode-tab[data-mode="reportcard"]').click();
  await loadAndAnalyze(w, fixturePath());
  await expect(w.locator('#rc-content')).toBeVisible();
}

// Every .rc-rectype pill on screen: horizontal overflow, and whether its right
// edge is still inside #rc-scroll's box (which #reportcard-view clips).
async function rectypeBoxes(w: Page) {
  return w.locator('.rc-rectype').evaluateAll((els) => {
    const scroller = document.querySelector('#rc-scroll') as HTMLElement;
    return els.map((raw) => {
      const el = raw as HTMLElement;
      return {
        id: el.id || el.className,
        overflowX: el.scrollWidth - el.clientWidth,
        withinScroller: el.getBoundingClientRect().right <= scroller.getBoundingClientRect().right + 1,
      };
    });
  });
}

test.describe('Report Card rectype pills wrap instead of clipping (#1484)', () => {
  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp());
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test('the Low Recording Gain pill shows its full note without clipping', async () => {
    await showReportCard(window, electronApp, LOW_GAIN_ANALYSIS);
    await expect(window.locator('#rc-rec-type')).toContainText('Low Recording Gain');
    await expect(window.locator('#rc-rec-type')).toContainText(
      'Raise console USB output toward -18 dBFS RMS.',
    );

    const boxes = await rectypeBoxes(window);
    expect(boxes.length).toBeGreaterThan(0);
    for (const b of boxes) {
      expect(b.overflowX, `${b.id} overflowed horizontally`).toBeLessThanOrEqual(1);
      expect(b.withinScroller, `${b.id} extended past #rc-scroll`).toBe(true);
    }

    const box = await window.locator('#rc-rec-type').evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        paddingTop: cs.paddingTop,
        paddingLeft: cs.paddingLeft,
        columnGap: cs.columnGap,
        whiteSpace: cs.whiteSpace,
      };
    });
    expect(box).toEqual({ paddingTop: '5px', paddingLeft: '12px', columnGap: '8px', whiteSpace: 'normal' });

    // A fresh analysis (loadAndAnalyze) always populates scoreRows, so the
    // report card renders #rc-metric-rows' <details>/<summary> markup, not
    // the #rc-metrics-body table (that only appears for history cards) — see
    // ReportCardIsland.tsx's isHistoryCard branch. Both paths share the same
    // statusPillHTML() output, so the .pill.sm assertion still covers it.
    const sm = await window.locator('#rc-metric-rows .pill.sm').first().evaluate((el) => {
      const cs = getComputedStyle(el);
      return { whiteSpace: cs.whiteSpace, paddingTop: cs.paddingTop, paddingLeft: cs.paddingLeft };
    });
    expect(sm).toEqual({ whiteSpace: 'nowrap', paddingTop: '2px', paddingLeft: '8px' });
  });

  test('the issue-tone Clipping pill does not clip either', async () => {
    await showReportCard(window, electronApp, CLIPPING_ANALYSIS);
    await expect(window.locator('#rc-rec-type')).toContainText('Clipping');
    await expect(window.locator('#rc-rec-type')).toHaveClass(/issue/);

    const boxes = await rectypeBoxes(window);
    expect(boxes.length).toBeGreaterThan(0);
    for (const b of boxes) {
      expect(b.overflowX, `${b.id} overflowed horizontally`).toBeLessThanOrEqual(1);
      expect(b.withinScroller, `${b.id} extended past #rc-scroll`).toBe(true);
    }
  });
});
