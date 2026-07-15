import { describe, it, expect } from 'vitest';
import { findSpectralPeaks } from '../../packages/audio-engine/src/analyze/spectral.js';

// feedback-ringout-state is a plain classic script (window.feedbackRingout in
// the browser, module.exports under Node) so the pure wizard/DSP/profile
// logic is exercised without a DOM, mirroring build-order-state.test.ts.
// identifyRing is exercised against the real findSpectralPeaks (#376) rather
// than a fake, so the DSP behavior this feature depends on is actually proven.
interface Step {
  id: string;
  label: string;
  instructions: string[];
}
interface Cut {
  freq: number;
  gainDb: number;
  q: number;
}
interface Profile {
  mic: string;
  cuts: Cut[];
}
interface Profiles {
  profiles: Profile[];
}
interface SpectrumCurve {
  freqs: number[];
  db: number[];
}
interface Ring {
  freq: number;
  db: number;
  prominence: number;
}
interface FakeStorage {
  store: Record<string, string>;
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

const {
  STORAGE_KEY,
  DEFAULT_CUT_GAIN_DB,
  DEFAULT_CUT_Q,
  MIN_FREQ_HZ,
  MAX_FREQ_HZ,
  ISO_THIRD_OCTAVE,
  STEPS,
  stepCount,
  clampStep,
  stepAt,
  stepId,
  isFirstStep,
  isLastStep,
  identifyRing,
  snapToIso,
  suggestCut,
  parseManualFrequency,
  emptyProfiles,
  isValidProfile,
  loadProfiles,
  getProfile,
  saveProfile,
  deleteProfile,
  formatCut,
  stepHtml,
  suggestionHtml,
  profileRowHtml,
} = require('./feedback-ringout-state.js') as {
  STORAGE_KEY: string;
  DEFAULT_CUT_GAIN_DB: number;
  DEFAULT_CUT_Q: number;
  MIN_FREQ_HZ: number;
  MAX_FREQ_HZ: number;
  ISO_THIRD_OCTAVE: number[];
  STEPS: Step[];
  stepCount: () => number;
  clampStep: (i: unknown) => number;
  stepAt: (i: number) => Step;
  stepId: (i: number) => string;
  isFirstStep: (i: number) => boolean;
  isLastStep: (i: number) => boolean;
  identifyRing: (
    curve: SpectrumCurve,
    findPeaks: unknown,
    opts?: unknown
  ) => Ring | null;
  snapToIso: (freq: number) => number | null;
  suggestCut: (freq: number, opts?: Partial<Cut>) => Cut | null;
  parseManualFrequency: (input: unknown) => number | null;
  emptyProfiles: () => Profiles;
  isValidProfile: (p: unknown) => boolean;
  loadProfiles: (storage: unknown) => Profiles;
  getProfile: (profiles: Profiles, mic: string) => Profile | null;
  saveProfile: (storage: unknown, profiles: Profiles, profile: Profile) => Profiles;
  deleteProfile: (storage: unknown, profiles: Profiles, mic: string) => Profiles;
  formatCut: (cut: Cut) => string;
  stepHtml: (index: number, escapeHtml: (s: unknown) => string) => string;
  suggestionHtml: (cut: Cut | null, escapeHtml: (s: unknown) => string) => string;
  profileRowHtml: (profile: Profile, escapeHtml: (s: unknown) => string) => string;
};

function escapeHtml(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] as string));
}

function makeStorage(): FakeStorage {
  const store: Record<string, string> = {};
  return {
    store,
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => { store[key] = value; },
  };
}

// A curve on the exact ISO grid with a clear -10 dB spike at 3150 Hz against
// a flat -40 dB floor everywhere else — a textbook feedback ring.
function ringingCurve(spikeFreq: number, spikeDb: number): SpectrumCurve {
  return {
    freqs: ISO_THIRD_OCTAVE.slice(),
    db: ISO_THIRD_OCTAVE.map((f) => (f === spikeFreq ? spikeDb : -40)),
  };
}

