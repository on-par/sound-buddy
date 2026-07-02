import { test, type ElectronApplication, type Page } from '@playwright/test';
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
    env: { ...process.env, SB_LOG_FILE: LOG_FILE },
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
  // 1. Tab navigation
  for (const mode of ['file', 'dir', 'live', 'reportcard', 'file']) {
    await win.locator(`.mode-tab[data-mode="${mode}"]`).click();
    await win.waitForTimeout(120);
  }

  // 2. Load + analyze a real fixture (real sox/ffprobe/python — surfaces missing tools)
  const fixture = path.join(__dirname, 'fixtures', 'silence.wav');
  await win.evaluate((fp) => (window as unknown as { loadFile: (p: string) => void }).loadFile(fp), fixture);
  await win.locator('#analyze-btn').click().catch(() => {});
  await win.waitForTimeout(2500);

  // 3. AI analysis (no API key → should warn+degrade gracefully, not crash)
  await win.locator('#ai-analyze-btn').click().catch(() => {});
  await win.waitForTimeout(1200);

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
});
