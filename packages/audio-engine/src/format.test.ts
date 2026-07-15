import { describe, it, expect } from "vitest";
import { fmt } from "./format.js";

describe("fmt", () => {
  it("formats a normal number to 2 decimals by default", () => {
    expect(fmt(-12.345)).toBe("-12.35");
    expect(fmt(0)).toBe("0.00");
  });

  it("honors the decimals arg", () => {
    expect(fmt(-12.345, 1)).toBe("-12.3");
    expect(fmt(5, 0)).toBe("5");
  });

  it("formats non-finite values as -inf", () => {
    expect(fmt(-Infinity)).toBe("-inf");
    expect(fmt(Infinity)).toBe("-inf");
    expect(fmt(NaN)).toBe("-inf");
  });
});
