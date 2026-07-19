import { describe, expect, it } from 'vitest';
import {
  EQ_BAND_DEFS,
  EQ_BAR_GAP_PCT,
  EQ_DB_MIN,
  EQ_DB_MAX,
  EQ_DIM_DB,
  EQ_HOT_DB,
  EQ_GRID_DB,
  LIVE_AVG_WINDOW_MS,
  eqBarColumns,
  eqBarPercent,
  bandView,
  loudestBandIndex,
  barReadoutBottomPct,
  createRollingAverager,
  createRollingMax,
} from './eq-bands';

describe('EQ_BAND_DEFS', () => {
  it('has exactly 7 bands', () => {
    expect(EQ_BAND_DEFS).toHaveLength(7);
  });

  it('has contiguous ranges spanning 20 Hz to 20000 Hz', () => {
    expect(EQ_BAND_DEFS[0].lo).toBe(20);
    for (let i = 1; i < EQ_BAND_DEFS.length; i += 1) {
      expect(EQ_BAND_DEFS[i].lo).toBe(EQ_BAND_DEFS[i - 1].hi);
    }
    expect(EQ_BAND_DEFS[EQ_BAND_DEFS.length - 1].hi).toBe(20000);
  });

  it('labels match the audio-engine band names', () => {
    expect(EQ_BAND_DEFS.map((b) => b.label)).toEqual([
      'Sub-bass',
      'Bass',
      'Low-mid',
      'Mid',
      'High-mid',
      'Presence',
      'Brilliance',
    ]);
  });

  it('brilliance band tops out at 20000 Hz', () => {
    const brilliance = EQ_BAND_DEFS.find((b) => b.key === 'brilliance');
    expect(brilliance?.hi).toBe(20000);
  });

  it('every band has a compact range label', () => {
    for (const band of EQ_BAND_DEFS) {
      expect(band.rangeLabel).toMatch(/^\d+.\d+ Hz$/);
    }
  });
});

describe('eqBarColumns', () => {
  it('produces 7 equal-width columns', () => {
    const cols = eqBarColumns();
    expect(cols).toHaveLength(7);
    const widths = new Set(cols.map((c) => c.widthPct.toFixed(6)));
    expect(widths.size).toBe(1);
  });

  it('lays columns left to right with the gap inset on each side', () => {
    const cols = eqBarColumns();
    const w = 100 / 7;
    cols.forEach((col, i) => {
      expect(col.leftPct).toBeCloseTo(i * w + EQ_BAR_GAP_PCT, 6);
      expect(col.widthPct).toBeCloseTo(w - 2 * EQ_BAR_GAP_PCT, 6);
    });
  });

  it('centers each column at i*w + w/2', () => {
    const cols = eqBarColumns();
    const w = 100 / 7;
    cols.forEach((col, i) => {
      expect(col.centerPct).toBeCloseTo(i * w + w / 2, 6);
    });
  });

  it('carries the band key and label in the same order as EQ_BAND_DEFS', () => {
    const cols = eqBarColumns();
    expect(cols.map((c) => c.key)).toEqual(EQ_BAND_DEFS.map((b) => b.key));
    expect(cols.map((c) => c.label)).toEqual(EQ_BAND_DEFS.map((b) => b.label));
  });
});

describe('eqBarPercent', () => {
  it('clamps at or below EQ_DB_MIN to 0', () => {
    expect(eqBarPercent(EQ_DB_MIN)).toBe(0);
    expect(eqBarPercent(EQ_DB_MIN - 20)).toBe(0);
  });

  it('clamps at or above EQ_DB_MAX to 100', () => {
    expect(eqBarPercent(EQ_DB_MAX)).toBe(100);
    expect(eqBarPercent(EQ_DB_MAX + 20)).toBe(100);
  });

  it('maps an interior value linearly', () => {
    const mid = (EQ_DB_MIN + EQ_DB_MAX) / 2;
    expect(eqBarPercent(mid)).toBeCloseTo(50, 6);
  });
});

describe('bandView', () => {
  it('is dim at exactly EQ_DIM_DB', () => {
    expect(bandView(EQ_DIM_DB).dim).toBe(true);
  });

  it('is not dim just above EQ_DIM_DB', () => {
    expect(bandView(EQ_DIM_DB + 0.1).dim).toBe(false);
  });

  it('is hot above EQ_HOT_DB', () => {
    expect(bandView(EQ_HOT_DB + 0.1).hot).toBe(true);
  });

  it('is not hot at or below EQ_HOT_DB', () => {
    expect(bandView(EQ_HOT_DB).hot).toBe(false);
  });

  it('floors non-finite input to -120 before computing', () => {
    const view = bandView(Number.NEGATIVE_INFINITY);
    expect(view.dim).toBe(true);
    expect(view.val).toBe('-120.0');
    expect(view.pct).toBe(0);
  });

  it('formats val to one decimal place', () => {
    expect(bandView(-30).val).toBe('-30.0');
    expect(bandView(-30.26).val).toBe('-30.3');
  });
});

describe('loudestBandIndex', () => {
  it('picks the index of the loudest band', () => {
    expect(loudestBandIndex([-70, -65, -50, -10, -62, -63, -64])).toBe(3);
  });

  it('returns -1 when every band is at or below EQ_DIM_DB', () => {
    expect(loudestBandIndex([-70, -65, -60, -61, -62, -63, -64])).toBe(-1);
  });

  it('returns a real index once any band rises above EQ_DIM_DB', () => {
    expect(loudestBandIndex([-70, -65, -60, EQ_DIM_DB + 0.5, -62, -63, -64])).toBe(3);
  });
});

