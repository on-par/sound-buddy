import { describe, it, expect } from "vitest";
import {
  PHASE_NARRATIVE_TEMPLATE,
  phaseNarrativeData,
  renderPhaseNarrative,
} from "./phase-narrative.js";
import type { PhaseRuleHit } from "./phase-narrative.js";
import { getRuleTemplate } from "./rule-narrative.js";

// Hand-built PhaseRuleHit fixtures so values are controlled exactly — the
// future phase-correlation engine does not exist yet (ADR-0028), and none is
// needed to render.
const TWO_HIT: PhaseRuleHit = {
  channelA: "3",
  channelB: "4",
  lowHz: 200,
  highHz: 1000,
  polarity: "polarity-inverted",
  instruction: "Flip the polarity of channel 4",
};

const DELAY_HIT: PhaseRuleHit = {
  channelA: "1",
  channelB: "2",
  lowHz: 500,
  highHz: 2000,
  polarity: "delayed relative to each other",
  instruction: "Nudge channel 2 ~2 ms later to realign the pair",
};

const SAME_CHANNELS_HIT: PhaseRuleHit = {
  channelA: "3",
  channelB: "4",
  lowHz: 2500,
  highHz: 3500,
  polarity: "polarity-inverted",
  instruction: "Flip the polarity of channel 4",
};

describe("renderPhaseNarrative registration", () => {
  it("registers the template under 'phase' in the #834 registry", () => {
    renderPhaseNarrative(TWO_HIT);
    expect(getRuleTemplate("phase")).toBe(PHASE_NARRATIVE_TEMPLATE);
  });

  it("is idempotent — a second render still returns the same prose and leaves the registry unchanged", () => {
    const first = renderPhaseNarrative(TWO_HIT);
    expect(getRuleTemplate("phase")).toBe(PHASE_NARRATIVE_TEMPLATE);
    expect(renderPhaseNarrative(TWO_HIT)).toBe(first);
  });
});

describe("phaseNarrativeData", () => {
  it("maps a PhaseRuleHit to the flat RuleNarrativeData record", () => {
    expect(phaseNarrativeData(TWO_HIT)).toEqual({
      channelA: "3",
      channelB: "4",
      band: "200 Hz–1 kHz",
      polarity: "polarity-inverted",
      instruction: "Flip the polarity of channel 4",
    });
  });
});

describe("renderPhaseNarrative output", () => {
  it("renders troubleshooting prose from the hit's measured values", () => {
    expect(renderPhaseNarrative(TWO_HIT)).toBe(
      "In the 200 Hz–1 kHz range, channels 3 and 4 are polarity-inverted, causing audible phase cancellation. Flip the polarity of channel 4.",
    );
  });

  it("renders text that differs per hit, each reflecting its own measurements", () => {
    const delay = renderPhaseNarrative(DELAY_HIT);
    const two = renderPhaseNarrative(TWO_HIT);
    expect(delay).toBe(
      "In the 500 Hz–2 kHz range, channels 1 and 2 are delayed relative to each other, causing audible phase cancellation. Nudge channel 2 ~2 ms later to realign the pair.",
    );
    expect(delay).not.toBe(two);

    const sameChannels = renderPhaseNarrative(SAME_CHANNELS_HIT);
    expect(sameChannels).toBe(
      "In the 2.5–3.5 kHz range, channels 3 and 4 are polarity-inverted, causing audible phase cancellation. Flip the polarity of channel 4.",
    );
    expect(sameChannels).not.toBe(two);
  });

  it("leaves no {placeholder} tokens or empty-string gaps in the rendered output", () => {
    const rendered = renderPhaseNarrative(TWO_HIT);
    expect(rendered).not.toContain("{");
    expect(rendered).not.toContain("  ");
  });
});