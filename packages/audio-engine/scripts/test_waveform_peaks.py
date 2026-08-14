#!/usr/bin/env python3
"""
Unit + integration tests for waveform_peaks.py (#734).

Run: python3 packages/audio-engine/scripts/test_waveform_peaks.py

The pure helpers (load_manifest, bucket_size_for, peaks_for_channel,
quantize_peak, encode_track_peaks) are plain Python with no numpy/soundfile
dependency, so they run on any python3. The decode integration cases
(read_track_peaks/generate_peaks over real WAV files) need numpy + soundfile
and are gated on HAVE_SOUNDFILE, mirroring test_playback.py. waveform_peaks.py
imports numpy/soundfile lazily (inside functions), so this module can load it
even when neither is installed.
"""

import os
import sys
import json
import base64
import shutil
import tempfile
import unittest
import importlib.util

try:
    import numpy as np
    import soundfile as sf
    HAVE_SOUNDFILE = True
except ImportError:
    HAVE_SOUNDFILE = False

_HERE = os.path.dirname(__file__)
_spec = importlib.util.spec_from_file_location(
    "waveform_peaks", os.path.join(_HERE, "waveform_peaks.py")
)
waveform_peaks = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(waveform_peaks)

# Explicit epsilon for the quantize round-trip bound — no bare float equality,
# per the repo's code-quality standard (mirrors the #519 spike's
# ROUND_TRIP_EPSILON).
ROUND_TRIP_EPSILON = 1e-3


def _write_manifest(session_dir, obj):
    with open(os.path.join(session_dir, "session.json"), "w") as f:
        json.dump(obj, f)


class LoadManifest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_reads_valid_mono_stereo_manifest(self):
        _write_manifest(self.dir, {
            "name": "set", "createdAt": "2026-07-04T00:00:00.000Z", "sampleRate": 48000,
            "tracks": [
                {"id": "t1", "label": "Kick", "kind": "mono", "sourceChannels": [0],
                 "file": "01-kick.wav"},
                {"id": "t2", "label": "OH", "kind": "stereo", "sourceChannels": [4, 5],
                 "file": "05-oh.wav"},
            ],
        })
        m = waveform_peaks.load_manifest(self.dir)
        self.assertEqual(m["sampleRate"], 48000)
        self.assertEqual([t["kind"] for t in m["tracks"]], ["mono", "stereo"])
        self.assertEqual([t["label"] for t in m["tracks"]], ["Kick", "OH"])
        self.assertEqual(m["tracks"][1]["file"], "05-oh.wav")

    def test_missing_manifest_raises(self):
        with self.assertRaises(ValueError):
            waveform_peaks.load_manifest(self.dir)

    def test_missing_sample_rate_raises(self):
        _write_manifest(self.dir, {"tracks": [{"label": "K", "kind": "mono", "file": "k.wav"}]})
        with self.assertRaises(ValueError):
            waveform_peaks.load_manifest(self.dir)

    def test_empty_tracks_raises(self):
        _write_manifest(self.dir, {"sampleRate": 48000, "tracks": []})
        with self.assertRaises(ValueError):
            waveform_peaks.load_manifest(self.dir)

    def test_track_missing_label_raises(self):
        _write_manifest(self.dir, {"sampleRate": 48000,
                                   "tracks": [{"kind": "mono", "file": "k.wav"}]})
        with self.assertRaises(ValueError):
            waveform_peaks.load_manifest(self.dir)

    def test_track_missing_kind_raises(self):
        _write_manifest(self.dir, {"sampleRate": 48000,
                                   "tracks": [{"label": "K", "file": "k.wav"}]})
        with self.assertRaises(ValueError):
            waveform_peaks.load_manifest(self.dir)

    def test_track_missing_file_raises(self):
        _write_manifest(self.dir, {"sampleRate": 48000,
                                   "tracks": [{"label": "K", "kind": "mono"}]})
        with self.assertRaises(ValueError):
            waveform_peaks.load_manifest(self.dir)

    def test_unknown_kind_raises(self):
        _write_manifest(self.dir, {"sampleRate": 48000,
                                   "tracks": [{"label": "K", "kind": "quad", "file": "k.wav"}]})
        with self.assertRaises(ValueError):
            waveform_peaks.load_manifest(self.dir)


class BucketSizeFor(unittest.TestCase):
    def test_known_rate_maps_to_expected_size(self):
        # 48 kHz / 50 buckets-per-sec = 960 samples per bucket.
        self.assertEqual(waveform_peaks.bucket_size_for(48000, 50), 960)

    def test_rounds_fractional_sizes(self):
        self.assertEqual(waveform_peaks.bucket_size_for(44100, 50), round(44100 / 50))

    def test_never_returns_zero(self):
        # A degenerate (near-zero) sample rate still yields at least one sample
        # per bucket so bucket alignment never divides by zero.
        self.assertEqual(waveform_peaks.bucket_size_for(1, 10000), 1)


