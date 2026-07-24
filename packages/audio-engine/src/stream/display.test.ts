import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { LiveState, WindowData, ChannelWindowData } from "./types.js";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BG_RED = "\x1b[41m";
const CLEAR_LINE = "\x1b[2K";
const COL1 = "\x1b[G";

let stdout: string;
let writeSpy: ReturnType<typeof vi.spyOn>;

function resetStdoutCapture(): void {
  stdout = "";
  writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
}

beforeEach(() => {
  vi.resetModules(); // fresh module instance => lastLineCount starts at 0
  resetStdoutCapture();
});

afterEach(() => {
  writeSpy.mockRestore();
});

async function loadRender() {
  const mod = await import("./display.js");
  return mod.render;
}

function makeChannel(overrides: Partial<ChannelWindowData> = {}): ChannelWindowData {
  return {
    index: 0,
    name: "Vox",
    bands: {
      sub_bass: -50,
      bass: -40,
      low_mid: -30,
      mid: -20,
      high_mid: -25,
      presence: -35,
      brilliance: -45,
    },
    rms: -18.5,
    peak: -6.2,
    clipping: false,
    centroid: 1500,
    rolloff: 800,
    ...overrides,
  };
}

function makeState(
  channels: ChannelWindowData[],
  masking: WindowData["masking"] = []
): LiveState {
  const win: WindowData = { window: 1, ts: 0, channels, masking };
  return { windows: [win], currentWindow: win };
}

function findLine(output: string, needle: string): string {
  const line = output.split("\n").find((l) => l.includes(needle));
  if (line === undefined) {
    throw new Error(`no line containing "${needle}" in output`);
  }
  return line;
}

// Counts `\x1b[<digits>A` cursor-up sequences without a control-character
// regex literal (ESLint's no-control-regex rule rejects `\x1b` in patterns).
function countCursorUps(output: string): number {
  const ESC = "\x1b[";
  let count = 0;
  let searchFrom = 0;
  for (;;) {
    const escIndex = output.indexOf(ESC, searchFrom);
    if (escIndex === -1) break;
    let cursor = escIndex + ESC.length;
    let sawDigit = false;
    while (output[cursor] >= "0" && output[cursor] <= "9") {
      sawDigit = true;
      cursor++;
    }
    if (sawDigit && output[cursor] === "A") count++;
    searchFrom = escIndex + ESC.length;
  }
  return count;
}

