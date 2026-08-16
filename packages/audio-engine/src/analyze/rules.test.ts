import { describe, it, expect } from "vitest";
import { evaluateRules, rulesForInstrument, RULE_TABLE } from "./rules.js";
import type { FiredRule } from "./rules.js";
import type { SpectrumCurve } from "../types.js";

// Fixed ascending freq grid (Hz) with one or more bins per rule band so every
// measured/reference band in RULE_TABLE falls on known indices:
//   [60,250)      -> indices 0,1
//   [250,500)     -> index 2
//   [500,2000)    -> indices 3,4
//   [2000,4000)   -> index 5   (also [2500,3500))
//   [3500,6000)   -> indices 6,7   (also [4000,6000))
//   [6000,12000)  -> indices 8,9
const FREQS = [80, 200, 400, 800, 1600, 3000, 4200, 5000, 7000, 10000];

const FLAT_DB = -30;

function curve(db: number[]): SpectrumCurve {
  return { freqs: FREQS, db };
}

/** Returns the fired rule with `id`, asserting it fired. */
function firedFor(hits: FiredRule[], id: string): FiredRule {
  const hit = hits.find((h) => h.rule.id === id);
  expect(hit, `expected rule "${id}" to fire`).toBeDefined();
  return hit as FiredRule;
}

