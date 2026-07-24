import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT, MULTI_CHANNEL_SYSTEM_PROMPT, buildLiveSystemPrompt } from "./index.js";
import * as audioEngine from "../index.js";

const EXPECTED_ENGINEER = `You are a professional audio engineer with 20+ years of experience. You are given acoustic measurement data for an audio file. Analyze it deeply: identify EQ imbalances, dynamic range issues, potential mastering problems, stereo image concerns, and anything else a trained ear would flag. Be specific, reference the actual numbers, and give actionable recommendations.`;

const EXPECTED_MULTI_CHANNEL = `You are a professional mixing engineer analyzing a multi-track recording from a Midas M32R console. Given the acoustic measurements of each channel and the full mix, identify: frequency masking between channels, problematic EQ buildups, channels that need low-cut or high-cut filters, channels competing in the same frequency range, and give specific actionable EQ/dynamics recommendations per channel. Reference actual dB values.`;

describe("shared AI system prompts (golden, #426)", () => {
  it("system-engineer text is byte-identical to the pre-refactor prompt", () => {
    expect(SYSTEM_PROMPT).toBe(EXPECTED_ENGINEER);
  });
  it("system-multi-channel text is byte-identical to the pre-refactor prompt", () => {
    expect(MULTI_CHANNEL_SYSTEM_PROMPT).toBe(EXPECTED_MULTI_CHANNEL);
  });
  it("package root re-exports the prompts", () => {
    expect(audioEngine.SYSTEM_PROMPT).toBe(SYSTEM_PROMPT);
    expect(audioEngine.MULTI_CHANNEL_SYSTEM_PROMPT).toBe(MULTI_CHANNEL_SYSTEM_PROMPT);
    expect(audioEngine.buildLiveSystemPrompt).toBe(buildLiveSystemPrompt);
  });
});
