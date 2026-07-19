#!/usr/bin/env python3
"""
Unit tests for spike_dual_capture.py's pure helpers (#459).

Run: python3 packages/audio-engine/scripts/test_spike_dual_capture.py
Plain-Python math only (no numpy/scipy) so these run on any python3.
`sounddevice` is stubbed so the module loads on hosts without PortAudio
(the runtime imports it lazily, but the stub keeps this test self-contained
if that ever changes).
"""

import os
import sys
import types
import unittest
import importlib.util

if "sounddevice" not in sys.modules:
    sys.modules["sounddevice"] = types.ModuleType("sounddevice")

_HERE = os.path.dirname(__file__)
_spec = importlib.util.spec_from_file_location(
    "spike_dual_capture", os.path.join(_HERE, "spike_dual_capture.py")
)
spike = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(spike)


TWO_DEVICES = [
    {"index": 0, "name": "USB Mic", "channels": 1, "default_sr": 48000},
    {"index": 2, "name": "MacBook Pro Microphone", "channels": 1, "default_sr": 44100},
]

THREE_DEVICES = TWO_DEVICES + [
    {"index": 5, "name": "M32 USB", "channels": 32, "default_sr": 48000},
]

ONE_DEVICE = [TWO_DEVICES[0]]


def _synth_events(effective_sr, n_events=100, frames_per_event=480, flags=None):
    """Deterministic synthetic callback events: cumulative frames vs host_time
    lie exactly on a line of slope `effective_sr`, so the least-squares fit
    recovers `effective_sr` (near-)exactly."""
    events = []
    cumulative = 0
    for i in range(n_events):
        cumulative += frames_per_event
        host_time = cumulative / effective_sr
        events.append({
            "host_time": host_time,
            "adc_time": host_time,
            "current_time": host_time,
            "frames": frames_per_event,
            "flags": (flags[i] if flags else ""),
        })
    return events


class PickDevicePair(unittest.TestCase):
    def test_defaults_pick_first_two_inputs(self):
        primary, secondary = spike.pick_device_pair(TWO_DEVICES, "", "")
        self.assertEqual(primary, TWO_DEVICES[0])
        self.assertEqual(secondary, TWO_DEVICES[1])

    def test_resolution_by_index(self):
        primary, secondary = spike.pick_device_pair(THREE_DEVICES, "5", "0")
        self.assertEqual(primary["name"], "M32 USB")
        self.assertEqual(secondary["name"], "USB Mic")

    def test_resolution_by_name_substring_case_insensitive(self):
        primary, secondary = spike.pick_device_pair(THREE_DEVICES, "macbook", "m32")
        self.assertEqual(primary["name"], "MacBook Pro Microphone")
        self.assertEqual(secondary["name"], "M32 USB")

    def test_zero_input_devices_raises_actionable_error(self):
        with self.assertRaises(ValueError) as ctx:
            spike.pick_device_pair([], "", "")
        self.assertIn("input device", str(ctx.exception))

    def test_one_input_device_raises_actionable_error(self):
        with self.assertRaises(ValueError) as ctx:
            spike.pick_device_pair(ONE_DEVICE, "", "")
        msg = str(ctx.exception)
        self.assertIn("Aggregate Device", msg)
        self.assertIn("--allow-same-device", msg)

    def test_one_input_device_allowed_with_allow_same(self):
        primary, secondary = spike.pick_device_pair(ONE_DEVICE, "", "", allow_same=True)
        self.assertEqual(primary, ONE_DEVICE[0])
        self.assertEqual(secondary, ONE_DEVICE[0])

    def test_zero_input_devices_still_raises_with_allow_same(self):
        with self.assertRaises(ValueError):
            spike.pick_device_pair([], "", "", allow_same=True)

    def test_explicit_same_device_rejected_without_flag(self):
        with self.assertRaises(ValueError) as ctx:
            spike.pick_device_pair(TWO_DEVICES, "0", "0")
        self.assertIn("--allow-same-device", str(ctx.exception))

    def test_explicit_same_device_allowed_with_flag(self):
        primary, secondary = spike.pick_device_pair(TWO_DEVICES, "0", "0", allow_same=True)
        self.assertEqual(primary, secondary)
        self.assertEqual(primary["index"], 0)

    def test_unknown_device_arg_raises(self):
        with self.assertRaises(ValueError) as ctx:
            spike.pick_device_pair(TWO_DEVICES, "nonexistent-device", "")
        self.assertIn("device not found", str(ctx.exception))

    def test_unknown_secondary_arg_raises(self):
        with self.assertRaises(ValueError) as ctx:
            spike.pick_device_pair(TWO_DEVICES, "0", "nonexistent-device")
        self.assertIn("device not found", str(ctx.exception))


