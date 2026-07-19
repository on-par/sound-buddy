import { describe, it, expect } from 'vitest';

// report-first-ux-state is a plain classic script (window.reportFirstUxState / module.exports).
const { isEnabled } = require('./report-first-ux-state.js') as {
  isEnabled: (settings: unknown) => boolean;
};

describe('isEnabled', () => {
  it('is true when reportFirstUxEnabled is a literal true', () => {
    expect(isEnabled({ reportFirstUxEnabled: true })).toBe(true);
  });

  it('is false when reportFirstUxEnabled is false', () => {
    expect(isEnabled({ reportFirstUxEnabled: false })).toBe(false);
  });

  it('is false when the key is absent', () => {
    expect(isEnabled({})).toBe(false);
  });

  it('is false for null settings', () => {
    expect(isEnabled(null)).toBe(false);
  });

  it('is false for undefined settings', () => {
    expect(isEnabled(undefined)).toBe(false);
  });

  it('is false for a truthy non-boolean value (strict === true check)', () => {
    expect(isEnabled({ reportFirstUxEnabled: 'true' })).toBe(false);
  });
});
