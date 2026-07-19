#!/usr/bin/env python3
"""
Spike (#519): can Sound Buddy stream downsampled waveform peak data (overall
mix + per-input lanes) from the Python capture process to the renderer at
interactive rates, without disturbing monitoring or recording?

Measures three NDJSON peak-frame encodings (float, u8-quantized, base64-packed
u8) under a synthetic multi-strip sweep, and (on a rig with input hardware)
the recording-safety cost of running a peak-emitting loop alongside a real
capture. This is a decision spike, not product code: see
docs/adr/0004-waveform-peak-transport.md for the findings and recommendation.
No changes to stream.py, live-capture.ts, or the renderer.

Usage:
  python3 spike_waveform_transport.py --list-devices
  python3 spike_waveform_transport.py --synthetic [--duration SECS] [--interval SECS]
                                      [--buckets-per-sec N] [--emit] [--out PATH]
  python3 spike_waveform_transport.py --device DEV [--record-dir PATH]
                                      [--duration SECS] [--interval SECS] [--out PATH]

  --list-devices    print {"devices": [...]} (input devices only) and exit
  --synthetic       run the strip-count x encoder sweep against numpy-generated
                     noise (no hardware required)
  --device DEV      real-capture mode: index or case-insensitive name substring
                     of the input device to open
  --record-dir PATH in real-capture mode, also write PCM_24 stems (mirrors
                     stream.py's --session-dir, minimal — one file per channel)
  --duration SECS   how long each synthetic sweep entry / the real capture runs
                     (default 60)
  --interval SECS   meter cadence in seconds (default 0.1, matches stream.py)
  --buckets-per-sec N
                     waveform bucket rate (default 50, i.e. one min/max pair
                     per 20ms of audio)
  --emit            in --synthetic mode, actually write encoded frame lines to
                     stdout (default: count bytes without emitting, so a sweep
                     doesn't flood the terminal)
  --out PATH        write the JSON findings report here (default: stdout)

Output: a single JSON findings document (see build_report) written to --out or
stdout. --list-devices prints {"devices": [...]} and exits, same shape as
stream.py's device enumeration.

Dependencies: pip install sounddevice numpy soundfile (numpy is required for
--synthetic and --device; the pure helpers below have no numpy/sounddevice
dependency and run on any python3 — see test_spike_waveform_transport.py).
"""

import sys
import json
import time
import base64
import signal
import argparse

# M32R USB default sample rate.
NOMINAL_SAMPLE_RATE = 48000
# Matches stream.py's meter cadence (scripts/stream.py --interval default).
DEFAULT_METER_INTERVAL_SECS = 0.1
# One min/max pair per 20ms of audio.
WAVEFORM_BUCKETS_PER_SEC = 50
# Per-input lane counts to sweep (+1 mix lane each).
STRIP_COUNTS = (8, 16, 32)
# Sanity-run length; the issue's 10-min run is --duration 600.
DEFAULT_DURATION_SECS = 60
# u8 quantization of a peak value in [-1.0, 1.0].
QUANT_LEVELS = 256

# ─── Verdict thresholds (see transport_ok / build_report) ──────────────────

# Produce+encode CPU must fit in this fraction of one meter interval.
TICK_BUDGET_FRACTION = 0.2
# NDJSON-over-stdout budget for peak frames (the existing live-event path).
MAX_PAYLOAD_BYTES_PER_SEC = 256 * 1024

# Gaps larger than this multiple of the nominal interval count as "late" —
# the same resync condition stream.py's meter loop would hit (stream.py:590).
LATE_TICK_GAP_MULTIPLE = 1.5


# ─── Pure helpers (plain Python only — no numpy/sounddevice — testable on any host) ─

def bucket_peaks(samples: list, buckets: int) -> list:
    """
    Split `samples` into `buckets` contiguous slices (the last bucket takes
    any remainder from integer division) and return a (min, max) tuple per
    slice. Empty input or `buckets <= 0` returns [].
    """
    if not samples or buckets <= 0:
        return []
    n = len(samples)
    base = n // buckets
    result = []
    idx = 0
    for i in range(buckets):
        if i == buckets - 1:
            chunk = samples[idx:]
        else:
            chunk = samples[idx:idx + base]
            idx += base
        if not chunk:
            continue
        result.append((min(chunk), max(chunk)))
    return result


