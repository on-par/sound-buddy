"""Tests for make_rta_display_fixture.py (#1707).

Run: python3 -m pytest apps/ios/scripts/test_make_rta_display_fixture.py
(or python3 apps/ios/scripts/test_make_rta_display_fixture.py). Stdlib only.
"""

from __future__ import annotations

import json
import math
import unittest

import make_rta_display_fixture as mk


def case(name: str) -> dict:
    return next(c for c in mk.build_fixture()["cases"] if c["name"] == name)


class MakeRtaDisplayFixtureTest(unittest.TestCase):
    def test_checked_in_canonical_fixture_matches_a_fresh_build(self) -> None:
        # Drift guard: regenerate with python3 apps/ios/scripts/make_rta_display_fixture.py.
        self.assertEqual(mk.CANONICAL_PATH.read_text(), mk.render())

    def test_swift_copy_is_byte_identical_to_the_canonical_fixture(self) -> None:
        self.assertEqual(mk.SWIFT_COPY_PATH.read_bytes(), mk.CANONICAL_PATH.read_bytes())

    def test_render_is_valid_json_equal_to_the_build(self) -> None:
        self.assertEqual(json.loads(mk.render()), mk.build_fixture())

    def test_spec_constants(self) -> None:
        constants = mk.build_fixture()["constants"]
        self.assertEqual(constants["ballistics"]["medium"], {"attackTauS": 0.05, "releaseTauS": 0.4})
        self.assertEqual(constants["ballistics"]["slow"], {"attackTauS": 0.25, "releaseTauS": 1.5})
        self.assertEqual(constants["peakHoldS"], 1.5)
        self.assertEqual(constants["peakReleaseDbPerS"], 20.0)
        self.assertEqual((constants["relativeRangeDb"], constants["relativeTickDb"]), (15.0, 5.0))
        self.assertEqual(
            (constants["absoluteFloorDb"], constants["absoluteCeilingDb"], constants["absoluteTickDb"]),
            (-96.0, 0.0, 12.0),
        )
        self.assertEqual(constants["neutralDeviationDb"], 3.0)

    def test_every_expected_entry_lines_up_with_its_frame(self) -> None:
        for c in mk.build_fixture()["cases"]:
            self.assertEqual(len(c["frames"]), len(c["expected"]), c["name"])
            width = len(c["frames"][0]["levelsDb"])
            for entry in c["expected"]:
                for key in ("levelsDb", "absoluteFractions", "peaksDb", "relativeDb",
                            "relativeClampedDb", "overflow", "tone", "relativePeaksDb"):
                    self.assertEqual(len(entry[key]), width, (c["name"], key))

    def test_ac2_a_band_held_six_db_over_target_for_one_second_reads_plus_six_in_amber(self) -> None:
        held = case("medium-rise-to-plus-six-then-drop-twenty")["expected"][20]  # 1 s after the rise
        self.assertAlmostEqual(held["relativeDb"][0], 6.0, delta=0.1)
        self.assertEqual(held["tone"][0], "over")

    def test_ac2_release_decays_63_percent_of_the_power_step_in_tau_not_16_db_linear(self) -> None:
        expected = case("medium-rise-to-plus-six-then-drop-twenty")["expected"]
        after = expected[20 + 8]["levelsDb"][0]  # 8 frames x 0.05 s = 0.4 s = release tau
        p_old, p_new = mk.db_to_power(-32.0), mk.db_to_power(-52.0)
        remaining = (mk.db_to_power(after) - p_new) / (p_old - p_new)
        self.assertAlmostEqual(remaining, math.exp(-1), delta=0.002)
        self.assertGreater(after, -32.0 - 16.0 + 5, "not the old linear 40 dB/s release")

    def test_ac3_a_spike_peak_holds_one_and_a_half_seconds_then_falls_twenty_db_per_second(self) -> None:
        c = case("peak-hold-after-one-frame-spike")
        times, t = [], 0.0
        for frame in c["frames"]:
            t += frame["dt"]
            times.append(t)
        spike_index = 1
        peak = c["expected"][spike_index]["peaksDb"][0]
        for i, entry in enumerate(c["expected"]):
            since = times[i] - times[spike_index]
            if 0 <= since <= mk.PEAK_HOLD_S:
                self.assertAlmostEqual(entry["peaksDb"][0], peak, delta=mk.TOLERANCE_DB)
            elif since > mk.PEAK_HOLD_S:
                fallen = peak - mk.PEAK_RELEASE_DB_PER_S * (since - mk.PEAK_HOLD_S)
                self.assertAlmostEqual(entry["peaksDb"][0], max(fallen, entry["levelsDb"][0]), delta=mk.TOLERANCE_DB)

    def test_clamp_flags_overflow_both_ways(self) -> None:
        last = case("shaped-target-clamp-and-overflow")["expected"][-1]
        self.assertEqual(last["overflow"][0], "above")
        self.assertEqual(last["relativeClampedDb"][0], 15.0)
        self.assertEqual(last["overflow"][-1], "below")
        self.assertEqual(last["relativeClampedDb"][-1], -15.0)
        self.assertEqual(last["absoluteFractions"][-1], 0.0)

    def test_no_target_is_relative_to_the_measured_mean(self) -> None:
        for entry in case("no-target-relative-to-measured-mean")["expected"]:
            self.assertAlmostEqual(sum(entry["relativeDb"]), 0.0, delta=1e-4)


if __name__ == "__main__":
    unittest.main()
