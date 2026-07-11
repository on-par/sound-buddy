import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// The cold-start-to-first-report-card promise (#141), run for REAL against the
// packaged .app (extracted from the release zip) with a scrubbed PATH and a
// brand-new --user-data-dir — proves the onboarding overlay, the bundled
// demo.wav analysis, and the self-contained sox/ffprobe/python bundle all work
// together on what looks like a clean machine, not just in dev (onboarding.spec.ts)
// or with onboarding suppressed (packaged.spec.ts).
test('a first-run user reaches a report card from the packaged .app via the onboarding demo', async () => {
  // Extracting a ~236MB zip + first-run numba JIT is well past the 30s default.
  test.setTimeout(180_000);
  const releaseDir = path.join(__dirname, '..', 'release');
  // Sort by mtime (newest first) so a stale leftover zip from a prior build
  // never shadows the just-built one.
  const zipName = fs.existsSync(releaseDir)
    ? fs
        .readdirSync(releaseDir)
        .filter((f) => f.endsWith('-arm64-mac.zip'))
        .sort((a, b) => fs.statSync(path.join(releaseDir, b)).mtimeMs - fs.statSync(path.join(releaseDir, a)).mtimeMs)[0]
    : undefined;
  test.skip(!zipName, 'release zip not built');
  const zip = path.join(releaseDir, zipName as string);

  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-onboarding-packaged-'));
  let app: ElectronApplication | undefined;
  try {
    execSync(`ditto -xk "${zip}" "${workdir}"`);
    const exe = path.join(workdir, 'Sound Buddy.app', 'Contents', 'MacOS', 'Sound Buddy');

    const mainOut: string[] = [];
    // Brand-new profile, no sb-onboarding-seen-v1 — the overlay must show.
    const userData = path.join(workdir, 'userdata');
    app = await electron.launch({
      executablePath: exe,
      args: [`--user-data-dir=${userData}`],
      // Clean-machine PATH: only the OS defaults, nothing from Homebrew. Unlike
      // packaged.spec.ts, SOUND_BUDDY_DISABLE_ONBOARDING is intentionally omitted
      // so the welcome overlay actually appears.
      env: {
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
        HOME: process.env.HOME || os.homedir(),
      },
    });
    app.process().stdout?.on('data', (d) => mainOut.push(d.toString()));
    app.process().stderr?.on('data', (d) => mainOut.push(d.toString()));

    const win: Page = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    const dialog = win.locator('#onboarding-dialog');
    await expect(dialog).toBeVisible();
    await expect(win.locator('#onboarding-title')).toHaveText('Welcome to Sound Buddy');
    const runBtn = win.locator('#onboarding-run');
    await expect(runBtn).toHaveText(/Run your first analysis/);

    await runBtn.click();
    await expect(win.locator('#onboarding-progress')).toBeVisible();

    // First packaged run pays numba JIT cost; onboarding.spec.ts uses 20s
    // against dev, so bump to 60s here.
    await expect(win.locator('#reportcard-view')).toHaveClass(/active/, { timeout: 60_000 });
    await expect(win.locator('#rc-content')).toBeVisible();
    // Proves it graded the bundled demo.wav, not a fallback.
    await expect(win.locator('#rc-filename')).toHaveText('demo.wav');

    await expect(dialog).toBeHidden();

    const joined = mainOut.join('');
    expect(joined).toContain('analyze-file ok');
    expect(joined).not.toContain('ENOENT');
  } finally {
    await app?.close();
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});
