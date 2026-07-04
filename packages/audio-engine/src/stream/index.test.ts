import { describe, it, expect } from "vitest";
import { buildStreamArgs, type LiveOptions } from "./index.js";

const base: LiveOptions = {
  windowSecs: 3,
  llmIntervalSecs: 0,
};

describe("buildStreamArgs", () => {
  it("emits device/window/channels positionals with sensible blanks", () => {
    expect(buildStreamArgs(base)).toEqual(["", "3", ""]);
    expect(buildStreamArgs({ ...base, device: "Scarlett", channels: [0, 1, 2] })).toEqual(
      ["Scarlett", "3", "0,1,2"],
    );
  });

  it("omits --session-dir and --arm in monitor mode", () => {
    const args = buildStreamArgs({ ...base, intervalSecs: 0.1 });
    expect(args).not.toContain("--session-dir");
    expect(args).not.toContain("--arm");
    expect(args).not.toContain("--record");
  });

  it("maps sessionDir → --session-dir and armTokens → --arm", () => {
    const args = buildStreamArgs({
      ...base,
      sessionDir: "/tmp/session-1",
      armTokens: ["0", "2-3"],
    });
    expect(args).toContain("--session-dir");
    expect(args[args.indexOf("--session-dir") + 1]).toBe("/tmp/session-1");
    expect(args).toContain("--arm");
    expect(args[args.indexOf("--arm") + 1]).toBe("0,2-3");
  });

  it("forwards sessionDir without --arm when no strips are armed", () => {
    const args = buildStreamArgs({ ...base, sessionDir: "/tmp/s", armTokens: [] });
    expect(args).toContain("--session-dir");
    expect(args).not.toContain("--arm");
  });

  it("still supports the single-file --record path", () => {
    const args = buildStreamArgs({ ...base, recordPath: "/tmp/out.wav" });
    expect(args).toContain("--record");
    expect(args[args.indexOf("--record") + 1]).toBe("/tmp/out.wav");
  });
});
