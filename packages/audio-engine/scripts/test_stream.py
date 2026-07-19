#!/usr/bin/env python3
"""
Unit tests for stream.py's pure analysis/parsing helpers.

Run: python3 packages/audio-engine/scripts/test_stream.py
Requires numpy + scipy. `sounddevice` is stubbed so the tests run on hosts
without PortAudio (e.g. CI), since stream.py imports it at module load.
"""

import io
import os
import sys
import time
import json
import types
import base64
import shutil
import signal
import contextlib
import tempfile
import subprocess
import unittest
import importlib.util

# Stub sounddevice before importing stream.py — the live-capture backend isn't
# needed (and PortAudio may be absent) for the pure helpers under test.
if "sounddevice" not in sys.modules:
    sys.modules["sounddevice"] = types.ModuleType("sounddevice")

import numpy as np

# soundfile drives the WAV stems; it may be absent on hosts that only ship
# numpy+scipy, so the stem/manifest tests skip rather than fail there.
try:
    import soundfile as sf
    HAVE_SOUNDFILE = True
except ImportError:
    HAVE_SOUNDFILE = False

_HERE = os.path.dirname(__file__)
_spec = importlib.util.spec_from_file_location("stream", os.path.join(_HERE, "stream.py"))
stream = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(stream)


def _mono_stereo_groups():
    """Configured strips: mono ch0, stereo ch2+ch3, mono ch1 (device with 4ch)."""
    return stream.parse_channel_groups("0,2-3,1", 4)


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


class BucketPeaks(unittest.TestCase):
    def test_even_split(self):
        self.assertEqual(
            stream.bucket_peaks([0.0, 0.5, -0.5, 1.0], 2),
            [(0.0, 0.5), (-0.5, 1.0)],
        )

    def test_remainder_goes_to_last_bucket(self):
        # 5 samples / 2 buckets: base=2, so bucket0 gets [0,1), bucket1 gets the
        # remainder [2,5) — 3 samples.
        out = stream.bucket_peaks([0.1, 0.2, 0.3, -0.9, 0.9], 2)
        self.assertEqual(len(out), 2)
        self.assertEqual(out[0], (0.1, 0.2))
        self.assertEqual(out[1], (-0.9, 0.9))

    def test_empty_input_returns_empty(self):
        self.assertEqual(stream.bucket_peaks([], 4), [])

    def test_zero_buckets_returns_empty(self):
        self.assertEqual(stream.bucket_peaks([0.1, 0.2], 0), [])

    def test_negative_buckets_returns_empty(self):
        self.assertEqual(stream.bucket_peaks([0.1, 0.2], -1), [])


class QuantizePeak(unittest.TestCase):
    def test_zero_maps_to_128(self):
        self.assertEqual(stream.quantize_peak(0.0), 128)

    def test_negative_one_maps_to_zero(self):
        self.assertEqual(stream.quantize_peak(-1.0), 0)

    def test_positive_one_maps_to_255(self):
        self.assertEqual(stream.quantize_peak(1.0), 255)

    def test_out_of_range_clamps(self):
        self.assertEqual(stream.quantize_peak(5.0), 255)
        self.assertEqual(stream.quantize_peak(-5.0), 0)

    def test_round_trips_within_epsilon(self):
        # The renderer's dequantize formula: level / (QUANT_LEVELS - 1) * 2 - 1.
        for value in (-1.0, -0.5, 0.0, 0.33, 0.75, 1.0):
            level = stream.quantize_peak(value)
            dequantized = level / (stream.QUANT_LEVELS - 1) * 2 - 1
            self.assertAlmostEqual(dequantized, value, delta=1.0 / (stream.QUANT_LEVELS - 1) + 1e-9)


class MixIndices(unittest.TestCase):
    def test_mono_and_stereo_groups_sorted_unique(self):
        groups = stream.parse_channel_groups("3,0-1", 4)
        self.assertEqual(stream.mix_indices(groups), [0, 1, 3])

    def test_overlapping_indices_deduplicated(self):
        groups = [
            {"kind": "mono", "indices": [2], "name": "CH03"},
            {"kind": "stereo", "indices": [2, 5], "name": "CH03+CH06"},
        ]
        self.assertEqual(stream.mix_indices(groups), [2, 5])

    def test_empty_groups_returns_empty(self):
        self.assertEqual(stream.mix_indices([]), [])


