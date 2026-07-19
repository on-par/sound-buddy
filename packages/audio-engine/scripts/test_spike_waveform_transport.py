#!/usr/bin/env python3
"""
Unit tests for spike_waveform_transport.py's pure helpers (#519).

Run: python3 packages/audio-engine/scripts/test_spike_waveform_transport.py
Plain-Python math only (no numpy) so these run on any python3. `sounddevice`
and `numpy` are stubbed so the module loads on hosts without PortAudio/numpy
(the runtime imports both lazily inside functions, but the stubs keep this
test self-contained if that ever changes — same belt-and-braces pattern as
test_spike_dual_capture.py).
"""

import os
import sys
import json
import base64
import types
import unittest
import importlib.util

if "sounddevice" not in sys.modules:
    sys.modules["sounddevice"] = types.ModuleType("sounddevice")
if "numpy" not in sys.modules:
    sys.modules["numpy"] = types.ModuleType("numpy")

_HERE = os.path.dirname(__file__)
_spec = importlib.util.spec_from_file_location(
    "spike_waveform_transport", os.path.join(_HERE, "spike_waveform_transport.py")
)
spike = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(spike)

# Explicit epsilon for the quantize/dequantize round-trip bound — no bare
# float equality, per the repo's code-quality standard. Covers the small gap
# between the true half-step error (1/(QUANT_LEVELS-1)) and 1/QUANT_LEVELS.
ROUND_TRIP_EPSILON = 1e-3


class BucketPeaks(unittest.TestCase):
    def test_known_8_samples_into_4_buckets_exact_min_max(self):
        samples = [0.1, -0.2, 0.3, -0.4, 0.5, -0.6, 0.7, -0.8]
        buckets = spike.bucket_peaks(samples, 4)
        self.assertEqual(
            buckets,
            [
                (-0.2, 0.1),
                (-0.4, 0.3),
                (-0.6, 0.5),
                (-0.8, 0.7),
            ],
        )

    def test_remainder_distribution_when_not_evenly_divisible(self):
        samples = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0]
        buckets = spike.bucket_peaks(samples, 4)
        # base = 10 // 4 = 2; first 3 buckets get 2 samples, last gets the
        # remainder (4 samples: [7,8,9,10]).
        self.assertEqual(len(buckets), 4)
        self.assertEqual(buckets[0], (1.0, 2.0))
        self.assertEqual(buckets[1], (3.0, 4.0))
        self.assertEqual(buckets[2], (5.0, 6.0))
        self.assertEqual(buckets[3], (7.0, 10.0))

    def test_empty_input_returns_empty_list(self):
        self.assertEqual(spike.bucket_peaks([], 4), [])

    def test_zero_buckets_returns_empty_list(self):
        self.assertEqual(spike.bucket_peaks([1.0, 2.0], 0), [])

    def test_negative_buckets_returns_empty_list(self):
        self.assertEqual(spike.bucket_peaks([1.0, 2.0], -3), [])


class QuantizePeak(unittest.TestCase):
    def test_minus_one_maps_to_zero(self):
        self.assertEqual(spike.quantize_peak(-1.0), 0)

    def test_zero_maps_to_128(self):
        self.assertEqual(spike.quantize_peak(0.0), 128)

    def test_plus_one_maps_to_255(self):
        self.assertEqual(spike.quantize_peak(1.0), 255)

    def test_clamps_above_one(self):
        self.assertEqual(spike.quantize_peak(1.5), 255)

    def test_clamps_below_minus_one(self):
        self.assertEqual(spike.quantize_peak(-1.5), 0)

    def test_round_trip_error_bounded(self):
        for value in (-1.0, -0.73, -0.25, 0.0, 0.1, 0.5, 0.999, 1.0):
            q = spike.quantize_peak(value)
            back = spike.dequantize_peak(q)
            self.assertLessEqual(
                abs(back - value), 1.0 / spike.QUANT_LEVELS + ROUND_TRIP_EPSILON
            )

    def test_dequantize_zero_is_minus_one(self):
        self.assertAlmostEqual(spike.dequantize_peak(0), -1.0, delta=ROUND_TRIP_EPSILON)

    def test_dequantize_max_is_plus_one(self):
        self.assertAlmostEqual(spike.dequantize_peak(255), 1.0, delta=ROUND_TRIP_EPSILON)


LANES = [
    {"id": "mix", "peaks": [(-0.5, 0.6), (0.1, 0.2), (-0.9, 0.95)]},
    {"id": "ch0", "peaks": [(0.0, 0.0), (-0.3, 0.3), (0.05, 0.05)]},
]
TS = 12345.678