const EXPECTED_STEP_IDS = ['setup', 'raise-gain', 'capture', 'cut', 'retest', 'save'];

describe('STORAGE_KEY', () => {
  it('is the versioned ring-out profiles key', () => {
    expect(STORAGE_KEY).toBe('sb-ringout-profiles-v1');
  });
});

describe('STEPS', () => {
  it('has 6 steps in the exact expected order', () => {
    expect(STEPS.map((s) => s.id)).toEqual(EXPECTED_STEP_IDS);
    expect(STEPS).toHaveLength(6);
  });

  it('every step has a label and at least one instruction', () => {
    STEPS.forEach((step) => {
      expect(step.label.length).toBeGreaterThan(0);
      expect(Array.isArray(step.instructions)).toBe(true);
      expect(step.instructions.length).toBeGreaterThan(0);
    });
  });
});

describe('stepCount', () => {
  it('matches STEPS.length', () => {
    expect(stepCount()).toBe(6);
  });
});

describe('clampStep', () => {
  it('clamps below 0 up to 0', () => {
    expect(clampStep(-1)).toBe(0);
    expect(clampStep(-100)).toBe(0);
  });

  it('clamps above the max down to the last index', () => {
    expect(clampStep(100)).toBe(5);
  });

  it('coerces non-finite input to 0', () => {
    expect(clampStep(NaN)).toBe(0);
    expect(clampStep(Infinity)).toBe(0);
    expect(clampStep(-Infinity)).toBe(0);
    expect(clampStep(undefined)).toBe(0);
  });

  it('passes through a valid in-range index unchanged', () => {
    expect(clampStep(3)).toBe(3);
  });
});

describe('stepAt / stepId', () => {
  it('returns the step object / id at a clamped index', () => {
    expect(stepAt(0).id).toBe('setup');
    expect(stepId(2)).toBe('capture');
    expect(stepId(-1)).toBe('setup');
    expect(stepId(999)).toBe('save');
  });
});

describe('isFirstStep / isLastStep', () => {
  it('is true only at the respective bound', () => {
    expect(isFirstStep(0)).toBe(true);
    expect(isFirstStep(1)).toBe(false);
    expect(isLastStep(5)).toBe(true);
    expect(isLastStep(4)).toBe(false);
  });

  it('bounds hold after clamping out-of-range input', () => {
    expect(isFirstStep(-5)).toBe(true);
    expect(isLastStep(999)).toBe(true);
  });
});

describe('identifyRing', () => {
  it('finds the ringing frequency of a clear spike using the real findSpectralPeaks', () => {
    const curve = ringingCurve(3150, -10);
    const ring = identifyRing(curve, findSpectralPeaks);
    expect(ring).not.toBeNull();
    expect(ring!.freq).toBe(3150);
    expect(ring!.db).toBe(-10);
  });

  it('returns null for a flat curve with no resonance', () => {
    const curve: SpectrumCurve = { freqs: ISO_THIRD_OCTAVE.slice(), db: ISO_THIRD_OCTAVE.map(() => -40) };
    expect(identifyRing(curve, findSpectralPeaks)).toBeNull();
  });

  it('returns null when findPeaks is not a function', () => {
    const curve = ringingCurve(3150, -10);
    expect(identifyRing(curve, undefined)).toBeNull();
    expect(identifyRing(curve, 'nope')).toBeNull();
  });

  it('returns null for an invalid curve', () => {
    expect(identifyRing(null as unknown as SpectrumCurve, findSpectralPeaks)).toBeNull();
    expect(identifyRing({ freqs: [1] } as unknown as SpectrumCurve, findSpectralPeaks)).toBeNull();
  });

  it('returns null when the finder yields no peaks', () => {
    const curve = ringingCurve(3150, -10);
    expect(identifyRing(curve, () => [])).toBeNull();
  });
});

