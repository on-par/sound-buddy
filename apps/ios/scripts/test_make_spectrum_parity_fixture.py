"""Tests for make_spectrum_parity_fixture.py — run: python apps/ios/scripts/test_make_spectrum_parity_fixture.py

Needs numpy + soundfile (spectrum.py refuses to import without soundfile).
"""

from __future__ import annotations

import json
import unittest

import make_spectrum_parity_fixture as mk

EXPECTED_BAND_KEYS = ["subBass", "bass", "lowMid", "mid", "highMid", "presence", "brilliance"]


class MakeSpectrumParityFixtureTest(unittest.TestCase):
    def test_checked_in_fixture_matches_a_fresh_build(self) -> None:
        # Drift guard: if spectrum.py's band reduction changes, regenerate the
        # fixture (python apps/ios/scripts/make_spectrum_parity_fixture.py) so
        # the Swift parity test compares against current Mac numbers.
        checked_in = json.loads(mk.FIXTURE_PATH.read_text())
        self.assertEqual(checked_in, mk.build_fixture())

    def test_band_keys_are_the_contract_camel_case_keys_in_order(self) -> None:
        self.assertEqual(list(mk.build_fixture()["expectedBandDb"].keys()), EXPECTED_BAND_KEYS)

    def test_camel_case_conversion(self) -> None:
        self.assertEqual(mk.camel_case("sub_bass"), "subBass")
        self.assertEqual(mk.camel_case("high_mid"), "highMid")
        self.assertEqual(mk.camel_case("mid"), "mid")

    def test_tones_land_in_their_bands(self) -> None:
        # The two tones sit in Bass (100 Hz) and Mid (1 kHz), so those must be
        # the two loudest bands. (Bass outranks Mid despite the quieter tone:
        # compute_band_energy averages power per bin and Bass spans fewer bins.)
        bands = mk.build_fixture()["expectedBandDb"]
        self.assertEqual(sorted(bands, key=bands.get, reverse=True)[:2], ["bass", "mid"])

    def test_synth_length_and_peak(self) -> None:
        signal = mk.synth(mk.SIGNAL)
        self.assertEqual(len(signal), mk.SIGNAL["fftSize"])
        peak_bound = sum(t["amplitude"] for t in mk.SIGNAL["tones"])
        self.assertLessEqual(float(abs(signal).max()), peak_bound)


if __name__ == "__main__":
    unittest.main()
