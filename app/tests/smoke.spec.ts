import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

// Instrumented smoke run: launches the REAL app (no IPC stubs) and exercises
// every flow so genuine runtime/environment errors surface, capturing renderer
// console errors, uncaught page errors, and main-process stdout/stderr.

const LOG_FILE = process.env.SB_LOG_FILE || path.join(__dirname, '..', 'test-results', 'sound-buddy.log');

test('smoke: exercise all flows and collect errors', async () => {
  const rendererErrors: string[] = [];
  const rendererWarnings: string[] = [];
  const pageErrors: string[] = [];
  const mainOut: string[] = [];

  const app: ElectronApplication = await electron.launch({
    args: [path.join(__dirname, '..', 'dist', 'electron', 'main.js')],
    // Suppress the first-run onboarding overlay (#69) so its scrim doesn't
    // intercept the tab/analyze clicks this smoke run makes on a fresh profile.
    env: { ...process.env, SB_LOG_FILE: LOG_FILE, SOUND_BUDDY_DISABLE_ONBOARDING: '1' },
  });

  // Main-process stdout/stderr
  app.process().stdout?.on('data', (d) => mainOut.push(`[main:out] ${d.toString().trim()}`));
  app.process().stderr?.on('data', (d) => mainOut.push(`[main:err] ${d.toString().trim()}`));

  const win: Page = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  win.on('console', (msg) => {
    const loc = msg.location();
    const where = `${loc.url.split('/').pop()}:${loc.lineNumber}`;
    if (msg.type() === 'error') rendererErrors.push(`${msg.text()} (${where})`);
    else if (msg.type() === 'warning') rendererWarnings.push(`${msg.text()} (${where})`);
  });
  win.on('pageerror', (err) => pageErrors.push(`${err.name}: ${err.message}`));

  // ── Exercise flows ───────────────────────────────────────────────────────
  // 1. Tab navigation (no standalone File tab anymore — its dropzone lives on
  // the Report Card tab, which is the default landing tab, #203).
  for (const mode of ['dir', 'live', 'reportcard']) {
    await win.locator(`.mode-tab[data-mode="${mode}"]`).click();
    await win.waitForTimeout(120);
  }

  // 2. Settings dialog (#76, #91, combined into one tabbed modal by #204; the
  // AI Engineer half was removed by #657): open via the gear, switch tabs to
  // exercise tab switching (About, since AI Engineer no longer exists), close.
  await win.locator('#settings-btn').click();
  await win.waitForTimeout(600);
  await win.locator('#settings-tab-btn-about').click();
  await win.waitForTimeout(120);
  await win.locator('#settings-dialog-cancel').click();

  // 3. Load + analyze a real fixture (real sox/ffprobe/python — surfaces missing tools)
  const fixture = path.join(__dirname, 'fixtures', 'silence.wav');
  await win.evaluate((fp) => (window as unknown as { loadFile: (p: string) => void }).loadFile(fp), fixture);
  await win.locator('#analyze-btn').click().catch(() => {});
  await win.waitForTimeout(2500);

  // 4. Report card render
  await win.locator('.mode-tab[data-mode="reportcard"]').click();
  await win.waitForTimeout(400);

  // 5. Live: enumerate devices (real python stream.py)
  await win.locator('.mode-tab[data-mode="live"]').click();
  await win.waitForTimeout(1500);

  await app.close();

  // ── Report ────────────────────────────────────────────────────────────────
  const section = (title: string, items: string[]) =>
    `\n=== ${title} (${items.length}) ===\n${items.length ? items.join('\n') : '(none)'}`;

  const report =
    section('RENDERER ERRORS', rendererErrors) +
    section('PAGE ERRORS (uncaught)', pageErrors) +
    section('RENDERER WARNINGS', rendererWarnings) +
    section('MAIN PROCESS OUTPUT', mainOut);

  console.log(report);
  if (fs.existsSync(LOG_FILE)) {
    console.log(`\n=== LOG FILE: ${LOG_FILE} ===\n${fs.readFileSync(LOG_FILE, 'utf8')}`);
  } else {
    console.log(`\n=== LOG FILE: ${LOG_FILE} === (not created!)`);
  }

  // ── Gate ────────────────────────────────────────────────────────────────
  // The report above prints first (even on failure), so the cause is always
  // visible. Now turn the collected errors into a hard gate: a genuinely
  // broken pipeline must fail the smoke run, not just log.
  //
  // Fires locally via ./scripts/verify.sh — NOT in CI, which runs Vitest, not
  // Playwright (see scripts/verify.sh + CLAUDE.md).
  //
  // The happy-path run on silence.wav produces zero renderer/page errors, so we
  // assert strictly empty — no allowlist. Handled error states (e.g. analysis
  // error surfaces #148/#125) log to the renderer as warnings or are caught,
  // not emitted as console errors, so they don't trip this gate. If a
  // known-benign renderer error ever appears, add a narrow, inline-documented
  // allowlist filter here rather than loosening the assertion. Warnings and
  // main-process stdout stay log-only (too noisy).
  expect(pageErrors, 'uncaught page errors during smoke run').toEqual([]);
  expect(rendererErrors, 'renderer console errors during smoke run').toEqual([]);
});