def quantize_peak(value: float) -> int:
    """Map a peak value in [-1.0, 1.0] to a u8 level in [0, QUANT_LEVELS-1]
    (0.0 -> 128), clamping out-of-range input."""
    clamped = max(-1.0, min(1.0, value))
    return round((clamped + 1.0) * (QUANT_LEVELS - 1) / 2.0)


def dequantize_peak(level: int) -> float:
    """Inverse of quantize_peak — maps a u8 level back to [-1.0, 1.0]."""
    return (level / (QUANT_LEVELS - 1)) * 2.0 - 1.0


def encode_frame_float(lanes: list, ts: float) -> str:
    """Candidate A: plain-float NDJSON line, values rounded to 3 decimals."""
    out_lanes = []
    for lane in lanes:
        out_lanes.append({
            "id": lane["id"],
            "min": [round(mn, 3) for mn, _mx in lane["peaks"]],
            "max": [round(mx, 3) for _mn, mx in lane["peaks"]],
        })
    return json.dumps({"type": "peaks", "ts": ts, "lanes": out_lanes})


def encode_frame_u8(lanes: list, ts: float) -> str:
    """Candidate B: same shape as encode_frame_float, min/max quantized to u8 ints."""
    out_lanes = []
    for lane in lanes:
        out_lanes.append({
            "id": lane["id"],
            "min": [quantize_peak(mn) for mn, _mx in lane["peaks"]],
            "max": [quantize_peak(mx) for _mn, mx in lane["peaks"]],
        })
    return json.dumps({"type": "peaks", "ts": ts, "lanes": out_lanes})


def encode_frame_b64(lanes: list, ts: float) -> str:
    """Candidate C: per lane, one base64 string packing interleaved u8
    min/max bytes (min0, max0, min1, max1, ...)."""
    out_lanes = []
    for lane in lanes:
        packed = bytes(
            b
            for mn, mx in lane["peaks"]
            for b in (quantize_peak(mn), quantize_peak(mx))
        )
        out_lanes.append({
            "id": lane["id"],
            "data": base64.b64encode(packed).decode("ascii"),
        })
    return json.dumps({"type": "peaks", "ts": ts, "lanes": out_lanes})


def _percentile(sorted_vals: list, pct: float) -> float:
    """Linear-interpolated percentile of an already-sorted list. 0.0 for an
    empty list. Copied from spike_dual_capture.py (#459) rather than
    imported, keeping this spike free of cross-file imports."""
    if not sorted_vals:
        return 0.0
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    rank = (len(sorted_vals) - 1) * (pct / 100.0)
    lo = int(rank)
    hi = min(lo + 1, len(sorted_vals) - 1)
    frac = rank - lo
    return sorted_vals[lo] * (1 - frac) + sorted_vals[hi] * frac


