import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { generateKeyPairSync, sign as cryptoSign, KeyObject } from 'crypto';

// Point Electron's userData at a per-test temp dir so license.json lands in
// real JSON we can assert against (same harness as settings.test.ts).
let userDataDir = '';
vi.mock('electron', () => ({
  app: { getPath: () => userDataDir },
  BrowserWindow: class {},
}));

import {
  verifyLicenseKey,
  getLicenseState,
  activateLicense,
  removeLicense,
  isEntitled,
  GRACE_DAYS,
} from './license';

const licenseFile = () => path.join(userDataDir, 'license.json');

// Test signing keypair — the module verifies against it via the
// SOUND_BUDDY_LICENSE_PUBKEY override (same override the e2e specs use).
const { publicKey: testPub, privateKey: testPriv } = generateKeyPairSync('ed25519');
const { privateKey: wrongPriv } = generateKeyPairSync('ed25519');

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Sign a license key the way scripts/license-keygen.mjs does. */
function makeKey(payload: Record<string, unknown>, priv: KeyObject = testPriv): string {
  const payloadBytes = Buffer.from(JSON.stringify(payload));
  const sig = cryptoSign(null, payloadBytes, priv);
  return `SB1.${b64url(payloadBytes)}.${b64url(sig)}`;
}

const NOW = new Date('2026-07-05T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const future = new Date(NOW.getTime() + 30 * DAY_MS).toISOString();

beforeEach(() => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-license-'));
  process.env.SOUND_BUDDY_LICENSE_PUBKEY = testPub
    .export({ type: 'spki', format: 'der' })
    .toString('base64');
});

