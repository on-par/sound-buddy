import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { NO_TRIAL_ENV, makeLicenseKey } from './license-fixture';

// The post-report-card "Keep improving" momentum card (#58). Runs for REAL
// against an isolated --user-data-dir on the deterministic free tier
// (NO_TRIAL_ENV), with the analyze-file IPC stubbed so a report card renders
// without sox/ffprobe/python. Asserts: the card only appears beside a finished
// report card, carries the locked next-steps + both pricing CTAs + trust copy,
// "Maybe later" hides it, and going Pro mid-session removes it entirely.

const MAIN = path.join(__dirname, '..', 'dist', 'electron', 'main.js');
const USER_DATA = path.join(__dirname, '..', 'test-results', 'momentum-userdata');

// Minimal analysis payload the report card can render from. Clipping forces
// grade F (computeGrade short-circuits on clipping), so the score-aware copy is
// the "Keep improving" tone — not the celebratory A/B one — deterministically.
const FAKE_ANALYSIS = {
  filePath: '/fake/momentum.wav',
  sox: { rmsDbfs: -18, peakDbfs: -0.5, dynamicRangeDb: 12, clipping: true },
  ffprobe: { format: { filename: '/fake/momentum.wav' } },
  spectrum: {
    bands: { subBass: -20, bass: -18, lowMid: -22, mid: -16, highMid: -25, presence: -30, brilliance: -35 },
    spectralCentroid: 1200,
    curve: null,
    frames: [],
    contentType: 'speech',
  },
};

let app: ElectronApplication;
let win: Page;

async function launch(): Promise<void> {
  app = await electron.launch({
    args: [MAIN, `--user-data-dir=${USER_DATA}`],
    env: { ...process.env, ...NO_TRIAL_ENV },
  });
  win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('#license-badge')).toHaveText(/FREE|PRO/);

  // Stub the analyzer so a report card renders anywhere (no media tools).
  await app.evaluate(({ ipcMain }, analysis) => {
    ipcMain.removeHandler('analyze-file');
    ipcMain.handle('analyze-file', () => ({ success: true, data: analysis }));
  }, FAKE_ANALYSIS);
}

async function analyzeAndOpenReportCard(): Promise<void> {
  // The File tab is gone (#203) — file loading now lives in the Report Card
  // tab's empty state, which is also the default landing tab.
  await win.locator('.mode-tab[data-mode="reportcard"]').click();
  await win.evaluate(() => {
    (window as unknown as { loadFile: (p: string) => void }).loadFile('/fake/momentum.wav');
  });
  await expect(win.locator('#analyze-btn')).toBeEnabled();
  await win.locator('#analyze-btn').click();
  // No further tab click needed — runFileAnalysis flips the empty state to
  // the rendered card itself once analysis succeeds (#203).
  await expect(win.locator('#rc-content')).toBeVisible();
}

