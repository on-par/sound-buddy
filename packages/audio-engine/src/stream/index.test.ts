import { describe, it, expect } from "vitest";
import { buildStreamArgs, type LiveOptions } from "./index.js";

const base: LiveOptions = {
  windowSecs: 3,
};

describe("buildStreamArgs", () => {
  it("emits device/window/channels positionals with sensible blanks", () => {
    expect(buildStreamArgs(base)).toEqual(["", "3", ""]);
    expect(buildStreamArgs({ ...base, device: "Scarlett", channels: ["0", "1", "2"] })).toEqual(
      ["Scarlett", "3", "0,1,2"],
    );
  });

  it("emits a single channel-config token as the joined positional", () => {
    expect(buildStreamArgs({ ...base, channels: ["0"] })).toEqual(["", "3", "0"]);
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

  it("emits --interval with its value when intervalSecs is positive", () => {
    const args = buildStreamArgs({ ...base, intervalSecs: 0.25 });
    expect(args).toContain("--interval");
    expect(args[args.indexOf("--interval") + 1]).toBe("0.25");
  });

  it("omits --interval when intervalSecs is 0 or undefined", () => {
    expect(buildStreamArgs({ ...base, intervalSecs: 0 })).not.toContain("--interval");
    expect(buildStreamArgs({ ...base, intervalSecs: undefined })).not.toContain("--interval");
  });

  it("emits --labels with the JSON array when at least one label is non-blank", () => {
    const args = buildStreamArgs({ ...base, labels: ["Kick", "", "OH"] });
    expect(args).toContain("--labels");
    expect(args[args.indexOf("--labels") + 1]).toBe(JSON.stringify(["Kick", "", "OH"]));
  });

  it("omits --labels when labels is undefined", () => {
    expect(buildStreamArgs({ ...base, labels: undefined })).not.toContain("--labels");
  });

  it("omits --labels when every label is blank/whitespace-only", () => {
    expect(buildStreamArgs({ ...base, labels: ["", "  "] })).not.toContain("--labels");
  });

  it("orders all optional flags correctly when every option is set", () => {
    const args = buildStreamArgs({
      device: "M32R",
      channels: ["0", "2", "3"],
      windowSecs: 5,
      intervalSecs: 0.1,
      recordPath: "/out.wav",
      sessionDir: "/tmp/sess",
      armTokens: ["0", "2-3"],
      labels: ["Kick", "", "OH"],
    });
    expect(args).toEqual([
      "M32R",
      "5",
      "0,2,3",
      "--interval",
      "0.1",
      "--record",
      "/out.wav",
      "--session-dir",
      "/tmp/sess",
      "--arm",
      "0,2-3",
      "--labels",
      JSON.stringify(["Kick", "", "OH"]),
    ]);
  });

  it("emits an empty positional when channels is an empty array", () => {
    expect(buildStreamArgs({ ...base, channels: [] })).toEqual(["", "3", ""]);
  });
});
