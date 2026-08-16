import { describe, it, expect } from "vitest";
import { HARSHNESS_NARRATIVE_TEMPLATE, harshnessNarrativeData, renderHarshnessNarrative } from "./harshness-narrative.js";
import { getRuleTemplate } from "./rule-narrative.js";
import type { FiredRule } from "./rules.js";

// Hand-built FiredRule fixtures so values are controlled exactly — the module
// only needs the FiredRule shape, no call into evaluateRules.
const HARSH_HIT: FiredRule = {
  rule: {
    id: "harsh",
    symptom: "Quacky/harsh",
    instruments: [],
    condition: {
      band: { lowHz: 2000, highHz: 4000 },
      reference: { lowHz: 500, highHz: 2000 },
      minExcessDb: 6,
    },
    suggestion: {
      instruction: "Cut 2–4 kHz",
      move: "cut",
      band: { lowHz: 2000, highHz: 4000 },
      targetHz: 3000,
    },
    why: "Harshness lives at 2–4 kHz.",
  },
  measuredDb: -20,
  referenceDb: -30,
  excessDb: 10,
};

const MUDDY_HIT: FiredRule = {
  rule: {
    id: "muddy",
    symptom: "Muddy",
    instruments: [],
    condition: {
      band: { lowHz: 60, highHz: 250 },
      reference: { lowHz: 500, highHz: 2000 },
      minExcessDb: 6,
    },
    suggestion: {
      instruction: "Highpass below ~100 Hz and cut ~250 Hz",
      move: "highpass",
      band: { lowHz: 200, highHz: 300 },
      targetHz: 250,
    },
    why: "Mud collects below 250 Hz.",
  },
  measuredDb: -10,
  referenceDb: -30,
  excessDb: 20,
};

const FRACTIONAL_KHZ_HIT: FiredRule = {
  rule: {
    id: "edgy",
    symptom: "Edgy/piezo",
    instruments: [],
    condition: {
      band: { lowHz: 2500, highHz: 3500 },
      reference: { lowHz: 3500, highHz: 6000 },
      minExcessDb: 8,
    },
    suggestion: {
      instruction: "Cut ~3 kHz",
      move: "cut",
      band: { lowHz: 2500, highHz: 3500 },
      targetHz: 3000,
    },
    why: "Piezo/edgy tone concentrates around 3 kHz.",
  },
  measuredDb: -20,
  referenceDb: -30,
  excessDb: 10,
};

describe("renderHarshnessNarrative registration", () => {
  it("registers the template under 'harshness' in the #834 registry", () => {
    renderHarshnessNarrative(HARSH_HIT);
    expect(getRuleTemplate("harshness")).toBe(HARSHNESS_NARRATIVE_TEMPLATE);
  });

  it("is idempotent — a second render still returns the same prose and leaves the registry unchanged", () => {
    const first = renderHarshnessNarrative(HARSH_HIT);
    expect(getRuleTemplate("harshness")).toBe(HARSHNESS_NARRATIVE_TEMPLATE);
    expect(renderHarshnessNarrative(HARSH_HIT)).toBe(first);
  });
});

describe("harshnessNarrativeData", () => {
  it("maps a FiredRule hit to the flat RuleNarrativeData record", () => {
    expect(harshnessNarrativeData(HARSH_HIT)).toEqual({
      symptom: "Quacky/harsh",
      band: "2–4 kHz",
      reference: "500 Hz–2 kHz",
      excessDb: "10.0",
      thresholdDb: "6",
      instruction: "Cut 2–4 kHz",
    });
  });

  it("formats sub-kHz bands with a Hz suffix and whole-Hz edges", () => {
    expect(harshnessNarrativeData(MUDDY_HIT)).toEqual({
      symptom: "Muddy",
      band: "60–250 Hz",
      reference: "500 Hz–2 kHz",
      excessDb: "20.0",
      thresholdDb: "6",
      instruction: "Highpass below ~100 Hz and cut ~250 Hz",
    });
  });

  it("formats fractional-kHz edges with one decimal (no trailing .0)", () => {
    expect(harshnessNarrativeData(FRACTIONAL_KHZ_HIT)).toEqual({
      symptom: "Edgy/piezo",
      band: "2.5–3.5 kHz",
      reference: "3.5–6 kHz",
      excessDb: "10.0",
      thresholdDb: "8",
      instruction: "Cut ~3 kHz",
    });
  });
});

describe("renderHarshnessNarrative output", () => {
  it("renders troubleshooting prose from the hit's measured values", () => {
    expect(renderHarshnessNarrative(HARSH_HIT)).toBe(
      "The mix reads as Quacky/harsh: the 2–4 kHz region sits 10.0 dB above the 500 Hz–2 kHz body (threshold 6 dB). Cut 2–4 kHz to tame it.",
    );
  });

  it("renders text that differs per hit, each reflecting its own measurements", () => {
    const muddy = renderHarshnessNarrative(MUDDY_HIT);
    const harsh = renderHarshnessNarrative(HARSH_HIT);
    expect(muddy).toBe(
      "The mix reads as Muddy: the 60–250 Hz region sits 20.0 dB above the 500 Hz–2 kHz body (threshold 6 dB). Highpass below ~100 Hz and cut ~250 Hz to tame it.",
    );
    expect(muddy).not.toBe(harsh);
  });

  it("leaves no {placeholder} tokens in the rendered output", () => {
    expect(renderHarshnessNarrative(HARSH_HIT)).not.toContain("{");
  });
});