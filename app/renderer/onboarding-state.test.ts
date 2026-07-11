import { describe, it, expect } from 'vitest';

// onboarding-state is a plain classic script (window.onboardingState in the
// browser, module.exports under Node) so the first-run gate is exercised without
// a DOM. A tiny in-memory Storage stand-in stands in for localStorage.
const { KEY, hasSeenOnboarding, shouldShowOnboarding, markOnboardingSeen } = require('./onboarding-state.js') as {
  KEY: string;
  hasSeenOnboarding: (storage: unknown) => boolean;
  shouldShowOnboarding: (storage: unknown) => boolean;
  markOnboardingSeen: (storage: unknown) => void;
};

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    _map: map,
  };
}

describe('shouldShowOnboarding', () => {
  it('shows on a genuine first launch (empty storage)', () => {
    expect(shouldShowOnboarding(fakeStorage())).toBe(true);
  });
  it('does not show once the seen flag is set', () => {
    expect(shouldShowOnboarding(fakeStorage({ [KEY]: '1' }))).toBe(false);
  });
  it('shows when storage is null/unavailable rather than suppressing silently', () => {
    expect(shouldShowOnboarding(null)).toBe(true);
  });
  it('shows when storage.getItem throws (private mode)', () => {
    const throwing = { getItem: () => { throw new Error('denied'); } };
    expect(shouldShowOnboarding(throwing)).toBe(true);
  });
});

describe('hasSeenOnboarding', () => {
  it('is false for empty storage', () => {
    expect(hasSeenOnboarding(fakeStorage())).toBe(false);
  });
  it('is true only for the exact "1" value', () => {
    expect(hasSeenOnboarding(fakeStorage({ [KEY]: '1' }))).toBe(true);
    expect(hasSeenOnboarding(fakeStorage({ [KEY]: 'yes' }))).toBe(false);
  });
});

describe('markOnboardingSeen', () => {
  it('persists the seen flag so onboarding never reappears', () => {
    const s = fakeStorage();
    expect(shouldShowOnboarding(s)).toBe(true);
    markOnboardingSeen(s);
    expect(s._map.get(KEY)).toBe('1');
    expect(shouldShowOnboarding(s)).toBe(false);
  });
  it('is a no-op (no throw) when storage.setItem throws', () => {
    const throwing = { setItem: () => { throw new Error('denied'); } };
    expect(() => markOnboardingSeen(throwing)).not.toThrow();
  });
  it('is a no-op (no throw) for a null storage', () => {
    expect(() => markOnboardingSeen(null)).not.toThrow();
  });
});
