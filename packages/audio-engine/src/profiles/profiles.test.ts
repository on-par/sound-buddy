import { describe, it, expect } from "vitest";
import {
  PROFILES,
  GRID_FREQS,
  GRID_POINTS,
  getProfile,
  defaultProfileForContentType,
  compareToProfile,
  bandTargetsFromProfile,
  defaultProfileForLiveCapture,
  LIVE_CAPTURE_DEFAULT_PROFILE_ID,
} from "./index.js";

describe("ideal profiles", () => {
  it("ships flat, music-fullrange, speech-podcast, broadcast, worship-service on the 48-pt grid", () => {
    const ids = PROFILES.map((p) => p.id).sort();
    expect(ids).toEqual(["broadcast", "flat", "music-fullrange", "speech-podcast", "worship-service"]);
    const worship = getProfile("worship-service")!;
    expect(worship.freqs).toEqual(GRID_FREQS);
    expect(worship.freqs).toHaveLength(GRID_POINTS);
    expect(worship.dbOffsets).toHaveLength(GRID_POINTS);
    for (const p of PROFILES) {
      expect(p.freqs).toHaveLength(GRID_POINTS);
      expect(p.dbOffsets).toHaveLength(GRID_POINTS);
      expect(p.freqs).toEqual(GRID_FREQS);
    }
  });

  it("matches the python geomspace(20, 20000, 48) grid endpoints", () => {
    expect(GRID_FREQS[0]).toBeCloseTo(20, 6);
    expect(GRID_FREQS[GRID_POINTS - 1]).toBeCloseTo(20000, 3);
    // strictly increasing
    for (let i = 1; i < GRID_FREQS.length; i++) {
      expect(GRID_FREQS[i]).toBeGreaterThan(GRID_FREQS[i - 1]);
    }
  });

  it("flat profile is all zeros", () => {
    expect(getProfile("flat")!.dbOffsets.every((v) => v === 0)).toBe(true);
  });

  it("maps content type to the right default profile", () => {
    expect(defaultProfileForContentType("speech")).toBe("speech-podcast");
    expect(defaultProfileForContentType("music")).toBe("worship-service");
    expect(defaultProfileForContentType("mixed")).toBe("worship-service");
    expect(defaultProfileForContentType("silence")).toBe("flat");
    expect(defaultProfileForContentType(undefined)).toBe("flat");
  });
});

describe("compareToProfile", () => {
  const flat = getProfile("flat")!;
  const music = getProfile("music-fullrange")!;

  // A synthetic measured curve with an arbitrary tilt.
  const baseDb = GRID_FREQS.map((f, i) => -30 + Math.sin(i / 5) * 4 + (f > 4000 ? -3 : 0));

  it("returns null for a missing or grid-mismatched curve", () => {
    expect(compareToProfile(undefined, flat)).toBeNull();
    expect(compareToProfile({ freqs: [1, 2], db: [1, 2] }, flat)).toBeNull();
  });

  it("is level-invariant: a +6 dB overall boost leaves deviation and score unchanged", () => {
    const boostedDb = baseDb.map((v) => v + 6);
    const a = compareToProfile({ freqs: GRID_FREQS, db: baseDb }, music)!;
    const b = compareToProfile({ freqs: GRID_FREQS, db: boostedDb }, music)!;

    expect(b.matchScore).toBe(a.matchScore);
    a.deviation.forEach((d, i) => expect(b.deviation[i]).toBeCloseTo(d, 9));
  });

  it("scores a curve that equals its target 100", () => {
    // A measured curve whose shape IS the target shape (plus any offset) is perfect.
    const measured = music.dbOffsets.map((v) => v - 42); // arbitrary level
    const cmp = compareToProfile({ freqs: GRID_FREQS, db: measured }, music)!;
    expect(cmp.matchScore).toBe(100);
    cmp.deviation.forEach((d) => expect(d).toBeCloseTo(0, 9));
  });

  it("scores worse as the mix diverges from the target", () => {
    const near = compareToProfile({ freqs: GRID_FREQS, db: baseDb }, music)!;
    const far = compareToProfile(
      { freqs: GRID_FREQS, db: baseDb.map((v, i) => v + (i % 2 ? 12 : -12)) },
      music,
    )!;
    expect(far.matchScore).toBeLessThan(near.matchScore);
  });

  it("excludes silent (non-finite) bins from scoring rather than counting them on-target", () => {
    // A near-target mix, but with a handful of −Infinity sub-bass bins (real
    // silence) plus a real +8 dB bump. The silent bins must not inflate the score.
    const measured = music.dbOffsets.map((v, i) => (i < 4 ? -Infinity : v - 42 + (i === 20 ? 8 : 0)));
    const cmp = compareToProfile({ freqs: GRID_FREQS, db: measured }, music)!;
    expect(cmp.matchScore).toBeLessThan(100);
    expect(cmp.matchScore).toBeGreaterThan(0);
  });

  it("returns null when the measured curve has no finite bins", () => {
    const measured = GRID_FREQS.map(() => -Infinity);
    expect(compareToProfile({ freqs: GRID_FREQS, db: measured }, flat)).toBeNull();
  });

  it("flags the most over- and under-target bands", () => {
    // Push presence (4–6 kHz) well above target, sub-bass well below.
    const measured = GRID_FREQS.map((f) => {
      if (f >= 4000 && f <= 6000) return -20;
      if (f < 60) return -60;
      return -35;
    });
    const cmp = compareToProfile({ freqs: GRID_FREQS, db: measured }, flat)!;
    expect(cmp.topOver?.band).toBe("presence");
    expect(cmp.topUnder?.band).toBe("subBass");
  });
});

