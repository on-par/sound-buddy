import type { LicensePayload, PolicyState } from './index.js';
import { GRACE_DAYS, DAY_MS } from './index.js';

/**
 * Golden vectors for {@link resolvePolicyState} — the single source of truth
 * both `app/electron/license.ts` and `worker/src/license-sign.ts` are tested
 * against, so their runtime-specific verify adapters can't silently drift
 * from this policy's grace/expiry math.
 */
export interface GoldenVector {
  label: string;
  payload: LicensePayload;
  now: Date;
  expected: PolicyState;
}

const NOW = new Date('2026-07-05T12:00:00Z');
const future = new Date(NOW.getTime() + 30 * DAY_MS).toISOString();

const expiredYesterday = new Date(NOW.getTime() - 1 * DAY_MS).toISOString();
const graceEndsMs = Date.parse(expiredYesterday) + GRACE_DAYS * DAY_MS;

const rightAtGraceBoundaryExpiresAt = new Date(NOW.getTime() - (GRACE_DAYS * DAY_MS - 1)).toISOString();
const justPastGraceExpiresAt = new Date(NOW.getTime() - GRACE_DAYS * DAY_MS).toISOString();

export const GOLDEN_VECTORS: GoldenVector[] = [
  {
    label: 'lifetime key is always valid, expiresAt stripped',
    payload: { kind: 'lifetime', email: 'a@b.c', expiresAt: '2000-01-01T00:00:00Z' },
    now: NOW,
    expected: { tier: 'pro', status: 'valid', kind: 'lifetime', email: 'a@b.c', expiresAt: undefined },
  },
  {
    label: 'subscription before expiresAt is valid',
    payload: { kind: 'subscription', email: 'a@b.c', expiresAt: future },
    now: NOW,
    expected: { tier: 'pro', status: 'valid', kind: 'subscription', email: 'a@b.c', expiresAt: future },
  },
  {
    label: 'subscription one day past expiry is in grace',
    payload: { kind: 'subscription', expiresAt: expiredYesterday },
    now: NOW,
    expected: {
      tier: 'pro',
      status: 'grace',
      kind: 'subscription',
      email: undefined,
      expiresAt: expiredYesterday,
      graceEndsAt: new Date(graceEndsMs).toISOString(),
    },
  },
  {
    label: 'grace boundary: 1ms before grace ends is still grace',
    payload: { kind: 'subscription', expiresAt: rightAtGraceBoundaryExpiresAt },
    now: NOW,
    expected: {
      tier: 'pro',
      status: 'grace',
      kind: 'subscription',
      email: undefined,
      expiresAt: rightAtGraceBoundaryExpiresAt,
      graceEndsAt: new Date(Date.parse(rightAtGraceBoundaryExpiresAt) + GRACE_DAYS * DAY_MS).toISOString(),
    },
  },
  {
    label: 'grace boundary: exactly GRACE_DAYS past expiry is expired (free)',
    payload: { kind: 'subscription', expiresAt: justPastGraceExpiresAt },
    now: NOW,
    expected: {
      tier: 'free',
      status: 'expired',
      kind: 'subscription',
      email: undefined,
      expiresAt: justPastGraceExpiresAt,
    },
  },
  {
    label: 'unknown kind is invalid',
    payload: { kind: 'trial' as unknown as LicensePayload['kind'] },
    now: NOW,
    expected: { tier: 'free', status: 'invalid', error: 'Unknown license kind' },
  },
  {
    label: 'subscription missing expiresAt is invalid',
    payload: { kind: 'subscription' },
    now: NOW,
    expected: { tier: 'free', status: 'invalid', error: 'License has no valid expiry' },
  },
  {
    label: 'subscription with unparseable expiresAt is invalid',
    payload: { kind: 'subscription', expiresAt: 'not-a-date' },
    now: NOW,
    expected: { tier: 'free', status: 'invalid', error: 'License has no valid expiry' },
  },
];