def compute_cadence_stats(tick_records: list, nominal_interval_secs: float = DEFAULT_METER_INTERVAL_SECS) -> dict:
    """
    Per-run cadence stats from tick records, each shaped
    `{"host_time": float, "cpu_ms": float, "bytes": int}` (one entry per
    meter tick that produced+encoded a peak frame).

    `late_ticks` counts inter-tick gaps exceeding `LATE_TICK_GAP_MULTIPLE`
    times `nominal_interval_secs` — the same resync condition stream.py's
    meter loop hits (stream.py:590), i.e. the monitoring-disturbance proxy.

    Degenerate input (<2 ticks) returns a well-formed dict with zeroed
    fields and `"degenerate": True`, mirroring compute_stream_stats in the
    #459 spike.
    """
    tick_count = len(tick_records)
    if tick_count < 2:
        return {
            "tick_count": tick_count,
            "duration_secs": 0.0,
            "ticks_per_sec": 0.0,
            "gap_ms": {"p50": 0.0, "p95": 0.0, "max": 0.0},
            "late_ticks": 0,
            "cpu_ms": {"p50": 0.0, "p95": 0.0, "max": 0.0},
            "cpu_utilization": 0.0,
            "bytes_per_sec": 0.0,
            "degenerate": True,
        }

    host_times = [r["host_time"] for r in tick_records]
    duration_secs = host_times[-1] - host_times[0]
    ticks_per_sec = (tick_count - 1) / duration_secs if duration_secs > 0 else 0.0

    gaps_secs = [host_times[i + 1] - host_times[i] for i in range(len(host_times) - 1)]
    gaps_ms_sorted = sorted(g * 1000.0 for g in gaps_secs)
    gap_ms = {
        "p50": _percentile(gaps_ms_sorted, 50),
        "p95": _percentile(gaps_ms_sorted, 95),
        "max": gaps_ms_sorted[-1] if gaps_ms_sorted else 0.0,
    }
    late_threshold_secs = LATE_TICK_GAP_MULTIPLE * nominal_interval_secs
    late_ticks = sum(1 for g in gaps_secs if g > late_threshold_secs)

    cpu_ms_sorted = sorted(r["cpu_ms"] for r in tick_records)
    cpu_ms_stats = {
        "p50": _percentile(cpu_ms_sorted, 50),
        "p95": _percentile(cpu_ms_sorted, 95),
        "max": cpu_ms_sorted[-1] if cpu_ms_sorted else 0.0,
    }
    total_cpu_secs = sum(r["cpu_ms"] for r in tick_records) / 1000.0
    cpu_utilization = total_cpu_secs / duration_secs if duration_secs > 0 else 0.0

    total_bytes = sum(r["bytes"] for r in tick_records)
    bytes_per_sec = total_bytes / duration_secs if duration_secs > 0 else 0.0

    return {
        "tick_count": tick_count,
        "duration_secs": duration_secs,
        "ticks_per_sec": ticks_per_sec,
        "gap_ms": gap_ms,
        "late_ticks": late_ticks,
        "cpu_ms": cpu_ms_stats,
        "cpu_utilization": cpu_utilization,
        "bytes_per_sec": bytes_per_sec,
        "degenerate": False,
    }


def transport_ok(entry: dict, interval_secs: float) -> bool:
    """
    A sweep entry (shaped `{"cadence": <compute_cadence_stats output>, ...}`)
    is transport-ok when its cadence is not degenerate, no ticks came in
    late (no monitoring-disturbing resync events), per-tick CPU p95 fits in
    `TICK_BUDGET_FRACTION` of one meter interval, and the payload rate stays
    under `MAX_PAYLOAD_BYTES_PER_SEC`.
    """
    cadence = entry["cadence"]
    if cadence.get("degenerate"):
        return False
    if cadence["late_ticks"] != 0:
        return False
    budget_ms = TICK_BUDGET_FRACTION * interval_secs * 1000.0
    if cadence["cpu_ms"]["p95"] > budget_ms:
        return False
    if cadence["bytes_per_sec"] > MAX_PAYLOAD_BYTES_PER_SEC:
        return False
    return True


def build_report(config: dict, sweep_results: list, capture_result) -> dict:
    """
    Assemble the findings JSON — the reproducible artifact the ADR quotes.

    `sweep_results` is one entry per strip count x encoder combination, each
    shaped `{"strips": int, "encoding": str, "cadence": {...}, "bytes_per_frame": float}`.

    verdict.mix_only reflects whether the smallest sweep (fewest lanes, a
    conservative proxy for a true 1-lane mix-only payload — see #519 spec)
    passes; verdict.per_input reflects whether the largest sweep (all
    STRIP_COUNTS + mix) passes; verdict.recommended_encoding is, among
    encoders whose largest-sweep entry passes, the one with the fewest
    bytes_per_frame ("insufficient_data" if none pass or the sweep is empty).

    `capture_result` is None on hardware-less hosts (verdict.recording_safety
    = "pending_real_rig"); otherwise "degraded" if PortAudio reported any
    status-flag events or the writer queue's max depth grew above zero
    (backpressure/overflow), else "ok".
    """
    interval_secs = config.get("interval_secs", DEFAULT_METER_INTERVAL_SECS)

    annotated = [
        {**entry, "transport_ok": transport_ok(entry, interval_secs)}
        for entry in sweep_results
    ]

    if not annotated:
        mix_only = False
        per_input = False
        recommended_encoding = "insufficient_data"
    else:
        strip_counts = sorted({e["strips"] for e in annotated})
        smallest_entries = [e for e in annotated if e["strips"] == strip_counts[0]]
        largest_entries = [e for e in annotated if e["strips"] == strip_counts[-1]]

        mix_only = any(e["transport_ok"] for e in smallest_entries)
        per_input = any(e["transport_ok"] for e in largest_entries)

        passing_largest = [e for e in largest_entries if e["transport_ok"]]
        if passing_largest:
            recommended_encoding = min(passing_largest, key=lambda e: e["bytes_per_frame"])["encoding"]
        else:
            recommended_encoding = "insufficient_data"

    if capture_result is None:
        recording_safety = "pending_real_rig"
    else:
        overflow_flags = capture_result.get("status_flag_count", 0)
        writer_queue_max_depth = capture_result.get("writer_queue_max_depth", 0)
        recording_safety = "degraded" if (overflow_flags > 0 or writer_queue_max_depth > 0) else "ok"

    return {
        "config": config,
        "sweep": annotated,
        "verdict": {
            "mix_only": mix_only,
            "per_input": per_input,
            "recommended_encoding": recommended_encoding,
            "recording_safety": recording_safety,
        },
    }