describe("render", () => {
  it("renders header and waiting message for null currentWindow", async () => {
    const render = await loadRender();
    render({ windows: [], currentWindow: null }, "TestDevice", 3, 2.5);

    expect(stdout).toContain("SOUND BUDDY — LIVE");
    expect(stdout).toContain("TestDevice");
    expect(stdout).toContain("Window 3");
    expect(stdout).toContain("2.5s/win");
    expect(stdout).toContain("Waiting for audio...");
    expect(stdout).not.toContain("Frequency Balance");
    expect(stdout).not.toContain("CHANNEL OVERVIEW");
  });

  it("renders waiting message for empty channels array", async () => {
    const render = await loadRender();
    render(makeState([]), "TestDevice", 1, 1);

    expect(stdout).toContain("Waiting for audio...");
  });

  it("renders the single-channel levels line", async () => {
    const render = await loadRender();
    const state = makeState([makeChannel({ rms: -18.5, peak: -6.2 })]);
    render(state, "TestDevice", 1, 1);

    expect(stdout).toContain("RMS: -18.5 dBFS");
    expect(stdout).toContain("Peak: -6.2 dBFS");
    expect(stdout).toContain("DR: 12.3 dB");
    expect(stdout).toContain("CLIP: NO");
    expect(stdout).toContain("Frequency Balance");
  });

  it("renders all 7 band labels in order", async () => {
    const render = await loadRender();
    const state = makeState([makeChannel()]);
    render(state, "TestDevice", 1, 1);

    const labels = [
      "Sub-bass",
      "Bass",
      "Low-mid",
      "Mid",
      "High-mid",
      "Presence",
      "Brilliance",
    ];
    for (const label of labels) {
      expect(stdout).toContain(label);
    }
    for (let i = 0; i < labels.length - 1; i++) {
      expect(stdout.indexOf(labels[i])).toBeLessThan(stdout.indexOf(labels[i + 1]));
    }
    expect(stdout).toContain("[20-60Hz]");
    expect(stdout).toContain("[6-20kHz]");
  });

  it("shows the clip badge when clipping is true", async () => {
    const render = await loadRender();
    const state = makeState([makeChannel({ clipping: true })]);
    render(state, "TestDevice", 1, 1);

    expect(stdout).toContain(BG_RED);
    expect(stdout).toContain("CLIP: YES");
    expect(stdout).not.toContain("CLIP: NO");
  });

  it("dbToBar: -60 renders 16 empty blocks", async () => {
    const render = await loadRender();
    const state = makeState([
      makeChannel({
        bands: {
          sub_bass: -60,
          bass: -60,
          low_mid: -60,
          mid: -60,
          high_mid: -60,
          presence: -60,
          brilliance: -60,
        },
      }),
    ]);
    render(state, "TestDevice", 1, 1);

    const line = findLine(stdout, "Sub-bass");
    expect(line).toContain("░".repeat(16));
    expect(line).not.toContain("█");
  });

  it("dbToBar: -6 renders 16 filled blocks", async () => {
    const render = await loadRender();
    const state = makeState([makeChannel({ bands: { sub_bass: -6 } })]);
    render(state, "TestDevice", 1, 1);

    const line = findLine(stdout, "Sub-bass");
    expect(line).toContain("█".repeat(16));
  });

  it("dbToBar: 0 and +3 clamp to 16 filled blocks", async () => {
    const render1 = await loadRender();
    const state0 = makeState([makeChannel({ bands: { sub_bass: 0 } })]);
    render1(state0, "TestDevice", 1, 1);
    expect(findLine(stdout, "Sub-bass")).toContain("█".repeat(16));

    vi.resetModules();
    resetStdoutCapture();
    const render2 = await loadRender();
    const state3 = makeState([makeChannel({ bands: { sub_bass: 3 } })]);
    render2(state3, "TestDevice", 1, 1);
    expect(findLine(stdout, "Sub-bass")).toContain("█".repeat(16));
  });

  it("dbToBar: -33 renders half-filled bar", async () => {
    const render = await loadRender();
    const state = makeState([makeChannel({ bands: { sub_bass: -33 } })]);
    render(state, "TestDevice", 1, 1);

    const line = findLine(stdout, "Sub-bass");
    expect(line).toContain("█".repeat(8) + "░".repeat(8));
  });

  it("colorBar: green above -24 dB", async () => {
    const render = await loadRender();
    const state = makeState([makeChannel({ bands: { sub_bass: -20 } })]);
    render(state, "TestDevice", 1, 1);

    expect(findLine(stdout, "Sub-bass")).toContain(GREEN);
  });

  it("colorBar: yellow above -36 dB", async () => {
    const render = await loadRender();
    const state = makeState([makeChannel({ bands: { sub_bass: -30 } })]);
    render(state, "TestDevice", 1, 1);

    expect(findLine(stdout, "Sub-bass")).toContain(YELLOW);
  });

  it("colorBar: dim at or below -36 dB", async () => {
    const render = await loadRender();
    const state = makeState([makeChannel({ bands: { sub_bass: -50 } })]);
    render(state, "TestDevice", 1, 1);

    expect(findLine(stdout, "Sub-bass")).toContain(DIM);
  });

  it("marks only the loudest band", async () => {
    const render = await loadRender();
    const state = makeState([makeChannel()]);
    render(state, "TestDevice", 1, 1);

    const midLine = findLine(stdout, "Mid ");
    expect(midLine).toContain("◀ loudest");
    const occurrences = stdout.split("◀ loudest").length - 1;
    expect(occurrences).toBe(1);
  });

  it("falls back missing band keys to -60", async () => {
    const render = await loadRender();
    const state = makeState([makeChannel({ bands: { mid: -10 } })]);
    render(state, "TestDevice", 1, 1);

    const labels = [
      "Sub-bass",
      "Bass",
      "Low-mid",
      "Mid",
      "High-mid",
      "Presence",
      "Brilliance",
    ];
    for (const label of labels) {
      expect(stdout).toContain(label);
    }
    const subBassLine = findLine(stdout, "Sub-bass");
    expect(subBassLine).toContain("-60.0 dB");
    expect(subBassLine).toContain("░".repeat(16));
  });

  it("formats centroid and rolloff", async () => {
    const render = await loadRender();
    const state = makeState([makeChannel({ centroid: 1500, rolloff: 800 })]);
    render(state, "TestDevice", 1, 1);

    expect(stdout).toContain("Centroid: 1.5kHz");
    expect(stdout).toContain("Rolloff: 800Hz");
  });

  it("rounds sub-1kHz centroid values", async () => {
    const render = await loadRender();
    const state = makeState([makeChannel({ centroid: 999.6 })]);
    render(state, "TestDevice", 1, 1);

    expect(stdout).toContain("Centroid: 1000Hz");
  });

  it("formats a zero peak with a + sign", async () => {
    const render = await loadRender();
    const state = makeState([makeChannel({ peak: 0 })]);
    render(state, "TestDevice", 1, 1);

    expect(stdout).toContain("Peak: +0.0 dBFS");
  });

  it("renders multi-channel overview sorted by RMS descending", async () => {
    const render = await loadRender();
    const kick = makeChannel({ index: 0, name: "Kick", rms: -30 });
    const vox = makeChannel({ index: 1, name: "Vox", rms: -10 });
    const state = makeState([kick, vox]);
    render(state, "TestDevice", 1, 1);

    expect(stdout).toContain("CHANNEL OVERVIEW");
    expect(stdout).toContain("CH");
    expect(stdout).toContain("NAME");
    expect(stdout).toContain("RMS");
    expect(stdout).toContain("PEAK");
    expect(stdout).toContain("DOM BAND");
    expect(stdout).toContain("CLIP");
    expect(stdout.indexOf("Vox")).toBeLessThan(stdout.indexOf("Kick"));
    expect(stdout).toContain("01");
    expect(stdout).toContain("02");
  });

  it("renders clip cells per channel in multi-channel table", async () => {
    const render = await loadRender();
    const clipped = makeChannel({ index: 0, name: "Kick", rms: -10, clipping: true });
    const clean = makeChannel({ index: 1, name: "Vox", rms: -30, clipping: false });
    const state = makeState([clipped, clean]);
    render(state, "TestDevice", 1, 1);

    expect(stdout).toContain(`${BG_RED}YES${RESET}`);
    expect(stdout).toContain("NO");
  });

  it("renders dominant band and falls back on an empty bands map", async () => {
    const render = await loadRender();
    const chA = makeChannel({
      index: 0,
      name: "A",
      rms: -10,
      bands: { presence: -5, mid: -20 },
    });
    const chB = makeChannel({ index: 1, name: "B", rms: -20, bands: {} });
    const state = makeState([chA, chB]);

    expect(() => render(state, "TestDevice", 1, 1)).not.toThrow();
    expect(stdout).toContain("Presence");
    expect(stdout).toContain("Sub-bass");
  });

  it("renders masking alerts", async () => {
    const render = await loadRender();
    const chA = makeChannel({ index: 0, name: "Kick", rms: -10 });
    const chB = makeChannel({ index: 1, name: "Bass", rms: -20 });
    const state = makeState(
      [chA, chB],
      [{ band: "low_mid", channelA: "Kick", channelB: "Bass", diffDb: 2.34 }]
    );
    render(state, "TestDevice", 1, 1);

    expect(stdout).toContain("MASKING ALERTS");
    expect(stdout).toContain("⚠");
    expect(stdout).toContain("low_mid: Kick ↔ Bass (2.3 dB diff)");
  });

  it("shows no-masking message when masking is empty", async () => {
    const render = await loadRender();
    const chA = makeChannel({ index: 0, name: "Kick", rms: -10 });
    const chB = makeChannel({ index: 1, name: "Bass", rms: -20 });
    const state = makeState([chA, chB], []);
    render(state, "TestDevice", 1, 1);

    expect(stdout).toContain("No masking conflicts detected.");
  });

  it("shows the quit-hint footer", async () => {
    const render = await loadRender();
    const state = makeState([makeChannel()]);
    render(state, "TestDevice", 1, 1);

    expect(stdout).toContain("Press Q = quit");
    expect(stdout).not.toContain("Next LLM analysis in");
    expect(stdout).not.toContain("LLM analysis disabled");
  });

  it("writes clearLine+col1 prefixed ANSI plumbing on first render", async () => {
    const render = await loadRender();
    const state = makeState([makeChannel()]);
    render(state, "TestDevice", 1, 1);

    expect(stdout.startsWith(`${CLEAR_LINE}${COL1}`)).toBe(true);
    expect(stdout).toContain(BOLD);
    expect(stdout).toContain(RESET);
  });

  it("manages the cursor across successive renders in the same module instance", async () => {
    const emptyState: LiveState = { windows: [], currentWindow: null };

    // Derive the empty-state frame's own line count from a real render,
    // rather than hardcoding it, so this test tracks buildLines() if its
    // empty-state branch ever gains or loses a line.
    const probeRender = await loadRender();
    probeRender(emptyState, "TestDevice", 1, 1);
    const emptyLineCount = (stdout.match(/\n/g) ?? []).length;

    vi.resetModules();
    resetStdoutCapture();
    const render = await loadRender();
    const chA = makeChannel({ index: 0, name: "Kick", rms: -10 });
    const chB = makeChannel({ index: 1, name: "Bass", rms: -20 });
    const multiState = makeState(
      [chA, chB],
      [{ band: "low_mid", channelA: "Kick", channelB: "Bass", diffDb: 2.34 }]
    );

    render(multiState, "TestDevice", 1, 1);
    const firstStdout = stdout;
    expect(countCursorUps(firstStdout)).toBe(0);
    const lineCount = (firstStdout.match(/\n/g) ?? []).length;

    stdout = "";
    render(multiState, "TestDevice", 1, 1);
    expect(stdout.startsWith(`\x1b[${lineCount}A`)).toBe(true);

    stdout = "";
    render(emptyState, "TestDevice", 1, 1);
    expect(stdout.startsWith(`\x1b[${lineCount}A`)).toBe(true);
    expect(stdout).toContain(`\x1b[${lineCount - emptyLineCount}A`);
  });

  it("does not emit a second cursor-up when the frame grows", async () => {
    const render = await loadRender();
    const emptyState: LiveState = { windows: [], currentWindow: null };
    render(emptyState, "TestDevice", 1, 1);

    stdout = "";
    const state = makeState([makeChannel()]);
    render(state, "TestDevice", 1, 1);

    expect(stdout.startsWith("\x1b[3A")).toBe(true);
    expect(countCursorUps(stdout)).toBe(1);
  });
});
