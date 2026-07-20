import { describe, expect, it } from "vitest";
import { buildLiveSystemPrompt } from "./system-live.js";

const EXPECTED_WITH_WINDOWS = `You are a professional audio engineer monitoring a live mix from a Midas M32R console. You are given 2 consecutive 3.0-second analysis windows. Identify trends, flag developing problems (frequency buildup, approaching clipping, dynamic issues), and give real-time mixing recommendations. Be concise — this is live monitoring, not a post-session report.`;

describe("buildLiveSystemPrompt (golden, TD-004 #398)", () => {
  it("with both window stats is byte-identical to the pre-refactor engineer.ts live prompt", () => {
    expect(buildLiveSystemPrompt({ windowCount: 2, windowSeconds: 3 })).toBe(EXPECTED_WITH_WINDOWS);
  });

  it("with no options renders the generic clause and keeps the M32R / live-monitoring wording", () => {
    const prompt = buildLiveSystemPrompt();
    expect(prompt).toContain("consecutive analysis windows");
    expect(prompt).toContain("from a Midas M32R console");
    expect(prompt).toContain("not a post-session report");
  });

  it("rounds windowSeconds to one decimal place", () => {
    expect(buildLiveSystemPrompt({ windowCount: 2, windowSeconds: 3.14 })).toContain("3.1-second");
  });

  it("falls back to the generic clause when only windowCount is given", () => {
    expect(buildLiveSystemPrompt({ windowCount: 2 })).toContain("consecutive analysis windows");
  });

  it("falls back to the generic clause when only windowSeconds is given", () => {
    expect(buildLiveSystemPrompt({ windowSeconds: 3 })).toContain("consecutive analysis windows");
  });
});