class ComputeStreamStats(unittest.TestCase):
    def test_exact_nominal_rate_yields_near_zero_drift(self):
        events = _synth_events(48000.0)
        stats = spike.compute_stream_stats(events, nominal_sr=48000)
        self.assertAlmostEqual(stats["effective_sample_rate"], 48000.0, delta=0.5)
        self.assertAlmostEqual(stats["drift_ppm"], 0.0, delta=1.0)

    def test_events_synthesized_100ppm_fast(self):
        effective_sr = 48000.0 * (1 + 100e-6)
        events = _synth_events(effective_sr)
        stats = spike.compute_stream_stats(events, nominal_sr=48000)
        self.assertAlmostEqual(stats["drift_ppm"], 100.0, delta=1.0)

    def test_status_flag_counting(self):
        flags = ["", "input_overflow", "", "input_overflow", ""]
        events = _synth_events(48000.0, n_events=5, flags=flags)
        stats = spike.compute_stream_stats(events, nominal_sr=48000)
        self.assertEqual(stats["status_flag_count"], 2)

    def test_empty_events_returns_well_formed_degenerate_dict(self):
        stats = spike.compute_stream_stats([], nominal_sr=48000)
        self.assertEqual(stats["event_count"], 0)
        self.assertEqual(stats["total_frames"], 0)
        self.assertEqual(stats["duration_secs"], 0.0)
        self.assertEqual(stats["effective_sample_rate"], 0.0)
        self.assertEqual(stats["drift_ppm"], 0.0)
        self.assertEqual(stats["status_flag_count"], 0)
        self.assertEqual(stats["jitter_ms"], {"p50": 0.0, "p95": 0.0, "max": 0.0})

    def test_single_event_does_not_raise_zero_division(self):
        events = _synth_events(48000.0, n_events=1)
        stats = spike.compute_stream_stats(events, nominal_sr=48000)
        self.assertEqual(stats["event_count"], 1)
        self.assertEqual(stats["total_frames"], 480)
        self.assertEqual(stats["effective_sample_rate"], 0.0)
        self.assertEqual(stats["jitter_ms"], {"p50": 0.0, "p95": 0.0, "max": 0.0})

    def test_jitter_reflects_callback_interval_gaps(self):
        events = _synth_events(48000.0, n_events=10, frames_per_event=4800)  # 100ms apart
        stats = spike.compute_stream_stats(events, nominal_sr=48000)
        self.assertAlmostEqual(stats["jitter_ms"]["p50"], 100.0, delta=0.5)
        self.assertAlmostEqual(stats["jitter_ms"]["max"], 100.0, delta=0.5)


