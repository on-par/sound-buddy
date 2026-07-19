import { describe, it, expect } from 'vitest';

// ai-dock-state is a plain classic script (window.aiDockState / module.exports).
const { placement } = require('./ai-dock-state.js') as {
  placement: (enabled: unknown, mode: string) => 'docked' | 'rail';
};

describe('placement', () => {
  it.each(['reportcard', 'dir', 'recent', 'guide', 'ringout', 'soundcheck'])(
    'docks when the flag is enabled and mode is %s',
    (mode) => {
      expect(placement(true, mode)).toBe('docked');
    }
  );

  it('stays a rail when the flag is enabled but mode is live', () => {
    expect(placement(true, 'live')).toBe('rail');
  });

  it('stays a rail when the flag is disabled', () => {
    expect(placement(false, 'reportcard')).toBe('rail');
  });

  it('stays a rail for a truthy non-boolean enabled value (strict === true check)', () => {
    expect(placement(1, 'reportcard')).toBe('rail');
    expect(placement('true', 'reportcard')).toBe('rail');
  });

  it('stays a rail when enabled is undefined (loading settings)', () => {
    expect(placement(undefined, 'reportcard')).toBe('rail');
  });
});
