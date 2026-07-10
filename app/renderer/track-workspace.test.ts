import { describe, it, expect } from 'vitest';

// track-workspace is a plain classic script (window.trackWorkspace / module.exports).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { idleChannel, addEnabled, isEmpty } = require('./track-workspace.js') as {
  idleChannel: (bandKeys: string[]) => {
    name: undefined;
    rms: number;
    peak: number;
    clipping: boolean;
    centroid: null;
    bands: Record<string, number>;
    idle: true;
  };
  addEnabled: (used: number, total: number, capturing: boolean) => boolean;
  isEmpty: (configuredCount: number) => boolean;
};

const BAND_KEYS = ['sub_bass', 'bass', 'low_mid', 'mid', 'high_mid', 'presence', 'brilliance'];

describe('idleChannel', () => {
  it('floors every band key to -120', () => {
    const ch = idleChannel(BAND_KEYS);
    for (const k of BAND_KEYS) expect(ch.bands[k]).toBe(-120);
  });
  it('has non-finite rms/peak', () => {
    const ch = idleChannel(BAND_KEYS);
    expect(Number.isFinite(ch.rms)).toBe(false);
    expect(Number.isFinite(ch.peak)).toBe(false);
  });
  it('is not clipping and carries the idle marker', () => {
    const ch = idleChannel(BAND_KEYS);
    expect(ch.clipping).toBe(false);
    expect(ch.idle).toBe(true);
  });
  it('tolerates an empty band-key list', () => { expect(idleChannel([]).bands).toEqual({}); });
});

describe('addEnabled', () => {
  it('is true with channels free and not capturing', () => expect(addEnabled(2, 8, false)).toBe(true));
  it('is false at the device channel cap', () => expect(addEnabled(8, 8, false)).toBe(false));
  it('is false while capturing, even with channels free', () => expect(addEnabled(2, 8, true)).toBe(false));
  it('is false at the cap while capturing', () => expect(addEnabled(8, 8, true)).toBe(false));
});

describe('isEmpty', () => {
  it('is true with zero configured tracks', () => expect(isEmpty(0)).toBe(true));
  it('is false with at least one configured track', () => expect(isEmpty(1)).toBe(false));
  it('is false with several configured tracks', () => expect(isEmpty(3)).toBe(false));
});