class EncodeFrameFloat(unittest.TestCase):
    def test_shape_and_rounding(self):
        line = spike.encode_frame_float(LANES, TS)
        parsed = json.loads(line)
        self.assertEqual(parsed["type"], "peaks")
        self.assertAlmostEqual(parsed["ts"], TS, delta=1e-9)
        self.assertEqual(len(parsed["lanes"]), 2)
        self.assertEqual(parsed["lanes"][0]["id"], "mix")
        self.assertEqual(parsed["lanes"][0]["min"], [-0.5, 0.1, -0.9])
        self.assertEqual(parsed["lanes"][0]["max"], [0.6, 0.2, 0.95])

    def test_values_rounded_to_3_decimals(self):
        lanes = [{"id": "mix", "peaks": [(-0.123456, 0.654321)]}]
        parsed = json.loads(spike.encode_frame_float(lanes, TS))
        self.assertEqual(parsed["lanes"][0]["min"], [-0.123])
        self.assertEqual(parsed["lanes"][0]["max"], [0.654])


class EncodeFrameU8(unittest.TestCase):
    def test_shape_and_quantized_values(self):
        line = spike.encode_frame_u8(LANES, TS)
        parsed = json.loads(line)
        self.assertEqual(parsed["type"], "peaks")
        self.assertEqual(parsed["lanes"][0]["id"], "mix")
        expected_min = [spike.quantize_peak(v) for v in (-0.5, 0.1, -0.9)]
        expected_max = [spike.quantize_peak(v) for v in (0.6, 0.2, 0.95)]
        self.assertEqual(parsed["lanes"][0]["min"], expected_min)
        self.assertEqual(parsed["lanes"][0]["max"], expected_max)
        self.assertTrue(all(isinstance(v, int) for v in parsed["lanes"][0]["min"]))


class EncodeFrameB64(unittest.TestCase):
    def test_lane_decodes_to_exact_packed_bytes(self):
        line = spike.encode_frame_b64(LANES, TS)
        parsed = json.loads(line)
        self.assertEqual(parsed["lanes"][0]["id"], "mix")
        decoded = base64.b64decode(parsed["lanes"][0]["data"])
        expected = bytes(
            b
            for mn, mx in LANES[0]["peaks"]
            for b in (spike.quantize_peak(mn), spike.quantize_peak(mx))
        )
        self.assertEqual(decoded, expected)


class EncoderSizeComparison(unittest.TestCase):
    def test_u8_frame_strictly_smaller_than_float_frame(self):
        float_line = spike.encode_frame_float(LANES, TS)
        u8_line = spike.encode_frame_u8(LANES, TS)
        self.assertLess(len(u8_line), len(float_line))


def _tick_records(host_times, cpu_ms_list, bytes_list):
    return [
        {"host_time": ht, "cpu_ms": cpu, "bytes": b}
        for ht, cpu, b in zip(host_times, cpu_ms_list, bytes_list)
    ]