describe('barReadoutBottomPct', () => {
  it('caps at 90', () => {
    expect(barReadoutBottomPct(95)).toBe(90);
    expect(barReadoutBottomPct(100)).toBe(90);
  });

  it('passes through values at or below 90', () => {
    expect(barReadoutBottomPct(50)).toBe(50);
    expect(barReadoutBottomPct(90)).toBe(90);
  });
});

describe('createRollingAverager (db domain)', () => {
  it('returns the first sample unchanged', () => {
    const avg = createRollingAverager(3000, 'db');
    expect(avg.update([-20], 0)[0]).toBeCloseTo(-20, 6);
  });

  it('stays constant under constant input', () => {
    const avg = createRollingAverager(3000, 'db');
    avg.update([-18], 0);
    avg.update([-18], 500);
    const result = avg.update([-18], 1000);
    expect(result[0]).toBeCloseTo(-18, 6);
  });

  it('averages in the power domain, not the dB domain', () => {
    const avg = createRollingAverager(3000, 'db');
    avg.update([-6], 0);
    const result = avg.update([-12], 500);
    const expected = 10 * Math.log10((Math.pow(10, -6 / 10) + Math.pow(10, -12 / 10)) / 2);
    expect(result[0]).toBeCloseTo(expected, 6);
    expect(result[0]).not.toBeCloseTo(-9, 1);
  });

  it('evicts a sample once it ages past the window', () => {
    const windowMs = 3000;
    const avg = createRollingAverager(windowMs, 'db');
    avg.update([-6], 0);
    const result = avg.update([-12], windowMs + 1);
    expect(result[0]).toBeCloseTo(-12, 6);
  });

  it('converges to a step input once old samples age out', () => {
    const windowMs = 3000;
    const avg = createRollingAverager(windowMs, 'db');
    avg.update([-30], 0);
    avg.update([-30], 100);
    const result = avg.update([-6], windowMs + 200);
    expect(result[0]).toBeCloseTo(-6, 6);
  });

  it('floors non-finite (-Infinity) input to -120 before converting', () => {
    const avg = createRollingAverager(3000, 'db');
    const result = avg.update([Number.NEGATIVE_INFINITY], 0);
    expect(result[0]).toBeCloseTo(-120, 6);
  });

  it('reports growing then saturating coverage, and 0 after reset', () => {
    const windowMs = 3000;
    const avg = createRollingAverager(windowMs, 'db');
    expect(avg.coverageMs(0)).toBe(0);

    // Dense updates (every 500ms, like an rAF-driven tick loop) so eviction
    // never drops the coverage below the window once it's been reached.
    for (let t = 0; t <= windowMs; t += 500) {
      avg.update([-20], t);
    }
    expect(avg.coverageMs(windowMs)).toBe(windowMs);

    avg.update([-20], windowMs + 500);
    expect(avg.coverageMs(windowMs + 500)).toBe(windowMs);

    avg.reset();
    expect(avg.coverageMs(windowMs + 500)).toBe(0);
  });

  it('grows coverage proportionally before the window is filled', () => {
    const windowMs = 3000;
    const avg = createRollingAverager(windowMs, 'db');
    avg.update([-20], 0);
    expect(avg.coverageMs(1000)).toBe(1000);
  });
});

describe('createRollingAverager (linear domain)', () => {
  it('computes the arithmetic mean', () => {
    const avg = createRollingAverager(3000, 'linear');
    avg.update([0.2, -1], 0);
    const result = avg.update([0.6, 1], 500);
    expect(result[0]).toBeCloseTo(0.4, 6);
    expect(result[1]).toBeCloseTo(0, 6);
  });

  it('evicts aged-out samples', () => {
    const windowMs = 3000;
    const avg = createRollingAverager(windowMs, 'linear');
    avg.update([1], 0);
    const result = avg.update([3], windowMs + 1);
    expect(result[0]).toBeCloseTo(3, 6);
  });

  it('returns 0 coverage after reset', () => {
    const avg = createRollingAverager(3000, 'linear');
    avg.update([1], 0);
    avg.reset();
    expect(avg.coverageMs(0)).toBe(0);
  });
});

describe('createRollingMax', () => {
  it('holds the windowed peak', () => {
    const max = createRollingMax(3000);
    max.update(10, 0);
    const result = max.update(5, 100);
    expect(result).toBe(10);
  });

  it('drops a peak once it ages past the window', () => {
    const windowMs = 3000;
    const max = createRollingMax(windowMs);
    max.update(10, 0);
    max.update(5, 100);
    const result = max.update(3, windowMs + 101);
    expect(result).toBe(3);
  });

  it('resets to tracking only new values', () => {
    const windowMs = 3000;
    const max = createRollingMax(windowMs);
    max.update(10, 0);
    max.reset();
    const result = max.update(2, 100);
    expect(result).toBe(2);
  });
});

describe('display window constants', () => {
  it('exposes named, non-magic constants', () => {
    expect(EQ_DB_MIN).toBe(-72);
    expect(EQ_DB_MAX).toBe(-3);
    expect(EQ_DIM_DB).toBe(-60);
    expect(EQ_HOT_DB).toBe(-24);
    expect(EQ_GRID_DB).toEqual([-60, -48, -36, -24, -12, -6]);
    expect(LIVE_AVG_WINDOW_MS).toBe(3000);
  });
});
