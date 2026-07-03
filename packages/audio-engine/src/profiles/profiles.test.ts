import { describe, it, expect } from "vitest";
import {
  PROFILES,
  GRID_FREQS,
  GRID_POINTS,
  getProfile,
  defaultProfileForContentType,
  compareToProfile,
} from "./index.js";

describe("ideal profiles", () => {
  it("ships flat, music-fullrange, speech-podcast, broadcast on the 48-pt grid", () => {
    const ids = PROFILES.map((p) => p.id).sort();
    expect(ids).toEqual(["broadcast", "flat", "music-fullrange", "speech-podcast"]);
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
    expect(defaultProfileForContentType("music")).toBe("music-fullrange");
    expect(defaultProfileForContentType("mixed")).toBe("music-fullrange");
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
