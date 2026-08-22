import { describe, it, expect } from 'vitest';

// daw-workspace-state is a plain classic script (window.dawWorkspaceState / module.exports).
const { transportLabel } = require('./daw-workspace-state.js') as {
  transportLabel: (liveRunning: boolean, liveMode: string) => string;
};

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
