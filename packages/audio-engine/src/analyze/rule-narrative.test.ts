import { describe, it, expect } from "vitest";
import { registerRuleTemplate, getRuleTemplate, renderRuleNarrative } from "./rule-narrative.js";
import type { RuleNarrativeData } from "./rule-narrative.js";

describe("registerRuleTemplate / getRuleTemplate", () => {
  it("returns the registered template for a rule type", () => {
    registerRuleTemplate("harshness", "{symptom} at {excessDb} dB over reference.");
    expect(getRuleTemplate("harshness")).toBe("{symptom} at {excessDb} dB over reference.");
  });

  it("re-registering a type overwrites it (upsert), and distinct types coexist independently", () => {
    registerRuleTemplate("harshness", "first");
    registerRuleTemplate("harshness", "second");
    registerRuleTemplate("gate", "gate template");
    expect(getRuleTemplate("harshness")).toBe("second");
    expect(getRuleTemplate("gate")).toBe("gate template");
  });

  it("throws an actionable error naming the type and registerRuleTemplate for an unregistered type", () => {
    let error: unknown;
    try {
      getRuleTemplate("phase");
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("phase");
    expect((error as Error).message).toContain("registerRuleTemplate");
  });
});

describe("renderRuleNarrative", () => {
  it("substitutes every {name} placeholder from the data record", () => {
    registerRuleTemplate("harshness", "{symptom} at {excessDb} dB over reference.");
    const data: RuleNarrativeData = { symptom: "Quacky/harsh", excessDb: 10 };
    expect(renderRuleNarrative("harshness", data)).toBe("Quacky/harsh at 10 dB over reference.");
  });

  it("stringifies number data values", () => {
    registerRuleTemplate("gate", "Threshold {thresholdDb} dB");
    const data: RuleNarrativeData = { thresholdDb: 10 };
    expect(renderRuleNarrative("gate", data)).toBe("Threshold 10 dB");
  });

  it("renders a placeholder missing from the data as the empty string without throwing", () => {
    registerRuleTemplate("harshness", "A {missing} end");
    const data: RuleNarrativeData = {};
    expect(renderRuleNarrative("harshness", data)).toBe("A  end");
  });

  it("renders a placeholder whose data value is undefined as the empty string", () => {
    registerRuleTemplate("harshness", "A {missing} end");
    const data: RuleNarrativeData = { missing: undefined };
    expect(renderRuleNarrative("harshness", data)).toBe("A  end");
  });

  it("throws the actionable unregistered-type error for an unregistered type", () => {
    let error: unknown;
    try {
      renderRuleNarrative("gain", {});
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("gain");
    expect((error as Error).message).toContain("registerRuleTemplate");
  });

  it("renders a placeholder-free template unchanged and ignores unused data keys", () => {
    registerRuleTemplate("phase", "Phase alignment is off");
    const data: RuleNarrativeData = { unused: "ignored", excessDb: 10 };
    expect(renderRuleNarrative("phase", data)).toBe("Phase alignment is off");
  });
});