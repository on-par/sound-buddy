import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchElectron } from './launch-electron';
import * as path from 'path';
import * as fs from 'fs';
import { NO_TRIAL_ENV, makeLicenseKey, seedProLicense } from './license-fixture';

// Purchase-path smoke test (#140): proves the app-side "money-in → access-out"
// funnel is wired correctly end to end. checkout.test.ts unit-tests
// checkoutUrl() in isolation and momentum.spec.ts stubs the open-checkout IPC
// handler to assert the plan is forwarded — neither drives the *real* handler
// (app/electron/main.ts's `open-checkout`) all the way to shell.openExternal.
// This spec launches with env-override checkout URLs set and spies on the real
// shell.openExternal, so each upgrade CTA is proven to open the env-configured
// URL (never the hardcoded DEFAULT_URLS placeholder) — plus that a pasted
// license key unlocks Pro without a restart. The live-sandbox app leg (a real
// Stripe-minted key, blocked by #116) is a manual pre-launch gate — see the PR
// body. The #56 describe block re-runs the real handler against a stored key
// whose subscription has lapsed past grace, proving the momentum CTA deep-links
// with the customer's email pre-filled (`?prefilled_email=...`).

const MAIN = path.join(__dirname, '..', 'dist', 'electron', 'main.js');
const USER_DATA = path.join(__dirname, '..', 'test-results', 'purchase-path-userdata');
const PREFILL_USER_DATA = path.join(__dirname, '..', 'test-results', 'purchase-path-prefill-userdata');

const CHECKOUT_ENV = {
  SOUND_BUDDY_CHECKOUT_MONTHLY_URL: 'https://sandbox.test/checkout/monthly-smoke',
  SOUND_BUDDY_CHECKOUT_ANNUAL_URL: 'https://sandbox.test/checkout/annual-smoke',
};

const PLACEHOLDER_URLS = [
  'https://buy.stripe.com/sound-buddy-pro-monthly',
  'https://buy.stripe.com/sound-buddy-pro-annual',
];

// Same clipping-forces-grade-F payload as momentum.spec.ts, so the report card
// (and thus the upgrade-momentum card whose CTAs this spec clicks) renders
// without sox/ffprobe/python.
const FAKE_ANALYSIS = {
  filePath: '/fake/purchase-path.wav',
  sox: { rmsDbfs: -18, peakDbfs: -0.5, dynamicRangeDb: 12, clipping: true },
  ffprobe: { format: { filename: '/fake/purchase-path.wav' } },
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

async function launch(userDataDir: string = USER_DATA): Promise<void> {
  app = await launchElectron({
    args: [MAIN, `--user-data-dir=${userDataDir}`],
    env: { ...process.env, ...NO_TRIAL_ENV, ...CHECKOUT_ENV },
  });
  win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('#license-badge')).toHaveText(/FREE|PRO/);

  // Stub the analyzer so a report card renders anywhere (no media tools).
  await app.evaluate(({ ipcMain }, analysis) => {
    ipcMain.removeHandler('analyze-file');
    ipcMain.handle('analyze-file', () => ({ success: true, data: analysis }));
  }, FAKE_ANALYSIS);

  // Spy on the real shell.openExternal (do NOT stub the open-checkout IPC
  // handler — the point is to exercise the production handler at main.ts's
  // `open-checkout`, which calls shell.openExternal(checkoutUrl(plan))).
  await app.evaluate(({ shell }) => {
    (globalThis as Record<string, unknown>).__openedUrls = [];
    shell.openExternal = ((url: string) => {
      ((globalThis as Record<string, unknown>).__openedUrls as string[]).push(url);
      return Promise.resolve();
    }) as typeof shell.openExternal;
  });
}

async function analyzeAndOpenReportCard(): Promise<void> {
  await win.locator('.mode-tab[data-mode="reportcard"]').click();
  // This spec tests checkout, not the #296 first-reveal hold — pre-seed the
  // flag so the upgrade card's CTAs are clickable without waiting out the
  // softened first-result delay.
  await win.evaluate(() => localStorage.setItem('sb-first-report-seen-at', String(Date.now() - 1000)));
  await win.evaluate(() => {
    (window as unknown as { loadFile: (p: string) => void }).loadFile('/fake/purchase-path.wav');
  });
  await expect(win.locator('#analyze-btn')).toBeEnabled();
  await win.locator('#analyze-btn').click();
  await expect(win.locator('#rc-content')).toBeVisible();
}