class ComputeRelativeDrift(unittest.TestCase):
    def test_50ppm_apart_yields_relative_ppm_and_projected_offset(self):
        stats_a = {"drift_ppm": 0.0}
        stats_b = {"drift_ppm": 50.0}
        relative = spike.compute_relative_drift(stats_a, stats_b)
        self.assertAlmostEqual(relative["relative_ppm"], 50.0, delta=0.01)
        offsets = {p["window_secs"]: p["offset_ms"] for p in relative["projections"]}
        self.assertEqual(set(offsets), set(spike.PROJECTION_WINDOWS_SECS))
        self.assertAlmostEqual(offsets[600], 30.0, delta=0.5)

    def test_verdict_ok_below_warn_threshold(self):
        relative = spike.compute_relative_drift({"drift_ppm": 0.0}, {"drift_ppm": 10.0})
        self.assertLess(10.0, spike.DRIFT_WARN_PPM)
        self.assertEqual(relative["verdict"], "ok")

    def test_verdict_warn_above_threshold(self):
        relative = spike.compute_relative_drift({"drift_ppm": 0.0}, {"drift_ppm": 500.0})
        self.assertGreater(500.0, spike.DRIFT_WARN_PPM)
        self.assertEqual(relative["verdict"], "warn")

    def test_verdict_flips_around_threshold(self):
        below = spike.compute_relative_drift(
            {"drift_ppm": 0.0}, {"drift_ppm": spike.DRIFT_WARN_PPM - 1.0}
        )
        above = spike.compute_relative_drift(
            {"drift_ppm": 0.0}, {"drift_ppm": spike.DRIFT_WARN_PPM + 1.0}
        )
        self.assertEqual(below["verdict"], "ok")
        self.assertEqual(above["verdict"], "warn")

    def test_relative_drift_is_signed(self):
        # b slower than a ⇒ negative relative ppm, but the warn verdict looks
        # at magnitude so a large negative drift still warns.
        relative = spike.compute_relative_drift({"drift_ppm": 50.0}, {"drift_ppm": 0.0})
        self.assertAlmostEqual(relative["relative_ppm"], -50.0, delta=0.01)


class BuildReport(unittest.TestCase):
    def setUp(self):
        self.device_a = TWO_DEVICES[0]
        self.device_b = TWO_DEVICES[1]
        self.stats_a = spike.compute_stream_stats(_synth_events(48000.0), nominal_sr=48000)
        self.stats_b = spike.compute_stream_stats(_synth_events(44100.0), nominal_sr=44100)
        self.relative = spike.compute_relative_drift(self.stats_a, self.stats_b)

    def test_shape_has_expected_top_level_keys(self):
        report = spike.build_report(
            self.device_a, self.device_b, self.stats_a, self.stats_b, self.relative, []
        )
        self.assertEqual(
            set(report),
            {"devices", "stats", "relative_drift", "lifecycle_events", "both_streams_ran"},
        )
        self.assertEqual(set(report["devices"]), {"a", "b"})
        self.assertEqual(report["devices"]["a"]["name"], "USB Mic")
        self.assertEqual(report["devices"]["a"]["nominal_sample_rate"], 48000)

    def test_events_are_preserved_verbatim(self):
        events_log = [{"type": "start", "ts": 1.0}, {"type": "stop", "ts": 2.0}]
        report = spike.build_report(
            self.device_a, self.device_b, self.stats_a, self.stats_b, self.relative, events_log
        )
        self.assertEqual(report["lifecycle_events"], events_log)

    def test_both_streams_ran_true_with_no_errors(self):
        events_log = [{"type": "start", "ts": 1.0}, {"type": "stop", "ts": 2.0}]
        report = spike.build_report(
            self.device_a, self.device_b, self.stats_a, self.stats_b, self.relative, events_log
        )
        self.assertTrue(report["both_streams_ran"])

    def test_both_streams_ran_false_on_error_event(self):
        events_log = [{"type": "start", "ts": 1.0}, {"type": "error", "ts": 1.5, "detail": "boom"}]
        report = spike.build_report(
            self.device_a, self.device_b, self.stats_a, self.stats_b, self.relative, events_log
        )
        self.assertFalse(report["both_streams_ran"])

    def test_both_streams_ran_false_on_disconnect_event(self):
        events_log = [{"type": "start", "ts": 1.0}, {"type": "disconnect", "ts": 1.5}]
        report = spike.build_report(
            self.device_a, self.device_b, self.stats_a, self.stats_b, self.relative, events_log
        )
        self.assertFalse(report["both_streams_ran"])


if __name__ == "__main__":
    unittest.main()