describe("evaluateRules", () => {
  describe("fire cases", () => {
    it("fires `harsh` when the 2–4 kHz band runs >=6 dB over the 500 Hz–2 kHz reference", () => {
      const c = curve([-30, -30, -30, -30, -30, -20, -30, -30, -30, -30]);
      const hit = firedFor(evaluateRules(c), "harsh");
      expect(hit.rule.symptom).toBe("Quacky/harsh");
      expect(hit.rule.suggestion.move).toBe("cut");
      expect(hit.rule.suggestion.targetHz).toBe(3000);
      expect(hit.rule.suggestion.band).toEqual({ lowHz: 2000, highHz: 4000 });
      expect(hit.measuredDb).toBeCloseTo(-20);
      expect(hit.referenceDb).toBeCloseTo(-30);
      expect(hit.excessDb).toBeCloseTo(10);
    });

    it("fires `edgy` when the ~3 kHz band runs >=8 dB over the 3.5–6 kHz reference", () => {
      const c = curve([-30, -30, -30, -30, -30, -20, -30, -30, -30, -30]);
      const hit = firedFor(evaluateRules(c), "edgy");
      expect(hit.rule.symptom).toBe("Edgy/piezo");
      expect(hit.rule.suggestion.move).toBe("cut");
      expect(hit.rule.suggestion.targetHz).toBe(3000);
      expect(hit.rule.suggestion.band).toEqual({ lowHz: 2500, highHz: 3500 });
      expect(hit.measuredDb).toBeCloseTo(-20);
      expect(hit.referenceDb).toBeCloseTo(-30);
      expect(hit.excessDb).toBeCloseTo(10);
    });

    it("fires `muddy` when the 60–250 Hz band runs >=6 dB over the 500 Hz–2 kHz reference", () => {
      const c = curve([-10, -10, -30, -30, -30, -30, -30, -30, -30, -30]);
      const hit = firedFor(evaluateRules(c), "muddy");
      expect(hit.rule.symptom).toBe("Muddy");
      expect(hit.rule.suggestion.move).toBe("highpass");
      expect(hit.rule.suggestion.targetHz).toBe(250);
      expect(hit.rule.suggestion.band).toEqual({ lowHz: 200, highHz: 300 });
      expect(hit.measuredDb).toBeCloseTo(-10);
      expect(hit.referenceDb).toBeCloseTo(-30);
      expect(hit.excessDb).toBeCloseTo(20);
    });

    it("fires `kick-boxy` for a kick when the 250–500 Hz band runs >=6 dB over 60–250 Hz", () => {
      const c = curve([-30, -30, -20, -30, -30, -30, -30, -30, -30, -30]);
      const hit = firedFor(evaluateRules(c, "kick"), "kick-boxy");
      expect(hit.rule.symptom).toBe("Boxy kick");
      expect(hit.rule.suggestion.move).toBe("cut");
      expect(hit.rule.suggestion.targetHz).toBe(400);
      expect(hit.rule.suggestion.band).toEqual({ lowHz: 300, highHz: 500 });
      expect(hit.measuredDb).toBeCloseTo(-20);
      expect(hit.referenceDb).toBeCloseTo(-30);
      expect(hit.excessDb).toBeCloseTo(10);
    });

    it("fires `snare-harsh` for a snare when the 2–4 kHz band runs >=8 dB over 500 Hz–2 kHz", () => {
      const c = curve([-30, -30, -30, -30, -30, -20, -30, -30, -30, -30]);
      const hit = firedFor(evaluateRules(c, "snare"), "snare-harsh");
      expect(hit.rule.symptom).toBe("Harsh/ringy snare");
      expect(hit.rule.suggestion.move).toBe("cut");
      expect(hit.rule.suggestion.targetHz).toBe(3000);
      expect(hit.rule.suggestion.band).toEqual({ lowHz: 2000, highHz: 4000 });
      expect(hit.measuredDb).toBeCloseTo(-20);
      expect(hit.referenceDb).toBeCloseTo(-30);
      expect(hit.excessDb).toBeCloseTo(10);
    });

    it("fires `cymbal-brittle` for overheads when the 6–12 kHz band runs >=6 dB over 4–6 kHz", () => {
      const c = curve([-30, -30, -30, -30, -30, -30, -30, -30, -20, -20]);
      const hit = firedFor(evaluateRules(c, "overheads"), "cymbal-brittle");
      expect(hit.rule.symptom).toBe("Brittle cymbals");
      expect(hit.rule.suggestion.move).toBe("cut");
      expect(hit.rule.suggestion.targetHz).toBe(8000);
      expect(hit.rule.suggestion.band).toEqual({ lowHz: 6000, highHz: 12000 });
      expect(hit.measuredDb).toBeCloseTo(-20);
      expect(hit.referenceDb).toBeCloseTo(-30);
      expect(hit.excessDb).toBeCloseTo(10);
    });
  });

  describe("no-fire cases", () => {
    it("fires nothing for a flat curve", () => {
      expect(evaluateRules(curve(Array(FREQS.length).fill(FLAT_DB)))).toEqual([]);
    });

    it("fires nothing when the measured band sits below its reference", () => {
      const c = curve([-30, -30, -30, -30, -30, -40, -30, -30, -30, -30]);
      expect(evaluateRules(c)).toEqual([]);
    });

    it("fires nothing when the excess is below every generic rule's threshold", () => {
      // idx5 sits only 3 dB over the 500 Hz–2 kHz reference — below harsh's
      // minExcessDb of 6 and edgy's of 8; the low end matches its reference.
      const c = curve([-30, -30, -30, -30, -30, -27, -30, -30, -30, -30]);
      expect(evaluateRules(c)).toEqual([]);
    });

    it("does not fire a drum rule for an unrelated instrument", () => {
      const kickCurve = curve([-30, -30, -20, -30, -30, -30, -30, -30, -30, -30]);
      expect(evaluateRules(kickCurve, "vocal")).toEqual([]);
      const cymbalCurve = curve([-30, -30, -30, -30, -30, -30, -30, -30, -20, -20]);
      expect(evaluateRules(cymbalCurve, "kick")).toEqual([]);
    });
  });

  describe("per-instrument scoping", () => {
    it("fires only the matching instrument rule for a known id", () => {
      const kickCurve = curve([-30, -30, -20, -30, -30, -30, -30, -30, -30, -30]);
      const hits = evaluateRules(kickCurve, "kick");
      expect(hits.map((h) => h.rule.id)).toEqual(["kick-boxy"]);
    });

    it("fires generic rules only for an unknown instrument id", () => {
      const harshCurve = curve([-30, -30, -30, -30, -30, -20, -30, -30, -30, -30]);
      const hits = evaluateRules(harshCurve, "vocal");
      expect(hits.map((h) => h.rule.id)).toEqual(["harsh", "edgy"]);
    });

    it("fires generic rules only when no instrument is given", () => {
      const harshCurve = curve([-30, -30, -30, -30, -30, -20, -30, -30, -30, -30]);
      const hits = evaluateRules(harshCurve);
      expect(hits.map((h) => h.rule.id)).toEqual(["harsh", "edgy"]);
    });
  });

  describe("boundary / epsilon", () => {
    it("fires a rule whose excess equals exactly minExcessDb", () => {
      // idx5 at -24 vs reference -30 -> excess exactly 6 = harsh's minExcessDb.
      const c = curve([-30, -30, -30, -30, -30, -24, -30, -30, -30, -30]);
      const hit = firedFor(evaluateRules(c), "harsh");
      expect(hit.excessDb).toBeCloseTo(6);
    });

    it("does not fire the same rule for a clearly-lower excess", () => {
      const c = curve([-30, -30, -30, -30, -30, -27, -30, -30, -30, -30]);
      expect(evaluateRules(c)).toEqual([]);
    });
  });

  describe("non-finite / silence guard", () => {
    it("fires nothing when a rule's reference band is all -Infinity", () => {
      const c = curve([
        -Infinity, -Infinity, -Infinity, -Infinity, -Infinity, -20,
        -Infinity, -Infinity, -Infinity, -Infinity,
      ]);
      expect(evaluateRules(c)).toEqual([]);
    });
  });

  describe("invalid input", () => {
    it("returns [] for an undefined curve", () => {
      expect(evaluateRules(undefined)).toEqual([]);
    });

    it("returns [] for a curve whose freqs and db lengths mismatch", () => {
      const c: SpectrumCurve = { freqs: FREQS, db: [-30, -30] };
      expect(evaluateRules(c)).toEqual([]);
    });

    it("returns [] for an empty curve", () => {
      expect(evaluateRules({ freqs: [], db: [] })).toEqual([]);
    });
  });

  describe("sort order", () => {
    it("returns fired rules sorted by excessDb descending, ties keeping table order", () => {
      // idx5 elevated 12 dB over its references (harsh + edgy fire), low end
      // elevated 8 dB (muddy fires): expects harsh (12), edgy (12), muddy (8).
      const c = curve([-22, -22, -30, -30, -30, -18, -30, -30, -30, -30]);
      const hits = evaluateRules(c);
      expect(hits.map((h) => h.rule.id)).toEqual(["harsh", "edgy", "muddy"]);
      expect(hits.map((h) => h.excessDb)).toEqual([12, 12, 8]);
      expect(hits[0].excessDb).toBeGreaterThanOrEqual(hits[1].excessDb);
      expect(hits[1].excessDb).toBeGreaterThanOrEqual(hits[2].excessDb);
    });
  });
});

