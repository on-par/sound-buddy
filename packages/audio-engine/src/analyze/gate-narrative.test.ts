import { describe, it, expect } from "vitest";
import {
  GATE_NARRATIVE_TEMPLATE,
  gateNarrativeData,
  renderGateNarrative,
} from "./gate-narrative.js";
import type { GateRuleHit } from "./gate-narrative.js";
import { getRuleTemplate } from "./rule-narrative.js";

// Hand-built GateRuleHit fixtures so values are controlled exactly — the
// future gate-attack engine does not exist yet (ADR-0028), and none is needed
// to render.
const CHOP_HIT: GateRuleHit = {
  behavior: "closes over the first syllable of every word",
  timingMs: 120,
  thresholdDb: -20,
  instruction: "Lower the threshold to -40 dB and shorten the attack time",
};

const NOISE_HIT: GateRuleHit = {
  behavior: "stays open over the room noise between lines",
  timingMs: 950,
  thresholdDb: -45,
  instruction: "Raise the threshold to -30 dB and shorten the release time",
};

describe("renderGateNarrative registration", () => {
  it("registers the template under 'gate' in the #834 registry", () => {
    renderGateNarrative(CHOP_HIT);
    expect(getRuleTemplate("gate")).toBe(GATE_NARRATIVE_TEMPLATE);
  });

  it("is idempotent — a second render still returns the same prose and leaves the registry unchanged", () => {
    const first = renderGateNarrative(CHOP_HIT);
    expect(getRuleTemplate("gate")).toBe(GATE_NARRATIVE_TEMPLATE);
    expect(renderGateNarrative(CHOP_HIT)).toBe(first);
  });
});

describe("gateNarrativeData", () => {
  it("maps a GateRuleHit to the flat RuleNarrativeData record", () => {
    expect(gateNarrativeData(CHOP_HIT)).toEqual({
      behavior: "closes over the first syllable of every word",
      timingMs: "120",
      thresholdDb: "-20",
      instruction: "Lower the threshold to -40 dB and shorten the attack time",
    });
  });
});

describe("renderGateNarrative output", () => {
  it("renders troubleshooting prose from the hit's measured values", () => {
    expect(renderGateNarrative(CHOP_HIT)).toBe(
      "The gate closes over the first syllable of every word: it responds 120 ms after the signal onset at the -20 dB threshold. Lower the threshold to -40 dB and shorten the attack time.",
    );
  });

  it("renders text that differs per hit, each reflecting its own measurements", () => {
    const noise = renderGateNarrative(NOISE_HIT);
    const chop = renderGateNarrative(CHOP_HIT);
    expect(noise).toBe(
      "The gate stays open over the room noise between lines: it responds 950 ms after the signal onset at the -45 dB threshold. Raise the threshold to -30 dB and shorten the release time.",
    );
    expect(noise).not.toBe(chop);
  });

  it("leaves no {placeholder} tokens or empty-string gaps in the rendered output", () => {
    const rendered = renderGateNarrative(CHOP_HIT);
    expect(rendered).not.toContain("{");
    expect(rendered).not.toContain("  ");
  });
});