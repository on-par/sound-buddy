import { describe, it, expect } from 'vitest';

// instrument-profiles is a plain classic script (window.instrumentProfiles /
// module.exports), same style as channel-labels.js, so the inference/override
// rules are exercised without a DOM.
const {
  PROFILES,
  GENERIC_ID,
  inferProfileId,
  isKnownProfileId,
  profileById,
  effectiveProfileId,
  recordOverride,
} = require('./instrument-profiles.js') as {
  PROFILES: Array<{ id: string; label: string; keywords: string[]; bands: Record<string, number> }>;
  GENERIC_ID: string;
  inferProfileId: (label: string | null | undefined) => string;
  isKnownProfileId: (id: string) => boolean;
  profileById: (id: string) => { id: string; label: string; keywords: string[]; bands: Record<string, number> };
  effectiveProfileId: (
    overridesForDevice: Record<string, string> | null | undefined,
    token: string,
    label: string | null | undefined,
  ) => string;
  recordOverride: (
    all: Record<string, Record<string, string>> | null | undefined,
    deviceName: string,
    token: string,
    profileId: string,
  ) => Record<string, Record<string, string>>;
};

const BAND_KEYS = ['subBass', 'bass', 'lowMid', 'mid', 'highMid', 'presence', 'brilliance'];
const EXPECTED_IDS = ['kick', 'bass', 'acoustic-guitar', 'electric-guitar', 'vocal', 'keys', 'generic'];

describe('PROFILES', () => {
  it('has exactly 7 profiles with the expected ids, in order', () => {
    expect(PROFILES).toHaveLength(7);
    expect(PROFILES.map((p) => p.id)).toEqual(EXPECTED_IDS);
  });

  it('every profile has all 7 ideal-curves band keys with finite numbers in [-18, 18]', () => {
    PROFILES.forEach((p) => {
      BAND_KEYS.forEach((key) => {
        const v = p.bands[key];
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(-18);
        expect(v).toBeLessThanOrEqual(18);
      });
    });
  });

  it('generic bands are all 0', () => {
    const generic = PROFILES.find((p) => p.id === GENERIC_ID)!;
    BAND_KEYS.forEach((key) => expect(generic.bands[key]).toBe(0));
  });
});

describe('inferProfileId', () => {
  it('"Bass" infers bass (acceptance scenario 1)', () => {
    expect(inferProfileId('Bass')).toBe('bass');
  });

  it('"Kick" and "Bass Drum" infer kick, taking precedence over bass', () => {
    expect(inferProfileId('Kick')).toBe('kick');
    expect(inferProfileId('Bass Drum')).toBe('kick');
  });

  it('"Bass Gtr" infers bass, taking precedence over the guitars', () => {
    expect(inferProfileId('Bass Gtr')).toBe('bass');
  });

  it('"Ac Gtr" and "Acoustic" infer acoustic-guitar', () => {
    expect(inferProfileId('Ac Gtr')).toBe('acoustic-guitar');
    expect(inferProfileId('Acoustic')).toBe('acoustic-guitar');
  });

  it('"EGtr", "Gtr 1", "Electric" infer electric-guitar', () => {
    expect(inferProfileId('EGtr')).toBe('electric-guitar');
    expect(inferProfileId('Gtr 1')).toBe('electric-guitar');
    expect(inferProfileId('Electric')).toBe('electric-guitar');
  });

  it('"Lead Vox", "PASTOR", "Choir L" infer vocal (case-insensitive)', () => {
    expect(inferProfileId('Lead Vox')).toBe('vocal');
    expect(inferProfileId('PASTOR')).toBe('vocal');
    expect(inferProfileId('Choir L')).toBe('vocal');
  });

  it('"Keys", "Piano", "Synth Pad" infer keys', () => {
    expect(inferProfileId('Keys')).toBe('keys');
    expect(inferProfileId('Piano')).toBe('keys');
    expect(inferProfileId('Synth Pad')).toBe('keys');
  });

  it('"Talkback", "", null, undefined fall back to generic (acceptance scenario 3)', () => {
    expect(inferProfileId('Talkback')).toBe('generic');
    expect(inferProfileId('')).toBe('generic');
    expect(inferProfileId(null)).toBe('generic');
    expect(inferProfileId(undefined)).toBe('generic');
  });
});

describe('profileById', () => {
  it('returns the matching profile for a known id', () => {
    expect(profileById('bass').id).toBe('bass');
  });

  it('returns the generic profile for an unknown or empty id', () => {
    expect(profileById('flute').id).toBe('generic');
    expect(profileById('').id).toBe('generic');
  });
});

describe('isKnownProfileId', () => {
  it('is true for a known id', () => {
    expect(isKnownProfileId('bass')).toBe(true);
  });

  it('is false for "auto", "", and an unknown id', () => {
    expect(isKnownProfileId('auto')).toBe(false);
    expect(isKnownProfileId('')).toBe(false);
    expect(isKnownProfileId('flute')).toBe(false);
  });
});

describe('effectiveProfileId', () => {
  it('override wins over label inference (acceptance scenario 2)', () => {
    expect(effectiveProfileId({ '0': 'vocal' }, '0', 'Bass')).toBe('vocal');
  });

  it('an unknown override id falls back to inference', () => {
    expect(effectiveProfileId({ '0': 'flute' }, '0', 'Bass')).toBe('bass');
  });

  it('a null overrides map behaves as empty', () => {
    expect(effectiveProfileId(null, '0', 'Bass')).toBe('bass');
    expect(effectiveProfileId(undefined, '0', 'Bass')).toBe('bass');
  });

  it('no override falls back to inference', () => {
    expect(effectiveProfileId({ '1': 'vocal' }, '0', 'Bass')).toBe('bass');
  });
});

describe('recordOverride', () => {
  it('sets an entry without mutating the input map', () => {
    const all = { Scarlett: { '0': 'bass' } };
    const next = recordOverride(all, 'Scarlett', '1', 'vocal');
    expect(next).toEqual({ Scarlett: { '0': 'bass', '1': 'vocal' } });
    expect(all).toEqual({ Scarlett: { '0': 'bass' } });
  });

  it('"" deletes the token entry and prunes an emptied device', () => {
    const all = { Scarlett: { '0': 'bass' } };
    expect(recordOverride(all, 'Scarlett', '0', '')).toEqual({});
  });

  it('"auto" deletes the token entry and prunes an emptied device', () => {
    const all = { Scarlett: { '0': 'bass' } };
    expect(recordOverride(all, 'Scarlett', '0', 'auto')).toEqual({});
  });

  it('an unknown profile id deletes the token entry and prunes an emptied device', () => {
    const all = { Scarlett: { '0': 'bass' } };
    expect(recordOverride(all, 'Scarlett', '0', 'flute')).toEqual({});
  });

  it('overrides for other devices/tokens ride through unchanged', () => {
    const all = { Scarlett: { '0': 'bass', '1': 'vocal' }, '': { '2': 'keys' } };
    const next = recordOverride(all, 'Scarlett', '0', '');
    expect(next).toEqual({ Scarlett: { '1': 'vocal' }, '': { '2': 'keys' } });
  });

  it('a very long garbage id is still just an unknown id: deleted, not stored', () => {
    const long = 'x'.repeat(200);
    expect(recordOverride({}, 'Scarlett', '0', long)).toEqual({});
  });
});
