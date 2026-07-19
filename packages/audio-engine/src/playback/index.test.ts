import { describe, it, expect, vi } from "vitest";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn: (...args: unknown[]) => spawnMock(...args) }));

import { buildPlaybackArgs, startPlayback, type PlaybackOptions } from "./index.js";

const base: PlaybackOptions = { sessionDir: "/tmp/session-1" };

/** A stand-in playback.py child: EventEmitter + real stdout stream + spy-able kill(). */
function fakeChild() {
  const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; kill: ReturnType<typeof vi.fn> };
  child.stdout = new PassThrough();
  child.kill = vi.fn();
  return child;
}

/** Flush the microtask queue so readline's 'line' events (emitted async) land. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

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
});

describe("startPlayback", () => {
  it("spawns the injected python binary with PLAYBACK_SCRIPT and the mapped args", () => {
    const child = fakeChild();
    spawnMock.mockReturnValueOnce(child);

    startPlayback({ ...base, device: "Scarlett" }, () => {}, "/usr/bin/python3.11");

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [python, argv] = spawnMock.mock.calls[0] as [string, string[]];
    expect(python).toBe("/usr/bin/python3.11");
    expect(argv[0]).toContain("playback.py");
    expect(argv.slice(1)).toEqual(buildPlaybackArgs({ ...base, device: "Scarlett" }));
  });

  it("parses NDJSON lines from stdout and delivers them to onEvent", async () => {
    const child = fakeChild();
    spawnMock.mockReturnValueOnce(child);
    const events: unknown[] = [];

    startPlayback(base, (e) => events.push(e));
    child.stdout.write('{"type":"progress","pct":0.5}\n{"type":"ended"}\n');
    await flush();

    expect(events).toEqual([{ type: "progress", pct: 0.5 }, { type: "ended" }]);
  });

  it("skips blank lines", async () => {
    const child = fakeChild();
    spawnMock.mockReturnValueOnce(child);
    const events: unknown[] = [];

    startPlayback(base, (e) => events.push(e));
    child.stdout.write("\n   \n" + '{"type":"ended"}\n');
    await flush();

    expect(events).toEqual([{ type: "ended" }]);
  });

  it("swallows non-JSON lines without throwing or calling onEvent", async () => {
    const child = fakeChild();
    spawnMock.mockReturnValueOnce(child);
    const onEvent = vi.fn();

    startPlayback(base, onEvent);
    child.stdout.write("this is not json\n");
    await flush();

    expect(onEvent).not.toHaveBeenCalled();
  });

  it("stop() SIGTERMs the process", () => {
    const child = fakeChild();
    spawnMock.mockReturnValueOnce(child);

    const handle = startPlayback(base, () => {});
    handle.stop();

    expect(child.kill).toHaveBeenCalledTimes(1);
  });
});
