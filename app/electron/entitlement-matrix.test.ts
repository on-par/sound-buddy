import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { generateKeyPairSync } from 'crypto';

// End-to-end entitlement matrix (#139): every license/trial state the app can
// resolve into, asserted against BOTH halves of the gate — getLicenseState's
// truth table AND isEntitled's per-feature gate — plus the two ACs (lifetime
// skips grace parsing entirely; expiry never re-offers a trial) and a static
// no-phone-home guardrail. license.test.ts already covers each mechanism in
// isolation; this file is the cross-cutting matrix over all eight states.
// The Playwright half (app/tests/entitlement-matrix.spec.ts) drives the same
// states through a real launch, proving the renderer and main-process gates
// agree with what's asserted here.

let userDataDir = '';
vi.mock('electron', () => ({
  app: { getPath: () => userDataDir },
  BrowserWindow: class {},
}));

import { getLicenseState, ensureTrialStarted, isEntitled, verifyLicenseKey, GRACE_DAYS } from './license';
import { signLicenseKey } from '../tests/license-fixture';

const licenseFile = () => path.join(userDataDir, 'license.json');

const { publicKey: testPub, privateKey: testPriv } = generateKeyPairSync('ed25519');

function makeKey(payload: Record<string, unknown>): string {
  return signLicenseKey(payload, testPriv);
}

const NOW = new Date('2026-07-05T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function writeStore(store: Record<string, unknown>): void {
  fs.writeFileSync(licenseFile(), JSON.stringify(store, null, 2));
}

beforeEach(() => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-entitlement-matrix-'));
  process.env.SOUND_BUDDY_LICENSE_PUBKEY = testPub
    .export({ type: 'spki', format: 'der' })
    .toString('base64');
});

afterEach(() => {
  delete process.env.SOUND_BUDDY_LICENSE_PUBKEY;
  delete process.env.SOUND_BUDDY_DISABLE_TRIAL;
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

const PRO_FEATURES = ['saved-rigs', 'live-monitoring', 'virtual-soundcheck', 'ai-narrative'];

// The eight states from the AC, and how to seed each into license.json.
type StateName =
  | 'free'
  | 'trial-day1'
  | 'trial-day13'
  | 'trial-expired'
  | 'sub-valid'
  | 'sub-grace'
  | 'sub-past-grace'
  | 'lifetime';

function seed(name: StateName): void {
  switch (name) {
    case 'free':
      process.env.SOUND_BUDDY_DISABLE_TRIAL = '1';
      break;
    case 'trial-day1':
      writeStore({ trialStartedAt: new Date(NOW.getTime() - 1 * DAY_MS).toISOString() });
      break;
    case 'trial-day13':
      writeStore({ trialStartedAt: new Date(NOW.getTime() - 13 * DAY_MS).toISOString() });
      break;
    case 'trial-expired':
      writeStore({ trialStartedAt: new Date(NOW.getTime() - 20 * DAY_MS).toISOString() });
      break;
    case 'sub-valid':
      writeStore({ key: makeKey({ kind: 'subscription', expiresAt: new Date(NOW.getTime() + 30 * DAY_MS).toISOString() }) });
      break;
    case 'sub-grace':
      writeStore({ key: makeKey({ kind: 'subscription', expiresAt: new Date(NOW.getTime() - 2 * DAY_MS).toISOString() }) });
      break;
    case 'sub-past-grace':
      writeStore({ key: makeKey({ kind: 'subscription', expiresAt: new Date(NOW.getTime() - 30 * DAY_MS).toISOString() }) });
      break;
    case 'lifetime':
      writeStore({ key: makeKey({ kind: 'lifetime' }) });
      break;
  }
}

const EXPECTED: Record<StateName, { status: string; tier: 'free' | 'pro' }> = {
  free: { status: 'none', tier: 'free' },
  'trial-day1': { status: 'trial', tier: 'pro' },
  'trial-day13': { status: 'trial', tier: 'pro' },
  'trial-expired': { status: 'trial-expired', tier: 'free' },
  'sub-valid': { status: 'valid', tier: 'pro' },
  'sub-grace': { status: 'grace', tier: 'pro' },
  'sub-past-grace': { status: 'expired', tier: 'free' },
  lifetime: { status: 'valid', tier: 'pro' },
};

describe('entitlement matrix (#139)', () => {
  describe('truth table — every license/trial state resolves as expected', () => {
    for (const name of Object.keys(EXPECTED) as StateName[]) {
      it(`${name} ⇒ status:${EXPECTED[name].status} tier:${EXPECTED[name].tier}`, () => {
        seed(name);
        const state = getLicenseState(NOW);
        expect(state.status).toBe(EXPECTED[name].status);
        expect(state.tier).toBe(EXPECTED[name].tier);
      });
    }
  });

  describe('both-halves gate — isEntitled agrees with tier for every state', () => {
    for (const name of Object.keys(EXPECTED) as StateName[]) {
      it(`${name}: the four Pro features are gated by tier, report-card always free`, () => {
        seed(name);
        const expectPro = EXPECTED[name].tier === 'pro';
        for (const feature of PRO_FEATURES) {
          expect(isEntitled(feature, NOW)).toBe(expectPro);
        }
        expect(isEntitled('report-card', NOW)).toBe(true);
      });
    }
  });

  it('lifetime skips the grace-check code path entirely (AC) — even with a 90-day-expired expiresAt', () => {
    // A lifetime key that also carries a long-past expiresAt: if any
    // expiry/grace branch ran, this would resolve to expired/free (90 days
    // is well past GRACE_DAYS). Resolving to valid/pro/no-expiresAt proves
    // license.ts returns for `kind: 'lifetime'` before any expiry parsing.
    const key = makeKey({
      kind: 'lifetime',
      expiresAt: new Date(NOW.getTime() - 90 * DAY_MS).toISOString(),
    });
    expect(90).toBeGreaterThan(GRACE_DAYS);
    const state = verifyLicenseKey(key, NOW);
    expect(state).toMatchObject({ tier: 'pro', status: 'valid' });
    expect(state.expiresAt).toBeUndefined();
  });

  it('no re-trial after expiry (AC) — ensureTrialStarted is idempotent, never restamps', () => {
    const startedAt = new Date(NOW.getTime() - 20 * DAY_MS).toISOString();
    writeStore({ trialStartedAt: startedAt });

    const state = ensureTrialStarted(NOW);
    expect(state).toMatchObject({ tier: 'free', status: 'trial-expired' });

    const stored = JSON.parse(fs.readFileSync(licenseFile(), 'utf8'));
    expect(stored.trialStartedAt).toBe(startedAt);
  });

  it('offline / no-phone-home static guardrail — license.ts resolution has no network path', () => {
    // Mirrors no-usage-caps.test.ts's static-scan style. license.ts owns
    // offline resolution only; the #117 refresh network call lives in the
    // separate license-refresh.ts (out of scope here).
    const src = fs.readFileSync(path.join(__dirname, 'license.ts'), 'utf8');
    const forbidden = ['fetch(', "require('https')", "from 'https'", "from 'http'", 'net.', 'http.request', 'https.request'];
    for (const token of forbidden) {
      expect(src.includes(token), `license.ts must not contain "${token}" — resolution must stay offline`).toBe(false);
    }
  });
});