afterEach(() => {
  delete process.env.SOUND_BUDDY_LICENSE_PUBKEY;
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

describe('verifyLicenseKey', () => {
  it('accepts a valid subscription key', () => {
    const state = verifyLicenseKey(
      makeKey({ kind: 'subscription', email: 'a@b.c', expiresAt: future }),
      NOW,
    );
    expect(state).toMatchObject({ tier: 'pro', status: 'valid', kind: 'subscription', email: 'a@b.c' });
  });

  it('accepts a lifetime key and skips expiry entirely (#90)', () => {
    // Even a nonsensical past expiresAt is ignored for lifetime keys.
    const state = verifyLicenseKey(
      makeKey({ kind: 'lifetime', expiresAt: '2000-01-01T00:00:00Z' }),
      NOW,
    );
    expect(state).toMatchObject({ tier: 'pro', status: 'valid', kind: 'lifetime' });
    expect(state.expiresAt).toBeUndefined();
  });

  it('grants a 7-day grace period after subscription expiry', () => {
    const expiredYesterday = new Date(NOW.getTime() - 1 * DAY_MS).toISOString();
    const state = verifyLicenseKey(makeKey({ kind: 'subscription', expiresAt: expiredYesterday }), NOW);
    expect(state.tier).toBe('pro');
    expect(state.status).toBe('grace');
    expect(Date.parse(state.graceEndsAt!)).toBe(Date.parse(expiredYesterday) + GRACE_DAYS * DAY_MS);
  });

  it('reverts to free once the grace period ends', () => {
    const expiredLongAgo = new Date(NOW.getTime() - (GRACE_DAYS + 1) * DAY_MS).toISOString();
    const state = verifyLicenseKey(makeKey({ kind: 'subscription', expiresAt: expiredLongAgo }), NOW);
    expect(state).toMatchObject({ tier: 'free', status: 'expired' });
  });

  it('rejects a key signed by the wrong private key', () => {
    const state = verifyLicenseKey(
      makeKey({ kind: 'subscription', expiresAt: future }, wrongPriv),
      NOW,
    );
    expect(state).toMatchObject({ tier: 'free', status: 'invalid' });
  });

  it('rejects a tampered payload', () => {
    const good = makeKey({ kind: 'subscription', expiresAt: future });
    const [prefix, , sig] = good.split('.');
    const forged = b64url(Buffer.from(JSON.stringify({ kind: 'lifetime' })));
    const state = verifyLicenseKey(`${prefix}.${forged}.${sig}`, NOW);
    expect(state).toMatchObject({ tier: 'free', status: 'invalid' });
  });

  it.each(['', 'garbage', 'SB1.only-two', 'XX9.a.b'])('rejects malformed input %j', (key) => {
    const state = verifyLicenseKey(key, NOW);
    expect(state).toMatchObject({ tier: 'free', status: 'invalid' });
    expect(state.error).toBeTruthy();
  });

  it('rejects an unknown kind and a subscription without expiry', () => {
    expect(verifyLicenseKey(makeKey({ kind: 'trial' }), NOW).status).toBe('invalid');
    expect(verifyLicenseKey(makeKey({ kind: 'subscription' }), NOW).status).toBe('invalid');
  });
});

describe('license store (license.json)', () => {
  it('reports free/none when no license.json exists — app fully works unlicensed', () => {
    expect(getLicenseState(NOW)).toEqual({ tier: 'free', status: 'none' });
  });

  it('activateLicense persists a valid key and getLicenseState re-verifies it', () => {
    const key = makeKey({ kind: 'subscription', expiresAt: future });
    const state = activateLicense(key, NOW);
    expect(state.status).toBe('valid');
    expect(JSON.parse(fs.readFileSync(licenseFile(), 'utf8'))).toEqual({ key });
    expect(getLicenseState(NOW).tier).toBe('pro');
  });

  it('does NOT persist an invalid or expired key, and never clobbers a stored one', () => {
    const good = makeKey({ kind: 'lifetime' });
    activateLicense(good, NOW);

    const expired = makeKey({
      kind: 'subscription',
      expiresAt: new Date(NOW.getTime() - 30 * DAY_MS).toISOString(),
    });
    expect(activateLicense(expired, NOW).status).toBe('expired');
    expect(activateLicense('garbage', NOW).status).toBe('invalid');

    // The lifetime key is still what's stored — the app stays Pro.
    expect(JSON.parse(fs.readFileSync(licenseFile(), 'utf8'))).toEqual({ key: good });
    expect(getLicenseState(NOW).status).toBe('valid');
  });

  it('a stored key that ages past expiry rolls to grace, then free, on read', () => {
    const expiresAt = new Date(NOW.getTime() + 1 * DAY_MS).toISOString();
    activateLicense(makeKey({ kind: 'subscription', expiresAt }), NOW);

    expect(getLicenseState(NOW).status).toBe('valid');
    expect(getLicenseState(new Date(NOW.getTime() + 2 * DAY_MS)).status).toBe('grace');
    expect(getLicenseState(new Date(NOW.getTime() + 30 * DAY_MS))).toMatchObject({
      tier: 'free',
      status: 'expired',
    });
  });

  it('removeLicense deletes the file and reverts to free (idempotent)', () => {
    activateLicense(makeKey({ kind: 'lifetime' }), NOW);
    expect(removeLicense()).toEqual({ tier: 'free', status: 'none' });
    expect(fs.existsSync(licenseFile())).toBe(false);
    expect(removeLicense().status).toBe('none');
  });

  it('treats a corrupt license.json as free, not a crash', () => {
    fs.writeFileSync(licenseFile(), 'not json');
    expect(getLicenseState(NOW).tier).toBe('free');
    fs.writeFileSync(licenseFile(), JSON.stringify({ key: 42 }));
    expect(getLicenseState(NOW)).toEqual({ tier: 'free', status: 'none' });
  });
});

describe('isEntitled', () => {
  const PRO = ['saved-rigs', 'live-monitoring', 'virtual-soundcheck', 'ai-narrative'];

  it('free tier: pro features locked, everything else (report card) free', () => {
    for (const f of PRO) expect(isEntitled(f, NOW)).toBe(false);
    expect(isEntitled('report-card', NOW)).toBe(true);
  });

  it('pro tier (valid and grace) unlocks all pro features', () => {
    activateLicense(makeKey({ kind: 'lifetime' }), NOW);
    for (const f of PRO) expect(isEntitled(f, NOW)).toBe(true);

    const expiresAt = new Date(NOW.getTime() - 1 * DAY_MS).toISOString();
    activateLicense(makeKey({ kind: 'subscription', expiresAt }), NOW);
    for (const f of PRO) expect(isEntitled(f, NOW)).toBe(true); // in grace
    for (const f of PRO) expect(isEntitled(f, new Date(NOW.getTime() + 30 * DAY_MS))).toBe(false);
  });
});