describe("bandTargetsFromProfile", () => {
  const KEYS = ["subBass", "bass", "lowMid", "mid", "highMid", "presence", "brilliance"] as const;

  it("is all zeros for the flat profile (today's flat band-balance reference)", () => {
    const targets = bandTargetsFromProfile(getProfile("flat"));
    expect(Object.keys(targets).sort()).toEqual([...KEYS].sort());
    for (const k of KEYS) expect(targets[k]).toBe(0);
  });

  it("returns the constant for a profile that is a constant offset everywhere", () => {
    const targets = bandTargetsFromProfile({ freqs: GRID_FREQS, dbOffsets: GRID_FREQS.map(() => 4) });
    for (const k of KEYS) expect(targets[k]).toBeCloseTo(4, 6);
  });

  it("orders the seven targets by the profile's tilt (a falling shape yields falling targets)", () => {
    const worship = getProfile("worship-service")!;
    const t = bandTargetsFromProfile(worship);
    // The worship-service shape rises through the bass, then falls to -18 dB at the top.
    expect(t.subBass).toBeGreaterThan(t.mid);
    expect(t.bass).toBeGreaterThan(t.mid);
    expect(t.mid).toBeGreaterThan(t.highMid);
    expect(t.highMid).toBeGreaterThan(t.presence);
    expect(t.presence).toBeGreaterThan(t.brilliance);
    expect(t.brilliance).toBeCloseTo(-18, 0);
    for (const k of KEYS) {
      expect(t[k]).toBeLessThanOrEqual(18);
      expect(t[k]).toBeGreaterThanOrEqual(-18);
    }
  });

  it("averages power, not dB, across a band (a half-band +10 dB step lands above the dB midpoint)", () => {
    // +10 dB over the top half of the mid band (1–2 kHz), 0 dB elsewhere.
    const dbOffsets = GRID_FREQS.map((f) => (f >= 1000 && f < 2000 ? 10 : 0));
    const t = bandTargetsFromProfile({ freqs: GRID_FREQS, dbOffsets });
    // Linear-frequency power mean of the mid band: 500–1000 Hz at 0 dB, 1–2 kHz at
    // +10 dB → (500·1 + 1000·10) / 1500 ≈ 7 → 8.45 dB. A dB mean would give ~5.
    expect(t.mid).toBeGreaterThan(7);
    expect(t.mid).toBeLessThan(10);
  });

  it("treats a missing or grid-mismatched profile as flat", () => {
    for (const k of KEYS) {
      expect(bandTargetsFromProfile(undefined)[k]).toBe(0);
      expect(bandTargetsFromProfile(null)[k]).toBe(0);
      expect(bandTargetsFromProfile({ freqs: [100, 1000], dbOffsets: [3] })[k]).toBe(0);
      expect(bandTargetsFromProfile({ freqs: [], dbOffsets: [] })[k]).toBe(0);
    }
  });

  it("skips non-finite offsets rather than poisoning the band", () => {
    const dbOffsets = GRID_FREQS.map((f, i) => (i === 10 ? Number.NaN : f < 250 ? 6 : 0));
    const t = bandTargetsFromProfile({ freqs: GRID_FREQS, dbOffsets });
    expect(Number.isFinite(t.bass)).toBe(true);
    expect(t.bass).toBeGreaterThan(3);
  });
});

describe("defaultProfileForLiveCapture", () => {
  it("is the worship-service target — a live capture has no content classifier, and Auto must not fall to flat", () => {
    expect(LIVE_CAPTURE_DEFAULT_PROFILE_ID).toBe("worship-service");
    expect(defaultProfileForLiveCapture()).toBe("worship-service");
    expect(getProfile(defaultProfileForLiveCapture())).toBeDefined();
  });
});
