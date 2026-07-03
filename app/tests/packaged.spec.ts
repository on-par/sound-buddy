import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// Launches the REAL packaged .app (extracted from the release zip) with a
// scrubbed PATH — no Homebrew, no system python — to prove the self-contained
// bundle (sox/ffprobe/python) works on a clean machine.
test('packaged app analyzes a file with no external tools on PATH', async () => {
  // Extracting a ~236MB zip + first-run numba JIT is well past the 30s default.
  test.setTimeout(180_000);
  const releaseDir = path.join(__dirname, '..', 'release');
  const zipName = fs.existsSync(releaseDir)
    ? fs.readdirSync(releaseDir).find((f) => f.endsWith('-arm64-mac.zip'))
    : undefined;
  test.skip(!zipName, 'release zip not built');
  const zip = path.join(releaseDir, zipName as string);

  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-packaged-'));
  execSync(`ditto -xk "${zip}" "${workdir}"`);
  const exe = path.join(workdir, 'Sound Buddy.app', 'Contents', 'MacOS', 'Sound Buddy');

  const mainOut: string[] = [];
  const app: ElectronApplication = await electron.launch({
    executablePath: exe,
    args: [],
    // Clean-machine PATH: only the OS defaults, nothing from Homebrew.
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: process.env.HOME || os.homedir() },
  });
  app.process().stdout?.on('data', (d) => mainOut.push(d.toString()));
  app.process().stderr?.on('data', (d) => mainOut.push(d.toString()));

  const win: Page = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  const fixture = path.join(__dirname, 'fixtures', 'silence.wav');
  await win.evaluate((fp) => (window as unknown as { loadFile: (p: string) => void }).loadFile(fp), fixture);
  await win.locator('#analyze-btn').click();

  // Report card should populate with a grade — proves sox+ffprobe+python all ran.
  await win.waitForSelector('#reportcard-grade, .grade-badge, [data-grade]', { timeout: 20_000 }).catch(() => {});
  await win.waitForTimeout(3000);

  const joined = mainOut.join('');
  await app.close();
  fs.rmSync(workdir, { recursive: true, force: true });

  expect(joined).toContain('analyze-file ok');
  expect(joined).not.toContain('ENOENT');
});
