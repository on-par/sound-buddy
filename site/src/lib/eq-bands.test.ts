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
  formatEqRangeLabel,
  centroidFromBandDbs,
  RTA_BANDS,
  RTA_BANDS_PER_OCTAVE,
  RTA_ANCHOR_HZ,
  RTA_MIN_HZ,
  RTA_MAX_HZ,
  RTA_FFT_SIZE,
  RTA_SMOOTHING_TIME_CONSTANT,
  RTA_SILENCE_FLOOR_DB,
  buildRtaBands,
  configureRtaAnalyser,
  blackmanFullScaleSinePower,
  rtaBandLevelsDb,
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
      expect(band.rangeLabel).toMatch(/^\d+–\d+ Hz$/);
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

describe('formatEqRangeLabel', () => {
  it('formats a compact Hz range with an en dash', () => {
    expect(formatEqRangeLabel(60, 250)).toBe('60–250 Hz');
  });

  it('is the source of every EQ_BAND_DEFS rangeLabel, so lo/hi can never drift from it', () => {
    for (const band of EQ_BAND_DEFS) {
      expect(band.rangeLabel).toBe(formatEqRangeLabel(band.lo, band.hi));
    }
  });
});

describe('centroidFromBandDbs', () => {
  it('is the weighted mean of band centers when every band is equally loud', () => {
    const equalDbs = EQ_BAND_DEFS.map(() => -6);
    const expected = EQ_BAND_DEFS.reduce((sum, b) => sum + b.center, 0) / EQ_BAND_DEFS.length;
    expect(centroidFromBandDbs(equalDbs)).toBeCloseTo(expected, 6);
  });

  it('is dominated by the loudest band', () => {
    const dbs = EQ_BAND_DEFS.map((b) => (b.key === 'mid' ? -6 : -120));
    const midCenter = EQ_BAND_DEFS.find((b) => b.key === 'mid')?.center as number;
    expect(centroidFromBandDbs(dbs)).toBeCloseTo(midCenter, 0);
  });

  it('missing entries fall back to the silence floor, same as an all-silent input', () => {
    const silentDbs = EQ_BAND_DEFS.map(() => -120);
    expect(centroidFromBandDbs([])).toBeCloseTo(centroidFromBandDbs(silentDbs), 6);
  });

  it('returns 0 when every band underflows to zero linear power', () => {
    const dbs = EQ_BAND_DEFS.map(() => -100000);
    expect(centroidFromBandDbs(dbs)).toBe(0);
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

/* ── 1/6-octave RTA bands (#1718): mirrors iOS SpectrumAnalyzer.rtaLevels ── */

describe('RTA_BANDS', () => {
  it('has 59 bands spanning 20 Hz-20 kHz, anchored on 1 kHz', () => {
    expect(RTA_BANDS).toHaveLength(59);
    expect(RTA_BANDS[0].centerHz).toBeGreaterThanOrEqual(RTA_MIN_HZ);
    expect(RTA_BANDS[RTA_BANDS.length - 1].centerHz).toBeLessThanOrEqual(RTA_MAX_HZ);
    expect(RTA_BANDS.some((b) => Math.abs(b.centerHz - RTA_ANCHOR_HZ) < 1e-9)).toBe(true);
  });

  it('is contiguous: each band\'s highHz meets the next band\'s lowHz', () => {
    for (let i = 1; i < RTA_BANDS.length; i += 1) {
      expect(Math.abs(RTA_BANDS[i].lowHz - RTA_BANDS[i - 1].highHz)).toBeLessThan(1e-9);
    }
  });

  it('is log-spaced at 1/6-octave steps', () => {
    const step = Math.pow(2, 1 / RTA_BANDS_PER_OCTAVE);
    for (let i = 1; i < RTA_BANDS.length; i += 1) {
      expect(RTA_BANDS[i].centerHz / RTA_BANDS[i - 1].centerHz).toBeCloseTo(step, 9);
    }
  });

  it('buildRtaBands with the default bandsPerOctave reproduces RTA_BANDS', () => {
    expect(buildRtaBands()).toEqual(RTA_BANDS);
  });
});

describe('configureRtaAnalyser', () => {
  it('sets fftSize 8192 and smoothingTimeConstant 0 on the RTA analyser', () => {
    const node = { fftSize: 2048, smoothingTimeConstant: 0.8 };
    const result = configureRtaAnalyser(node);
    expect(result).toBe(node);
    expect(result.fftSize).toBe(RTA_FFT_SIZE);
    expect(result.smoothingTimeConstant).toBe(RTA_SMOOTHING_TIME_CONSTANT);
    expect(RTA_FFT_SIZE).toBe(8192);
    expect(RTA_SMOOTHING_TIME_CONSTANT).toBe(0);
  });
});

describe('blackmanFullScaleSinePower', () => {
  it('equals windowEnergy / (4 * fftSize) for the Web Audio Blackman window', () => {
    const fftSize = 8192;
    const alpha = 0.16;
    const a0 = (1 - alpha) / 2;
    const a1 = 0.5;
    const a2 = alpha / 2;
    let windowEnergy = 0;
    for (let n = 0; n < fftSize; n += 1) {
      const w = a0 - a1 * Math.cos((2 * Math.PI * n) / fftSize) + a2 * Math.cos((4 * Math.PI * n) / fftSize);
      windowEnergy += w * w;
    }
    const expected = windowEnergy / (4 * fftSize);
    expect(blackmanFullScaleSinePower(fftSize)).toBeCloseTo(expected, 9);
    expect(windowEnergy / fftSize).toBeCloseTo(0.3046, 4);
    expect(blackmanFullScaleSinePower(fftSize)).toBeCloseTo(0.3046 / 4, 4);
  });
});

describe('rtaBandLevelsDb', () => {
  const SAMPLE_RATE = 48000;

  /**
   * Emulates AnalyserNode.getFloatFrequencyData with smoothingTimeConstant 0:
   * a Blackman-windowed DFT of `signal` (length = fftSize), in dB, -Infinity
   * on a zero bin. Only computes bins within +/-64 of `focusBin` (the rest
   * are filled with -Infinity) so a direct DFT over an 8192-sample frame
   * stays fast in a test; `focusBin` must cover whatever the test inspects.
   */
  function webAudioBinDbs(signal: Float64Array, focusBin: number): number[] {
    const fftSize = signal.length;
    const alpha = 0.16;
    const a0 = (1 - alpha) / 2;
    const a1 = 0.5;
    const a2 = alpha / 2;
    const windowed = new Float64Array(fftSize);
    for (let n = 0; n < fftSize; n += 1) {
      const w = a0 - a1 * Math.cos((2 * Math.PI * n) / fftSize) + a2 * Math.cos((4 * Math.PI * n) / fftSize);
      windowed[n] = w * signal[n];
    }
    const binCount = fftSize / 2;
    const lo = Math.max(0, focusBin - 64);
    const hi = Math.min(binCount - 1, focusBin + 64);
    const out = new Array<number>(binCount).fill(Number.NEGATIVE_INFINITY);
    for (let k = lo; k <= hi; k += 1) {
      let re = 0;
      let im = 0;
      for (let n = 0; n < fftSize; n += 1) {
        const phase = (2 * Math.PI * k * n) / fftSize;
        re += windowed[n] * Math.cos(phase);
        im -= windowed[n] * Math.sin(phase);
      }
      re /= fftSize;
      im /= fftSize;
      const magnitude = Math.sqrt(re * re + im * im);
      out[k] = magnitude > 0 ? 20 * Math.log10(magnitude) : Number.NEGATIVE_INFINITY;
    }
    return out;
  }

  it('reads a half-scale 1 kHz sine within 0.5 dB of the iOS reference', () => {
    const fftSize = 8192;
    const binHz = SAMPLE_RATE / fftSize;
    const focusBin = Math.round(1000 / binHz);
    const signal = new Float64Array(fftSize);
    for (let n = 0; n < fftSize; n += 1) {
      signal[n] = 0.5 * Math.sin((2 * Math.PI * 1000 * n) / SAMPLE_RATE);
    }
    const binDbs = webAudioBinDbs(signal, focusBin);
    const levels = rtaBandLevelsDb(binDbs, SAMPLE_RATE);
    const targetIndex = RTA_BANDS.findIndex((b) => Math.abs(b.centerHz - 1000) < 1e-9);
    const IOS_RTA_HALF_SCALE_1KHZ_REFERENCE_DB = 20 * Math.log10(0.5);

    expect(Math.abs(levels[targetIndex] - IOS_RTA_HALF_SCALE_1KHZ_REFERENCE_DB)).toBeLessThan(0.5);
    expect(loudestBandIndex(levels)).toBe(targetIndex);
  });

  it('interpolates power density for a low band narrower than one bin', () => {
    const fftSize = 8192;
    const binHz = SAMPLE_RATE / fftSize;
    const band = RTA_BANDS[0];
    expect(band.highHz - band.lowHz).toBeLessThan(binHz);

    const binCount = fftSize / 2;
    const binDbs = new Array<number>(binCount).fill(-60);
    const position = band.centerHz / binHz;
    const k0 = Math.floor(position);
    const k1 = k0 + 1;
    const t = position - k0;
    binDbs[k0] = -40;
    binDbs[k1] = -50;

    const levels = rtaBandLevelsDb(binDbs, SAMPLE_RATE);
    expect(levels).toHaveLength(RTA_BANDS.length);
    for (const level of levels) {
      expect(Number.isFinite(level)).toBe(true);
    }
    expect(levels[0]).not.toBe(RTA_SILENCE_FLOOR_DB);

    const p0 = Math.pow(10, -40 / 10);
    const p1 = Math.pow(10, -50 / 10);
    const density = p0 * (1 - t) + p1 * t;
    const bandPower = (density * (band.highHz - band.lowHz)) / binHz;
    const expected = 10 * Math.log10(bandPower / blackmanFullScaleSinePower(fftSize));
    expect(levels[0]).toBeCloseTo(expected, 9);
  });

  it('reads the silence floor for an all-silent (-Infinity) spectrum', () => {
    const binDbs = new Array<number>(4096).fill(Number.NEGATIVE_INFINITY);
    const levels = rtaBandLevelsDb(binDbs, SAMPLE_RATE);
    expect(levels).toHaveLength(RTA_BANDS.length);
    for (const level of levels) {
      expect(level).toBe(RTA_SILENCE_FLOOR_DB);
    }
  });

  it('reads the silence floor for bands at or above Nyquist', () => {
    const sampleRate = 16000;
    const binDbs = new Array<number>(4096).fill(-30);
    const levels = rtaBandLevelsDb(binDbs, sampleRate);
    RTA_BANDS.forEach((band, i) => {
      if (band.lowHz >= sampleRate / 2) {
        expect(levels[i]).toBe(RTA_SILENCE_FLOOR_DB);
      }
    });
    expect(RTA_BANDS.some((b) => b.lowHz >= sampleRate / 2)).toBe(true);
  });

  it('reads the silence floor for invalid input (empty bins, zero/NaN sample rate)', () => {
    const allFloor = RTA_BANDS.map(() => RTA_SILENCE_FLOOR_DB);
    expect(rtaBandLevelsDb([], SAMPLE_RATE)).toEqual(allFloor);
    const someBins = new Array<number>(4096).fill(-30);
    expect(rtaBandLevelsDb(someBins, 0)).toEqual(allFloor);
    expect(rtaBandLevelsDb(someBins, Number.NaN)).toEqual(allFloor);
    expect(rtaBandLevelsDb(someBins, -48000)).toEqual(allFloor);
    expect(rtaBandLevelsDb([], SAMPLE_RATE)).toHaveLength(RTA_BANDS.length);
  });

  it('power-sums bins rather than averaging dB: two bins at -20 dB read 3.01 dB louder than one', () => {
    const fftSize = 8192;
    const binHz = SAMPLE_RATE / fftSize;
    const band = RTA_BANDS.find((b) => b.highHz - b.lowHz > 3 * binHz);
    if (!band) throw new Error('expected a band wide enough for this test');
    const binCount = fftSize / 2;
    const lo = Math.ceil(band.lowHz / binHz);

    const oneBin = new Array<number>(binCount).fill(Number.NEGATIVE_INFINITY);
    oneBin[lo] = -20;
    const twoBins = new Array<number>(binCount).fill(Number.NEGATIVE_INFINITY);
    twoBins[lo] = -20;
    twoBins[lo + 1] = -20;

    const bandIndex = RTA_BANDS.indexOf(band);
    const oneLevel = rtaBandLevelsDb(oneBin, SAMPLE_RATE)[bandIndex];
    const twoLevel = rtaBandLevelsDb(twoBins, SAMPLE_RATE)[bandIndex];
    expect(twoLevel - oneLevel).toBeCloseTo(10 * Math.log10(2), 2);
  });
});