describe('snapToIso', () => {
  it('snaps 3100 -> 3150 and 990 -> 1000 (nearest by log distance)', () => {
    expect(snapToIso(3100)).toBe(3150);
    expect(snapToIso(990)).toBe(1000);
  });

  it('leaves an exact center unchanged', () => {
    expect(snapToIso(1000)).toBe(1000);
  });

  it('returns null for non-finite or non-positive input', () => {
    expect(snapToIso(NaN)).toBeNull();
    expect(snapToIso(Infinity)).toBeNull();
    expect(snapToIso(0)).toBeNull();
    expect(snapToIso(-100)).toBeNull();
  });
});

describe('suggestCut', () => {
  it('snaps the frequency and fills in the default gain/Q', () => {
    expect(suggestCut(3140)).toEqual({ freq: 3150, gainDb: DEFAULT_CUT_GAIN_DB, q: DEFAULT_CUT_Q });
    expect(DEFAULT_CUT_GAIN_DB).toBe(-6);
    expect(DEFAULT_CUT_Q).toBe(6.0);
  });

  it('honors gainDb/q overrides in opts', () => {
    expect(suggestCut(3140, { gainDb: -9, q: 8 })).toEqual({ freq: 3150, gainDb: -9, q: 8 });
  });

  it('returns null for a non-finite frequency', () => {
    expect(suggestCut(NaN)).toBeNull();
    expect(suggestCut(Infinity)).toBeNull();
  });
});

describe('parseManualFrequency', () => {
  it('parses a valid in-range frequency', () => {
    expect(parseManualFrequency('3150')).toBe(3150);
    expect(parseManualFrequency('440.5')).toBeCloseTo(440.5, 5);
  });

  it('rejects below MIN_FREQ_HZ and above MAX_FREQ_HZ', () => {
    expect(MIN_FREQ_HZ).toBe(20);
    expect(MAX_FREQ_HZ).toBe(20000);
    expect(parseManualFrequency('5')).toBeNull();
    expect(parseManualFrequency('25000')).toBeNull();
  });

  it('rejects unparseable input', () => {
    expect(parseManualFrequency('abc')).toBeNull();
    expect(parseManualFrequency('')).toBeNull();
  });
});