describe("rulesForInstrument", () => {
  it("returns generic rules plus the instrument's own rules for a known id", () => {
    expect(rulesForInstrument("kick").map((r) => r.id)).toEqual(["harsh", "edgy", "muddy", "kick-boxy"]);
    expect(rulesForInstrument("snare").map((r) => r.id)).toEqual(["harsh", "edgy", "muddy", "snare-harsh"]);
    expect(rulesForInstrument("overheads").map((r) => r.id)).toEqual(["harsh", "edgy", "muddy", "cymbal-brittle"]);
  });

  it("returns only generic rules for an undefined id", () => {
    expect(rulesForInstrument().map((r) => r.id)).toEqual(["harsh", "edgy", "muddy"]);
  });

  it("returns only generic rules for an empty-string id", () => {
    expect(rulesForInstrument("").map((r) => r.id)).toEqual(["harsh", "edgy", "muddy"]);
  });

  it("returns only generic rules for an unknown id", () => {
    expect(rulesForInstrument("vocal").map((r) => r.id)).toEqual(["harsh", "edgy", "muddy"]);
  });
});

describe("RULE_TABLE integrity", () => {
  it("has unique non-empty ids and non-empty symptoms", () => {
    const ids = RULE_TABLE.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id.length).toBeGreaterThan(0);
    }
    for (const rule of RULE_TABLE) {
      expect(rule.symptom.length).toBeGreaterThan(0);
    }
  });

  it("keeps every suggestion band inside the curve's 20 Hz–20 kHz span with targetHz inside it", () => {
    for (const rule of RULE_TABLE) {
      const { band, targetHz } = rule.suggestion;
      expect(band.lowHz).toBeGreaterThanOrEqual(20);
      expect(band.highHz).toBeLessThanOrEqual(20000);
      expect(band.lowHz).toBeLessThan(band.highHz);
      expect(targetHz).toBeGreaterThanOrEqual(band.lowHz);
      expect(targetHz).toBeLessThan(band.highHz);
    }
  });

  it("has a positive minExcessDb on every rule", () => {
    for (const rule of RULE_TABLE) {
      expect(rule.condition.minExcessDb).toBeGreaterThan(0);
    }
  });
});