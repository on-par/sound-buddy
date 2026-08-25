import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { generateKeyPairSync } from 'crypto';

// Point Electron's userData at a per-test temp dir (same harness as
// license.test.ts) — isPackaged is omitted so `!app.isPackaged` is true and
// the dev-only env overrides below are honored.
let userDataDir = '';
vi.mock('electron', () => ({
  app: { getPath: () => userDataDir },
  BrowserWindow: class {},
}));

import {
  verifyLicenseKey,
  activateLicense,
  getLicenseState,
  isEntitled,
  getStoredKey,
  GRACE_DAYS,
} from './license';
import { signLicenseKey } from '../tests/license-fixture';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-07-05T12:00:00Z');
const PRO_FEATURES = ['saved-rigs', 'live-monitoring', 'virtual-soundcheck', 'ai-narrative'];

const { publicKey: testPub, privateKey: testPriv } = generateKeyPairSync('ed25519');
const { privateKey: wrongPriv } = generateKeyPairSync('ed25519');

beforeEach(() => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-lic-accept-'));
  process.env.SOUND_BUDDY_LICENSE_PUBKEY = testPub.export({ type: 'spki', format: 'der' }).toString('base64');
  process.env.SOUND_BUDDY_DISABLE_TRIAL = '1'; // deterministic free tier (no 14-day Pro trial)
});

afterEach(() => {
  delete process.env.SOUND_BUDDY_LICENSE_PUBKEY;
  delete process.env.SOUND_BUDDY_DISABLE_TRIAL;
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

/** Pins #1188's acceptance criteria (a valid key unlocks Pro, an invalid key is
 * rejected with an actionable message and stays locked, the free tier stays
 * usable with Pro visibly locked) against the shipped license.ts surface. */
describe('#1188 license key validation and feature gating — acceptance', () => {
  describe('AC1 — a valid key unlocks Pro immediately', () => {
    it('a lifetime key activates, persists, and unlocks every Pro feature', () => {
      const key = signLicenseKey({ kind: 'lifetime', email: 'a@b.co' }, testPriv);

      expect(activateLicense(key, NOW)).toMatchObject({ tier: 'pro', status: 'valid' });
      expect(getStoredKey()).toBe(key.trim());
      for (const feature of PRO_FEATURES) expect(isEntitled(feature, NOW)).toBe(true);
      // No restart required — a fresh read after activation is already Pro.
      expect(getLicenseState(NOW).tier).toBe('pro');
    });

    it('an in-date subscription key activates, persists, and unlocks every Pro feature', () => {
      const expiresAt = new Date(NOW.getTime() + 30 * DAY_MS).toISOString();
      const key = signLicenseKey({ kind: 'subscription', email: 'a@b.co', expiresAt }, testPriv);

      expect(activateLicense(key, NOW)).toMatchObject({ tier: 'pro', status: 'valid' });
      expect(getStoredKey()).toBe(key.trim());
      for (const feature of PRO_FEATURES) expect(isEntitled(feature, NOW)).toBe(true);
      expect(getLicenseState(NOW).tier).toBe('pro');
    });
  });

  describe('AC2 — an invalid key is rejected with an actionable message', () => {
    it('a wrong-signature key is rejected, not persisted, and Pro stays locked', () => {
      const key = signLicenseKey({ kind: 'lifetime', email: 'a@b.co' }, wrongPriv);

      const state = activateLicense(key, NOW);
      expect(state).toMatchObject({ tier: 'free', status: 'invalid' });
      expect(state.error).toMatch(/signature/i);
      expect(getStoredKey()).toBeUndefined();
      for (const feature of PRO_FEATURES) expect(isEntitled(feature, NOW)).toBe(false);
    });

    it('a structurally malformed key is rejected, not persisted, and Pro stays locked', () => {
      const state = activateLicense('not-a-key', NOW);
      expect(state).toMatchObject({ tier: 'free', status: 'invalid' });
      expect(state.error).toMatch(/Sound Buddy license key/);
      expect(getStoredKey()).toBeUndefined();
      for (const feature of PRO_FEATURES) expect(isEntitled(feature, NOW)).toBe(false);
    });
  });

  describe('AC3 — the free tier stays accessible with Pro locked', () => {
    it('with no key and the trial disabled, the app resolves to free/none', () => {
      expect(getLicenseState(NOW)).toEqual({ tier: 'free', status: 'none' });
    });

    it('a non-Pro feature (e.g. the report card) stays usable', () => {
      expect(isEntitled('report-card', NOW)).toBe(true);
    });

    it('every Pro feature is visibly locked', () => {
      for (const feature of PRO_FEATURES) expect(isEntitled(feature, NOW)).toBe(false);
    });
  });

  describe('expired subscription keys revert to free and stay locked', () => {
    it('a subscription past its grace window resolves to free/expired', () => {
      const expiresAt = new Date(NOW.getTime() - (GRACE_DAYS + 1) * DAY_MS).toISOString();
      const key = signLicenseKey({ kind: 'subscription', email: 'a@b.co', expiresAt }, testPriv);

      expect(verifyLicenseKey(key, NOW)).toMatchObject({ tier: 'free', status: 'expired' });
      for (const feature of PRO_FEATURES) expect(isEntitled(feature, NOW)).toBe(false);
    });
  });
});
