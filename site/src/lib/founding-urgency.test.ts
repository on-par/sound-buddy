import { describe, expect, it } from 'vitest';
import {
  FOUNDING_CAP,
  PLACEHOLDER_FOUNDING_URL,
  foundingCheckoutUrl,
  foundingUrgency,
  isCheckoutLive,
  remainingLabel,
} from './founding-urgency';

describe('foundingCheckoutUrl', () => {
  it('returns the placeholder for an empty env', () => {
    expect(foundingCheckoutUrl({})).toBe(PLACEHOLDER_FOUNDING_URL);
  });

  it('returns the placeholder when the override is an empty string', () => {
    expect(foundingCheckoutUrl({ PUBLIC_FOUNDING_CHECKOUT_URL: '' })).toBe(PLACEHOLDER_FOUNDING_URL);
  });

  it('returns the placeholder when the override is whitespace-only', () => {
    expect(foundingCheckoutUrl({ PUBLIC_FOUNDING_CHECKOUT_URL: '   ' })).toBe(PLACEHOLDER_FOUNDING_URL);
  });

  it('returns the trimmed override when set', () => {
    expect(
      foundingCheckoutUrl({ PUBLIC_FOUNDING_CHECKOUT_URL: '  https://buy.stripe.com/real-link  ' }),
    ).toBe('https://buy.stripe.com/real-link');
  });
});

describe('isCheckoutLive', () => {
  it('is false for an empty env', () => {
    expect(isCheckoutLive({})).toBe(false);
  });

  it('is false when the override equals the placeholder', () => {
    expect(isCheckoutLive({ PUBLIC_FOUNDING_CHECKOUT_URL: PLACEHOLDER_FOUNDING_URL })).toBe(false);
  });

  it('is true for a real-looking link', () => {
    expect(isCheckoutLive({ PUBLIC_FOUNDING_CHECKOUT_URL: 'https://buy.stripe.com/real-link' })).toBe(true);
  });
});

describe('foundingUrgency', () => {
  it('returns mode: none when checkout is not live, even well before the deadline', () => {
    expect(
      foundingUrgency({ nowMs: 0, deadlineMs: 1_000_000_000_000, checkoutLive: false }),
    ).toEqual({ mode: 'none' });
  });

  it('returns mode: cap when live and nowMs === deadlineMs', () => {
    expect(foundingUrgency({ nowMs: 1000, deadlineMs: 1000, checkoutLive: true })).toEqual({ mode: 'cap' });
  });

  it('returns mode: cap when live and past the deadline', () => {
    expect(foundingUrgency({ nowMs: 2000, deadlineMs: 1000, checkoutLive: true })).toEqual({ mode: 'cap' });
  });

  it('returns mode: countdown with the expected label when live and before the deadline', () => {
    const oneDayMs = 86_400_000;
    expect(
      foundingUrgency({ nowMs: 0, deadlineMs: oneDayMs, checkoutLive: true }),
    ).toEqual({ mode: 'countdown', remainingLabel: '1d 0h 0m left' });
  });
});

describe('remainingLabel', () => {
  it('formats a multi-day remainder', () => {
    // 4 days, 21 hours, 3 minutes, plus some seconds to prove flooring
    const ms = 4 * 86_400_000 + 21 * 3_600_000 + 3 * 60_000 + 42_000;
    expect(remainingLabel(ms)).toBe('4d 21h 3m left');
  });

  it('formats a sub-day remainder', () => {
    expect(remainingLabel(5 * 3_600_000 + 2 * 60_000)).toBe('0d 5h 2m left');
  });

  it('formats a sub-minute remainder', () => {
    expect(remainingLabel(42_000)).toBe('0d 0h 0m left');
  });

  it('returns an empty string for zero', () => {
    expect(remainingLabel(0)).toBe('');
  });

  it('returns an empty string for negatives', () => {
    expect(remainingLabel(-1000)).toBe('');
  });
});

describe('FOUNDING_CAP', () => {
  it('is 300', () => {
    expect(FOUNDING_CAP).toBe(300);
  });
});
