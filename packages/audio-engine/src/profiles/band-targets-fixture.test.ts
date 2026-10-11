// Drift guard for the iOS band-target golden fixture (#1724). iOS ports
// bandTargetsFromProfile to Swift (IdealCurve.bandTargets) and checks itself
// against apps/ios/.../Fixtures/band-targets.v1.json. The Swift suite runs on
// a Mac, so this re-derives every fixture value from the TS source of truth on
// every CI run: changing a built-in curve or the reduction without
// regenerating the fixture (npx tsx apps/ios/scripts/make_band_targets_fixture.mjs)
// fails here.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BAND_METADATA } from "../bands.js";
import { bandTargetsFromProfile, getProfile } from "./index.js";

interface FixtureCase {
  targets: Record<string, number>;
}
interface Fixture {
  schemaVersion: number;
  builtIn: Array<FixtureCase & { id: string }>;
  edgeCases: Array<FixtureCase & { name: string; freqs: number[]; dbOffsets: Array<number | null> }>;
}

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(
  here,
  "../../../../apps/ios/SoundBuddyKit/Tests/SoundBuddyKitTests/Fixtures/band-targets.v1.json",
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;

function expectTargets(actual: Record<string, number>, expected: Record<string, number>) {
  expect(Object.keys(expected).sort()).toEqual(BAND_METADATA.map((b) => b.key).sort());
  for (const band of BAND_METADATA) {
    expect(actual[band.key], band.key).toBeCloseTo(expected[band.key], 5);
  }
}

describe("iOS band-target fixture (#1724)", () => {
  it("covers the five curves SoundBuddyKit bundles", () => {
    expect(fixture.schemaVersion).toBe(1);
    expect(fixture.builtIn.map((c) => c.id)).toEqual([
      "flat",
      "music-fullrange",
      "worship-service",
      "speech-podcast",
      "worship-room",
    ]);
  });

  it.each(fixture.builtIn.map((c) => [c.id, c] as const))("%s matches bandTargetsFromProfile", (id, c) => {
    const profile = getProfile(id);
    expect(profile).toBeDefined();
    expectTargets(bandTargetsFromProfile(profile), c.targets);
  });

  it.each(fixture.edgeCases.map((c) => [c.name, c] as const))("edge case %s matches bandTargetsFromProfile", (_name, c) => {
    const dbOffsets = c.dbOffsets.map((x) => (x === null ? Number.NaN : x));
    expectTargets(bandTargetsFromProfile({ freqs: c.freqs, dbOffsets }), c.targets);
  });
});
