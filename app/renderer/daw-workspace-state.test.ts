import { describe, it, expect } from 'vitest';

// daw-workspace-state is a plain classic script (window.dawWorkspaceState / module.exports).
const { isEnabled } = require('./daw-workspace-state.js') as {
  isEnabled: (settings: unknown) => boolean;
};

describe('isEnabled', () => {
  it('is true when dawWorkspaceEnabled is a literal true', () => {
    expect(isEnabled({ dawWorkspaceEnabled: true })).toBe(true);
  });

  it('is false when dawWorkspaceEnabled is false', () => {
    expect(isEnabled({ dawWorkspaceEnabled: false })).toBe(false);
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
    expect(isEnabled({ dawWorkspaceEnabled: 'true' })).toBe(false);
  });
});
