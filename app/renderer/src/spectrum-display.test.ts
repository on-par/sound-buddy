// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import {
  DB_MIN,
  DB_MAX,
  DIM_DB,
  HOT_DB,
  GRID,
  BAND_META,
  CURVE_VB,
  X_TICKS,
  CURVE_FMIN,
  CURVE_FMAX,
  EQ_GAP,
  EQ_COLS,
  escapeHtml,
  fmtHz,
  toPct,
  levelMatchedTarget,
  niceTicks,
  smoothPath,
  spectrumCurveSVG,
  spectrumLegendHTML,
  bandLevelsFromCurve,
  bandDbFromSpectrum,
  veqBarsAndLabelsHTML,
  eqTargetLineSVG,
  eqCentroidHTML,
  eqBarsHTML,
  veqLoudestIdx,
  veqBandView,
  veqValBottom,
  type SpectrumCurvePaths,
} from './spectrum-display';

describe('constants', () => {
  it('exposes the band/scale geometry the rest of the module relies on', () => {
    expect(DB_MIN).toBe(-72);
    expect(DB_MAX).toBe(-3);
    expect(DIM_DB).toBe(-60);
    expect(HOT_DB).toBe(-24);
    expect(GRID).toEqual([-60, -48, -36, -24, -12, -6]);
    expect(BAND_META).toHaveLength(7);
    expect(BAND_META.map((b) => b.key)).toEqual([
      'subBass', 'bass', 'lowMid', 'mid', 'highMid', 'presence', 'brilliance',
    ]);
    expect(BAND_META.map((b) => b.label)).toEqual([
      'Sub Bass', 'Bass', 'Low Mid', 'Mid', 'High Mid', 'Presence', 'Brilliance',
    ]);
    expect(CURVE_VB).toEqual({ w: 900, h: 440, ml: 52, mr: 16, mt: 18, mb: 34 });
    expect(X_TICKS).toHaveLength(10);
    expect(CURVE_FMIN).toBe(20);
    expect(CURVE_FMAX).toBe(20000);
    expect(EQ_GAP).toBe(1.4);
    expect(EQ_COLS).toHaveLength(7);
    expect(EQ_COLS[0].key).toBe('subBass');
  });
});

