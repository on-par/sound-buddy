import { describe, it, expect } from 'vitest';

// daw-waveform-state is a plain classic script (window.dawWaveformState / module.exports).
const {
  create,
  decodeMixLane,
  decodeLanes,
  append,
  bucketsPerSecond,
  columnPeaks,
  captureModeToken,
  MAX_WAVEFORM_BUCKETS,
} = require('./daw-waveform-state.js') as {
  create: () => { pairs: Array<{ min: number; max: number }> };
  decodeMixLane: (frame: unknown) => Array<{ min: number; max: number }> | null;
  decodeLanes: (frame: unknown) => Record<string, Array<{ min: number; max: number }>> | null;
  append: (
    state: { pairs: Array<{ min: number; max: number }> },
    pairs: Array<{ min: number; max: number }>
  ) => { pairs: Array<{ min: number; max: number }> };
  bucketsPerSecond: (intervalSecs: number) => number;
  columnPeaks: (
    pairs: Array<{ min: number; max: number }>,
    bucketsPerSec: number,
    pxPerSecond: number,
    maxPx: number
  ) => Array<{ min: number; max: number }>;
  captureModeToken: (liveRunning: boolean, liveMode: string) => string;
  MAX_WAVEFORM_BUCKETS: number;
};

describe('create', () => {
  it('returns a fresh empty state', () => {
    expect(create()).toEqual({ pairs: [] });
  });

  it('returns a distinct object each call', () => {
    expect(create()).not.toBe(create());
  });
});

describe('decodeMixLane', () => {
  it('decodes a hand-built base64 mix lane', () => {
    // bytes [0, 255, 128, 128] -> base64 "AP+AgA=="
    const frame = { type: 'peaks', ts: 1, lanes: [{ id: 'mix', data: 'AP+AgA==' }] };
    const pairs = decodeMixLane(frame)!;
    expect(pairs).toHaveLength(2);
    expect(pairs[0].min).toBeCloseTo(-1, 5);
    expect(pairs[0].max).toBeCloseTo(1, 5);
    expect(pairs[1].min).toBeCloseTo(0, 2);
    expect(pairs[1].max).toBeCloseTo(0, 2);
  });

  it('returns null for a null frame', () => {
    expect(decodeMixLane(null)).toBeNull();
  });

  it('returns null when lanes is missing', () => {
    expect(decodeMixLane({ type: 'peaks', ts: 1 })).toBeNull();
  });

  it('returns null when there is no mix lane', () => {
    expect(decodeMixLane({ type: 'peaks', ts: 1, lanes: [{ id: 'strip0', data: 'AAA=' }] })).toBeNull();
  });

  it('returns null for bad base64', () => {
    expect(decodeMixLane({ type: 'peaks', ts: 1, lanes: [{ id: 'mix', data: '!!!not-base64!!!' }] })).toBeNull();
  });

  it('returns null for empty data', () => {
    expect(decodeMixLane({ type: 'peaks', ts: 1, lanes: [{ id: 'mix', data: '' }] })).toBeNull();
  });

  it('returns null for odd-length decoded bytes (truncated pair)', () => {
    // "AA==" decodes to a single 0x00 byte — no complete (min,max) pair.
    expect(decodeMixLane({ type: 'peaks', ts: 1, lanes: [{ id: 'mix', data: 'AA==' }] })).toBeNull();
  });
});

describe('decodeLanes', () => {
  it('decodes a two-lane frame into an object keyed by lane id', () => {
    // "mix" bytes [0, 255, 128, 128] -> "AP+AgA=="; "strip0" bytes [64, 192] -> "QMA="
    const frame = {
      type: 'peaks',
      ts: 1,
      lanes: [
        { id: 'mix', data: 'AP+AgA==' },
        { id: 'strip0', data: 'QMA=' },
      ],
    };
    const lanes = decodeLanes(frame)!;
    expect(Object.keys(lanes).sort()).toEqual(['mix', 'strip0']);
    expect(lanes.mix).toHaveLength(2);
    expect(lanes.mix[0].min).toBeCloseTo(-1, 5);
    expect(lanes.mix[0].max).toBeCloseTo(1, 5);
    expect(lanes.strip0).toHaveLength(1);
    expect(lanes.strip0[0].min).toBeCloseTo(64 / 255 * 2 - 1, 5);
    expect(lanes.strip0[0].max).toBeCloseTo(192 / 255 * 2 - 1, 5);
  });

  it('returns null for a null frame', () => {
    expect(decodeLanes(null)).toBeNull();
  });

  it('returns null when lanes is missing', () => {
    expect(decodeLanes({ type: 'peaks', ts: 1 })).toBeNull();
  });

  it('skips a lane with bad base64, empty data, odd-length bytes, or a missing id, keeping well-formed lanes', () => {
    const frame = {
      type: 'peaks',
      ts: 1,
      lanes: [
        { id: 'mix', data: 'AP+AgA==' },
        { id: 'bad-base64', data: '!!!not-base64!!!' },
        { id: 'empty', data: '' },
        { id: 'odd', data: 'AA==' },
        { data: 'AP+AgA==' },
      ],
    };
    const lanes = decodeLanes(frame)!;
    expect(Object.keys(lanes)).toEqual(['mix']);
    expect(lanes.mix).toHaveLength(2);
  });
});