class PeaksForChannel(unittest.TestCase):
    def test_exact_min_max_pairs(self):
        samples = [0.1, -0.2, 0.3, -0.4, 0.5, -0.6, 0.7, -0.8]
        self.assertEqual(
            waveform_peaks.peaks_for_channel(samples, 2),
            [
                (-0.2, 0.1),
                (-0.4, 0.3),
                (-0.6, 0.5),
                (-0.8, 0.7),
            ],
        )

    def test_remainder_absorbed_into_last_bucket(self):
        samples = [1.0, 2.0, 3.0, 4.0, 5.0]
        self.assertEqual(
            waveform_peaks.peaks_for_channel(samples, 2),
            [(1.0, 2.0), (3.0, 4.0), (5.0, 5.0)],
        )

    def test_single_partial_bucket(self):
        self.assertEqual(waveform_peaks.peaks_for_channel([0.25], 8), [(0.25, 0.25)])

    def test_empty_input_returns_empty_list(self):
        self.assertEqual(waveform_peaks.peaks_for_channel([], 2), [])

    def test_zero_bucket_size_returns_empty_list(self):
        self.assertEqual(waveform_peaks.peaks_for_channel([1.0, 2.0], 0), [])

    def test_global_alignment_from_sample_zero(self):
        # Bucket boundaries are fixed multiples of bucket_size from sample 0 —
        # index 3 starts the second bucket regardless of any earlier flush.
        samples = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0]
        self.assertEqual(
            waveform_peaks.peaks_for_channel(samples, 3),
            [(1.0, 3.0), (4.0, 6.0), (7.0, 7.0)],
        )


class QuantizePeak(unittest.TestCase):
    def test_minus_one_maps_to_zero(self):
        self.assertEqual(waveform_peaks.quantize_peak(-1.0), 0)

    def test_zero_maps_to_128(self):
        self.assertEqual(waveform_peaks.quantize_peak(0.0), 128)

    def test_plus_one_maps_to_255(self):
        self.assertEqual(waveform_peaks.quantize_peak(1.0), 255)

    def test_clamps_above_one(self):
        self.assertEqual(waveform_peaks.quantize_peak(1.5), 255)

    def test_clamps_below_minus_one(self):
        self.assertEqual(waveform_peaks.quantize_peak(-1.5), 0)

    def test_quantize_round_trip_bounded(self):
        for value in (-1.0, -0.73, -0.25, 0.0, 0.1, 0.5, 0.999, 1.0):
            level = waveform_peaks.quantize_peak(value)
            back = (level / (waveform_peaks.QUANT_LEVELS - 1)) * 2.0 - 1.0
            self.assertLessEqual(
                abs(back - value), 1.0 / waveform_peaks.QUANT_LEVELS + ROUND_TRIP_EPSILON
            )


class EncodeTrackPeaks(unittest.TestCase):
    def test_decodes_to_exact_interleaved_quantized_bytes(self):
        peaks = [(-0.5, 0.6), (0.1, 0.2), (-0.9, 0.95)]
        decoded = base64.b64decode(waveform_peaks.encode_track_peaks(peaks))
        expected = bytes(
            b
            for mn, mx in peaks
            for b in (waveform_peaks.quantize_peak(mn), waveform_peaks.quantize_peak(mx))
        )
        self.assertEqual(decoded, expected)

    def test_empty_peaks_returns_empty_string(self):
        self.assertEqual(waveform_peaks.encode_track_peaks([]), "")


