import { describe, it, expect } from "vitest";
import {
  GAIN_NARRATIVE_TEMPLATE,
  gainNarrativeData,
  renderGainNarrative,
} from "./gain-narrative.js";
import type { GainRuleHit } from "./gain-narrative.js";
import { getRuleTemplate } from "./rule-narrative.js";

// Hand-built GainRuleHit fixtures so values are controlled exactly — the
// future gain-rule engine does not exist yet (ADR-0028), and none is needed
// to render.
const HOT_HIT: GainRuleHit = {
  channel: "Kick",
  levelDbfs: -8.2,
  targetDbfs: -18,
  status: "hot",
  instruction: "Reduce gain at the preamp for channel Kick",
};

const COLD_HIT: GainRuleHit = {
  channel: "Kick",
  levelDbfs: -30.5,
  targetDbfs: -18,
  status: "cold",
  instruction: "Raise gain at the preamp for channel Kick",
};

const DIFFERENT_CHANNEL_HIT: GainRuleHit = {
  channel: "3",
  levelDbfs: -10.8,
  targetDbfs: -18,
  status: "hot",
  instruction: "Reduce gain at the preamp for channel 3",
};

describe("renderGainNarrative registration", () => {
  it("registers the template under 'gain' in the #834 registry", () => {
    renderGainNarrative(HOT_HIT);
    expect(getRuleTemplate("gain")).toBe(GAIN_NARRATIVE_TEMPLATE);
  });

  it("is idempotent — a second render still returns the same prose and leaves the registry unchanged", () => {
    const first = renderGainNarrative(HOT_HIT);
    expect(getRuleTemplate("gain")).toBe(GAIN_NARRATIVE_TEMPLATE);
    expect(renderGainNarrative(HOT_HIT)).toBe(first);
  });
});

describe("gainNarrativeData", () => {
  it("maps a GainRuleHit to the flat RuleNarrativeData record", () => {
    expect(gainNarrativeData(HOT_HIT)).toEqual({
      channel: "Kick",
      status: "hot",
      levelDbfs: "-8.2",
      distanceDb: "9.8",
      direction: "above",
      targetDbfs: "-18",
      instruction: "Reduce gain at the preamp for channel Kick",
    });
  });
});

describe("renderGainNarrative output", () => {
  it("renders troubleshooting prose from the hit's measured values", () => {
    expect(renderGainNarrative(HOT_HIT)).toBe(
      "Channel Kick is running hot: its recorded level of -8.2 dBFS sits 9.8 dB above the -18 dBFS target. Reduce gain at the preamp for channel Kick.",
    );
  });

  it("renders text that differs per hit, each reflecting its own measurements", () => {
    const cold = renderGainNarrative(COLD_HIT);
    const hot = renderGainNarrative(HOT_HIT);
    expect(cold).toBe(
      "Channel Kick is running cold: its recorded level of -30.5 dBFS sits 12.5 dB below the -18 dBFS target. Raise gain at the preamp for channel Kick.",
    );
    expect(cold).not.toBe(hot);

    const differentChannel = renderGainNarrative(DIFFERENT_CHANNEL_HIT);
    expect(differentChannel).toBe(
      "Channel 3 is running hot: its recorded level of -10.8 dBFS sits 7.2 dB above the -18 dBFS target. Reduce gain at the preamp for channel 3.",
    );
    expect(differentChannel).not.toBe(hot);
  });

  it("leaves no {placeholder} tokens or empty-string gaps in the rendered output", () => {
    const rendered = renderGainNarrative(HOT_HIT);
    expect(rendered).not.toContain("{");
    expect(rendered).not.toContain("  ");
  });
});