import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { generateKeyPairSync } from 'crypto';

// Point Electron's userData at a per-test temp dir (same harness as
// licensing-acceptance.test.ts) — isPackaged is omitted so `!app.isPackaged`
// is true and the dev-only env overrides below are honored.
let userDataDir = '';
vi.mock('electron', () => ({
  app: { getPath: () => userDataDir },
  BrowserWindow: class {},
}));

import {
  ensureTrialStarted,
  getLicenseState,
  isEntitled,
  activateLicense,
  removeLicense,
  TRIAL_DAYS,
} from './license';
import { signLicenseKey } from '../tests/license-fixture';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-07-05T12:00:00Z');
const days = (n: number) => new Date(NOW.getTime() + n * DAY_MS);
const PRO_FEATURES = ['saved-rigs', 'live-monitoring', 'virtual-soundcheck', 'ai-narrative'];

const { publicKey: testPub, privateKey: testPriv } = generateKeyPairSync('ed25519');

beforeEach(() => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-trial-accept-'));
  process.env.SOUND_BUDDY_LICENSE_PUBKEY = testPub.export({ type: 'spki', format: 'der' }).toString('base64');
  // Deliberately DO NOT set SOUND_BUDDY_DISABLE_TRIAL — this suite exercises the live trial.
  delete process.env.SOUND_BUDDY_DISABLE_TRIAL;
});

afterEach(() => {
  delete process.env.SOUND_BUDDY_LICENSE_PUBKEY;
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

const licenseFile = () => path.join(userDataDir, 'license.json');
const readLicenseJson = () => JSON.parse(fs.readFileSync(licenseFile(), 'utf8'));

/** Pins #1190's acceptance criteria (trial starts on first launch and unlocks
 * all Pro features; expiry reverts to free with the upgrade signal while the
 * free report card stays accessible; no data loss / no crash on expiry)
 * against the shipped 14-day trial (#61) surface in license.ts. */
describe('#1190 14-day Pro trial — acceptance', () => {
  describe('AC1 — trial starts on first launch and unlocks all Pro features', () => {
    it('stamps trialStartedAt, grants pro/trial, and persists to license.json', () => {
      const state = ensureTrialStarted(NOW);

      expect(state).toMatchObject({ tier: 'pro', status: 'trial' });
      expect(Date.parse(state.trialEndsAt!)).toBe(NOW.getTime() + TRIAL_DAYS * DAY_MS);
      expect(readLicenseJson()).toEqual({ trialStartedAt: NOW.toISOString() });
    });

    it('entitles every Pro feature during the trial', () => {
      ensureTrialStarted(NOW);
      for (const feature of PRO_FEATURES) expect(isEntitled(feature, NOW)).toBe(true);
    });

    it('stays on the trial (Pro) late in the window', () => {
      ensureTrialStarted(NOW);
      expect(getLicenseState(days(TRIAL_DAYS - 1)).status).toBe('trial');
    });

    it('is idempotent — a second call mid-trial does not restamp', () => {
      ensureTrialStarted(NOW);
      const second = ensureTrialStarted(days(5));

      expect(readLicenseJson().trialStartedAt).toBe(NOW.toISOString());
      expect(second.status).toBe('trial');
    });
  });

  describe('AC2 — expiry reverts to free with the upgrade signal; report card stays accessible', () => {
    it('reverts to tier free / status trial-expired after TRIAL_DAYS elapse', () => {
      ensureTrialStarted(NOW);
      const after = getLicenseState(days(TRIAL_DAYS + 1));

      expect(after).toMatchObject({ tier: 'free', status: 'trial-expired' });
      expect(after.trialEndsAt).toBeDefined();
    });

    it('locks every Pro feature post-expiry', () => {
      ensureTrialStarted(NOW);
      for (const feature of PRO_FEATURES) {
        expect(isEntitled(feature, days(TRIAL_DAYS + 1))).toBe(false);
      }
    });

    it('keeps the free report card accessible post-expiry', () => {
      ensureTrialStarted(NOW);
      expect(isEntitled('report-card', days(TRIAL_DAYS + 1))).toBe(true);
    });

    it('is expired exactly at the TRIAL_DAYS boundary', () => {
      ensureTrialStarted(NOW);
      expect(getLicenseState(days(TRIAL_DAYS)).status).toBe('trial-expired');
    });
  });

  describe('AC3 — expiry preserves data and never crashes', () => {
    it('never throws crossing expiry and leaves unrelated data untouched', () => {
      fs.writeFileSync(path.join(userDataDir, 'saved-report.json'), '{"score":92}');
      ensureTrialStarted(NOW);

      expect(() => getLicenseState(days(TRIAL_DAYS + 3))).not.toThrow();
      expect(fs.readFileSync(path.join(userDataDir, 'saved-report.json'), 'utf8')).toBe('{"score":92}');
    });

    it('preserves the trial stamp and refuses to restart the clock on relaunch', () => {
      ensureTrialStarted(NOW);
      getLicenseState(days(TRIAL_DAYS + 3));

      expect(readLicenseJson()).toEqual({ trialStartedAt: NOW.toISOString() });
      expect(ensureTrialStarted(days(TRIAL_DAYS + 3)).status).toBe('trial-expired');
    });

    it('a paid key outranks an active trial, and removing it after expiry does not restart it', () => {
      ensureTrialStarted(NOW);
      const key = signLicenseKey({ kind: 'lifetime', email: 'a@b.co' }, testPriv);

      expect(activateLicense(key, NOW)).toMatchObject({ tier: 'pro', status: 'valid' });

      const afterRemoval = removeLicense(days(TRIAL_DAYS + 3));
      expect(afterRemoval.status).toBe('trial-expired');
      expect(readLicenseJson().trialStartedAt).toBe(NOW.toISOString());
    });
  });
});
