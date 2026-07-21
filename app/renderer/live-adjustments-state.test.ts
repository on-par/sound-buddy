import { describe, it, expect } from 'vitest';

// live-adjustments-state is a plain classic script (window.liveAdjustmentsState / module.exports).
const {
  isEnabled, showPanel, panelHTML, hasEnoughData, mixCandidates, MIN_WINDOWS,
  inputHasEnoughData, inputCandidates,
  clipCandidates, candidateConfidence, confidenceLabel, rankCandidates, selectCoachingCandidate,
  coachingCardHTML, MIN_CONFIDENCE, HIGH_CONFIDENCE, CATEGORY_PRIORITY, CLIP_RISK_PEAK_DBFS,
  CONFIDENCE_FULL_WINDOWS,
} = require('./live-adjustments-state.js') as {
  isEnabled: (settings: unknown) => boolean;
  showPanel: (settings: unknown, mode: string) => boolean;
  panelHTML: (settings: unknown, mode: string, windows?: unknown, measurementSource?: number | null, focusView?: unknown) => string;
  hasEnoughData: (windows: unknown, measurementSource?: number | null) => boolean;
  mixCandidates: (windows: unknown, measurementSource?: number | null) => Array<{ id: string; title: string; detail: string }>;
  MIN_WINDOWS: number;
  inputHasEnoughData: (windows: unknown, channelIndex: number) => boolean;
  inputCandidates: (windows: unknown, channelIndex: number, profile: unknown) => Array<{ id: string; title: string; detail: string }>;
  clipCandidates: (windows: unknown, measurementSource?: number | null) => Array<Record<string, unknown>>;
  candidateConfidence: (severityDb: number, windowCount: number) => number;
  confidenceLabel: (confidence: number) => string;
  rankCandidates: (candidates: unknown) => Array<Record<string, unknown>>;
  selectCoachingCandidate: (candidates: unknown) => Record<string, unknown> | null;
  coachingCardHTML: (candidate: Record<string, unknown> | null, focusName?: string | null) => string;
  MIN_CONFIDENCE: number;
  HIGH_CONFIDENCE: number;
  CATEGORY_PRIORITY: Record<string, number>;
  CLIP_RISK_PEAK_DBFS: number;
  CONFIDENCE_FULL_WINDOWS: number;
};

type Profile = { id: string; label: string; bands: Record<string, number> };
const { profileById } = require('./instrument-profiles.js') as { profileById: (id: string) => Profile };
const bassProfile = profileById('bass');
const egProfile = profileById('electric-guitar');
const genericProfile = profileById('generic');

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

describe('inputHasEnoughData', () => {
  it('is false for an empty array', () => {
    expect(inputHasEnoughData([], 0)).toBe(false);
  });

  it('is false for a non-array', () => {
    expect(inputHasEnoughData(undefined, 0)).toBe(false);
    expect(inputHasEnoughData(null, 0)).toBe(false);
  });

  it('is false when the channel index is missing from windows (no fallback to channel 0)', () => {
    const windows = [
      mkWindow(undefined, [{ bands: FLAT }]),
      mkWindow(undefined, [{ bands: FLAT }]),
      mkWindow(undefined, [{ bands: FLAT }]),
    ];
    expect(inputHasEnoughData(windows, 1)).toBe(false);
  });

  it('is true at exactly MIN_WINDOWS windows carrying that index', () => {
    const windows = [
      mkWindow(undefined, [{ bands: FLAT }, { bands: FLAT }]),
      mkWindow(undefined, [{ bands: FLAT }, { bands: FLAT }]),
      mkWindow(undefined, [{ bands: FLAT }, { bands: FLAT }]),
    ];
    expect(windows.length).toBe(MIN_WINDOWS);
    expect(inputHasEnoughData(windows, 1)).toBe(true);
  });
});