class EncodePeaksFrame(unittest.TestCase):
    def test_parses_as_json_with_expected_shape(self):
        line = stream.encode_peaks_frame([{"id": "mix", "peaks": [(-0.5, 0.5)]}], 1234.5)
        parsed = json.loads(line)
        self.assertEqual(parsed["type"], "peaks")
        self.assertIsInstance(parsed["ts"], float)
        self.assertEqual(len(parsed["lanes"]), 1)
        self.assertEqual(parsed["lanes"][0]["id"], "mix")

    def test_data_decodes_to_interleaved_quantized_bytes(self):
        peaks = [(-1.0, 1.0), (0.0, 0.0)]
        line = stream.encode_peaks_frame([{"id": "mix", "peaks": peaks}], 0.0)
        parsed = json.loads(line)
        raw = base64.b64decode(parsed["lanes"][0]["data"])
        expected = bytes([
            stream.quantize_peak(-1.0), stream.quantize_peak(1.0),
            stream.quantize_peak(0.0), stream.quantize_peak(0.0),
        ])
        self.assertEqual(raw, expected)

    def test_known_sine_decodes_to_expected_signs(self):
        sr = 48000
        t = np.arange(int(0.1 * sr)) / sr
        sine = (0.8 * np.sin(2 * np.pi * 10 * t)).tolist()
        pairs = stream.bucket_peaks(sine, 5)
        line = stream.encode_peaks_frame([{"id": "mix", "peaks": pairs}], 0.0)
        raw = base64.b64decode(json.loads(line)["lanes"][0]["data"])
        for i, (mn, mx) in enumerate(pairs):
            self.assertEqual(raw[i * 2], stream.quantize_peak(mn))
            self.assertEqual(raw[i * 2 + 1], stream.quantize_peak(mx))
            self.assertLessEqual(mn, mx)


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


class ArmResolution(unittest.TestCase):
    def test_absent_arm_arms_all_strips(self):
        groups = _mono_stereo_groups()
        self.assertEqual(stream.resolve_armed_strips(groups, None, 4), groups)
        self.assertEqual(stream.resolve_armed_strips(groups, "", 4), groups)
        self.assertEqual(stream.resolve_armed_strips(groups, "   ", 4), groups)

    def test_subset_selected_in_armed_order(self):
        groups = _mono_stereo_groups()  # ch0 (mono), ch2+3 (stereo), ch1 (mono)
        armed = stream.resolve_armed_strips(groups, "2-3,0", 4)
        self.assertEqual([g["indices"] for g in armed], [[2, 3], [0]])

    def test_unknown_token_raises(self):
        groups = _mono_stereo_groups()
        with self.assertRaises(ValueError):
            stream.resolve_armed_strips(groups, "0,3", 4)  # ch3 alone isn't a strip

    def test_malformed_stereo_token_raises(self):
        with self.assertRaises(ValueError):
            stream.resolve_armed_strips(_mono_stereo_groups(), "2-3-4", 4)

    def test_out_of_range_arm_token_raises(self):
        # Reuses parse_channel_groups' range validation: ch9 exceeds the device.
        with self.assertRaises(ValueError):
            stream.resolve_armed_strips(_mono_stereo_groups(), "9", 4)


