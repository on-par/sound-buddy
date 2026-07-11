import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { generateKeyPairSync } from 'crypto';

// Same harness as license.test.ts: point Electron's userData at a per-test
// temp dir so license.json lands in real JSON we can assert against.
let userDataDir = '';
vi.mock('electron', () => ({
  app: { getPath: () => userDataDir, isPackaged: false },
  BrowserWindow: class {},
}));

import { getLicenseState, activateLicense, GRACE_DAYS, DAY_MS } from './license';
import { maybeRefreshLicense, shouldAutoRefresh } from './license-refresh';
import { signLicenseKey } from '../tests/license-fixture';

const { publicKey: testPub, privateKey: testPriv } = generateKeyPairSync('ed25519');

function makeKey(payload: Record<string, unknown>): string {
  return signLicenseKey(payload, testPriv);
}

const NOW = new Date('2026-07-05T12:00:00Z');

beforeEach(() => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-license-refresh-'));
  process.env.SOUND_BUDDY_LICENSE_PUBKEY = testPub
    .export({ type: 'spki', format: 'der' })
    .toString('base64');
});

afterEach(() => {
  delete process.env.SOUND_BUDDY_LICENSE_PUBKEY;
  delete process.env.SOUND_BUDDY_DISABLE_LICENSE_REFRESH;
  vi.unstubAllGlobals();
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

describe('shouldAutoRefresh', () => {
  it('is true for a subscription in grace', () => {
    expect(shouldAutoRefresh({ tier: 'pro', status: 'grace', kind: 'subscription' }, NOW)).toBe(true);
  });

  it('is true for a subscription valid but within the grace-day window of expiry', () => {
    const expiresAt = new Date(NOW.getTime() + (GRACE_DAYS - 1) * DAY_MS).toISOString();
    expect(
      shouldAutoRefresh({ tier: 'pro', status: 'valid', kind: 'subscription', expiresAt }, NOW),
    ).toBe(true);
  });

  it('is false for a subscription valid and far from expiry', () => {
    const expiresAt = new Date(NOW.getTime() + 30 * DAY_MS).toISOString();
    expect(
      shouldAutoRefresh({ tier: 'pro', status: 'valid', kind: 'subscription', expiresAt }, NOW),
    ).toBe(false);
  });

  it('is false for a lifetime key regardless of status', () => {
    expect(shouldAutoRefresh({ tier: 'pro', status: 'valid', kind: 'lifetime' }, NOW)).toBe(false);
  });

  it('is false for trial, expired, invalid, and none states', () => {
    expect(shouldAutoRefresh({ tier: 'pro', status: 'trial' }, NOW)).toBe(false);
    expect(shouldAutoRefresh({ tier: 'free', status: 'trial-expired' }, NOW)).toBe(false);
    expect(
      shouldAutoRefresh({ tier: 'free', status: 'expired', kind: 'subscription' }, NOW),
    ).toBe(false);
    expect(
      shouldAutoRefresh({ tier: 'free', status: 'invalid', kind: 'subscription' }, NOW),
    ).toBe(false);
    expect(shouldAutoRefresh({ tier: 'free', status: 'none' }, NOW)).toBe(false);
  });

  it('is false when expiresAt is missing or unparseable', () => {
    expect(shouldAutoRefresh({ tier: 'pro', status: 'valid', kind: 'subscription' }, NOW)).toBe(false);
    expect(
      shouldAutoRefresh(
        { tier: 'pro', status: 'valid', kind: 'subscription', expiresAt: 'not-a-date' },
        NOW,
      ),
    ).toBe(false);
  });
});

describe('maybeRefreshLicense', () => {
  it('fetches and activates a renewed key when a subscription is near expiry (renewal is invisible)', async () => {
    const expiresAt = new Date(NOW.getTime() + 5 * DAY_MS).toISOString();
    const currentKey = makeKey({ kind: 'subscription', expiresAt });
    activateLicense(currentKey, NOW);

    const newerExpiresAt = new Date(NOW.getTime() + 35 * DAY_MS).toISOString();
    const newerKey = makeKey({ kind: 'subscription', expiresAt: newerExpiresAt });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ key: newerKey }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const state = await maybeRefreshLicense({}, NOW);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://soundbuddy.online/api/license/refresh');
    expect(JSON.parse(init.body)).toEqual({ key: currentKey });

    expect(state.tier).toBe('pro');
    expect(state.expiresAt).toBe(newerExpiresAt);
    expect(getLicenseState(NOW).expiresAt).toBe(newerExpiresAt);
  });

  it('makes no fetch call when the subscription is far from expiry', async () => {
    const expiresAt = new Date(NOW.getTime() + 30 * DAY_MS).toISOString();
    const currentKey = makeKey({ kind: 'subscription', expiresAt });
    activateLicense(currentKey, NOW);

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const state = await maybeRefreshLicense({}, NOW);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.expiresAt).toBe(expiresAt);
  });

  it('never calls the network for a lifetime key, even forced', async () => {
    activateLicense(makeKey({ kind: 'lifetime' }), NOW);

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await maybeRefreshLicense({}, NOW);
    await maybeRefreshLicense({ force: true }, NOW);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stays quiet on a network error while offline and in grace', async () => {
    const expiredYesterday = new Date(NOW.getTime() - 1 * DAY_MS).toISOString();
    activateLicense(makeKey({ kind: 'subscription', expiresAt: expiredYesterday }), NOW);
    const before = getLicenseState(NOW);
    expect(before.status).toBe('grace');

    const fetchMock = vi.fn().mockRejectedValue(new Error('network unreachable'));
    vi.stubGlobal('fetch', fetchMock);

    const state = await maybeRefreshLicense({}, NOW);

    expect(state).toEqual(before);
    expect(getLicenseState(NOW)).toEqual(before);
  });

  it('stays quiet on a timeout/AbortError while in grace', async () => {
    const expiredYesterday = new Date(NOW.getTime() - 1 * DAY_MS).toISOString();
    activateLicense(makeKey({ kind: 'subscription', expiresAt: expiredYesterday }), NOW);
    const before = getLicenseState(NOW);

    const abortError = new DOMException('The operation was aborted', 'AbortError');
    const fetchMock = vi.fn().mockRejectedValue(abortError);
    vi.stubGlobal('fetch', fetchMock);

    const state = await maybeRefreshLicense({}, NOW);

    expect(state).toEqual(before);
    expect(() => state).not.toThrow();
  });

  it('winds down naturally on a 403 no-active-subscription (canceled)', async () => {
    const expiredYesterday = new Date(NOW.getTime() - 1 * DAY_MS).toISOString();
    const key = makeKey({ kind: 'subscription', expiresAt: expiredYesterday });
    activateLicense(key, NOW);
    const before = getLicenseState(NOW);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'no-active-subscription' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const state = await maybeRefreshLicense({}, NOW);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(state).toEqual(before);
    expect(getLicenseState(NOW)).toEqual(before);
  });

  it('is fully disabled by the kill-switch, even when forced', async () => {
    const expiresAt = new Date(NOW.getTime() + 5 * DAY_MS).toISOString();
    activateLicense(makeKey({ kind: 'subscription', expiresAt }), NOW);
    process.env.SOUND_BUDDY_DISABLE_LICENSE_REFRESH = '1';

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await maybeRefreshLicense({}, NOW);
    await maybeRefreshLicense({ force: true }, NOW);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('makes no fetch call when there is no stored key, or only a trial', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    // No key, no trial: free tier.
    expect(getLicenseState(NOW).status).toBe('none');
    await maybeRefreshLicense({}, NOW);
    expect(fetchMock).not.toHaveBeenCalled();

    // A trial-only state also has no stored key.
    await maybeRefreshLicense({ force: true }, NOW);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the manual force bypasses the expiry window and activates the returned key', async () => {
    const expiresAt = new Date(NOW.getTime() + 30 * DAY_MS).toISOString();
    activateLicense(makeKey({ kind: 'subscription', expiresAt }), NOW);

    const newerExpiresAt = new Date(NOW.getTime() + 60 * DAY_MS).toISOString();
    const newerKey = makeKey({ kind: 'subscription', expiresAt: newerExpiresAt });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ key: newerKey }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const state = await maybeRefreshLicense({ force: true }, NOW);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(state.expiresAt).toBe(newerExpiresAt);
  });

  it('does no network call at all when the kill-switch is set, before checking for a key', async () => {
    process.env.SOUND_BUDDY_DISABLE_LICENSE_REFRESH = '1';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const state = await maybeRefreshLicense({}, NOW);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.status).toBe('none');
  });

  it('swallows a body without a usable key ({ status: "lifetime" } shape)', async () => {
    const expiresAt = new Date(NOW.getTime() + 5 * DAY_MS).toISOString();
    activateLicense(makeKey({ kind: 'subscription', expiresAt }), NOW);
    const before = getLicenseState(NOW);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'lifetime' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const state = await maybeRefreshLicense({}, NOW);

    expect(state).toEqual(before);
  });

  it('swallows a JSON parse failure', async () => {
    const expiresAt = new Date(NOW.getTime() + 5 * DAY_MS).toISOString();
    activateLicense(makeKey({ kind: 'subscription', expiresAt }), NOW);
    const before = getLicenseState(NOW);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    const state = await maybeRefreshLicense({}, NOW);

    expect(state).toEqual(before);
  });
});