describe('inputCandidates', () => {
  function twoChannelWindows(bandsForBoth: Record<string, number>, count = MIN_WINDOWS) {
    const win = mkWindow(undefined, [{ bands: bandsForBoth }, { bands: bandsForBoth }]);
    return Array.from({ length: count }, () => win);
  }

  it('returns [] for a null/undefined profile', () => {
    const windows = twoChannelWindows(FLAT);
    expect(inputCandidates(windows, 0, null)).toEqual([]);
    expect(inputCandidates(windows, 0, undefined)).toEqual([]);
  });

  it('returns [] for a profile without bands', () => {
    const windows = twoChannelWindows(FLAT);
    expect(inputCandidates(windows, 0, { id: 'x', label: 'X' })).toEqual([]);
  });

  it('returns [] below MIN_WINDOWS even with extreme bands', () => {
    const hot = { ...FLAT, sub_bass: -20, bass: -20 };
    const windows = twoChannelWindows(hot, MIN_WINDOWS - 1);
    expect(inputCandidates(windows, 1, egProfile)).toEqual([]);
  });

  it('acceptance scenario 2: identical low-heavy windows differentiate by profile', () => {
    const hot = { ...FLAT, sub_bass: -20, bass: -20 };
    const windows = twoChannelWindows(hot);
    expect(inputCandidates(windows, 0, bassProfile)).toEqual([]);
    const eg = inputCandidates(windows, 1, egProfile);
    expect(eg.map((c) => c.id)).toContain('input-low-cleanup');
  });

  it('low-thin windows: bass profile wants support, EG profile does not', () => {
    const thin = { ...FLAT, sub_bass: -45, bass: -45 };
    const windows = twoChannelWindows(thin);
    const bass = inputCandidates(windows, 0, bassProfile);
    expect(bass.map((c) => c.id)).toContain('input-low-support');
    expect(inputCandidates(windows, 1, egProfile)).toEqual([]);
  });

  it('flags upper-mid buildup against the generic profile when presence is hot', () => {
    const hotPresence = { ...FLAT, presence: FLAT.presence + 20 };
    const windows = twoChannelWindows(hotPresence);
    const candidates = inputCandidates(windows, 0, genericProfile);
    expect(candidates.map((c) => c.id)).toContain('input-high-buildup');
  });

  it('flags presence support against the generic profile when high_mid/presence are quiet', () => {
    const quiet = { ...FLAT, high_mid: FLAT.high_mid - 25, presence: FLAT.presence - 25 };
    const windows = twoChannelWindows(quiet);
    const candidates = inputCandidates(windows, 0, genericProfile);
    expect(candidates.map((c) => c.id)).toContain('input-high-support');
  });

  it('returns [] for balanced content against the generic profile', () => {
    const windows = twoChannelWindows(FLAT);
    expect(inputCandidates(windows, 0, genericProfile)).toEqual([]);
  });

  it('averages across windows — a single extreme window stays under threshold', () => {
    const hot = { ...FLAT, bass: FLAT.bass + 20 };
    const win = mkWindow(undefined, [{ bands: hot }, { bands: hot }]);
    const flatWin = mkWindow(undefined, [{ bands: FLAT }, { bands: FLAT }]);
    const windows = [win, flatWin, flatWin];
    expect(inputCandidates(windows, 1, genericProfile)).toEqual([]);
  });

  it('orders low before upper and caps length at MAX_CANDIDATES', () => {
    const thin = { ...FLAT, sub_bass: -45, bass: -45, high_mid: FLAT.high_mid + 20, presence: FLAT.presence + 20 };
    const windows = twoChannelWindows(thin);
    const candidates = inputCandidates(windows, 0, bassProfile);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.length).toBeLessThanOrEqual(3);
    const lowIdx = candidates.findIndex((c) => c.id.indexOf('low') !== -1);
    const upperIdx = candidates.findIndex((c) => c.id.indexOf('high') !== -1);
    if (lowIdx !== -1 && upperIdx !== -1) expect(lowIdx).toBeLessThan(upperIdx);
  });
});