@unittest.skipUnless(HAVE_SOUNDFILE, "soundfile not installed")
class ReadTrackPeaksIntegration(unittest.TestCase):
    """Decode-path integration: real stem WAVs through soundfile/numpy."""

    def setUp(self):
        self.dir = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def _write_session(self, sample_rate=48000, frames=48000):
        # mono Kick: constant 0.5 -> every bucket is (0.5, 0.5)
        mono = np.full((frames, 1), 0.5, dtype=np.float32)
        sf.write(os.path.join(self.dir, "01-kick.wav"), mono, sample_rate, subtype="PCM_24")
        # stereo OH: L constant 0.3, R constant -0.4 -> one combined lane whose
        # every bucket is (min(0.3,-0.4), max(0.3,-0.4)) = (-0.4, 0.3)
        stereo = np.zeros((frames, 2), dtype=np.float32)
        stereo[:, 0] = 0.3
        stereo[:, 1] = -0.4
        sf.write(os.path.join(self.dir, "05-oh.wav"), stereo, sample_rate, subtype="PCM_24")
        _write_manifest(self.dir, {
            "sampleRate": sample_rate,
            "tracks": [
                {"label": "Kick", "kind": "mono", "file": "01-kick.wav"},
                {"label": "OH", "kind": "stereo", "file": "05-oh.wav"},
            ],
        })

    def test_generate_peaks_document_shape_and_known_buckets(self):
        self._write_session()
        doc = waveform_peaks.generate_peaks(self.dir, 50)
        self.assertEqual(doc["bucketsPerSecond"], 50)
        self.assertEqual([t["label"] for t in doc["tracks"]], ["Kick", "OH"])
        self.assertEqual([t["kind"] for t in doc["tracks"]], ["mono", "stereo"])
        self.assertEqual([t["index"] for t in doc["tracks"]], [0, 1])

        mono = doc["tracks"][0]
        self.assertEqual(mono["bucketCount"], 48000 // 960)
        raw = base64.b64decode(mono["data"])
        self.assertEqual(len(raw), mono["bucketCount"] * 2)
        # constant 0.5 -> every bucket's quantized min == max == quantize(0.5)
        expected = waveform_peaks.quantize_peak(0.5)
        for b in range(mono["bucketCount"]):
            self.assertEqual(raw[b * 2], expected)
            self.assertEqual(raw[b * 2 + 1], expected)

    def test_stereo_folds_to_single_combined_lane(self):
        self._write_session()
        doc = waveform_peaks.generate_peaks(self.dir, 50)
        oh = doc["tracks"][1]
        raw = base64.b64decode(oh["data"])
        self.assertEqual(len(raw), oh["bucketCount"] * 2)
        # L=0.3 / R=-0.4 fold to min=-0.4, max=0.3 per bucket.
        for b in range(oh["bucketCount"]):
            self.assertEqual(raw[b * 2], waveform_peaks.quantize_peak(-0.4))
            self.assertEqual(raw[b * 2 + 1], waveform_peaks.quantize_peak(0.3))

    def test_partial_tail_bucket_absorbs_remainder(self):
        # 48000 + 480 frames at 48 kHz / 50 bps (bucket_size 960): 50 full
        # buckets + one 480-sample tail bucket.
        self._write_session(frames=48480)
        doc = waveform_peaks.generate_peaks(self.dir, 50)
        mono = doc["tracks"][0]
        self.assertEqual(mono["bucketCount"], 51)
        self.assertEqual(len(base64.b64decode(mono["data"])), 51 * 2)

    def test_differing_lengths_yield_differing_bucket_counts(self):
        # Short stem (4800 frames = 5 buckets) vs long stem (48000 = 50).
        mono = np.full((4800, 1), 0.5, dtype=np.float32)
        sf.write(os.path.join(self.dir, "01-short.wav"), mono, 48000, subtype="PCM_24")
        long = np.full((48000, 1), -0.2, dtype=np.float32)
        sf.write(os.path.join(self.dir, "02-long.wav"), long, 48000, subtype="PCM_24")
        _write_manifest(self.dir, {
            "sampleRate": 48000,
            "tracks": [
                {"label": "Short", "kind": "mono", "file": "01-short.wav"},
                {"label": "Long", "kind": "mono", "file": "02-long.wav"},
            ],
        })
        doc = waveform_peaks.generate_peaks(self.dir, 50)
        counts = [t["bucketCount"] for t in doc["tracks"]]
        self.assertEqual(counts, [5, 50])
        self.assertNotEqual(counts[0], counts[1])

    def test_missing_stem_raises_value_error(self):
        self._write_session()
        os.remove(os.path.join(self.dir, "01-kick.wav"))
        with self.assertRaises(ValueError):
            waveform_peaks.generate_peaks(self.dir, 50)

    def test_wrong_sample_rate_raises_value_error(self):
        self._write_session(sample_rate=48000)
        # Rewrite only the manifest to claim 44100 while the stems stay 48000.
        _write_manifest(self.dir, {
            "sampleRate": 44100,
            "tracks": [
                {"label": "Kick", "kind": "mono", "file": "01-kick.wav"},
                {"label": "OH", "kind": "stereo", "file": "05-oh.wav"},
            ],
        })
        with self.assertRaises(ValueError):
            waveform_peaks.generate_peaks(self.dir, 50)

    def test_channel_count_mismatch_raises_value_error(self):
        self._write_session()
        # Claim the stereo OH stem as mono -> channel mismatch.
        _write_manifest(self.dir, {
            "sampleRate": 48000,
            "tracks": [
                {"label": "Kick", "kind": "mono", "file": "01-kick.wav"},
                {"label": "OH", "kind": "mono", "file": "05-oh.wav"},
            ],
        })
        with self.assertRaises(ValueError):
            waveform_peaks.generate_peaks(self.dir, 50)


if __name__ == "__main__":
    unittest.main()
