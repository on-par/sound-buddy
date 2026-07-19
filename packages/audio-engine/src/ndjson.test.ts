import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { readNdjsonLines, parseOllamaNdjsonStream } from "./ndjson.js";

describe("readNdjsonLines", () => {
  const collect = () => {
    const seen: unknown[] = [];
    const em = new EventEmitter();
    readNdjsonLines(em, (d) => seen.push(d));
    return { em, seen };
  };

  it("parses complete newline-terminated lines, including two objects in one chunk", () => {
    const { em, seen } = collect();
    em.emit("data", Buffer.from('{"a":1}\n{"b":2}\n'));
    expect(seen).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("reassembles one line split across two chunks", () => {
    const { em, seen } = collect();
    em.emit("data", Buffer.from('{"win'));
    em.emit("data", Buffer.from('dow":2}\n'));
    expect(seen).toEqual([{ window: 2 }]);
  });

  it("ignores non-JSON lines", () => {
    const { em, seen } = collect();
    em.emit("data", Buffer.from('garbage\n{"ok":true}\n'));
    expect(seen).toEqual([{ ok: true }]);
  });

  it("skips blank/whitespace-only lines", () => {
    const { em, seen } = collect();
    em.emit("data", Buffer.from('\n   \n{"x":1}\n'));
    expect(seen).toEqual([{ x: 1 }]);
  });

  it("never delivers a trailing partial line with no newline", () => {
    const { em, seen } = collect();
    em.emit("data", Buffer.from('{"x":1}'));
    expect(seen).toEqual([]);
  });
});

describe("parseOllamaNdjsonStream", () => {
  const collect = () => {
    const em = new EventEmitter();
    const deltas: string[] = [];
    const onDone = vi.fn();
    parseOllamaNdjsonStream(em, (text) => deltas.push(text), onDone);
    return { em, deltas, onDone };
  };

  it('emits onDelta("Hi") and calls onDone exactly once for a following done line', () => {
    const { em, deltas, onDone } = collect();
    em.emit("data", Buffer.from('{"message":{"content":"Hi"},"done":false}\n'));
    expect(deltas).toEqual(["Hi"]);
    expect(onDone).not.toHaveBeenCalled();

    em.emit("data", Buffer.from('{"done":true}\n'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("reassembles a multi-line stream split mid-line across chunks", () => {
    const { em, deltas, onDone } = collect();
    em.emit("data", Buffer.from('{"message":{"content":"He'));
    em.emit(
      "data",
      Buffer.from('llo"},"done":false}\n{"message":{"content":" world"},"done":false}\n'),
    );
    em.emit("data", Buffer.from('{"done":true}\n'));

    expect(deltas).toEqual(["Hello", " world"]);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("does not emit a delta for a done:true line that also carries message.content", () => {
    const { em, deltas, onDone } = collect();
    em.emit("data", Buffer.from('{"message":{"content":"trailing"},"done":true}\n'));
    expect(deltas).toEqual([]);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("emits nothing and does not call onDone for a line with no message and done:false", () => {
    const { em, deltas, onDone } = collect();
    em.emit("data", Buffer.from('{"done":false}\n'));
    expect(deltas).toEqual([]);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("silently skips malformed JSON lines", () => {
    const { em, deltas, onDone } = collect();
    em.emit("data", Buffer.from('not json\n{"done":true}\n'));
    expect(deltas).toEqual([]);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
