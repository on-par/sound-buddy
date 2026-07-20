import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT, MULTI_CHANNEL_SYSTEM_PROMPT, ANALYST_SYSTEM_PROMPT, buildLiveSystemPrompt } from "./index.js";
import * as audioEngine from "../index.js";

const EXPECTED_ENGINEER = `You are a professional audio engineer with 20+ years of experience. You are given acoustic measurement data for an audio file. Analyze it deeply: identify EQ imbalances, dynamic range issues, potential mastering problems, stereo image concerns, and anything else a trained ear would flag. Be specific, reference the actual numbers, and give actionable recommendations.`;

const EXPECTED_MULTI_CHANNEL = `You are a professional mixing engineer analyzing a multi-track recording from a Midas M32R console. Given the acoustic measurements of each channel and the full mix, identify: frequency masking between channels, problematic EQ buildups, channels that need low-cut or high-cut filters, channels competing in the same frequency range, and give specific actionable EQ/dynamics recommendations per channel. Reference actual dB values.`;

const EXPECTED_ANALYST = `You are an expert live sound engineer specializing in the Midas M32R digital mixing console.
Analyze the provided audio measurements and/or scene changes and return actionable insights for the engineer.
Reference actual dB values in your insights. Be specific about channel names.
When returning structured insights, respond with a valid JSON array of insight objects matching this shape:
{ type: string, channel?: string, message: string, severity: "info" | "warning" | "suggestion" }
Return ONLY the JSON array, no prose wrapper.`;

describe("shared AI system prompts (golden, #426)", () => {
  it("system-engineer text is byte-identical to the pre-refactor prompt", () => {
    expect(SYSTEM_PROMPT).toBe(EXPECTED_ENGINEER);
  });
  it("system-multi-channel text is byte-identical to the pre-refactor prompt", () => {
    expect(MULTI_CHANNEL_SYSTEM_PROMPT).toBe(EXPECTED_MULTI_CHANNEL);
  });
  it("system-analyst text is byte-identical to the pre-refactor ai-analyst prompt", () => {
    expect(ANALYST_SYSTEM_PROMPT).toBe(EXPECTED_ANALYST);
  });
  it("package root re-exports all three prompts", () => {
    expect(audioEngine.SYSTEM_PROMPT).toBe(SYSTEM_PROMPT);
    expect(audioEngine.MULTI_CHANNEL_SYSTEM_PROMPT).toBe(MULTI_CHANNEL_SYSTEM_PROMPT);
    expect(audioEngine.ANALYST_SYSTEM_PROMPT).toBe(ANALYST_SYSTEM_PROMPT);
    expect(audioEngine.buildLiveSystemPrompt).toBe(buildLiveSystemPrompt);
  });
});
