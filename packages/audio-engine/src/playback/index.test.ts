import { describe, it, expect } from "vitest";
import { buildPlaybackArgs, type PlaybackOptions } from "./index.js";

const base: PlaybackOptions = { sessionDir: "/tmp/session-1" };

describe("buildPlaybackArgs", () => {
  it("emits session_dir as the sole positional by default", () => {
    expect(buildPlaybackArgs(base)).toEqual(["/tmp/session-1"]);
  });

  it("maps device/route/interval flags in order", () => {
    const args = buildPlaybackArgs({
      ...base,
      device: "Scarlett",
      route: "0:0,1:2-3",
      intervalSecs: 0.05,
    });
    expect(args).toEqual([
      "/tmp/session-1",
      "--device",
      "Scarlett",
      "--route",
      "0:0,1:2-3",
      "--interval",
      "0.05",
    ]);
  });

  it("appends --master as a bare flag", () => {
    const args = buildPlaybackArgs({ ...base, route: "0:0", master: true });
    expect(args).toContain("--master");
    expect(args[args.indexOf("--master") + 1]).toBeUndefined();
  });

  it("omits device/route when not provided (master-only fold)", () => {
    const args = buildPlaybackArgs({ ...base, master: true });
    expect(args).not.toContain("--device");
    expect(args).not.toContain("--route");
    expect(args).toEqual(["/tmp/session-1", "--master"]);
  });

  it("omits --interval when zero or negative", () => {
    expect(buildPlaybackArgs({ ...base, intervalSecs: 0 })).not.toContain("--interval");
    expect(buildPlaybackArgs({ ...base, intervalSecs: -1 })).not.toContain("--interval");
  });

  it("emits --start-at for a positive startOffsetSecs", () => {
    const args = buildPlaybackArgs({ ...base, startOffsetSecs: 5 });
    expect(args).toContain("--start-at");
    expect(args[args.indexOf("--start-at") + 1]).toBe("5");
  });

  it("emits --start-at with the exact string for a fractional offset", () => {
    const args = buildPlaybackArgs({ ...base, startOffsetSecs: 0.05 });
    expect(args[args.indexOf("--start-at") + 1]).toBe("0.05");
  });

  it("omits --start-at when omitted, zero, or negative", () => {
    expect(buildPlaybackArgs(base)).not.toContain("--start-at");
    expect(buildPlaybackArgs({ ...base, startOffsetSecs: 0 })).not.toContain("--start-at");
    expect(buildPlaybackArgs({ ...base, startOffsetSecs: -1 })).not.toContain("--start-at");
  });

  it("orders --start-at after --interval and before --master", () => {
    const args = buildPlaybackArgs({
      ...base,
      intervalSecs: 0.05,
      startOffsetSecs: 5,
      master: true,
    });
    expect(args).toEqual([
      "/tmp/session-1",
      "--interval",
      "0.05",
      "--start-at",
      "5",
      "--master",
    ]);
  });
});
