import { describe, it, expect } from "vitest";
import { parseEbur128Summary } from "./ebur128.js";

const TONE_SUMMARY = `[Parsed_ebur128_0 @ 0x1] t: 0.999977   TARGET:-23 LUFS    M:  -9.0 S:-120.7     I:  -9.0 LUFS       LRA:   0.0 LU  FTPK:  -6.0 dBFS  TPK:  -6.0 dBFS
[Parsed_ebur128_0 @ 0x1] Summary:

  Integrated loudness:
    I:          -9.0 LUFS
    Threshold: -19.0 LUFS

  Loudness range:
    LRA:         0.0 LU
    Threshold:   0.0 LUFS
    LRA low:     0.0 LUFS
    LRA high:    0.0 LUFS

  True peak:
    Peak:       -6.0 dBFS
`;

describe("parseEbur128Summary", () => {
  it("parses the captured summary block", () => {
    const stats = parseEbur128Summary(TONE_SUMMARY);
    expect(stats.integratedLufs).toBeCloseTo(-9.0, 5);
    expect(stats.loudnessRange).toBeCloseTo(0.0, 5);
    expect(stats.truePeakDbtp).toBeCloseTo(-6.0, 5);
  });

  it("parses a realistic summary with negative LRA-adjacent, multi-digit values", () => {
    const output = `[Parsed_ebur128_0 @ 0x1] Summary:

  Integrated loudness:
    I:         -23.0 LUFS
    Threshold: -33.2 LUFS

  Loudness range:
    LRA:        10.5 LU
    Threshold:  -43.1 LUFS
    LRA low:    -33.0 LUFS
    LRA high:   -22.5 LUFS

  True peak:
    Peak:       -3.5 dBFS
`;
    const stats = parseEbur128Summary(output);
    expect(stats.integratedLufs).toBeCloseTo(-23.0, 5);
    expect(stats.loudnessRange).toBeCloseTo(10.5, 5);
    expect(stats.truePeakDbtp).toBeCloseTo(-3.5, 5);
  });

  it("ignores per-frame I:/LRA: lines and uses only the summary block", () => {
    // TONE_SUMMARY already includes a per-frame line ahead of Summary: with
    // matching values; this fixture makes the per-frame values differ so a
    // parser that (incorrectly) matched the whole output would fail.
    const output = `[Parsed_ebur128_0 @ 0x1] t: 0.1 TARGET:-23 LUFS M: -30.0 S:-120.7 I: -30.0 LUFS LRA: 99.0 LU FTPK: -40.0 dBFS TPK: -40.0 dBFS
[Parsed_ebur128_0 @ 0x1] t: 0.9 TARGET:-23 LUFS M:  -9.0 S:-120.7 I:  -9.0 LUFS LRA:  0.0 LU FTPK:  -6.0 dBFS TPK:  -6.0 dBFS
[Parsed_ebur128_0 @ 0x1] Summary:

  Integrated loudness:
    I:          -9.0 LUFS
    Threshold: -19.0 LUFS

  Loudness range:
    LRA:         0.0 LU
    Threshold:   0.0 LUFS
    LRA low:     0.0 LUFS
    LRA high:    0.0 LUFS

  True peak:
    Peak:       -6.0 dBFS
`;
    const stats = parseEbur128Summary(output);
    expect(stats.integratedLufs).toBeCloseTo(-9.0, 5);
    expect(stats.loudnessRange).toBeCloseTo(0.0, 5);
    expect(stats.truePeakDbtp).toBeCloseTo(-6.0, 5);
  });

  it("throws an actionable error when Summary: is missing", () => {
    expect(() => parseEbur128Summary("no summary here at all")).toThrow(
      /ffmpeg ebur128.*could not parse/i,
    );
  });

  it("throws when the summary reports a non-finite integrated loudness (nan)", () => {
    const output = `Summary:

  Integrated loudness:
    I:          nan LUFS
    Threshold: -19.0 LUFS

  Loudness range:
    LRA:         0.0 LU

  True peak:
    Peak:       -6.0 dBFS
`;
    expect(() => parseEbur128Summary(output)).toThrow(/ffmpeg ebur128.*could not parse/i);
  });

  it("throws on empty input", () => {
    expect(() => parseEbur128Summary("")).toThrow(/ffmpeg ebur128.*could not parse/i);
  });
});