describe('profiles', () => {
  it('emptyProfiles() is an empty profiles list', () => {
    expect(emptyProfiles()).toEqual({ profiles: [] });
  });

  it('isValidProfile requires a non-empty mic name and an array of finite cuts', () => {
    expect(isValidProfile({ mic: 'SM58', cuts: [{ freq: 3150, gainDb: -6, q: 6 }] })).toBe(true);
    expect(isValidProfile({ mic: '', cuts: [] })).toBe(false);
    expect(isValidProfile({ mic: 'SM58', cuts: [{ freq: NaN, gainDb: -6, q: 6 }] })).toBe(false);
    expect(isValidProfile(null)).toBe(false);
  });

  it('loadProfiles returns emptyProfiles() for missing/malformed/throwing storage', () => {
    expect(loadProfiles(undefined)).toEqual(emptyProfiles());
    const malformed = makeStorage();
    malformed.store[STORAGE_KEY] = '{not json';
    expect(loadProfiles(malformed)).toEqual(emptyProfiles());
    const throwing = {
      getItem: () => { throw new Error('private mode'); },
      setItem: () => { throw new Error('private mode'); },
    };
    expect(loadProfiles(throwing)).toEqual(emptyProfiles());
  });

  it('loadProfiles filters invalid entries out of stored JSON', () => {
    const storage = makeStorage();
    storage.store[STORAGE_KEY] = JSON.stringify({
      profiles: [
        { mic: 'SM58', cuts: [{ freq: 3150, gainDb: -6, q: 6 }] },
        { mic: '', cuts: [] },
        { mic: 'Beta58', cuts: [{ freq: NaN, gainDb: -6, q: 6 }] },
      ],
    });
    expect(loadProfiles(storage)).toEqual({ profiles: [{ mic: 'SM58', cuts: [{ freq: 3150, gainDb: -6, q: 6 }] }] });
  });

  it('saveProfile persists a new profile and getProfile finds it (case-insensitive)', () => {
    const storage = makeStorage();
    const profile: Profile = { mic: 'SM58', cuts: [{ freq: 3150, gainDb: -6, q: 6 }] };
    const next = saveProfile(storage, emptyProfiles(), profile);
    expect(next.profiles).toHaveLength(1);
    expect(getProfile(next, 'sm58')).toEqual(profile);
    expect(getProfile(next, 'nope')).toBeNull();
    expect(loadProfiles(storage)).toEqual(next);
  });

  it('saveProfile replaces an existing profile with the same mic name, case-insensitively', () => {
    const storage = makeStorage();
    const first = saveProfile(storage, emptyProfiles(), { mic: 'SM58', cuts: [{ freq: 3150, gainDb: -6, q: 6 }] });
    const second = saveProfile(storage, first, { mic: 'sm58', cuts: [{ freq: 1000, gainDb: -9, q: 8 }] });
    expect(second.profiles).toHaveLength(1);
    expect(getProfile(second, 'SM58')!.cuts).toEqual([{ freq: 1000, gainDb: -9, q: 8 }]);
  });

  it('saveProfile ignores an invalid profile and returns the input unchanged', () => {
    const storage = makeStorage();
    const before = emptyProfiles();
    const after = saveProfile(storage, before, { mic: '', cuts: [] });
    expect(after).toBe(before);
  });

  it('deleteProfile removes a profile by mic name and persists', () => {
    const storage = makeStorage();
    const withProfile = saveProfile(storage, emptyProfiles(), { mic: 'SM58', cuts: [{ freq: 3150, gainDb: -6, q: 6 }] });
    const after = deleteProfile(storage, withProfile, 'sm58');
    expect(after.profiles).toHaveLength(0);
    expect(loadProfiles(storage)).toEqual(emptyProfiles());
  });
});

describe('stepHtml', () => {
  it('contains the escaped label and a Step N of M indicator', () => {
    const html = stepHtml(2, escapeHtml);
    expect(html).toContain('Capture the ringing frequency');
    expect(html).toContain('Step 3 of 6');
  });
});

describe('formatCut', () => {
  it('produces plain text with no markup (safe for textContent status lines)', () => {
    const text = formatCut({ freq: 3150, gainDb: -6, q: 6 });
    expect(text).toBe('Cut 3.15 kHz · -6 dB · Q 6.0');
    expect(text).not.toContain('<');
  });
});

describe('suggestionHtml', () => {
  it('formats a cut with kHz for freq >= 1000', () => {
    const html = suggestionHtml({ freq: 3150, gainDb: -6, q: 6 }, escapeHtml);
    expect(html).toContain('3.15 kHz');
    expect(html).toContain('Q 6.0');
  });

  it('renders an empty-state string for a null cut', () => {
    const html = suggestionHtml(null, escapeHtml);
    expect(html.length).toBeGreaterThan(0);
    expect(html).not.toContain('kHz');
  });
});

describe('profileRowHtml', () => {
  it('includes data-mic and escapes a hostile mic name', () => {
    const html = profileRowHtml(
      { mic: '<img src=x onerror=1>', cuts: [{ freq: 3150, gainDb: -6, q: 6 }] },
      escapeHtml
    );
    expect(html).not.toContain('<img src=x onerror=1>');
    expect(html).toContain('Recall');
    expect(html).toContain('Delete');
  });

  it('formats a sub-1000 Hz cut in Hz, not kHz', () => {
    const html = profileRowHtml({ mic: 'SM58', cuts: [{ freq: 440, gainDb: -6, q: 6 }] }, escapeHtml);
    expect(html).toContain('440 Hz');
    expect(html).not.toContain('kHz');
  });
});