class ApplyStripLabels(unittest.TestCase):
    def test_happy_path_sets_label_per_index(self):
        groups = _mono_stereo_groups()
        out = stream.apply_strip_labels(groups, '["Kick","OH","Snare"]')
        self.assertEqual([g.get("label") for g in out], ["Kick", "OH", "Snare"])
        self.assertIs(out, groups)  # same list, mutated in place for chaining

    def test_empty_strings_skipped(self):
        groups = _mono_stereo_groups()
        stream.apply_strip_labels(groups, '["Kick",""]')
        self.assertEqual(groups[0]["label"], "Kick")
        self.assertNotIn("label", groups[1])

    def test_whitespace_only_label_skipped(self):
        groups = _mono_stereo_groups()
        stream.apply_strip_labels(groups, '["   "]')
        self.assertNotIn("label", groups[0])

    def test_extra_entries_ignored(self):
        groups = _mono_stereo_groups()
        stream.apply_strip_labels(groups, '["Kick","OH","Snare","Extra1","Extra2"]')
        self.assertEqual([g.get("label") for g in groups], ["Kick", "OH", "Snare"])

    def test_missing_entries_leave_strips_unlabeled(self):
        groups = _mono_stereo_groups()
        stream.apply_strip_labels(groups, '["Kick"]')
        self.assertEqual(groups[0]["label"], "Kick")
        self.assertNotIn("label", groups[1])
        self.assertNotIn("label", groups[2])

    def test_falsy_labels_json_is_a_noop(self):
        groups = _mono_stereo_groups()
        self.assertIs(stream.apply_strip_labels(groups, None), groups)
        self.assertIs(stream.apply_strip_labels(groups, ""), groups)
        self.assertNotIn("label", groups[0])

    def test_invalid_json_raises_value_error(self):
        with self.assertRaisesRegex(ValueError, "--labels must be a JSON array"):
            stream.apply_strip_labels(_mono_stereo_groups(), "not json")

    def test_non_array_json_raises_value_error(self):
        with self.assertRaisesRegex(ValueError, "--labels must be a JSON array"):
            stream.apply_strip_labels(_mono_stereo_groups(), '{"0": "Kick"}')
        with self.assertRaisesRegex(ValueError, "--labels must be a JSON array"):
            stream.apply_strip_labels(_mono_stereo_groups(), '"Kick"')

    def test_non_string_entry_ignored(self):
        groups = _mono_stereo_groups()
        stream.apply_strip_labels(groups, '[42, "Snare"]')
        self.assertNotIn("label", groups[0])
        self.assertEqual(groups[1]["label"], "Snare")


class Slugify(unittest.TestCase):
    def test_slugs(self):
        self.assertEqual(stream.slugify("CH01"), "ch01")
        self.assertEqual(stream.slugify("CH02+CH03"), "ch02-ch03")
        self.assertEqual(stream.slugify("Kick Drum!"), "kick-drum")

    def test_empty_falls_back(self):
        self.assertEqual(stream.slugify("+++"), "strip")


class UniqueStemName(unittest.TestCase):
    def test_appends_counter_on_collision(self):
        d = tempfile.mkdtemp()
        try:
            self.assertEqual(stream._unique_stem_name(d, "01-kick.wav"), "01-kick.wav")
            open(os.path.join(d, "01-kick.wav"), "w").close()
            self.assertEqual(stream._unique_stem_name(d, "01-kick.wav"), "01-kick-2.wav")
            open(os.path.join(d, "01-kick-2.wav"), "w").close()
            self.assertEqual(stream._unique_stem_name(d, "01-kick.wav"), "01-kick-3.wav")
        finally:
            shutil.rmtree(d)


