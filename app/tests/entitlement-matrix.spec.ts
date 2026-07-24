import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { MATRIX_ENV, MATRIX_FREE_ENV, seedTrial, seedSubscription, seedProLicense } from './license-fixture';

// End-to-end entitlement matrix (#139): every license/trial state, launched
// for REAL, asserting BOTH halves of the gate hold together — the renderer
// hides Pro features AND the main process independently re-checks entitlement
// before doing privileged work (so a patched renderer can't just flip a CSS
// class to unlock Pro) — plus a renderer-side zero-network guard for every
// state (see the caveat on the `win.on('request', ...)` hook in launch()).
// license.spec.ts / trial.spec.ts already cover the free tier, key entry, and
// trial flows interactively; this spec is the cross-cutting matrix over all
// eight states, driven directly through window.soundBuddy rather than clicks.
//
// NOTE (#402): CI now runs this Playwright spec too, via the stubbed e2e job
// (.github/workflows/ci.yml's `e2e` job / `npm run test:e2e:stubbed`) — it
// needs no real sox/ffprobe/python, so it isn't in playwright.config.ts's
// MEDIA_SPECS denylist. To run it locally / pre-release:
//   npm run build --prefix app && cd app && npx playwright test tests/entitlement-matrix.spec.ts

const MAIN = path.join(__dirname, '..', 'dist', 'electron', 'main.js');
const USER_DATA = path.join(__dirname, '..', 'test-results', 'entitlement-matrix-userdata');

let app: ElectronApplication;
let win: Page;
let requests: string[] = [];

async function launch(env: Record<string, string>): Promise<void> {
  app = await electron.launch({
    args: [MAIN, `--user-data-dir=${USER_DATA}`],
    env: { ...process.env, ...env },
  });
  win = await app.firstWindow();
  requests = [];
  // Renderer-side network guard only — Playwright's CDP hook covers the page's
  // own fetch/XHR/resource loads, NOT the Node `fetch()` #117's auto-refresh
  // makes from the Electron *main* process (license-refresh.ts's doRefresh),
  // which never surfaces as a page request here. That call is suppressed at
  // its source by MATRIX_ENV's SOUND_BUDDY_DISABLE_LICENSE_REFRESH kill-switch
  // (asserted by license-refresh.ts's own license-refresh.test.ts, not here) —
  // this listener instead catches any *other* accidental renderer-side
  // network activity (analytics, font/asset CDNs, stray XHRs) during boot.
  win.on('request', (r) => {
    const u = r.url();
    if (u.startsWith('http://') || u.startsWith('https://')) requests.push(u);
  });
  await win.waitForLoadState('domcontentloaded');
  // Boot resolves the license async; the badge is populated either way.
  await expect(win.locator('#license-badge')).toHaveText(/FREE|PRO|Pro trial/);
}

async function reseed(seed: (dir: string) => void): Promise<void> {
  if (app) await app.close();
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  seed(USER_DATA);
}

// Matches what upsertRig (app/electron/settings.ts) validates: name required,
// the rest free-form — same minimal shape rigs.spec.ts uses for a direct save.
function testRig(name: string) {
  return {
    name,
    deviceName: 'Matrix Test Device',
    channelConfig: [{ kind: 'mono', a: 0, b: 0 }],
    mode: 'monitor',
    recordDir: '',
    intervalMs: 100,
    windowSecs: 5,
  };
}

async function assertRendererGated(): Promise<void> {
  await expect(win.locator('#license-badge')).toHaveText('FREE');
  await expect(win.locator('body')).toHaveClass(/not-pro/);
  await expect(win.locator('.mode-tab[data-mode="live"] .tab-lock')).toBeVisible();
  await expect(win.locator('.mode-tab[data-mode="soundcheck"] .tab-lock')).toBeVisible();

  await win.locator('.mode-tab[data-mode="live"]').click();
  await expect(win.locator('#tab-live .pro-gate')).toBeVisible();
  await expect(win.locator('#live-start-btn')).toBeHidden();

  await win.locator('.mode-tab[data-mode="soundcheck"]').click();
  await expect(win.locator('#tab-soundcheck .pro-gate')).toBeVisible();
  await expect(win.locator('#sc-play-btn')).toBeHidden();

  // The free funnel is untouched: report card stays reachable.
  await win.locator('.mode-tab[data-mode="reportcard"]').click();
  await expect(win.locator('#reportcard-view')).toBeVisible();
}

async function assertRendererUngated(badgeText: string): Promise<void> {
  await expect(win.locator('#license-badge')).toHaveText(badgeText);
  await expect(win.locator('body')).not.toHaveClass(/not-pro/);
  await expect(win.locator('.mode-tab[data-mode="live"] .tab-lock')).toBeHidden();

  await win.locator('.mode-tab[data-mode="live"]').click();
  await expect(win.locator('#live-start-btn')).toBeVisible();
}