async function openedUrls(): Promise<string[]> {
  return app.evaluate(() => (globalThis as Record<string, unknown>).__openedUrls as string[]);
}

test.describe.serial('Purchase path smoke test (#140)', () => {
  test.beforeAll(async () => {
    fs.rmSync(USER_DATA, { recursive: true, force: true });
    await launch();
    await analyzeAndOpenReportCard();
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test('every rendered upgrade CTA maps to a known CheckoutPlan', async () => {
    const plans = await win.locator('#rcu-cta [data-checkout-plan]').evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-checkout-plan')),
    );
    expect(plans.length).toBeGreaterThan(0);
    for (const plan of plans) {
      expect(['monthly', 'annual']).toContain(plan);
    }
  });

  test('monthly CTA opens the env-override checkout URL, never the placeholder', async () => {
    await win.locator('#rcu-cta [data-checkout-plan="monthly"]').click();
    await expect.poll(openedUrls).toContain(CHECKOUT_ENV.SOUND_BUDDY_CHECKOUT_MONTHLY_URL);
    const urls = await openedUrls();
    for (const placeholder of PLACEHOLDER_URLS) {
      expect(urls).not.toContain(placeholder);
    }
  });

  test('annual CTA opens the env-override checkout URL, never the placeholder', async () => {
    await win.locator('#rcu-cta [data-checkout-plan="annual"]').click();
    await expect.poll(openedUrls).toContain(CHECKOUT_ENV.SOUND_BUDDY_CHECKOUT_ANNUAL_URL);
    const urls = await openedUrls();
    for (const placeholder of PLACEHOLDER_URLS) {
      expect(urls).not.toContain(placeholder);
    }
  });

  test('a pasted Pro key unlocks all Pro features without a restart', async () => {
    // Fixture-signed key stands in for a real sandbox-minted key here — the
    // live-sandbox app leg (real Checkout → real key) is a manual pre-launch
    // gate blocked by #116 (see the PR body); the Stripe/worker legs are
    // already covered by #121's worker/test/e2e/sandbox.e2e.test.ts.
    const key = makeLicenseKey({ kind: 'lifetime', email: 'pro@test.local' });
    await win.locator('#license-badge').click();
    await win.locator('#license-key-input').fill(key);
    await win.locator('#license-activate-btn').click();
    await expect(win.locator('#license-badge')).toHaveText('PRO');

    // The observable unlock: the upgrade card disappears from the still-open
    // report card, and a previously locked Pro tab loses its lock — the four
    // PRO_FEATURES themselves are entitlement-matrix's job, not this smoke test.
    await win.locator('.mode-tab[data-mode="reportcard"]').click();
    await expect(win.locator('#rc-content')).toBeVisible();
    await expect(win.locator('#rc-upgrade')).toBeHidden();
    await expect(win.locator('.mode-tab[data-mode="live"] .tab-lock')).toBeHidden();
  });
});

test.describe.serial('Purchase path smoke — prefilled email (#56)', () => {
  // A subscription key expired well past the 7-day grace period: tier resolves
  // to 'free' (momentum card shows) while the key's email claim is retained —
  // exactly the re-upgrade funnel the pre-fill targets.
  const LAPSED_EMAIL = 'lapsed@test.local';
  const PAST_GRACE_MS = 40 * 24 * 60 * 60 * 1000;

  test.beforeAll(async () => {
    fs.rmSync(PREFILL_USER_DATA, { recursive: true, force: true });
    seedProLicense(PREFILL_USER_DATA, {
      kind: 'subscription',
      email: LAPSED_EMAIL,
      expiresAt: new Date(Date.now() - PAST_GRACE_MS).toISOString(),
    });
    await launch(PREFILL_USER_DATA);
    await analyzeAndOpenReportCard();
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test('a lapsed subscriber lands in Stripe with their email pre-filled', async () => {
    // The expired-but-email-retaining key keeps the momentum card up (tier free).
    // The card's first-result hold (#296) is a 6s window from boot (the Upgrade
    // Momentum component resolves it once at mount, before the helper's
    // first-seen pre-seed lands) — wait it out like momentum.spec.ts does.
    await expect(win.locator('#rc-upgrade')).toBeVisible({ timeout: 15_000 });

    await win.locator('#rcu-cta [data-checkout-plan="monthly"]').click();
    await expect
      .poll(async () => (await openedUrls()).at(-1))
      .toBe(`${CHECKOUT_ENV.SOUND_BUDDY_CHECKOUT_MONTHLY_URL}?prefilled_email=lapsed%40test.local`);
  });
});
