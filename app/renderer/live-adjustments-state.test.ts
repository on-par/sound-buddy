import { describe, it, expect } from 'vitest';

// live-adjustments-state is a plain classic script (window.liveAdjustmentsState / module.exports).
const { isEnabled, showPanel, panelHTML, hasEnoughData, mixCandidates, MIN_WINDOWS } = require('./live-adjustments-state.js') as {
  isEnabled: (settings: unknown) => boolean;
  showPanel: (settings: unknown, mode: string) => boolean;
  panelHTML: (settings: unknown, mode: string, windows?: unknown, measurementSource?: number | null) => string;
  hasEnoughData: (windows: unknown, measurementSource?: number | null) => boolean;
  mixCandidates: (windows: unknown, measurementSource?: number | null) => Array<{ id: string; title: string; detail: string }>;
  MIN_WINDOWS: number;
};

const FLAT = {
  sub_bass: -30,
  bass: -30,
  low_mid: -30,
  mid: -30,
  high_mid: -30,
  presence: -30,
  brilliance: -30,
};

function mkWindow(bands: Record<string, number>, channels?: Array<{ bands: Record<string, number> }>) {
  return {
    type: 'window',
    window: 1,
    channels: channels || [{ bands }],
  };
}

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

describe('hasEnoughData', () => {
  it('is false for an empty array', () => {
    expect(hasEnoughData([])).toBe(false);
  });

  it('is false for a non-array', () => {
    expect(hasEnoughData(undefined)).toBe(false);
    expect(hasEnoughData(null)).toBe(false);
    expect(hasEnoughData('nope')).toBe(false);
  });

  it('is false for fewer than MIN_WINDOWS usable windows', () => {
    const windows = [mkWindow(FLAT), mkWindow(FLAT)];
    expect(windows.length).toBeLessThan(MIN_WINDOWS);
    expect(hasEnoughData(windows)).toBe(false);
  });

  it('is true for exactly MIN_WINDOWS usable windows', () => {
    const windows = [mkWindow(FLAT), mkWindow(FLAT), mkWindow(FLAT)];
    expect(windows.length).toBe(MIN_WINDOWS);
    expect(hasEnoughData(windows)).toBe(true);
  });

  it('does not count windows with missing channels/bands', () => {
    const windows = [
      mkWindow(FLAT),
      mkWindow(FLAT),
      { type: 'window', window: 3 }, // no channels
      { type: 'window', window: 4, channels: [] }, // empty channels
      { type: 'window', window: 5, channels: [{ name: 'Main' }] }, // no bands
    ];
    expect(hasEnoughData(windows)).toBe(false);
  });

  it('falls back to channel 0 when measurementSource is out of range', () => {
    const windows = [mkWindow(FLAT), mkWindow(FLAT), mkWindow(FLAT)];
    expect(hasEnoughData(windows, 7)).toBe(true);
  });
});