// Drives all three main-process gates to their reject boundary via
// window.soundBuddy — proves the gate holds even though the renderer's UI is
// only asserted separately (a patched renderer can't bypass this half).
async function assertMainProcessRejectsAllGates(): Promise<void> {
  await expect(
    win.evaluate((rig) => (window as any).soundBuddy.saveRig(rig), testRig('should-reject')),
  ).rejects.toThrow(/Pro license/);

  const live = await win.evaluate(() =>
    (window as any).soundBuddy.startLive({ windowSecs: 1, llmIntervalSecs: 5 }),
  );
  expect(live.success).toBe(false);
  expect(live.error).toMatch(/Pro license/);

  const playback = await win.evaluate(() =>
    (window as any).soundBuddy.startPlayback({ sessionDir: '/tmp/nope' }),
  );
  expect(playback.success).toBe(false);
  expect(playback.error).toMatch(/Pro license/);
}

// The one cleanly-testable privileged allow-path — saveRig, no subprocess or
// provider needed. The other two Pro features (live-monitoring,
// virtual-soundcheck) spawn subprocesses when entitled, so their positive
// (entitled ⇒ allowed) case is covered by the Vitest isEntitled truth table
// (electron/entitlement-matrix.test.ts), not driven live here.
async function assertMainProcessAllowsSaveRig(label: string): Promise<void> {
  const name = `Matrix Rig — ${label}`;
  await win.evaluate((rig) => (window as any).soundBuddy.saveRig(rig), testRig(name));
  const rigs = await win.evaluate(() => (window as any).soundBuddy.listRigs());
  expect(rigs.some((r: any) => r.name === name)).toBe(true);
}

const NON_PRO_STATES: Array<{ label: string; env: Record<string, string>; seed: (dir: string) => void }> = [
  { label: 'free', env: MATRIX_FREE_ENV, seed: () => {} },
  { label: 'trial-expired', env: MATRIX_ENV, seed: (dir) => seedTrial(dir, 20) },
  { label: 'sub-past-grace', env: MATRIX_ENV, seed: (dir) => seedSubscription(dir, -30) },
];

test.describe.serial('Entitlement matrix (#139) — non-Pro states', () => {
  test.beforeAll(() => {
    fs.rmSync(USER_DATA, { recursive: true, force: true });
  });
  test.afterAll(async () => {
    await app?.close();
  });

  for (const state of NON_PRO_STATES) {
    test(`${state.label}: renderer gated, all three main-process gates reject, zero network calls`, async () => {
      await reseed(state.seed);
      await launch(state.env);

      await assertRendererGated();
      await assertMainProcessRejectsAllGates();

      expect(requests).toEqual([]);
    });
  }
});

const PRO_STATES: Array<{
  label: string;
  env: Record<string, string>;
  seed: (dir: string) => void;
  badge: string;
  banner?: 'visible' | 'hidden';
}> = [
  { label: 'trial-day1', env: MATRIX_ENV, seed: (dir) => seedTrial(dir, 1), badge: 'Pro trial — 13 days left' },
  { label: 'trial-day13', env: MATRIX_ENV, seed: (dir) => seedTrial(dir, 13), badge: 'Pro trial — 1 day left' },
  { label: 'sub-valid', env: MATRIX_ENV, seed: (dir) => seedSubscription(dir, 365), badge: 'PRO' },
  { label: 'sub-grace', env: MATRIX_ENV, seed: (dir) => seedSubscription(dir, -2), badge: 'PRO · GRACE', banner: 'visible' },
  { label: 'lifetime', env: MATRIX_ENV, seed: (dir) => seedProLicense(dir), badge: 'PRO', banner: 'hidden' },
];

test.describe.serial('Entitlement matrix (#139) — Pro states', () => {
  test.beforeAll(() => {
    fs.rmSync(USER_DATA, { recursive: true, force: true });
  });
  test.afterAll(async () => {
    await app?.close();
  });

  for (const state of PRO_STATES) {
    test(`${state.label}: renderer ungated, saveRig allowed, zero network calls`, async () => {
      await reseed(state.seed);
      await launch(state.env);

      await assertRendererUngated(state.badge);
      if (state.banner === 'visible') await expect(win.locator('#license-banner')).toBeVisible();
      if (state.banner === 'hidden') await expect(win.locator('#license-banner')).toBeHidden();

      await assertMainProcessAllowsSaveRig(state.label);

      expect(requests).toEqual([]);
    });
  }
});
