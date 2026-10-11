#!/usr/bin/env node
// Generates the golden band-target fixture that keeps iOS's
// IdealCurve.bandTargets (SoundBuddyKit) in step with the Mac's
// bandTargetsFromProfile (packages/audio-engine/src/profiles/index.ts) (#1724).
//
// Run from the repo root after changing a built-in curve or the reduction:
//   npx tsx apps/ios/scripts/make_band_targets_fixture.mjs
//
// The fixture is read by SoundBuddyKitTests/IdealCurveBandTargetsTests.swift
// (Swift must match within 0.01 dB) and re-derived by
// packages/audio-engine/src/profiles/band-targets-fixture.test.ts, so a change
// to the TS reduction or curve data that skips this script fails CI.
//
// JSON has no NaN, so a non-finite offset in an edge case is written as null.

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bandTargetsFromProfile, getProfile } from "../../../packages/audio-engine/src/profiles/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_PATH = resolve(
  here,
  "../SoundBuddyKit/Tests/SoundBuddyKitTests/Fixtures/band-targets.v1.json",
);

/** The curves bundled in SoundBuddyKit (IdealCurveLibrary.builtInIds). */
export const BUILT_IN_IDS = ["flat", "music-fullrange", "worship-service", "speech-podcast", "worship-room"];

/** Edge cases the Swift port must treat exactly as the TS reduction does. */
export const EDGE_CASES = [
  {
    name: "sparse-grid",
    note: "few points: bands between and beyond them are interpolated and clamped",
    freqs: [30, 50, 100, 1000],
    dbOffsets: [2, 4, -3, 1],
  },
  {
    name: "length-mismatch",
    note: "freqs and dbOffsets differ in length: treated as flat",
    freqs: [100, 1000],
    dbOffsets: [3],
  },
  {
    name: "empty",
    note: "no points: treated as flat",
    freqs: [],
    dbOffsets: [],
  },
  {
    name: "non-finite-gap",
    note: "a non-finite offset is skipped: neighbours stand in for it",
    freqs: [20, 100, 1000, 5000, 20000],
    dbOffsets: [6, null, -2, 4, null],
  },
  {
    name: "all-non-finite",
    note: "nothing finite to sample: every band falls back to 0",
    freqs: [20, 20000],
    dbOffsets: [null, null],
  },
  {
    name: "degenerate-grid",
    note: "duplicate frequencies hold the lower value instead of producing NaN",
    freqs: [0, 100, 100, 20000],
    dbOffsets: [3, 3, 9, 9],
  },
];

const toNumbers = (xs) => xs.map((x) => (x === null ? Number.NaN : x));
const round = (x) => Math.round(x * 1e6) / 1e6;
const roundTargets = (t) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, round(v)]));

export function buildFixture() {
  return {
    schemaVersion: 1,
    source: "packages/audio-engine/src/profiles/index.ts bandTargetsFromProfile",
    toleranceDb: 0.01,
    builtIn: BUILT_IN_IDS.map((id) => {
      const profile = getProfile(id);
      if (!profile) throw new Error(`unknown built-in profile ${id}`);
      return { id, targets: roundTargets(bandTargetsFromProfile(profile)) };
    }),
    edgeCases: EDGE_CASES.map(({ name, note, freqs, dbOffsets }) => ({
      name,
      note,
      freqs,
      dbOffsets,
      targets: roundTargets(bandTargetsFromProfile({ freqs, dbOffsets: toNumbers(dbOffsets) })),
    })),
  };
}

export { toNumbers };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeFileSync(FIXTURE_PATH, JSON.stringify(buildFixture(), null, 2) + "\n");
  console.log(`wrote ${FIXTURE_PATH}`);
}