class ComputeCadenceStats(unittest.TestCase):
    def test_known_gaps_yield_exact_percentiles(self):
        host_times = [i * 0.1 for i in range(10)]
        cpu_ms = [5.0] * 10
        byte_counts = [100] * 10
        records = _tick_records(host_times, cpu_ms, byte_counts)
        stats = spike.compute_cadence_stats(records, nominal_interval_secs=0.1)
        self.assertEqual(stats["tick_count"], 10)
        self.assertAlmostEqual(stats["duration_secs"], 0.9, delta=1e-9)
        self.assertAlmostEqual(stats["gap_ms"]["p50"], 100.0, delta=1e-6)
        self.assertAlmostEqual(stats["gap_ms"]["p95"], 100.0, delta=1e-6)
        self.assertAlmostEqual(stats["gap_ms"]["max"], 100.0, delta=1e-6)
        self.assertFalse(stats["degenerate"])

    def test_late_ticks_counts_only_gaps_above_1_5x_interval(self):
        host_times = [0.0, 0.1, 0.2, 0.5, 0.6]
        cpu_ms = [1.0] * 5
        byte_counts = [50] * 5
        records = _tick_records(host_times, cpu_ms, byte_counts)
        stats = spike.compute_cadence_stats(records, nominal_interval_secs=0.1)
        # Gaps: 0.1, 0.1, 0.3, 0.1 — threshold is 1.5 * 0.1 = 0.15, so only
        # the 0.3s gap counts as late.
        self.assertEqual(stats["late_ticks"], 1)

    def test_no_late_ticks_when_all_gaps_within_threshold(self):
        host_times = [0.0, 0.1, 0.2, 0.3]
        cpu_ms = [1.0] * 4
        byte_counts = [50] * 4
        records = _tick_records(host_times, cpu_ms, byte_counts)
        stats = spike.compute_cadence_stats(records, nominal_interval_secs=0.1)
        self.assertEqual(stats["late_ticks"], 0)

    def test_cpu_utilization_math(self):
        host_times = [0.0, 1.0]
        cpu_ms = [100.0, 200.0]  # total 300ms over 1s wall -> 0.3 utilization
        byte_counts = [10, 10]
        records = _tick_records(host_times, cpu_ms, byte_counts)
        stats = spike.compute_cadence_stats(records, nominal_interval_secs=0.1)
        self.assertAlmostEqual(stats["cpu_utilization"], 0.3, delta=1e-6)

    def test_bytes_per_sec_math(self):
        host_times = [0.0, 2.0]
        byte_counts = [500, 500]  # total 1000 bytes over 2s -> 500 bytes/sec
        cpu_ms = [1.0, 1.0]
        records = _tick_records(host_times, cpu_ms, byte_counts)
        stats = spike.compute_cadence_stats(records, nominal_interval_secs=0.1)
        self.assertAlmostEqual(stats["bytes_per_sec"], 500.0, delta=1e-6)

    def test_zero_ticks_returns_degenerate(self):
        stats = spike.compute_cadence_stats([], nominal_interval_secs=0.1)
        self.assertEqual(stats["tick_count"], 0)
        self.assertEqual(stats["duration_secs"], 0.0)
        self.assertEqual(stats["late_ticks"], 0)
        self.assertEqual(stats["gap_ms"], {"p50": 0.0, "p95": 0.0, "max": 0.0})
        self.assertEqual(stats["cpu_ms"], {"p50": 0.0, "p95": 0.0, "max": 0.0})
        self.assertEqual(stats["cpu_utilization"], 0.0)
        self.assertEqual(stats["bytes_per_sec"], 0.0)
        self.assertTrue(stats["degenerate"])

    def test_one_tick_returns_degenerate(self):
        records = _tick_records([0.0], [1.0], [10])
        stats = spike.compute_cadence_stats(records, nominal_interval_secs=0.1)
        self.assertEqual(stats["tick_count"], 1)
        self.assertTrue(stats["degenerate"])


class TransportOk(unittest.TestCase):
    def _passing_cadence(self, bytes_per_sec=1000.0, cpu_p95=1.0, late_ticks=0, degenerate=False):
        return {
            "tick_count": 10,
            "duration_secs": 1.0,
            "ticks_per_sec": 10.0,
            "gap_ms": {"p50": 100.0, "p95": 100.0, "max": 100.0},
            "late_ticks": late_ticks,
            "cpu_ms": {"p50": cpu_p95, "p95": cpu_p95, "max": cpu_p95},
            "cpu_utilization": 0.01,
            "bytes_per_sec": bytes_per_sec,
            "degenerate": degenerate,
        }

    def test_passes_when_all_thresholds_met(self):
        entry = {"cadence": self._passing_cadence()}
        self.assertTrue(spike.transport_ok(entry, interval_secs=0.1))

    def test_fails_when_degenerate(self):
        entry = {"cadence": self._passing_cadence(degenerate=True)}
        self.assertFalse(spike.transport_ok(entry, interval_secs=0.1))

    def test_fails_when_late_ticks_nonzero(self):
        entry = {"cadence": self._passing_cadence(late_ticks=2)}
        self.assertFalse(spike.transport_ok(entry, interval_secs=0.1))

    def test_fails_when_cpu_p95_exceeds_budget(self):
        # budget = TICK_BUDGET_FRACTION * 0.1s * 1000 = 20ms
        entry = {"cadence": self._passing_cadence(cpu_p95=25.0)}
        self.assertFalse(spike.transport_ok(entry, interval_secs=0.1))

    def test_passes_at_exact_cpu_budget(self):
        entry = {"cadence": self._passing_cadence(cpu_p95=20.0)}
        self.assertTrue(spike.transport_ok(entry, interval_secs=0.1))

    def test_fails_when_bytes_per_sec_exceeds_max_payload(self):
        entry = {"cadence": self._passing_cadence(bytes_per_sec=spike.MAX_PAYLOAD_BYTES_PER_SEC + 1)}
        self.assertFalse(spike.transport_ok(entry, interval_secs=0.1))


