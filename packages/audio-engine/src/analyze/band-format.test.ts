import { describe, it, expect } from "vitest";
import { formatBandRange } from "./band-format.js";

describe("formatBandRange", () => {
  it("formats whole-kHz edges with a single kHz suffix", () => {
    expect(formatBandRange(2000, 4000)).toBe("2–4 kHz");
  });

  it("formats whole-Hz edges with a single Hz suffix", () => {
    expect(formatBandRange(60, 250)).toBe("60–250 Hz");
  });

  it("formats fractional-kHz edges with one decimal and no trailing .0", () => {
    expect(formatBandRange(2500, 3500)).toBe("2.5–3.5 kHz");
  });

  it("carries a suffix per edge when the edges span unit classes", () => {
    expect(formatBandRange(500, 2000)).toBe("500 Hz–2 kHz");
  });
});