describe('panelHTML with focusView (#525)', () => {
  it('is byte-identical to the omitted-focusView output when focusView is absent', () => {
    const windows = [mkWindow(FLAT), mkWindow(FLAT), mkWindow(FLAT)];
    const withoutArg = panelHTML({ liveAdjustmentsEnabled: true }, 'live', windows, null);
    const withUndefined = panelHTML({ liveAdjustmentsEnabled: true }, 'live', windows, null, undefined);
    expect(withUndefined).toBe(withoutArg);
    expect(withoutArg).not.toContain('lap-focus');
  });

  it('is byte-identical when focusView.inputs is empty', () => {
    const windows = [mkWindow(FLAT), mkWindow(FLAT), mkWindow(FLAT)];
    const withoutArg = panelHTML({ liveAdjustmentsEnabled: true }, 'live', windows, null);
    const withEmptyInputs = panelHTML({ liveAdjustmentsEnabled: true }, 'live', windows, null, { inputs: [], focusedIndex: null });
    expect(withEmptyInputs).toBe(withoutArg);
  });

  it('renders the focus selector with a None option and one option per input', () => {
    const windows = [mkWindow(FLAT), mkWindow(FLAT), mkWindow(FLAT)];
    const focusView = {
      focusedIndex: null,
      inputs: [
        { index: 0, name: 'Kick', profile: genericProfile },
        { index: 1, name: 'Bass', profile: bassProfile },
      ],
    };
    const html = panelHTML({ liveAdjustmentsEnabled: true }, 'live', windows, null, focusView);
    expect(html).toContain('lap-focus-select');
    expect(html).toContain('<option value="">None</option>');
    expect(html).toContain('<option value="0">Kick</option>');
    expect(html).toContain('<option value="1">Bass</option>');
    expect(html).toContain('Choose an input');
  });

  it('shows per-input waiting copy naming the input when it lacks enough data', () => {
    const windows = [mkWindow(undefined, [{ bands: FLAT }])];
    const focusView = {
      focusedIndex: 0,
      inputs: [{ index: 0, name: 'Kick', profile: genericProfile }],
    };
    const html = panelHTML({ liveAdjustmentsEnabled: true }, 'live', windows, null, focusView);
    expect(html).toContain('Kick');
    expect(html).toContain('candidates appear after a few analysis windows');
  });

  it('shows candidates, profile label, and "for this input only" alongside the overall-mix section', () => {
    const hot = { ...FLAT, bass: FLAT.bass + 20, sub_bass: -20 };
    const windows = [
      mkWindow(undefined, [{ bands: hot }, { bands: hot }]),
      mkWindow(undefined, [{ bands: hot }, { bands: hot }]),
      mkWindow(undefined, [{ bands: hot }, { bands: hot }]),
    ];
    const focusView = {
      focusedIndex: 1,
      inputs: [
        { index: 0, name: 'Overall', profile: genericProfile },
        { index: 1, name: 'Guitar', profile: egProfile },
      ],
    };
    const html = panelHTML({ liveAdjustmentsEnabled: true }, 'live', windows, null, focusView);
    expect(html).toContain('lap-input-candidates');
    expect(html).toContain('Electric guitar');
    expect(html).toContain('for this input only');
    expect(html).toContain('Overall mix candidates');
  });

  it('shows the "sits close to its shape" copy when the focused input has enough data but no candidates', () => {
    const windows = [mkWindow(FLAT), mkWindow(FLAT), mkWindow(FLAT)];
    const focusView = {
      focusedIndex: 0,
      inputs: [{ index: 0, name: 'Overall', profile: genericProfile }],
    };
    const html = panelHTML({ liveAdjustmentsEnabled: true }, 'live', windows, null, focusView);
    expect(html).toContain('sits close to its');
    expect(html).toContain('Generic');
    expect(html).toContain('nothing to try right now');
  });

  it('escapes an unsafe input name in both the option and the note', () => {
    const hot = { ...FLAT, bass: FLAT.bass + 20, sub_bass: -20 };
    const windows = [
      mkWindow(undefined, [{ bands: hot }]),
      mkWindow(undefined, [{ bands: hot }]),
      mkWindow(undefined, [{ bands: hot }]),
    ];
    const unsafeName = '<img src=x onerror=1>';
    const focusView = {
      focusedIndex: 0,
      inputs: [{ index: 0, name: unsafeName, profile: egProfile }],
    };
    const html = panelHTML({ liveAdjustmentsEnabled: true }, 'live', windows, null, focusView);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('shows the hint copy with no crash when focusedIndex is out of range', () => {
    const windows = [mkWindow(FLAT), mkWindow(FLAT), mkWindow(FLAT)];
    const focusView = {
      focusedIndex: 7,
      inputs: [
        { index: 0, name: 'A', profile: genericProfile },
        { index: 1, name: 'B', profile: genericProfile },
      ],
    };
    const html = panelHTML({ liveAdjustmentsEnabled: true }, 'live', windows, null, focusView);
    expect(html).toContain('Choose an input');
  });
});

function mkLevelWindow(channels: Array<{ peak?: number; clipping?: boolean }>) {
  return {
    type: 'window',
    window: 1,
    channels: channels.map((c) => ({ peak: c.peak, clipping: c.clipping })),
  };
}

describe('candidateConfidence', () => {
  it('returns CONFIDENCE_BASE at zero severity and zero windows', () => {
    expect(candidateConfidence(0, 0)).toBeCloseTo(0.4);
  });

  it('rises with severity', () => {
    const low = candidateConfidence(0, 0);
    const high = candidateConfidence(3, 0);
    expect(high).toBeGreaterThan(low);
  });

  it('rises with window count', () => {
    const low = candidateConfidence(0, 0);
    const high = candidateConfidence(0, 3);
    expect(high).toBeGreaterThan(low);
  });

  it('saturates at exactly 1 for huge severity and many windows', () => {
    expect(candidateConfidence(1000, 1000)).toBeCloseTo(1);
    expect(candidateConfidence(1000, CONFIDENCE_FULL_WINDOWS)).toBeCloseTo(1);
  });

  it('clamps negative severity to the base', () => {
    expect(candidateConfidence(-50, 0)).toBeCloseTo(0.4);
  });

  it('coerces non-finite severity/window inputs to zero ratios', () => {
    expect(candidateConfidence(NaN, NaN)).toBeCloseTo(0.4);
    expect(candidateConfidence(Infinity, 0)).toBeCloseTo(0.8);
  });
});

describe('confidenceLabel', () => {
  it('is High at 0.8 and above', () => {
    expect(confidenceLabel(0.8)).toBe('High');
    expect(confidenceLabel(0.95)).toBe('High');
  });

  it('is Medium at exactly 0.6', () => {
    expect(confidenceLabel(0.6)).toBe('Medium');
  });

  it('is Low at 0.59', () => {
    expect(confidenceLabel(0.59)).toBe('Low');
  });

  it('lands on the inclusive side at the exact thresholds', () => {
    expect(confidenceLabel(HIGH_CONFIDENCE)).toBe('High');
    expect(confidenceLabel(MIN_CONFIDENCE)).toBe('Medium');
  });
});

describe('clipCandidates', () => {
  it('returns [] for non-array input', () => {
    expect(clipCandidates(undefined)).toEqual([]);
    expect(clipCandidates(null)).toEqual([]);
  });

  it('returns [] for empty input', () => {
    expect(clipCandidates([])).toEqual([]);
  });

  it('returns [] below MIN_WINDOWS', () => {
    const windows = [mkLevelWindow([{ peak: 2 }]), mkLevelWindow([{ peak: 2 }])];
    expect(windows.length).toBeLessThan(MIN_WINDOWS);
    expect(clipCandidates(windows)).toEqual([]);
  });

  it('returns [] when peaks sit safely below CLIP_RISK_PEAK_DBFS', () => {
    const windows = [mkLevelWindow([{ peak: -20 }]), mkLevelWindow([{ peak: -20 }]), mkLevelWindow([{ peak: -20 }])];
    expect(clipCandidates(windows)).toEqual([]);
  });

  it('emits one clip-risk candidate with category clipping when peaks exceed the threshold', () => {
    const peak = CLIP_RISK_PEAK_DBFS + 3;
    const windows = [mkLevelWindow([{ peak }]), mkLevelWindow([{ peak }]), mkLevelWindow([{ peak }])];
    const candidates = clipCandidates(windows);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe('clip-risk');
    expect(candidates[0].category).toBe('clipping');
    expect(candidates[0].scope).toBe('mix');
    expect(candidates[0].severityDb).toBeCloseTo(3);
  });

  it('forces confidence to 1 when any window channel has clipping: true, even at low severity', () => {
    const windows = [
      mkLevelWindow([{ peak: -0.9, clipping: true }]),
      mkLevelWindow([{ peak: -0.9 }]),
      mkLevelWindow([{ peak: -0.9 }]),
    ];
    const candidates = clipCandidates(windows);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].confidence).toBe(1);
  });

  it('honours measurementSource and its fall-back to channel 0', () => {
    const windows = [
      mkLevelWindow([{ peak: -20 }, { peak: 2 }]),
      mkLevelWindow([{ peak: -20 }, { peak: 2 }]),
      mkLevelWindow([{ peak: -20 }, { peak: 2 }]),
    ];
    expect(clipCandidates(windows, 0)).toEqual([]);
    expect(clipCandidates(windows, 1)).toHaveLength(1);
    expect(clipCandidates(windows, 7)).toEqual([]); // falls back to channel 0
  });
});

