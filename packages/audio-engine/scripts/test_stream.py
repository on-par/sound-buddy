#!/usr/bin/env python3
"""
Unit tests for stream.py's pure analysis/parsing helpers.

Run: python3 packages/audio-engine/scripts/test_stream.py
Requires numpy + scipy. `sounddevice` is stubbed so the tests run on hosts
without PortAudio (e.g. CI), since stream.py imports it at module load.
"""

import os
import sys
import types
import unittest
import importlib.util

# Stub sounddevice before importing stream.py — the live-capture backend isn't
# needed (and PortAudio may be absent) for the pure helpers under test.
if "sounddevice" not in sys.modules:
    sys.modules["sounddevice"] = types.ModuleType("sounddevice")

import numpy as np

_spec = importlib.util.spec_from_file_location(
    "stream", os.path.join(os.path.dirname(__file__), "stream.py")
)
stream = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(stream)


class ParseChannelGroups(unittest.TestCase):
    def test_default_is_first_two_mono(self):
        self.assertEqual(
            stream.parse_channel_groups("", 8),
            [
                {"kind": "mono", "indices": [0], "name": "CH01"},
                {"kind": "mono", "indices": [1], "name": "CH02"},
            ],
        )

    def test_default_respects_channel_count(self):
        groups = stream.parse_channel_groups("", 1)
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]["indices"], [0])

    def test_mono_and_stereo_mix(self):
        groups = stream.parse_channel_groups("0,1-2,4", 6)
        self.assertEqual([g["kind"] for g in groups], ["mono", "stereo", "mono"])
        self.assertEqual(groups[1]["indices"], [1, 2])
        self.assertEqual(groups[1]["name"], "CH02+CH03")

    def test_out_of_range_raises(self):
        with self.assertRaises(ValueError):
            stream.parse_channel_groups("0,9", 4)

    def test_malformed_stereo_raises(self):
        with self.assertRaises(ValueError):
            stream.parse_channel_groups("1-2-3", 8)


class AnalyzeGroups(unittest.TestCase):
    def setUp(self):
        self.sr = 48000
        t = np.arange(int(0.2 * self.sr)) / self.sr
        self.tone = (0.5 * np.sin(2 * np.pi * 1000 * t)).astype(np.float32)

    def test_mono_levels(self):
        frames = np.stack([self.tone, np.zeros_like(self.tone)], axis=1)
        out = stream.analyze_groups(frames, self.sr, stream.parse_channel_groups("0", 2))
        self.assertEqual(len(out), 1)
        # 0.5 amplitude sine ⇒ peak ≈ -6 dBFS, rms ≈ -9 dBFS.
        self.assertAlmostEqual(out[0]["peak"], -6.0, delta=0.5)
        self.assertAlmostEqual(out[0]["rms"], -9.0, delta=0.5)
        self.assertFalse(out[0]["clipping"])

    def test_stereo_is_lr_mean(self):
        # Identical L/R ⇒ mean equals the channel; a silent R halves the mean.
        loud = np.stack([self.tone, self.tone], axis=1)
        half = np.stack([self.tone, np.zeros_like(self.tone)], axis=1)
        pair = stream.parse_channel_groups("0-1", 2)
        rms_loud = stream.analyze_groups(loud, self.sr, pair)[0]["rms"]
        rms_half = stream.analyze_groups(half, self.sr, pair)[0]["rms"]
        # Halving amplitude ⇒ ~6 dB drop.
        self.assertAlmostEqual(rms_loud - rms_half, 6.0, delta=1.0)

    def test_clipping_flagged(self):
        full = np.ones(int(0.2 * self.sr), dtype=np.float32)
        frames = np.stack([full, full], axis=1)
        out = stream.analyze_groups(frames, self.sr, stream.parse_channel_groups("0", 2))
        self.assertTrue(out[0]["clipping"])

    def test_stereo_single_leg_clipping_flagged(self):
        # Left leg clips, right leg is quiet: the L+R mean would hide it, but
        # peak/clip is taken from the hottest individual channel.
        full = np.ones(int(0.2 * self.sr), dtype=np.float32)
        frames = np.stack([full, self.tone * 0.01], axis=1)
        out = stream.analyze_groups(frames, self.sr, stream.parse_channel_groups("0-1", 2))
        self.assertTrue(out[0]["clipping"])
        self.assertAlmostEqual(out[0]["peak"], 0.0, delta=0.2)

    def test_short_window_does_not_crash(self):
        frames = np.zeros((16, 2), dtype=np.float32)
        out = stream.analyze_groups(frames, self.sr, stream.parse_channel_groups("0", 2))
        self.assertEqual(len(out), 1)


class Masking(unittest.TestCase):
    def test_similar_channels_flagged(self):
        sr = 48000
        t = np.arange(int(0.3 * sr)) / sr
        tone = (0.5 * np.sin(2 * np.pi * 300 * t)).astype(np.float32)
        frames = np.stack([tone, tone], axis=1)
        out = stream.analyze_groups(frames, sr, stream.parse_channel_groups("0,1", 2))
        masking = stream.compute_masking(out)
        # Two identical tones sit within the masking threshold in shared bands.
        self.assertTrue(any(m["band"] == "low_mid" for m in masking))


if __name__ == "__main__":
    unittest.main()
