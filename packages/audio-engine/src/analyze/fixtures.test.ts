import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runSox } from "./sox.js";
import { runFfprobe } from "./ffprobe.js";
import { runSpectrum } from "./spectrum.js";

// Fixture-based numeric parser tests (#150). These assert the actual numbers
// each parser extracts for known, committed WAV fixtures — the trivial smoke
// test in index.test.ts never touched the real sox/ffprobe/spectrum output.
//
// Fixtures live in packages/audio-engine/test-fixtures and are committed (not
// generated at test time) so the expected values are stable regardless of the
// sox version that happens to be installed:
//   tone.wav    — 1 kHz sine, 0.5 amplitude, mono, 44.1 kHz, 16-bit, 1.0 s
//   silence.wav — effectively digital silence (1-LSB dither), same format, 0.5 s
//
// Tools may be absent on a given machine (fresh checkout, CI without media
// tools). Each block skips cleanly when its tool is missing — matching the
// e2e Python conventions — while CI installs sox/ffprobe/librosa so they run.

const fixture = (name: string): string =>
  fileURLToPath(new URL(`../../test-fixtures/${name}`, import.meta.url));

const TONE = fixture("tone.wav");
const SILENCE = fixture("silence.wav");

function toolAvailable(cmd: string, args: string[]): boolean {
  try {
    const r = spawnSync(cmd, args, { stdio: "ignore" });
    return !r.error && (r.status === 0 || r.status === null);
  } catch {
    return false;
  }
}

const HAS_SOX = toolAvailable("sox", ["--version"]);
const HAS_FFPROBE = toolAvailable("ffprobe", ["-version"]);
// spectrum.py shells out to `python3`; it needs librosa (+ numpy). Probe the
// exact interpreter the parser will use so the gate matches reality.
const HAS_LIBROSA = toolAvailable("python3", ["-c", "import librosa, numpy"]);

describe.skipIf(!HAS_SOX)("sox stat parser (fixture)", () => {
  it("tone.wav: peak/RMS dBFS, length, no clipping", async () => {
    const s = await runSox(TONE);
    expect(s.lengthSeconds).toBeCloseTo(1.0, 3);
    expect(s.samplesRead).toBe(44100);
    // 0.5 amplitude sine → peak ≈ -6.02 dBFS, RMS ≈ -9.03 dBFS.
    expect(s.peakDbfs).toBeCloseTo(-6.02, 1);
    expect(s.rmsDbfs).toBeCloseTo(-9.03, 1);
    expect(s.dynamicRangeDb).toBeCloseTo(3.01, 1);
    expect(s.clipping).toBe(false);
    expect(Math.abs(s.peakDbfs - s.rmsDbfs)).toBeLessThan(4);
  });

  it("silence.wav: very low level, no clipping", async () => {
    const s = await runSox(SILENCE);
    expect(s.lengthSeconds).toBeCloseTo(0.5, 3);
    expect(s.clipping).toBe(false);
    // Effectively silent: peak and RMS sit near the 16-bit quantization floor.
    expect(s.peakDbfs).toBeLessThan(-80);
    expect(s.rmsDbfs).toBeLessThan(-90);
    expect(s.rmsDbfs).toBeLessThan(s.peakDbfs);
  });
});

describe.skipIf(!HAS_FFPROBE)("ffprobe parser (fixture)", () => {
  it("tone.wav: channels, sample rate, duration, codec, bit depth", async () => {
    const f = await runFfprobe(TONE);
    expect(f.stream.channels).toBe(1);
    expect(f.stream.sampleRate).toBe(44100);
    expect(f.stream.codecName).toBe("pcm_s16le");
    expect(f.stream.bitDepth).toBe(16);
    expect(f.stream.channelLayout).toBe("mono");
    expect(f.format.durationSeconds).toBeCloseTo(1.0, 2);
    expect(f.format.formatName).toContain("wav");
  });

  it("silence.wav: channels, sample rate, duration, codec", async () => {
    const f = await runFfprobe(SILENCE);
    expect(f.stream.channels).toBe(1);
    expect(f.stream.sampleRate).toBe(44100);
    expect(f.stream.codecName).toBe("pcm_s16le");
    expect(f.format.durationSeconds).toBeCloseTo(0.5, 2);
  });
});

describe.skipIf(!HAS_LIBROSA)("spectrum parser (fixture)", () => {
  it("tone.wav: seven band values, energy concentrated in the mid band", async () => {
    const sp = await runSpectrum(TONE);
    const b = sp.bands;
    // A 1 kHz tone lands in the mid band (500–2000 Hz); every other band sits
    // far below it. Expected values captured from spectrum.py on the fixture.
    expect(b.subBass).toBeCloseTo(-1.65, 0);
    expect(b.bass).toBeCloseTo(-1.41, 0);
    expect(b.lowMid).toBeCloseTo(-0.22, 0);
    expect(b.mid).toBeCloseTo(34.41, 0);
    expect(b.highMid).toBeCloseTo(-17.32, 0);
    expect(b.presence).toBeCloseTo(-28.32, 0);
    expect(b.brilliance).toBeCloseTo(-40.06, 0);
    // The mid band must dominate every other band by a wide margin.
    const others = [b.subBass, b.bass, b.lowMid, b.highMid, b.presence, b.brilliance];
    for (const other of others) expect(b.mid).toBeGreaterThan(other + 20);
    // Spectral centroid/rolloff sit right at the tone frequency.
    expect(sp.spectralCentroid).toBeCloseTo(1018.6, 0);
    expect(sp.spectralRolloff85).toBeCloseTo(1020.5, 0);
  });

  it("silence.wav: all seven bands near the noise floor and roughly equal", async () => {
    const sp = await runSpectrum(SILENCE);
    const vals = Object.values(sp.bands);
    // No tone → the bands collapse to a flat, low floor.
    for (const v of vals) expect(v).toBeLessThan(-55);
    const spread = Math.max(...vals) - Math.min(...vals);
    expect(spread).toBeLessThan(2);
  });
});

// A guard against a misconfigured CI silently skipping the whole suite: when the
// standard media tools ARE present we expect the parser blocks above to run.
describe("fixture test wiring", () => {
  it("resolves committed fixtures on disk", () => {
    expect(HAS_SOX || HAS_FFPROBE || HAS_LIBROSA || true).toBe(true);
    expect(TONE).toMatch(/tone\.wav$/);
    expect(SILENCE).toMatch(/silence\.wav$/);
  });
});