# ─── Runtime (hardware/numpy-bound — thin, logic-free; imported lazily) ────

ENCODERS = {
    "float": encode_frame_float,
    "u8": encode_frame_u8,
    "b64": encode_frame_b64,
}


def _enumerate_input_devices(sd) -> list:
    """Copy of stream.py:_enumerate_devices's walk (input devices only) —
    copied rather than imported so this spike has no product-code dependency."""
    devs = sd.query_devices()
    out = []
    for i, d in enumerate(devs):
        if d["max_input_channels"] > 0:
            out.append({
                "index": i,
                "name": d["name"],
                "channels": d["max_input_channels"],
                "default_sr": int(d["default_samplerate"]),
            })
    return out


def _run_synthetic_sweep_entry(np, strips: int, encoding: str, duration_secs: float,
                                interval_secs: float, buckets_per_sec: int, emit: bool) -> dict:
    """
    Paced synthetic loop for one (strip count, encoder) combination: every
    `interval_secs`, generate one interval's worth of noise for `strips`
    channels + the mix, bucket to min/max peaks, encode, and record
    host_time/cpu_ms/bytes for one tick — using the same next_tick += interval
    / resync-instead-of-catch-up pacing as stream.py:586-595.
    """
    encoder = ENCODERS[encoding]
    n_samples = max(1, round(NOMINAL_SAMPLE_RATE * interval_secs))
    buckets = max(1, round(buckets_per_sec * interval_secs))
    lane_ids = ["mix"] + [f"strip{i}" for i in range(strips)]

    tick_records = []
    deadline = time.monotonic() + duration_secs
    next_tick = time.monotonic()

    while time.monotonic() < deadline:
        next_tick += interval_secs
        now = time.monotonic()
        if now - next_tick > interval_secs:
            next_tick = now
        sleep = next_tick - now
        if sleep > 0:
            time.sleep(sleep)

        cpu_start = time.process_time()

        frames = np.random.uniform(-1.0, 1.0, size=(n_samples, strips)).astype("float32")
        mix = frames.mean(axis=1)

        lanes = []
        for lane_id, channel in zip(lane_ids, [mix] + [frames[:, i] for i in range(strips)]):
            reshaped = channel[: buckets * (len(channel) // buckets)].reshape(buckets, -1)
            if reshaped.size == 0:
                peaks = []
            else:
                mins = reshaped.min(axis=1)
                maxs = reshaped.max(axis=1)
                peaks = list(zip((float(v) for v in mins), (float(v) for v in maxs)))
            lanes.append({"id": lane_id, "peaks": peaks})

        line = encoder(lanes, time.time())
        cpu_ms = (time.process_time() - cpu_start) * 1000.0

        if emit:
            sys.stdout.write(line + "\n")
            sys.stdout.flush()

        tick_records.append({
            "host_time": time.monotonic(),
            "cpu_ms": cpu_ms,
            "bytes": len(line.encode("utf-8")),
        })

    cadence = compute_cadence_stats(tick_records, nominal_interval_secs=interval_secs)
    bytes_per_frame = (
        cadence["bytes_per_sec"] / cadence["ticks_per_sec"]
        if cadence["ticks_per_sec"] > 0 else 0.0
    )
    return {
        "strips": strips,
        "encoding": encoding,
        "cadence": cadence,
        "bytes_per_frame": bytes_per_frame,
    }


def run_synthetic_sweep(duration_secs: float, interval_secs: float, buckets_per_sec: int, emit: bool) -> dict:
    """Sweep STRIP_COUNTS x every encoder, each combination run for
    `duration_secs`, and assemble the findings report (capture_result=None —
    synthetic mode never touches real hardware)."""
    import numpy as np

    sweep_results = []
    for strips in STRIP_COUNTS:
        for encoding in ENCODERS:
            sweep_results.append(
                _run_synthetic_sweep_entry(np, strips, encoding, duration_secs, interval_secs, buckets_per_sec, emit)
            )

    config = {
        "mode": "synthetic",
        "interval_secs": interval_secs,
        "buckets_per_sec": buckets_per_sec,
        "duration_secs": duration_secs,
        "strip_counts": list(STRIP_COUNTS),
        "sample_rate": NOMINAL_SAMPLE_RATE,
    }
    return build_report(config, sweep_results, capture_result=None)


def run_real_capture(sd, np, device: dict, duration_secs: float, interval_secs: float,
                      buckets_per_sec: int, record_dir) -> dict:
    """
    Real-device mode: mirror stream.py's architecture — an InputStream
    callback enqueues raw blocks onto a queue.Queue, a writer thread drains
    them (optionally to PCM_24 stems via soundfile when `record_dir` is set),
    while the main loop emits u8-encoded peak frames each interval from the
    trailing blocks. PortAudio status flags and the writer queue's max depth
    feed capture_result (recording-safety verdict). SIGTERM/SIGINT finalize
    stems then still produce a report, mirroring SessionRecorder.finalize's
    idempotent design.
    """
    import queue
    import threading

    n_channels = device["channels"]
    sample_rate = device["default_sr"]
    q: "queue.Queue" = queue.Queue()
    status_flag_count = {"n": 0}
    writer_queue_max_depth = {"n": 0}
    stop_flag = {"stop": False}
    blocks: list = []

    writers = []
    if record_dir is not None:
        import os
        import soundfile as sf
        os.makedirs(record_dir, exist_ok=True)
        for ch in range(n_channels):
            writers.append(sf.SoundFile(
                os.path.join(record_dir, f"ch{ch}.wav"),
                mode="w", samplerate=sample_rate, channels=1, subtype="PCM_24",
            ))

    def audio_callback(indata, frames, time_info, status):
        if status:
            status_flag_count["n"] += 1
        q.put(indata.copy())
        blocks.append(indata.copy())
        writer_queue_max_depth["n"] = max(writer_queue_max_depth["n"], q.qsize())

    def writer_loop():
        while not stop_flag["stop"] or not q.empty():
            try:
                block = q.get(timeout=0.1)
            except queue.Empty:
                continue
            for ch, writer in enumerate(writers):
                writer.write(block[:, ch])

    def _on_signal(*_args):
        stop_flag["stop"] = True

    signal.signal(signal.SIGTERM, _on_signal)
    signal.signal(signal.SIGINT, _on_signal)

    writer_thread = threading.Thread(target=writer_loop)
    writer_thread.start()

    tick_records = []
    n_samples = max(1, round(sample_rate * interval_secs))
    buckets = max(1, round(buckets_per_sec * interval_secs))

    with sd.InputStream(
        device=device["index"], channels=n_channels, samplerate=sample_rate,
        dtype="float32", callback=audio_callback,
    ):
        deadline = time.monotonic() + duration_secs
        next_tick = time.monotonic()
        while time.monotonic() < deadline and not stop_flag["stop"]:
            next_tick += interval_secs
            now = time.monotonic()
            if now - next_tick > interval_secs:
                next_tick = now
            sleep = next_tick - now
            if sleep > 0:
                time.sleep(sleep)

            cpu_start = time.process_time()
            total = sum(b.shape[0] for b in blocks)
            if total < n_samples:
                continue
            recent = blocks[-1]
            trailing_len = min(recent.shape[0], n_samples)
            trailing = recent[-trailing_len:]

            lane_ids = ["mix"] + [f"strip{i}" for i in range(n_channels)]
            mix = trailing.mean(axis=1)
            lanes = []
            for lane_id, channel in zip(lane_ids, [mix] + [trailing[:, i] for i in range(n_channels)]):
                reshaped = channel[: buckets * (len(channel) // buckets)].reshape(buckets, -1) if len(channel) >= buckets else channel.reshape(0, 0)
                if reshaped.size == 0:
                    peaks = []
                else:
                    mins = reshaped.min(axis=1)
                    maxs = reshaped.max(axis=1)
                    peaks = list(zip((float(v) for v in mins), (float(v) for v in maxs)))
                lanes.append({"id": lane_id, "peaks": peaks})

            line = encode_frame_u8(lanes, time.time())
            cpu_ms = (time.process_time() - cpu_start) * 1000.0
            tick_records.append({
                "host_time": time.monotonic(),
                "cpu_ms": cpu_ms,
                "bytes": len(line.encode("utf-8")),
            })

    stop_flag["stop"] = True
    writer_thread.join(timeout=5.0)
    for writer in writers:
        writer.close()

    cadence = compute_cadence_stats(tick_records, nominal_interval_secs=interval_secs)
    bytes_per_frame = (
        cadence["bytes_per_sec"] / cadence["ticks_per_sec"]
        if cadence["ticks_per_sec"] > 0 else 0.0
    )
    sweep_results = [{
        "strips": n_channels,
        "encoding": "u8",
        "cadence": cadence,
        "bytes_per_frame": bytes_per_frame,
    }]
    config = {
        "mode": "real",
        "interval_secs": interval_secs,
        "buckets_per_sec": buckets_per_sec,
        "duration_secs": duration_secs,
        "device": device["name"],
        "sample_rate": sample_rate,
    }
    capture_result = {
        "status_flag_count": status_flag_count["n"],
        "writer_queue_max_depth": writer_queue_max_depth["n"],
    }
    return build_report(config, sweep_results, capture_result)


def _resolve_device_arg(arg: str, devices: list):
    """`arg` by exact `index` match, else case-insensitive name substring."""
    if not arg:
        return None
    try:
        idx = int(arg)
    except ValueError:
        idx = None
    if idx is not None:
        for d in devices:
            if d["index"] == idx:
                return d
        return None
    lower = arg.lower()
    for d in devices:
        if lower in d["name"].lower():
            return d
    return None


def main():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--list-devices", action="store_true")
    parser.add_argument("--synthetic", action="store_true")
    parser.add_argument("--device", default="")
    parser.add_argument("--record-dir", default=None)
    parser.add_argument("--duration", type=float, default=DEFAULT_DURATION_SECS)
    parser.add_argument("--interval", type=float, default=DEFAULT_METER_INTERVAL_SECS)
    parser.add_argument("--buckets-per-sec", type=int, default=WAVEFORM_BUCKETS_PER_SEC)
    parser.add_argument("--emit", action="store_true")
    parser.add_argument("--out", default=None)
    args = parser.parse_args()

    def _write(report: dict):
        output = json.dumps(report, indent=2)
        if args.out:
            with open(args.out, "w") as f:
                f.write(output)
        else:
            print(output, flush=True)

    if args.list_devices:
        try:
            import sounddevice as sd
        except ImportError as e:
            print(json.dumps({"error": f"missing dependency: {e}"}), flush=True)
            sys.exit(1)
        print(json.dumps({"devices": _enumerate_input_devices(sd)}), flush=True)
        return

    if args.synthetic:
        report = run_synthetic_sweep(args.duration, args.interval, args.buckets_per_sec, args.emit)
        _write(report)
        return

    try:
        import sounddevice as sd
        import numpy as np
    except ImportError as e:
        print(json.dumps({"error": f"missing dependency: {e}"}), flush=True)
        sys.exit(1)

    devices = _enumerate_input_devices(sd)
    if not devices:
        print(json.dumps({
            "error": "no input devices found — connect an input device or create "
                     "an Aggregate Device in Audio MIDI Setup"
        }), flush=True)
        sys.exit(1)

    device = _resolve_device_arg(args.device, devices) if args.device else devices[0]
    if args.device and device is None:
        print(json.dumps({"error": f"device not found: {args.device}"}), flush=True)
        sys.exit(1)

    report = run_real_capture(sd, np, device, args.duration, args.interval, args.buckets_per_sec, args.record_dir)
    _write(report)


if __name__ == "__main__":
    main()
