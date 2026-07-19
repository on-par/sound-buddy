import { describe, it, expect } from 'vitest';

// live-adjustments-state is a plain classic script (window.liveAdjustmentsState / module.exports).
const { isEnabled, showPanel, panelHTML } = require('./live-adjustments-state.js') as {
  isEnabled: (settings: unknown) => boolean;
  showPanel: (settings: unknown, mode: string) => boolean;
  panelHTML: (settings: unknown, mode: string) => string;
};

describe('isEnabled', () => {
  it('is true when liveAdjustmentsEnabled is a literal true', () => {
    expect(isEnabled({ liveAdjustmentsEnabled: true })).toBe(true);
  });

  it('is false when liveAdjustmentsEnabled is false', () => {
    expect(isEnabled({ liveAdjustmentsEnabled: false })).toBe(false);
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
    expect(isEnabled({ liveAdjustmentsEnabled: 'true' })).toBe(false);
  });
});

describe('showPanel', () => {
  it('is true when enabled and the mode is live', () => {
    expect(showPanel({ liveAdjustmentsEnabled: true }, 'live')).toBe(true);
  });

  it('is false when disabled, even in live mode', () => {
    expect(showPanel({ liveAdjustmentsEnabled: false }, 'live')).toBe(false);
  });

  it('is false when enabled but the mode is reportcard', () => {
    expect(showPanel({ liveAdjustmentsEnabled: true }, 'reportcard')).toBe(false);
  });

  it('is false when enabled but the mode is soundcheck', () => {
    expect(showPanel({ liveAdjustmentsEnabled: true }, 'soundcheck')).toBe(false);
  });

  it('is false for null settings', () => {
    expect(showPanel(null, 'live')).toBe(false);
  });

  it('is false for undefined settings', () => {
    expect(showPanel(undefined, 'live')).toBe(false);
  });
});

describe('panelHTML', () => {
  it('is empty when disabled in live mode', () => {
    expect(panelHTML({ liveAdjustmentsEnabled: false }, 'live')).toBe('');
  });

  it('is empty when enabled on the reportcard tab', () => {
    expect(panelHTML({ liveAdjustmentsEnabled: true }, 'reportcard')).toBe('');
  });

  it('renders the placeholder panel when enabled and live', () => {
    const html = panelHTML({ liveAdjustmentsEnabled: true }, 'live');
    expect(html).toContain('class="live-adjustments-panel"');
    expect(html).toContain('Live adjustments');
    expect(html).toContain('Experimental');
    expect(html).toContain('while you monitor or record');
  });
});