describe('mixCandidates', () => {
  it('returns [] for a balanced (FLAT) mix', () => {
    const windows = [mkWindow(FLAT), mkWindow(FLAT), mkWindow(FLAT)];
    expect(mixCandidates(windows)).toEqual([]);
  });

  it('flags low-end buildup when bass is hot', () => {
    const hotBass = { ...FLAT, bass: FLAT.bass + 20 };
    const windows = [mkWindow(hotBass), mkWindow(hotBass), mkWindow(hotBass)];
    const candidates = mixCandidates(windows);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe('low-end');
    expect(candidates[0].title).toBe('Low-end buildup');
  });

  it('flags harshness when presence is hot', () => {
    const hotPresence = { ...FLAT, presence: FLAT.presence + 20 };
    const windows = [mkWindow(hotPresence), mkWindow(hotPresence), mkWindow(hotPresence)];
    const candidates = mixCandidates(windows);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe('harshness');
  });

  it('flags harshness when high_mid is hot', () => {
    const hotHighMid = { ...FLAT, high_mid: FLAT.high_mid + 20 };
    const windows = [mkWindow(hotHighMid), mkWindow(hotHighMid), mkWindow(hotHighMid)];
    const candidates = mixCandidates(windows);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe('harshness');
  });

  it('flags buried vocal range when mid is quiet', () => {
    const quietMid = { ...FLAT, mid: FLAT.mid - 20 };
    const windows = [mkWindow(quietMid), mkWindow(quietMid), mkWindow(quietMid)];
    const candidates = mixCandidates(windows);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe('vocal-clarity');
  });

  it('emits all three candidates in fixed order, capped at MAX_CANDIDATES', () => {
    const hot = { ...FLAT, bass: FLAT.bass + 20, presence: FLAT.presence + 20, mid: FLAT.mid - 20 };
    const windows = [mkWindow(hot), mkWindow(hot), mkWindow(hot)];
    const candidates = mixCandidates(windows);
    expect(candidates.length).toBeLessThanOrEqual(3);
    expect(candidates.map((c) => c.id)).toEqual(['low-end', 'harshness', 'vocal-clarity']);
  });

  it('averages across windows — a single hot window is smoothed under threshold', () => {
    const hotBass = { ...FLAT, bass: FLAT.bass + 20 };
    const windows = [mkWindow(hotBass), mkWindow(FLAT), mkWindow(FLAT)];
    expect(mixCandidates(windows)).toEqual([]);
  });

  it('returns [] when fewer than MIN_WINDOWS usable windows, even with hot bands', () => {
    const hotBass = { ...FLAT, bass: FLAT.bass + 20 };
    const windows = [mkWindow(hotBass), mkWindow(hotBass)];
    expect(mixCandidates(windows)).toEqual([]);
  });

  it('reads the selected measurementSource channel', () => {
    const hotBass = { ...FLAT, bass: FLAT.bass + 20 };
    const windows = [
      mkWindow(undefined, [{ bands: FLAT }, { bands: hotBass }]),
      mkWindow(undefined, [{ bands: FLAT }, { bands: hotBass }]),
      mkWindow(undefined, [{ bands: FLAT }, { bands: hotBass }]),
    ];
    expect(mixCandidates(windows, 0)).toEqual([]);
    const candidates = mixCandidates(windows, 1);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe('low-end');
  });
});

describe('panelHTML', () => {
  it('is empty when disabled in live mode', () => {
    expect(panelHTML({ liveAdjustmentsEnabled: false }, 'live')).toBe('');
  });

  it('is empty when enabled on the reportcard tab', () => {
    expect(panelHTML({ liveAdjustmentsEnabled: true }, 'reportcard')).toBe('');
  });

  it('renders the waiting state when enabled, live, and there are not enough windows', () => {
    const html = panelHTML({ liveAdjustmentsEnabled: true }, 'live');
    expect(html).toContain('class="live-adjustments-panel"');
    expect(html).toContain('Experimental');
    expect(html).toContain('lap-empty');
    expect(html).toContain('collecting live analysis data');
  });

  it('renders candidates when enabled, live, and enough hot-bass windows have accumulated', () => {
    const hotBass = { ...FLAT, bass: FLAT.bass + 20 };
    const windows = [mkWindow(hotBass), mkWindow(hotBass), mkWindow(hotBass)];
    const html = panelHTML({ liveAdjustmentsEnabled: true }, 'live', windows, null);
    expect(html).toContain('lap-candidates');
    expect(html).toContain('Low-end buildup');
    expect(html).toContain('not instructions');
    expect(html).toContain('Experimental');
  });

  it('renders the steady-state empty copy when enough windows accumulate but no candidates trigger', () => {
    const windows = [mkWindow(FLAT), mkWindow(FLAT), mkWindow(FLAT)];
    const html = panelHTML({ liveAdjustmentsEnabled: true }, 'live', windows, null);
    expect(html).toContain('nothing to try right now');
    expect(html).not.toContain('lap-candidates');
  });
});