describe('append', () => {
  it('accumulates pairs onto empty state', () => {
    const s = append(create(), [{ min: -0.1, max: 0.1 }]);
    expect(s.pairs).toEqual([{ min: -0.1, max: 0.1 }]);
  });

  it('accumulates onto existing pairs, preserving order', () => {
    let s = create();
    s = append(s, [{ min: -0.1, max: 0.1 }]);
    s = append(s, [{ min: -0.2, max: 0.2 }]);
    expect(s.pairs).toEqual([
      { min: -0.1, max: 0.1 },
      { min: -0.2, max: 0.2 },
    ]);
  });

  it('stops appending past MAX_WAVEFORM_BUCKETS without dropping from the front', () => {
    const big = Array.from({ length: MAX_WAVEFORM_BUCKETS }, () => ({ min: 0, max: 0 }));
    let s = { pairs: big };
    const first = s.pairs[0];
    s = append(s, [{ min: 1, max: 1 }]);
    expect(s.pairs).toHaveLength(MAX_WAVEFORM_BUCKETS);
    expect(s.pairs[0]).toBe(first);
    expect(s.pairs[s.pairs.length - 1]).not.toEqual({ min: 1, max: 1 });
  });

  it('truncates an over-large append to only fill remaining room', () => {
    const almostFull = Array.from({ length: MAX_WAVEFORM_BUCKETS - 1 }, () => ({ min: 0, max: 0 }));
    const s = append({ pairs: almostFull }, [
      { min: 1, max: 1 },
      { min: 2, max: 2 },
    ]);
    expect(s.pairs).toHaveLength(MAX_WAVEFORM_BUCKETS);
    expect(s.pairs[s.pairs.length - 1]).toEqual({ min: 1, max: 1 });
  });
});

describe('bucketsPerSecond', () => {
  it('0.1s interval -> 50 buckets/sec', () => {
    expect(bucketsPerSecond(0.1)).toBeCloseTo(50, 5);
  });

  it('0.25s interval -> 48 buckets/sec', () => {
    expect(bucketsPerSecond(0.25)).toBeCloseTo(48, 5);
  });

  it('0.05s interval -> 40 buckets/sec', () => {
    expect(bucketsPerSecond(0.05)).toBeCloseTo(40, 5);
  });

  it('guards zero by returning the nominal rate', () => {
    expect(bucketsPerSecond(0)).toBe(50);
  });

  it('guards NaN by returning the nominal rate', () => {
    expect(bucketsPerSecond(NaN)).toBe(50);
  });

  it('guards negative input by returning the nominal rate', () => {
    expect(bucketsPerSecond(-1)).toBe(50);
  });
});

describe('columnPeaks', () => {
  it('returns [] for empty pairs', () => {
    expect(columnPeaks([], 50, 8, 400)).toEqual([]);
  });

  it('one column per bucket when there are fewer buckets than pixels', () => {
    const pairs = [
      { min: -0.1, max: 0.1 },
      { min: -0.2, max: 0.2 },
    ];
    expect(columnPeaks(pairs, 1, 1, 10)).toEqual(pairs);
  });

  it('aggregates multiple buckets into one column (min-of-mins, max-of-maxes)', () => {
    const pairs = [
      { min: 0.1, max: 0.2 },
      { min: -0.5, max: 0.05 },
      { min: 0.0, max: 0.9 },
      { min: -0.9, max: 0.0 },
    ];
    const cols = columnPeaks(pairs, 4, 1, 2);
    expect(cols).toHaveLength(1);
    expect(cols[0].min).toBeCloseTo(-0.9, 5);
    expect(cols[0].max).toBeCloseTo(0.9, 5);
  });

  it('clamps to at most Math.floor(maxPx) columns', () => {
    const pairs = Array.from({ length: 100 }, () => ({ min: 0, max: 0 }));
    const cols = columnPeaks(pairs, 100, 1, 5);
    expect(cols.length).toBeLessThanOrEqual(5);
  });

  it('all-zero pairs produce all-zero columns (silence)', () => {
    const pairs = Array.from({ length: 8 }, () => ({ min: 0, max: 0 }));
    const cols = columnPeaks(pairs, 2, 1, 10);
    expect(cols.length).toBeGreaterThan(0);
    for (const c of cols) {
      expect(c.min).toBe(0);
      expect(c.max).toBe(0);
    }
  });
});

describe('captureModeToken', () => {
  it('is "stopped" when not running', () => {
    expect(captureModeToken(false, 'record')).toBe('stopped');
    expect(captureModeToken(false, 'monitor')).toBe('stopped');
  });

  it('is "recording" when running in record mode', () => {
    expect(captureModeToken(true, 'record')).toBe('recording');
  });

  it('is "monitoring" when running in any non-record mode', () => {
    expect(captureModeToken(true, 'monitor')).toBe('monitoring');
    expect(captureModeToken(true, 'live')).toBe('monitoring');
  });
});
