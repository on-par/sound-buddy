import { describe, expect, it } from 'vitest';
import {
  buildWaitlistPayload,
  WAITLIST_ENDPOINT,
  WAITLIST_ERROR_MESSAGE,
  WAITLIST_SUCCESS_MESSAGE,
  waitlistOutcomeMessage,
} from './waitlist-form';

describe('buildWaitlistPayload', () => {
  it('trims a padded email and omits churchName when the second arg is empty', () => {
    expect(buildWaitlistPayload('  a@b.com  ', '')).toEqual({ email: 'a@b.com' });
  });

  it('trims a padded churchName and includes it, trimmed, when non-blank', () => {
    expect(buildWaitlistPayload('a@b.com', '  First Baptist  ')).toEqual({
      email: 'a@b.com',
      churchName: 'First Baptist',
    });
  });

  it('omits churchName when it is whitespace-only', () => {
    expect(buildWaitlistPayload('a@b.com', '   ')).toEqual({ email: 'a@b.com' });
  });
});

describe('waitlistOutcomeMessage', () => {
  it('returns the success message when ok is true', () => {
    expect(waitlistOutcomeMessage(true)).toBe(WAITLIST_SUCCESS_MESSAGE);
  });

  it('returns the error message when ok is false', () => {
    expect(waitlistOutcomeMessage(false)).toBe(WAITLIST_ERROR_MESSAGE);
  });
});

describe('WAITLIST_ENDPOINT', () => {
  it('is /api/waitlist', () => {
    expect(WAITLIST_ENDPOINT).toBe('/api/waitlist');
  });
});
