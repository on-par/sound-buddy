import { describe, it, expect } from 'vitest';

// daw-workspace-state is a plain classic script (window.dawWorkspaceState / module.exports).
const { isEnabled, showShell, transportLabel } = require('./daw-workspace-state.js') as {
  isEnabled: (settings: unknown) => boolean;
  showShell: (settings: unknown, mode: string) => boolean;
  transportLabel: (liveRunning: boolean, liveMode: string) => string;
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

describe('showShell', () => {
  it('is true when the workspace is enabled and the mode is live', () => {
    expect(showShell({ dawWorkspaceEnabled: true }, 'live')).toBe(true);
  });

  it('is false when the workspace is disabled, even in live mode', () => {
    expect(showShell({ dawWorkspaceEnabled: false }, 'live')).toBe(false);
  });

  it('is false when enabled but the mode is reportcard', () => {
    expect(showShell({ dawWorkspaceEnabled: true }, 'reportcard')).toBe(false);
  });

  it('is false when enabled but the mode is soundcheck', () => {
    expect(showShell({ dawWorkspaceEnabled: true }, 'soundcheck')).toBe(false);
  });

  it('is false for null settings', () => {
    expect(showShell(null, 'live')).toBe(false);
  });

  it('is false for undefined settings', () => {
    expect(showShell(undefined, 'live')).toBe(false);
  });
});

describe('transportLabel', () => {
  it('is Stopped when not running and mode is monitor', () => {
    expect(transportLabel(false, 'monitor')).toBe('Stopped');
  });

  it('is Stopped when not running and mode is record', () => {
    expect(transportLabel(false, 'record')).toBe('Stopped');
  });

  it('is Recording when running in record mode', () => {
    expect(transportLabel(true, 'record')).toBe('Recording');
  });

  it('is Monitoring when running in monitor mode', () => {
    expect(transportLabel(true, 'monitor')).toBe('Monitoring');
  });
});