class BuildReport(unittest.TestCase):
    def _cadence(self, bytes_per_sec=1000.0, cpu_p95=1.0, late_ticks=0, degenerate=False):
        return {
            "tick_count": 10,
            "duration_secs": 1.0,
            "ticks_per_sec": 10.0,
            "gap_ms": {"p50": 100.0, "p95": 100.0, "max": 100.0},
            "late_ticks": late_ticks,
            "cpu_ms": {"p50": cpu_p95, "p95": cpu_p95, "max": cpu_p95},
            "cpu_utilization": 0.01,
            "bytes_per_sec": bytes_per_sec,
            "degenerate": degenerate,
        }

    def _entry(self, strips, encoding, bytes_per_frame, **cadence_kwargs):
        return {
            "strips": strips,
            "encoding": encoding,
            "cadence": self._cadence(**cadence_kwargs),
            "bytes_per_frame": bytes_per_frame,
        }

    def test_passing_sweep_yields_true_verdicts_and_recommended_encoding(self):
        sweep = [
            self._entry(8, "float", 500),
            self._entry(8, "u8", 200),
            self._entry(8, "b64", 150),
            self._entry(32, "float", 2000),
            self._entry(32, "u8", 800),
            self._entry(32, "b64", 600),
        ]
        config = {"interval_secs": 0.1}
        report = spike.build_report(config, sweep, capture_result=None)
        self.assertTrue(report["verdict"]["mix_only"])
        self.assertTrue(report["verdict"]["per_input"])
        self.assertEqual(report["verdict"]["recommended_encoding"], "b64")

    def test_entry_with_late_ticks_fails_transport_ok_in_sweep(self):
        sweep = [self._entry(8, "float", 500, late_ticks=3)]
        config = {"interval_secs": 0.1}
        report = spike.build_report(config, sweep, capture_result=None)
        self.assertFalse(report["sweep"][0]["transport_ok"])
        self.assertFalse(report["verdict"]["mix_only"])

    def test_entry_with_oversized_bytes_per_sec_fails_transport_ok(self):
        sweep = [
            self._entry(8, "float", 500, bytes_per_sec=spike.MAX_PAYLOAD_BYTES_PER_SEC * 2),
        ]
        config = {"interval_secs": 0.1}
        report = spike.build_report(config, sweep, capture_result=None)
        self.assertFalse(report["sweep"][0]["transport_ok"])

    def test_capture_result_none_yields_pending_real_rig(self):
        sweep = [self._entry(8, "float", 500)]
        report = spike.build_report({"interval_secs": 0.1}, sweep, capture_result=None)
        self.assertEqual(report["verdict"]["recording_safety"], "pending_real_rig")

    def test_capture_result_clean_yields_ok(self):
        sweep = [self._entry(8, "float", 500)]
        capture_result = {"status_flag_count": 0, "writer_queue_max_depth": 0}
        report = spike.build_report({"interval_secs": 0.1}, sweep, capture_result)
        self.assertEqual(report["verdict"]["recording_safety"], "ok")

    def test_capture_result_overflow_flags_yields_degraded(self):
        sweep = [self._entry(8, "float", 500)]
        capture_result = {"status_flag_count": 3, "writer_queue_max_depth": 0}
        report = spike.build_report({"interval_secs": 0.1}, sweep, capture_result)
        self.assertEqual(report["verdict"]["recording_safety"], "degraded")

    def test_capture_result_writer_queue_depth_yields_degraded(self):
        sweep = [self._entry(8, "float", 500)]
        capture_result = {"status_flag_count": 0, "writer_queue_max_depth": 4}
        report = spike.build_report({"interval_secs": 0.1}, sweep, capture_result)
        self.assertEqual(report["verdict"]["recording_safety"], "degraded")

    def test_degenerate_sweep_yields_insufficient_data_recommendation(self):
        sweep = [
            self._entry(8, "float", 500, degenerate=True),
            self._entry(32, "float", 2000, degenerate=True),
        ]
        report = spike.build_report({"interval_secs": 0.1}, sweep, capture_result=None)
        self.assertEqual(report["verdict"]["recommended_encoding"], "insufficient_data")
        self.assertFalse(report["verdict"]["mix_only"])
        self.assertFalse(report["verdict"]["per_input"])

    def test_empty_sweep_yields_insufficient_data(self):
        report = spike.build_report({"interval_secs": 0.1}, [], capture_result=None)
        self.assertEqual(report["verdict"]["recommended_encoding"], "insufficient_data")
        self.assertFalse(report["verdict"]["mix_only"])
        self.assertFalse(report["verdict"]["per_input"])


if __name__ == "__main__":
    unittest.main()
