import { describe, expect, it } from 'vitest';
import { resolveSiteMode } from './site-mode';

describe('resolveSiteMode', () => {
  it('defaults to waitlist when PUBLIC_SITE_MODE is unset', () => {
    expect(resolveSiteMode({})).toBe('waitlist');
  });

  it('resolves to waitlist when explicitly set to "waitlist"', () => {
    expect(resolveSiteMode({ PUBLIC_SITE_MODE: 'waitlist' })).toBe('waitlist');
  });

  it('resolves to live when explicitly set to "live"', () => {
    expect(resolveSiteMode({ PUBLIC_SITE_MODE: 'live' })).toBe('live');
  });

  it('fails safe to waitlist for an unrecognized value', () => {
    expect(resolveSiteMode({ PUBLIC_SITE_MODE: 'preview' })).toBe('waitlist');
  });
});