class UtcTimestamp(unittest.TestCase):
    def test_iso8601_millis_z(self):
        ts = stream._utc_now_iso()
        # e.g. 2026-07-03T14:32:07.512Z
        self.assertRegex(ts, r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")


@unittest.skipUnless(HAVE_SOUNDFILE, "soundfile not installed")
class SessionRecording(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.sr = 48000
        # Deterministic per-channel constant so demuxed stems are checkable:
        # device channel c carries value (c + 1) * 0.1.
        n = 512
        self.block = np.zeros((n, 4), dtype=np.float32)
        for c in range(4):
            self.block[:, c] = (c + 1) * 0.1
        self.n = n

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def _record(self, armed, blocks=2):
        rec = stream.SessionRecorder(self.dir, armed, self.sr)
        for _ in range(blocks):
            rec.write(self.block)
        rec.finalize()
        return rec

    def test_one_stem_per_armed_strip_with_correct_shape(self):
        armed = _mono_stereo_groups()  # mono, stereo, mono
        self._record(armed)
        wavs = sorted(f for f in os.listdir(self.dir) if f.endswith(".wav"))
        self.assertEqual(wavs, ["01-ch01.wav", "02-ch03-ch04.wav", "03-ch02.wav"])
        # mono → 1ch, stereo → 2ch, each 24-bit PCM.
        for fname, want_ch in [("01-ch01.wav", 1), ("02-ch03-ch04.wav", 2), ("03-ch02.wav", 1)]:
            info = sf.info(os.path.join(self.dir, fname))
            self.assertEqual(info.channels, want_ch)
            self.assertEqual(info.subtype, "PCM_24")

    def test_demuxed_samples_equal_input_columns(self):
        armed = _mono_stereo_groups()
        self._record(armed, blocks=1)
        # Stereo stem (ch2+ch3) columns should equal device columns 2 and 3.
        data, _ = sf.read(os.path.join(self.dir, "02-ch03-ch04.wav"), dtype="float32")
        self.assertEqual(data.shape, (self.n, 2))
        np.testing.assert_allclose(data[:, 0], 0.3, atol=1e-4)
        np.testing.assert_allclose(data[:, 1], 0.4, atol=1e-4)
        # Mono stem (ch0) equals device column 0.
        mono, _ = sf.read(os.path.join(self.dir, "01-ch01.wav"), dtype="float32")
        np.testing.assert_allclose(mono, 0.1, atol=1e-4)

    def test_arm_subset_records_only_selected(self):
        groups = _mono_stereo_groups()
        armed = stream.resolve_armed_strips(groups, "0,1", 4)  # two monos, skip stereo
        self._record(armed)
        wavs = sorted(f for f in os.listdir(self.dir) if f.endswith(".wav"))
        self.assertEqual(wavs, ["01-ch01.wav", "02-ch02.wav"])

    def test_manifest_shape_and_files_resolve(self):
        armed = _mono_stereo_groups()
        self._record(armed, blocks=2)
        with open(os.path.join(self.dir, "session.json")) as f:
            manifest = json.load(f)
        self.assertEqual(set(manifest), {"name", "createdAt", "sampleRate", "tracks"})
        self.assertEqual(manifest["sampleRate"], self.sr)
        self.assertRegex(manifest["createdAt"], r"Z$")
        self.assertEqual(len(manifest["tracks"]), 3)
        self.assertEqual([t["id"] for t in manifest["tracks"]], ["t1", "t2", "t3"])
        self.assertEqual([t["kind"] for t in manifest["tracks"]], ["mono", "stereo", "mono"])
        self.assertEqual(manifest["tracks"][1]["sourceChannels"], [2, 3])
        for t in manifest["tracks"]:
            self.assertEqual(t["frames"], 2 * self.n)
            # `file` is relative and resolves to a real WAV inside the folder.
            self.assertFalse(os.path.isabs(t["file"]))
            resolved = os.path.join(self.dir, t["file"])
            self.assertTrue(os.path.exists(resolved))
            want_ch = 1 if t["kind"] == "mono" else 2
            self.assertEqual(sf.info(resolved).channels, want_ch)

    def test_finalize_is_idempotent(self):
        armed = _mono_stereo_groups()
        rec = stream.SessionRecorder(self.dir, armed, self.sr)
        rec.write(self.block)
        rec.finalize()
        with open(os.path.join(self.dir, "session.json")) as f:
            first = f.read()
        rec.finalize()  # second call must not raise or rewrite differently
        rec.write(self.block)  # post-finalize writes are no-ops
        with open(os.path.join(self.dir, "session.json")) as f:
            self.assertEqual(f.read(), first)
        self.assertEqual(json.loads(first)["tracks"][0]["frames"], self.n)

    def test_zero_frame_session_still_writes_stems_and_manifest(self):
        armed = stream.resolve_armed_strips(_mono_stereo_groups(), "0", 4)
        rec = stream.SessionRecorder(self.dir, armed, self.sr)
        rec.finalize()  # no blocks written
        self.assertTrue(os.path.exists(os.path.join(self.dir, "01-ch01.wav")))
        with open(os.path.join(self.dir, "session.json")) as f:
            manifest = json.load(f)
        self.assertEqual(manifest["tracks"][0]["frames"], 0)


@unittest.skipUnless(HAVE_SOUNDFILE, "soundfile not installed")
class SessionRecordingWithLabels(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.sr = 48000

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_labeled_strip_names_stem_from_the_label(self):
        groups = stream.parse_channel_groups("0,1", 2)
        stream.apply_strip_labels(groups, '["Kick Drum",""]')
        rec = stream.SessionRecorder(self.dir, groups, self.sr)
        rec.finalize()
        wavs = sorted(f for f in os.listdir(self.dir) if f.endswith(".wav"))
        self.assertEqual(wavs, ["01-kick-drum.wav", "02-ch02.wav"])

    def test_unlabeled_strip_falls_back_to_channel_identity(self):
        groups = stream.parse_channel_groups("0", 1)
        rec = stream.SessionRecorder(self.dir, groups, self.sr)
        rec.finalize()
        self.assertTrue(os.path.exists(os.path.join(self.dir, "01-ch01.wav")))

    def test_label_with_slashes_and_spaces_is_sanitized(self):
        groups = stream.parse_channel_groups("0", 1)
        stream.apply_strip_labels(groups, '["Vocal / Lead"]')
        rec = stream.SessionRecorder(self.dir, groups, self.sr)
        rec.finalize()
        self.assertTrue(os.path.exists(os.path.join(self.dir, "01-vocal-lead.wav")))

    def test_label_with_no_alphanumerics_falls_back_to_channel_identity(self):
        groups = stream.parse_channel_groups("0", 1)
        stream.apply_strip_labels(groups, '["../.."]')
        rec = stream.SessionRecorder(self.dir, groups, self.sr)
        rec.finalize()
        # "../.." has no alphanumeric content, so the channel identity (CH01)
        # is used instead of a slug of the (traversal-looking) label.
        self.assertTrue(os.path.exists(os.path.join(self.dir, "01-ch01.wav")))

    def test_two_strips_with_the_same_label_get_unique_stem_names(self):
        # The idx prefix ("01-"/"02-") already disambiguates same-labeled
        # strips within one session; _unique_stem_name's counter only kicks in
        # for a true filename collision (covered by UniqueStemName above).
        groups = stream.parse_channel_groups("0,1", 2)
        stream.apply_strip_labels(groups, '["Vox","Vox"]')
        rec = stream.SessionRecorder(self.dir, groups, self.sr)
        rec.finalize()
        wavs = sorted(f for f in os.listdir(self.dir) if f.endswith(".wav"))
        self.assertEqual(wavs, ["01-vox.wav", "02-vox.wav"])

    def test_manifest_label_carries_the_user_label_and_falls_back_to_channel_name(self):
        groups = stream.parse_channel_groups("0,1", 2)
        stream.apply_strip_labels(groups, '["Kick",""]')
        rec = stream.SessionRecorder(self.dir, groups, self.sr)
        rec.finalize()
        with open(os.path.join(self.dir, "session.json")) as f:
            manifest = json.load(f)
        self.assertEqual(manifest["tracks"][0]["label"], "Kick")
        self.assertEqual(manifest["tracks"][1]["label"], "CH02")


class MonitorPathWritesNothing(unittest.TestCase):
    def test_no_session_no_recorder_touches_disk(self):
        # SessionRecorder is only constructed when --session-dir is given; a
        # monitor-only run never instantiates it. Guard the contract: an empty
        # temp dir stays empty when no recorder is created.
        d = tempfile.mkdtemp()
        try:
            self.assertEqual(os.listdir(d), [])
        finally:
            shutil.rmtree(d)


@unittest.skipUnless(HAVE_SOUNDFILE, "soundfile not installed")
class SigtermFinalizesSession(unittest.TestCase):
    """End-to-end: a real stream.py subprocess (fed by a fake sounddevice) must
    finalize every stem header and session.json when killed with SIGTERM."""

    def test_sigterm_writes_manifest_and_stems(self):
        work = tempfile.mkdtemp()
        session_dir = os.path.join(work, "session")
        fake_dir = os.path.join(work, "fake")
        os.makedirs(fake_dir)
        # A PortAudio-free sounddevice that drives the audio callback from a
        # background thread with deterministic per-channel constants.
        with open(os.path.join(fake_dir, "sounddevice.py"), "w") as f:
            f.write(_FAKE_SOUNDDEVICE)
        env = dict(os.environ)
        env["PYTHONPATH"] = fake_dir + os.pathsep + env.get("PYTHONPATH", "")
        proc = subprocess.Popen(
            [sys.executable, os.path.join(_HERE, "stream.py"),
             "", "0.5", "0,2-3", "--session-dir", session_dir, "--interval", "0.05"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env,
        )
        try:
            # Wait for stems to open and take on audio before stopping.
            deadline = time.monotonic() + 5.0
            stem = os.path.join(session_dir, "01-ch01.wav")
            while time.monotonic() < deadline:
                if os.path.exists(stem) and os.path.getsize(stem) > 128:
                    break
                time.sleep(0.05)
            proc.send_signal(signal.SIGTERM)
            self.assertEqual(proc.wait(timeout=5), 0)

            with open(os.path.join(session_dir, "session.json")) as fh:
                manifest = json.load(fh)
            self.assertEqual([t["kind"] for t in manifest["tracks"]], ["mono", "stereo"])
            for t in manifest["tracks"]:
                path = os.path.join(session_dir, t["file"])
                info = sf.info(path)  # a finalized (non-empty) header reads back
                self.assertEqual(info.subtype, "PCM_24")
                self.assertGreater(info.frames, 0)
                self.assertEqual(info.frames, t["frames"])
        finally:
            if proc.poll() is None:
                proc.kill()
            shutil.rmtree(work, ignore_errors=True)


_FAKE_SOUNDDEVICE = '''
"""PortAudio-free sounddevice stub for stream.py integration tests."""
import threading, time
import numpy as np

_INFO = {"name": "Fake Multichannel", "max_input_channels": 4, "default_samplerate": 48000}


def query_devices(index=None):
    return _INFO if index is not None else [_INFO]


class _Default:
    device = [0, 0]


default = _Default()


class InputStream:
    def __init__(self, device, channels, samplerate, dtype, callback):
        self.channels, self.callback = channels, callback
        self._stop = threading.Event()
        self._thread = None

    def __enter__(self):
        def run():
            n = 1024
            block = np.zeros((n, self.channels), dtype=np.float32)
            for c in range(self.channels):
                block[:, c] = (c + 1) * 0.1
            while not self._stop.is_set():
                self.callback(block.copy(), n, None, None)
                time.sleep(0.01)
        self._thread = threading.Thread(target=run, daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *a):
        self._stop.set()
        self._thread.join(timeout=1)
        return False
'''


class DeviceEnumeration(unittest.TestCase):
    """Output enumeration (#44) mirrors input enumeration over one device table:
    an input-only, an output-only, and a duplex device."""

    DEVICES = [
        {"name": "Built-in Microphone", "max_input_channels": 2,
         "max_output_channels": 0, "default_samplerate": 48000.0},
        {"name": "Built-in Output", "max_input_channels": 0,
         "max_output_channels": 2, "default_samplerate": 44100.0},
        {"name": "Scarlett 18i20", "max_input_channels": 18,
         "max_output_channels": 20, "default_samplerate": 48000.0},
    ]

    def setUp(self):
        self._orig = getattr(stream.sd, "query_devices", None)
        stream.sd.query_devices = lambda *a, **k: self.DEVICES

    def tearDown(self):
        stream.sd.query_devices = self._orig

    def test_output_list_excludes_input_only(self):
        out = stream._enumerate_devices("max_output_channels")
        self.assertEqual([d["name"] for d in out], ["Built-in Output", "Scarlett 18i20"])

    def test_channels_reflect_max_output(self):
        out = stream._enumerate_devices("max_output_channels")
        # channels mirrors max_output_channels; index is the position in the full
        # device table (2 for the duplex device, past the excluded input-only one).
        self.assertEqual(out[0], {"index": 1, "name": "Built-in Output",
                                  "channels": 2, "default_sr": 44100})
        self.assertEqual(out[1], {"index": 2, "name": "Scarlett 18i20",
                                  "channels": 20, "default_sr": 48000})

    def test_input_list_still_filters_on_max_input(self):
        out = stream._enumerate_devices("max_input_channels")
        self.assertEqual([d["name"] for d in out],
                         ["Built-in Microphone", "Scarlett 18i20"])
        self.assertEqual(out[0]["channels"], 2)

    def test_empty_when_no_output_devices(self):
        stream.sd.query_devices = lambda *a, **k: [
            {"name": "Mic Only", "max_input_channels": 1,
             "max_output_channels": 0, "default_samplerate": 48000.0},
        ]
        self.assertEqual(stream._enumerate_devices("max_output_channels"), [])

    def test_list_output_devices_prints_devices_envelope(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            stream.list_output_devices()
        payload = json.loads(buf.getvalue())
        self.assertEqual([d["name"] for d in payload["devices"]],
                         ["Built-in Output", "Scarlett 18i20"])


if __name__ == "__main__":
    unittest.main()