describe('escapeHtml', () => {
  it('escapes all five HTML entities', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('coerces null/undefined to an empty string', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('fmtHz', () => {
  it('renders sub-kHz values in whole Hz', () => {
    expect(fmtHz(500)).toBe('500 Hz');
    expect(fmtHz(999)).toBe('999 Hz');
  });

  it('renders 1000+ Hz in kHz with one decimal', () => {
    expect(fmtHz(1000)).toBe('1.0 kHz');
    expect(fmtHz(1500)).toBe('1.5 kHz');
  });
});

describe('toPct', () => {
  it('maps the dB window linearly to 0-100', () => {
    expect(toPct(-72)).toBe(0);
    expect(toPct(-3)).toBe(100);
    expect(toPct(-37.5)).toBe(50);
  });

  it('clamps outside the window', () => {
    expect(toPct(-200)).toBe(0);
    expect(toPct(0)).toBe(100);
  });
});

describe('veqValBottom', () => {
  it('passes through under the 90 cap', () => {
    expect(veqValBottom(50)).toBe('50.00');
  });

  it('caps at 90', () => {
    expect(veqValBottom(120)).toBe('90.00');
  });
});

describe('veqBandView', () => {
  it('is not dim just above DIM_DB, dim at/below it', () => {
    expect(veqBandView(-60).dim).toBe(true);
    expect(veqBandView(-59.9).dim).toBe(false);
  });

  it('is hot only strictly above HOT_DB', () => {
    expect(veqBandView(-24).hot).toBe(false);
    expect(veqBandView(-23.9).hot).toBe(true);
  });

  it('renders val as db.toFixed(1)', () => {
    expect(veqBandView(-16).val).toBe('-16.0');
  });
});

describe('veqLoudestIdx', () => {
  it('picks the index of the loudest band', () => {
    expect(veqLoudestIdx([-30, -20, -40])).toBe(1);
  });

  it('clears DIM_DB at exactly the boundary', () => {
    expect(veqLoudestIdx([-70, -65, -59])).toBe(2);
  });

  it('returns -1 when every band is idle (max at or below DIM_DB)', () => {
    expect(veqLoudestIdx([-72, -65, -60])).toBe(-1);
  });
});

describe('bandDbFromSpectrum', () => {
  it('reads the named band and floors everything else to -120', () => {
    const result = bandDbFromSpectrum({ bands: { mid: -16 } });
    expect(result).toEqual([-120, -120, -120, -16, -120, -120, -120]);
  });

  it('floors non-finite band values to -120', () => {
    const result = bandDbFromSpectrum({ bands: { mid: NaN } });
    expect(result[3]).toBe(-120);
  });

  it('floors every band to -120 when bands is missing', () => {
    expect(bandDbFromSpectrum({})).toEqual([-120, -120, -120, -120, -120, -120, -120]);
  });
});

describe('bandLevelsFromCurve', () => {
  it('averages the curve samples that fall in each band range', () => {
    const curve = { freqs: [30, 50, 100, 1000], db: [-10, -20, -30, -40] };
    const result = bandLevelsFromCurve(curve);
    // subBass (20-60): 30,50 -> mean(-10,-20) = -15
    expect(result[0]).toBeCloseTo(-15);
    // bass (60-250): 100 -> -30
    expect(result[1]).toBeCloseTo(-30);
    // lowMid (250-500): no samples -> -120
    expect(result[2]).toBe(-120);
    // mid (500-2000): 1000 -> -40
    expect(result[3]).toBeCloseTo(-40);
    expect(result[4]).toBe(-120);
    expect(result[5]).toBe(-120);
    expect(result[6]).toBe(-120);
  });
});

describe('levelMatchedTarget', () => {
  it('shifts the profile offsets by the measured/target mean delta', () => {
    const curve = { freqs: [20, 200], db: [-10, -30] }; // mean -20
    const profile = { label: 'Test', dbOffsets: [-10, -10] }; // mean -10, shift -10
    expect(levelMatchedTarget(curve, profile)).toEqual([-20, -20]);
  });
});

describe('niceTicks', () => {
  it('produces evenly spaced ticks within range', () => {
    const ticks = niceTicks(-60, -6);
    expect(ticks.length).toBeGreaterThan(1);
    for (const t of ticks) {
      expect(t).toBeGreaterThanOrEqual(-60);
      expect(t).toBeLessThanOrEqual(-6);
    }
    const steps = new Set<number>();
    for (let i = 1; i < ticks.length; i++) steps.add(Math.round((ticks[i] - ticks[i - 1]) * 100) / 100);
    expect(steps.size).toBe(1);
  });

  it('degenerates to a single rounded value for a zero/negative span', () => {
    expect(niceTicks(5, 5)).toEqual([5]);
    expect(niceTicks(5, 3)).toEqual([5]);
  });
});

describe('smoothPath', () => {
  it('returns an empty string for no points', () => {
    expect(smoothPath([])).toBe('');
  });

  it('returns a single M for one point', () => {
    expect(smoothPath([{ x: 3, y: 4 }])).toBe('M3,4');
  });

  it('produces the exact Catmull-Rom path for a known 3-point input', () => {
    const d = smoothPath([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }]);
    expect(d).toBe('M0.00,0.00C1.67,1.67 6.67,10.00 10.00,10.00C13.33,10.00 18.33,1.67 20.00,0.00');
  });
});

describe('spectrumCurveSVG', () => {
  const curve = { freqs: [20, 200, 2000, 20000], db: [-40, -20, -10, -30] };

  it('returns "" for a missing curve', () => {
    expect(spectrumCurveSVG(null, undefined, undefined)).toBe('');
    expect(spectrumCurveSVG(undefined, undefined, undefined)).toBe('');
  });

  it('returns "" for a too-short or non-finite curve', () => {
    expect(spectrumCurveSVG({ freqs: [20], db: [-10] }, undefined, undefined)).toBe('');
    expect(spectrumCurveSVG({ freqs: [NaN, 200], db: [-10, -20] }, undefined, undefined)).toBe('');
  });

  it('renders the curve line, band tints, and x-axis labels', () => {
    const svg = spectrumCurveSVG(curve, undefined, undefined) as string;
    expect(svg).toContain('sb-curve-line');
    expect(svg).toContain('sb-band-tint');
    expect(svg).toContain('>20<');
    expect(svg).toContain('>20k<');
  });

  it('adds the target line when targetDb is provided', () => {
    const svg = spectrumCurveSVG(curve, undefined, [-40, -20, -10, -30]) as string;
    expect(svg).toContain('sb-target-line');
  });

  it('adds the centroid marker for a finite in-range centroid', () => {
    const svg = spectrumCurveSVG(curve, 1000, undefined) as string;
    expect(svg).toContain('sb-centroid-line');
    expect(svg).toContain('1.0 kHz');
  });

  it('omits the centroid marker when centroid is missing or out of range', () => {
    const svg = spectrumCurveSVG(curve, undefined, undefined) as string;
    expect(svg).not.toContain('sb-centroid-line');
  });

  it('suffixes gradient/clip ids with opts.uid', () => {
    const svg = spectrumCurveSVG(curve, undefined, undefined, { uid: 'live0' }) as string;
    expect(svg).toContain('sb-spectrum-fill-live0');
    expect(svg).toContain('sb-spectrum-plot-live0');
  });

  it('clamps points into a fixed opts.yMin/yMax range', () => {
    const extreme = { freqs: [20, 200, 2000], db: [-1000, -30, 5000] };
    const paths = spectrumCurveSVG(extreme, undefined, undefined, {
      yMin: -50, yMax: -10, wantPaths: true,
    }) as SpectrumCurvePaths;
    const y0 = CURVE_VB.mt, y1 = CURVE_VB.h - CURVE_VB.mb;
    expect(paths.line).toContain(`,${y1.toFixed(2)}`); // clamped-low point sits at plot bottom
    expect(paths.line).toContain(`,${y0.toFixed(2)}`); // clamped-high point sits at plot top
  });

  it('returns { svg, line, area, centroidMark } when opts.wantPaths is set', () => {
    const paths = spectrumCurveSVG(curve, 1000, undefined, { wantPaths: true }) as SpectrumCurvePaths;
    expect(typeof paths.svg).toBe('string');
    expect(typeof paths.line).toBe('string');
    expect(typeof paths.area).toBe('string');
    expect(typeof paths.centroidMark).toBe('string');
  });
});

describe('spectrumLegendHTML', () => {
  it('escapes the profile label', () => {
    const html = spectrumLegendHTML({ label: '<b>X</b>', dbOffsets: [] }, null, false);
    expect(html).toContain('&lt;b&gt;X&lt;/b&gt;');
    expect(html).not.toContain('<b>X</b>');
  });

  it('shows the match score when a comparison is given', () => {
    const html = spectrumLegendHTML({ label: 'Flat', dbOffsets: [] }, { matchScore: 87 }, false);
    expect(html).toContain('87');
    expect(html).toContain('Match');
  });

  it('omits the score span when there is no comparison', () => {
    const html = spectrumLegendHTML({ label: 'Flat', dbOffsets: [] }, null, false);
    expect(html).not.toContain('sl-score');
  });

  it('appends " (auto)" iff isAuto is true', () => {
    const auto = spectrumLegendHTML({ label: 'Flat', dbOffsets: [] }, null, true);
    const manual = spectrumLegendHTML({ label: 'Flat', dbOffsets: [] }, null, false);
    expect(auto).toContain('Flat (auto)');
    expect(manual).not.toContain('(auto)');
  });
});

describe('eqCentroidHTML', () => {
  it('renders the centroid in kHz', () => {
    expect(eqCentroidHTML({ spectralCentroid: 1500 })).toBe('<div class="eq-centroid">Centroid · 1.5 kHz</div>');
  });

  it('returns "" for zero or missing centroid', () => {
    expect(eqCentroidHTML({ spectralCentroid: 0 })).toBe('');
    expect(eqCentroidHTML({})).toBe('');
  });
});

describe('veqBarsAndLabelsHTML', () => {
  it('marks only the loudest bar as loud and carries a title tooltip when a range is present', () => {
    const cols = [
      { key: 'a', label: 'A', color: 'red', range: '20-60 Hz', left: '0', width: '10', center: '5' },
      { key: 'b', label: 'B', color: 'blue', left: '10', width: '10', center: '15' },
    ];
    const { bars, labels } = veqBarsAndLabelsHTML(cols, [-50, -10], 1);
    expect(bars).toContain('data-band="a"');
    expect(bars).toContain('title="20-60 Hz"');
    expect((bars.match(/loud/g) || []).length).toBe(1);
    expect(labels).toContain('veq-label loud');
    expect(labels).toContain('>A<');
    expect(labels).toContain('>B<');
  });
});

describe('eqTargetLineSVG', () => {
  it('draws one point per EQ_COLS column', () => {
    const svg = eqTargetLineSVG(EQ_COLS.map(() => -20));
    expect(svg).toContain('eq-target-svg');
    expect(svg).toContain('sb-target-line');
    const pointCount = (svg.match(/L/g) || []).length + 1;
    expect(pointCount).toBe(EQ_COLS.length);
  });
});

describe('eqBarsHTML', () => {
  const bandDb = [-70, -65, -60, -16, -30, -50, -35]; // mid (-16) loudest

  it('renders 7 bars in BAND_META order with correct data-band and labels', () => {
    const html = eqBarsHTML(bandDb);
    const bars = html.match(/class="veq-bar(?:"| )[^"]*"/g) || [];
    expect(bars).toHaveLength(7);
    const dataBands = [...html.matchAll(/data-band="([^"]+)"/g)].map((m) => m[1]);
    expect(dataBands).toEqual(BAND_META.map((b) => b.key));
    expect(html).toContain('>Sub Bass<');
    expect(html).toContain('>Brilliance<');
  });

  it('marks only the loudest bar as loud', () => {
    const html = eqBarsHTML(bandDb);
    const loudBars = html.match(/class="veq-bar loud[^"]*"/g) || [];
    expect(loudBars).toHaveLength(1);
    expect(loudBars[0]).not.toBeUndefined();
  });

  it('sets bar height from toPct', () => {
    const html = eqBarsHTML(bandDb);
    const midHeight = toPct(bandDb[3]).toFixed(2);
    expect(html).toContain(`height:${midHeight}%`);
  });

  it('includes eq-target-svg only when targetDb has exactly 7 entries', () => {
    const withTarget = eqBarsHTML(bandDb, bandDb.map(() => -20));
    const withoutTarget = eqBarsHTML(bandDb);
    const wrongLength = eqBarsHTML(bandDb, [-20, -20]);
    expect(withTarget).toContain('eq-target-svg');
    expect(withoutTarget).not.toContain('eq-target-svg');
    expect(wrongLength).not.toContain('eq-target-svg');
  });
});