describe('rankCandidates', () => {
  it('returns [] for null/non-array input', () => {
    expect(rankCandidates(null)).toEqual([]);
    expect(rankCandidates(undefined)).toEqual([]);
    expect(rankCandidates('nope')).toEqual([]);
  });

  it('does not mutate its argument', () => {
    const input = [
      { id: 'b', category: 'tonal', confidence: 0.5, severityDb: 1, scope: 'mix' },
      { id: 'a', category: 'tonal', confidence: 0.9, severityDb: 2, scope: 'mix' },
    ];
    const inputCopy = JSON.parse(JSON.stringify(input));
    rankCandidates(input);
    expect(input).toEqual(inputCopy);
  });

  it('filters out non-object entries', () => {
    const result = rankCandidates([null, 'nope', 5, { id: 'a', category: 'tonal', confidence: 0.5, severityDb: 1, scope: 'mix' }]);
    expect(result).toHaveLength(1);
  });

  it('orders clipping before tonal even when the tonal candidate has higher confidence (AC scenario 2)', () => {
    const tonal = { id: 'tonal-hi', category: 'tonal', confidence: 0.95, severityDb: 5, scope: 'mix' };
    const clip = { id: 'clip-risk', category: 'clipping', confidence: 0.4, severityDb: 0.1, scope: 'mix' };
    const ranked = rankCandidates([tonal, clip]);
    expect(ranked[0].id).toBe('clip-risk');
    expect(CATEGORY_PRIORITY.clipping).toBeGreaterThan(CATEGORY_PRIORITY.tonal);
  });

  it('breaks confidence ties by severityDb', () => {
    const a = { id: 'a', category: 'tonal', confidence: 0.7, severityDb: 1, scope: 'mix' };
    const b = { id: 'b', category: 'tonal', confidence: 0.7, severityDb: 3, scope: 'mix' };
    const ranked = rankCandidates([a, b]);
    expect(ranked.map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('breaks confidence+severity ties by scope, mix before input', () => {
    const inputCand = { id: 'x', category: 'tonal', confidence: 0.7, severityDb: 1, scope: 'input' };
    const mixCand = { id: 'y', category: 'tonal', confidence: 0.7, severityDb: 1, scope: 'mix' };
    const ranked = rankCandidates([inputCand, mixCand]);
    expect(ranked.map((c) => c.id)).toEqual(['y', 'x']);
  });

  it('breaks remaining ties by id, lexicographic ascending', () => {
    const b = { id: 'b', category: 'tonal', confidence: 0.7, severityDb: 1, scope: 'mix' };
    const a = { id: 'a', category: 'tonal', confidence: 0.7, severityDb: 1, scope: 'mix' };
    const ranked = rankCandidates([b, a]);
    expect(ranked.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('breaks a three-way id tie in both comparison directions', () => {
    const c = { id: 'c', category: 'tonal', confidence: 0.7, severityDb: 1, scope: 'mix' };
    const a = { id: 'a', category: 'tonal', confidence: 0.7, severityDb: 1, scope: 'mix' };
    const b = { id: 'b', category: 'tonal', confidence: 0.7, severityDb: 1, scope: 'mix' };
    const ranked = rankCandidates([c, a, b]);
    expect(ranked.map((c2) => c2.id)).toEqual(['a', 'b', 'c']);
  });

  it('treats equal ids as an outright tie (stable order)', () => {
    const first = { id: 'same', category: 'tonal', confidence: 0.7, severityDb: 1, scope: 'mix', tag: 'first' };
    const second = { id: 'same', category: 'tonal', confidence: 0.7, severityDb: 1, scope: 'mix', tag: 'second' };
    const ranked = rankCandidates([first, second]);
    expect(ranked).toHaveLength(2);
    expect(ranked.map((c) => c.tag)).toEqual(['first', 'second']);
  });
});

describe('selectCoachingCandidate', () => {
  it('returns the single top-ranked candidate when several clear the gate (AC scenario 1)', () => {
    const a = { id: 'a', category: 'tonal', confidence: 0.9, severityDb: 5, scope: 'mix' };
    const b = { id: 'b', category: 'tonal', confidence: 0.7, severityDb: 3, scope: 'mix' };
    expect(selectCoachingCandidate([a, b])).toBe(a);
  });

  it('returns null when every candidate is below MIN_CONFIDENCE (AC scenario 3)', () => {
    const a = { id: 'a', category: 'tonal', confidence: 0.5, severityDb: 1, scope: 'mix' };
    const b = { id: 'b', category: 'clipping', confidence: 0.4, severityDb: 0.1, scope: 'mix' };
    expect(selectCoachingCandidate([a, b])).toBeNull();
  });

  it('returns a lower-priority candidate when the higher-priority one is below the gate', () => {
    const clip = { id: 'clip-risk', category: 'clipping', confidence: 0.5, severityDb: 0.1, scope: 'mix' };
    const tonal = { id: 'tonal', category: 'tonal', confidence: 0.9, severityDb: 5, scope: 'mix' };
    expect(selectCoachingCandidate([clip, tonal])).toBe(tonal);
  });

  it('returns null for [] and null', () => {
    expect(selectCoachingCandidate([])).toBeNull();
    expect(selectCoachingCandidate(null)).toBeNull();
  });
});

describe('coachingCardHTML', () => {
  const selected = {
    id: 'low-end',
    title: 'Low-end buildup',
    why: 'Extra energy below 250 Hz masks vocals and makes the room feel muddy from the back.',
    action: 'Consider a small cut in the 60–250 Hz range, or a high-pass on channels that don’t need lows.',
    scope: 'mix',
    scopeLabel: 'Overall mix',
    confidence: 0.9,
  };

  it('contains the title, why, action, confidence label, flags, and scope for a selected candidate', () => {
    const html = coachingCardHTML(selected, null);
    expect(html).toContain('data-candidate-id="low-end"');
    expect(html).toContain('Low-end buildup');
    expect(html).toContain(selected.why);
    expect(html).toContain(selected.action);
    expect(html).toContain('Confidence: High');
    expect(html).toContain('Experimental · Advisory');
    expect(html).toContain('Advisory only');
    expect(html).toContain('Overall mix');
  });

  it('shows "Focused input: <name>" for scope input candidates', () => {
    const inputCandidate = { ...selected, scope: 'input', scopeLabel: 'Focused input' };
    const html = coachingCardHTML(inputCandidate, 'Kick');
    expect(html).toContain('Focused input: Kick');
  });

  it('shows plain "Focused input" when no focus name was passed', () => {
    const inputCandidate = { ...selected, scope: 'input', scopeLabel: 'Focused input' };
    const html = coachingCardHTML(inputCandidate, null);
    expect(html).toContain('Focused input');
    expect(html).not.toContain('Focused input: ');
  });

  it('HTML-escapes a focus name containing <, &, and "', () => {
    const inputCandidate = { ...selected, scope: 'input', scopeLabel: 'Focused input' };
    const html = coachingCardHTML(inputCandidate, '<a>&"');
    expect(html).not.toContain('<a>&"');
    expect(html).toContain('&lt;a&gt;&amp;&quot;');
  });

  it('renders lap-card-monitoring with monitoring copy for null candidate, no title or confidence', () => {
    const html = coachingCardHTML(null);
    expect(html).toContain('lap-card-monitoring');
    expect(html).toContain('Monitoring — not enough evidence to advise yet');
    expect(html).not.toContain('lap-card-title');
    expect(html).not.toContain('Confidence:');
  });
});

describe('panelHTML — ranked coaching card (#611)', () => {
  it('renders exactly one .lap-card in every state', () => {
    const waiting = panelHTML({ liveAdjustmentsEnabled: true }, 'live');
    // Boundary-aware: a naive /class="lap-card/g also matches the card's own
    // sub-element classes (lap-card-title, lap-card-label, ...), which all
    // share that literal prefix — this anchors to the card element itself.
    expect(waiting.match(/class="lap-card(?:"|\s)/g)).toHaveLength(1);

    const hotBass = { ...FLAT, bass: FLAT.bass + 20 };
    const windows = [mkWindow(hotBass), mkWindow(hotBass), mkWindow(hotBass)];
    const withCandidates = panelHTML({ liveAdjustmentsEnabled: true }, 'live', windows, null);
    expect(withCandidates.match(/class="lap-card(?:"|\s)/g)).toHaveLength(1);
  });

  it('the waiting state renders the monitoring card', () => {
    const html = panelHTML({ liveAdjustmentsEnabled: true }, 'live');
    expect(html).toContain('lap-card-monitoring');
  });

  it('hot-bass windows render a low-end card via data-candidate-id', () => {
    const hotBass = { ...FLAT, bass: FLAT.bass + 20 };
    const windows = [mkWindow(hotBass), mkWindow(hotBass), mkWindow(hotBass)];
    const html = panelHTML({ liveAdjustmentsEnabled: true }, 'live', windows, null);
    expect(html).toContain('data-candidate-id="low-end"');
  });

  it('windows with clipping peaks and hot bass render the clip-risk card', () => {
    const hotBass = { ...FLAT, bass: FLAT.bass + 20 };
    const windows = [
      { type: 'window', window: 1, channels: [{ bands: hotBass, peak: 2, clipping: true }] },
      { type: 'window', window: 2, channels: [{ bands: hotBass, peak: 2, clipping: true }] },
      { type: 'window', window: 3, channels: [{ bands: hotBass, peak: 2, clipping: true }] },
    ];
    const html = panelHTML({ liveAdjustmentsEnabled: true }, 'live', windows, null);
    expect(html).toContain('data-candidate-id="clip-risk"');
  });

  it('the card block appears before the existing lap-note/lap-candidates markup', () => {
    const hotBass = { ...FLAT, bass: FLAT.bass + 20 };
    const windows = [mkWindow(hotBass), mkWindow(hotBass), mkWindow(hotBass)];
    const html = panelHTML({ liveAdjustmentsEnabled: true }, 'live', windows, null);
    const cardIdx = html.indexOf('lap-card');
    const noteIdx = html.indexOf('lap-note');
    expect(cardIdx).toBeGreaterThan(-1);
    expect(noteIdx).toBeGreaterThan(-1);
    expect(cardIdx).toBeLessThan(noteIdx);
  });
});