test.describe.serial('Upgrade momentum card (#58)', () => {
  test.beforeAll(() => {
    fs.rmSync(USER_DATA, { recursive: true, force: true });
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test('hidden before any analysis (never over an empty report)', async () => {
    await launch();
    await expect(win.locator('#license-badge')).toHaveText('FREE');
    await win.locator('.mode-tab[data-mode="reportcard"]').click();
    await expect(win.locator('#rc-empty')).toBeVisible();
    await expect(win.locator('#rc-upgrade')).toBeHidden();
  });

  test('appears beside the finished free report with next-steps, CTAs, trust copy', async () => {
    await analyzeAndOpenReportCard();

    // The install's first report card: the grade owns the first frame (#296)
    // — the momentum card holds back before easing in.
    const card = win.locator('#rc-upgrade');
    await expect(card).toBeHidden();
    await expect(card).toBeVisible({ timeout: 15_000 }); // 6s hold + margin

    // Score-aware heading (this mix is not an A/B, so the "Keep improving" tone).
    await expect(win.locator('#rcu-heading')).toHaveText('Keep improving');

    // The three locked next-step actions from the wireframe, each with a lock glyph.
    await expect(win.locator('#rcu-actions .rcu-action')).toHaveCount(3);
    await expect(win.locator('#rcu-actions')).toContainText('See what changed week to week');
    await expect(win.locator('#rcu-actions')).toContainText('Save this rig as your baseline');
    await expect(win.locator('#rcu-actions')).toContainText('Get ongoing coaching during live monitoring');
    await expect(win.locator('#rcu-actions .rcu-lock')).toHaveCount(3);

    // Both pricing CTAs, primary first.
    const ctas = win.locator('#rcu-cta [data-checkout-plan]');
    await expect(ctas).toHaveCount(2);
    await expect(ctas.nth(0)).toHaveText('Start for $9/mo');
    await expect(ctas.nth(0)).toHaveAttribute('data-checkout-plan', 'monthly');
    await expect(ctas.nth(1)).toHaveText('Best value $79/yr');
    await expect(ctas.nth(1)).toHaveAttribute('data-checkout-plan', 'annual');

    // Trust copy naming both the own-provider and local-Ollama paths.
    await expect(win.locator('#rcu-trust')).toContainText('own AI provider');
    await expect(win.locator('#rcu-trust')).toContainText('Ollama');
  });

  test('second and later report cards show the invitation immediately (#296)', async () => {
    // The prior test's first-value moment wrote the first-seen flag.
    expect(await win.evaluate(() => localStorage.getItem('sb-first-report-seen-at'))).not.toBeNull();

    // Clear back to the empty state (where the dropzone/Analyze button live)
    // and re-analyze to render a second report card. Read the upgrade card's
    // hidden state right after #rc-content becomes visible — both flip in
    // the same synchronous render, so there's no polling window in which the
    // delayed (first-result) path could false-pass.
    await win.locator('#reportcard-clear-btn').click();
    await expect(win.locator('#rc-empty')).toBeVisible();
    await analyzeAndOpenReportCard();
    expect(await win.evaluate(() => document.getElementById('rc-upgrade')?.hidden)).toBe(false);
  });

  test('clicking a CTA opens hosted checkout (external), not a modal wall', async () => {
    // Stub open-checkout so no real browser opens; assert the plan is forwarded.
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('open-checkout');
      ipcMain.handle('open-checkout', (_e, plan) => {
        (globalThis as Record<string, unknown>).__checkoutPlan = plan;
      });
    });
    await win.locator('#rcu-cta [data-checkout-plan="annual"]').click();
    await expect
      .poll(() => app.evaluate(() => (globalThis as Record<string, unknown>).__checkoutPlan))
      .toBe('annual');
  });

  test('"Maybe later" dismisses it and it stays gone on re-render', async () => {
    await win.locator('#rcu-later').click();
    await expect(win.locator('#rc-upgrade')).toBeHidden();

    // Leaving and returning to the report card keeps it dismissed. (No
    // standalone File tab to leave to anymore, #203 — any other tab works.)
    await win.locator('.mode-tab[data-mode="dir"]').click();
    await win.locator('.mode-tab[data-mode="reportcard"]').click();
    await expect(win.locator('#rc-content')).toBeVisible();
    await expect(win.locator('#rc-upgrade')).toBeHidden();
  });

  test('going Pro mid-session removes the card entirely', async () => {
    // Clear the dismissal so only the license state can hide the card now.
    await win.evaluate(() => localStorage.removeItem('sb-upgrade-momentum-dismissed-at'));

    // Activate a real (fixture-signed) Pro key — unlocks without a restart.
    const key = makeLicenseKey({ kind: 'lifetime', email: 'pro@test.local' });
    await win.locator('#license-badge').click();
    await win.locator('#license-key-input').fill(key);
    await win.locator('#license-activate-btn').click();
    await expect(win.locator('#license-badge')).toHaveText('PRO');

    // Even with a rendered report card and no dismissal, a Pro user never sees it.
    await win.locator('.mode-tab[data-mode="reportcard"]').click();
    await expect(win.locator('#rc-content')).toBeVisible();
    await expect(win.locator('#rc-upgrade')).toBeHidden();
  });
});
