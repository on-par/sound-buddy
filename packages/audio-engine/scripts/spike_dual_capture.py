#!/usr/bin/env python3
"""
Spike (#459): can Sound Buddy run a second live input stream (a measurement
mic) alongside the board multitrack capture on macOS?

Opens two concurrent `sd.InputStream`s and measures each stream's effective
sample rate, clock drift, and callback jitter from raw callback timestamps —
no audio is retained, only per-callback timing metadata. This is a decision
spike, not product code: see docs/adr/0003-secondary-audio-device-measurement.md
for the findings and recommendation.

Usage:
  python3 spike_dual_capture.py --list-devices
  python3 spike_dual_capture.py [--primary DEV] [--secondary DEV] [--duration SECS]
                                [--allow-same-device] [--out PATH]

  --primary DEV   index or case-insensitive name substring of the "board" input
                  device (empty = first available input device)
  --secondary DEV index or case-insensitive name substring of the "measurement"
                  input device (empty = second available input device)
  --duration SECS how long to run both streams (default 60)
  --allow-same-device
                  permit opening two streams on the same device (useful when
                  only one input device is present)
  --out PATH      write the JSON findings report here (default: stdout)

Output: a single JSON findings document (see build_report) written to --out or
stdout. --list-devices prints {"devices": [...]} and exits, same shape as
stream.py's device enumeration.

Dependencies: pip install sounddevice (numpy/scipy are not needed — the
analysis helpers below are plain Python so they run without PortAudio).
"""

import sys
import json
import time
import signal
import argparse

# How long a run captures both streams by default (the issue's "sanity run"
# length; the 10-30 min drift window is a separate, explicit --duration).
DEFAULT_DURATION_SECS = 60

# Relative inter-stream drift above which the ADR recommends surfacing a
# user-visible warning (≈45 ms over a 30-minute service — the issue's
# "misleading measurement accuracy" threshold).
DRIFT_WARN_PPM = 25.0

# The issue's 10-30 minute range: relative drift is projected at both, in
# seconds, so a spike run can extrapolate without actually running that long.
PROJECTION_WINDOWS_SECS = (600, 1800)


# ─── Pure helpers (no numpy/sounddevice — testable on any host) ────────────

def pick_device_pair(devices: list[dict], primary_arg: str, secondary_arg: str,
                     allow_same: bool = False) -> tuple[dict, dict]:
    """
    Resolve the primary ("board") and secondary ("measurement") input devices
    from a device list shaped like stream.py's `_enumerate_devices` output
    (dicts with `index`, `name`, `channels`, `default_sr`).

    Each arg is resolved by exact device index or case-insensitive name
    substring (same semantics as stream.py:find_device); an empty arg picks
    the first / second available device. Raises ValueError with an actionable
    message when fewer than two distinct input devices exist and
    `allow_same` is False, or when an explicit arg doesn't match any device.
    """
    if not devices:
        raise ValueError(
            "no input devices found — connect an input device or create an "
            "Aggregate Device in Audio MIDI Setup"
        )
    if not allow_same and len(devices) < 2:
        raise ValueError(
            f"only {len(devices)} input device found — connect a second input "
            "device, create an Aggregate Device in Audio MIDI Setup, or pass "
            "--allow-same-device to open two streams on one device"
        )

    primary = _resolve_device_arg(primary_arg, devices)
    if primary_arg and primary is None:
        raise ValueError(f"device not found: {primary_arg}")
    if primary is None:
        primary = devices[0]

    secondary = _resolve_device_arg(secondary_arg, devices)
    if secondary_arg and secondary is None:
        raise ValueError(f"device not found: {secondary_arg}")
    if secondary is None:
        others = [d for d in devices if d["index"] != primary["index"]]
        secondary = others[0] if others else primary

    if primary["index"] == secondary["index"] and not allow_same:
        raise ValueError(
            "primary and secondary resolve to the same device — pass "
            "--allow-same-device to open two streams on one device, or choose "
            "two distinct input devices"
        )

    return primary, secondary


def _resolve_device_arg(arg: str, devices: list[dict]):
    """`arg` by exact `index` match, else case-insensitive name substring.
    Empty arg or no match returns None (caller decides default vs error)."""
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


def _lstsq_slope(xs: list[float], ys: list[float]) -> float:
    """Least-squares slope of ys vs xs, plain Python (no numpy). Returns 0.0
    when there are fewer than two points or xs are degenerate (no spread)."""
    n = len(xs)
    if n < 2:
        return 0.0
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    num = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
    den = sum((x - mean_x) ** 2 for x in xs)
    if den == 0:
        return 0.0
    return num / den


def _percentile(sorted_vals: list[float], pct: float) -> float:
    """Linear-interpolated percentile of an already-sorted list. 0.0 for an
    empty list."""
    if not sorted_vals:
        return 0.0
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    rank = (len(sorted_vals) - 1) * (pct / 100.0)
    lo = int(rank)
    hi = min(lo + 1, len(sorted_vals) - 1)
    frac = rank - lo
    return sorted_vals[lo] * (1 - frac) + sorted_vals[hi] * frac


def compute_stream_stats(events: list[dict], nominal_sr: float) -> dict:
    """
    Per-stream timing stats from raw callback events, each shaped
    `{"host_time": float, "adc_time": float, "current_time": float,
    "frames": int, "flags": str}` (host_time from `time.monotonic()` in the
    callback; adc/current from PortAudio's `time_info`).

    Effective sample rate is the least-squares slope of cumulative frames vs
    host_time — a robust rate estimate that doesn't depend on any single
    callback's timing. drift_ppm is the deviation from `nominal_sr` in parts
    per million. Degenerate input (0 or 1 events) returns a well-formed dict
    with zeroed rate/drift/jitter fields rather than raising.
    """
    event_count = len(events)
    total_frames = sum(e["frames"] for e in events)
    duration_secs = (events[-1]["host_time"] - events[0]["host_time"]) if event_count >= 2 else 0.0
    status_flag_count = sum(1 for e in events if e.get("flags"))

    host_times = [e["host_time"] for e in events]
    cumulative = []
    running = 0
    for e in events:
        running += e["frames"]
        cumulative.append(running)
    effective_sr = _lstsq_slope(host_times, cumulative)
    drift_ppm = ((effective_sr - nominal_sr) / nominal_sr * 1e6) if effective_sr else 0.0

    gaps_ms = [
        (host_times[i + 1] - host_times[i]) * 1000.0 for i in range(len(host_times) - 1)
    ]
    gaps_ms.sort()
    jitter_ms = {
        "p50": _percentile(gaps_ms, 50),
        "p95": _percentile(gaps_ms, 95),
        "max": (gaps_ms[-1] if gaps_ms else 0.0),
    }

    return {
        "event_count": event_count,
        "total_frames": total_frames,
        "duration_secs": duration_secs,
        "effective_sample_rate": effective_sr,
        "drift_ppm": drift_ppm,
        "jitter_ms": jitter_ms,
        "status_flag_count": status_flag_count,
    }


def compute_relative_drift(stats_a: dict, stats_b: dict) -> dict:
    """
    Relative clock drift (b vs a, in ppm) and the projected inter-stream
    offset in ms at each of `PROJECTION_WINDOWS_SECS`, plus a verdict
    ("warn" when the magnitude reaches `DRIFT_WARN_PPM`, else "ok").

    A ppm drift is a fractional rate error, so the projected offset in
    seconds after `window_secs` is simply `relative_ppm * 1e-6 * window_secs`.
    """
    relative_ppm = stats_b["drift_ppm"] - stats_a["drift_ppm"]
    projections = [
        {
            "window_secs": window_secs,
            "offset_ms": relative_ppm * 1e-6 * window_secs * 1000.0,
        }
        for window_secs in PROJECTION_WINDOWS_SECS
    ]
    verdict = "warn" if abs(relative_ppm) >= DRIFT_WARN_PPM else "ok"
    return {
        "relative_ppm": relative_ppm,
        "projections": projections,
        "verdict": verdict,
    }


def build_report(device_a: dict, device_b: dict, stats_a: dict, stats_b: dict,
                 relative: dict, events_log: list[dict]) -> dict:
    """
    Assemble the final JSON findings document — the reproducible artifact the
    ADR quotes. `both_streams_ran` is False if any lifecycle event is an
    "error" or "disconnect" (a killed/degraded run is still a valid finding,
    not a crash — see spec's disconnect-behavior-is-a-finding note).
    """
    def _device_entry(d: dict) -> dict:
        return {
            "name": d["name"],
            "index": d["index"],
            "channels": d["channels"],
            "nominal_sample_rate": d["default_sr"],
        }

    both_streams_ran = not any(e.get("type") in ("error", "disconnect") for e in events_log)

    return {
        "devices": {"a": _device_entry(device_a), "b": _device_entry(device_b)},
        "stats": {"a": stats_a, "b": stats_b},
        "relative_drift": relative,
        "lifecycle_events": events_log,
        "both_streams_ran": both_streams_ran,
    }


# ─── Runtime (hardware-bound — thin, logic-free; sounddevice imported lazily) ─

def _enumerate_input_devices(sd) -> list[dict]:
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


def _run_stream(sd, device: dict, events: list, events_log: list, label: str, stop_flag: dict):
    """Open one InputStream on `device`, appending a timing record per
    callback to `events` until `stop_flag["stop"]` is set. Only timestamps and
    the frame count are copied — no audio is retained; this spike measures
    clocks, not content. A stream error (including device disappearance) is
    caught, logged as a lifecycle event, and does not raise — the caller still
    finalizes a report."""
    events_log.append({"type": "start", "label": label, "ts": time.time()})

    def callback(indata, frames, time_info, status):
        events.append({
            "host_time": time.monotonic(),
            "adc_time": getattr(time_info, "inputBufferAdcTime", 0.0),
            "current_time": getattr(time_info, "currentTime", 0.0),
            "frames": frames,
            "flags": str(status) if status else "",
        })

    try:
        with sd.InputStream(
            device=device["index"], channels=1, samplerate=device["default_sr"],
            dtype="float32", callback=callback,
        ):
            while not stop_flag["stop"]:
                time.sleep(0.05)
        events_log.append({"type": "stop", "label": label, "ts": time.time()})
    except Exception as e:
        events_log.append({
            "type": "error", "label": label, "ts": time.time(), "detail": str(e),
        })


def run_dual_capture(sd, device_a: dict, device_b: dict, duration_secs: float) -> dict:
    """Open both streams concurrently (one background thread per stream),
    run for `duration_secs`, then build and return the findings report."""
    import threading

    events_a: list = []
    events_b: list = []
    events_log: list = []
    stop_flag = {"stop": False}

    def _on_signal(*_args):
        stop_flag["stop"] = True

    signal.signal(signal.SIGTERM, _on_signal)
    signal.signal(signal.SIGINT, _on_signal)

    thread_a = threading.Thread(
        target=_run_stream, args=(sd, device_a, events_a, events_log, "board", stop_flag)
    )
    thread_b = threading.Thread(
        target=_run_stream, args=(sd, device_b, events_b, events_log, "measurement", stop_flag)
    )
    thread_a.start()
    thread_b.start()

    deadline = time.monotonic() + duration_secs
    while time.monotonic() < deadline and not stop_flag["stop"]:
        time.sleep(0.1)
    stop_flag["stop"] = True

    thread_a.join(timeout=5.0)
    thread_b.join(timeout=5.0)

    stats_a = compute_stream_stats(events_a, device_a["default_sr"])
    stats_b = compute_stream_stats(events_b, device_b["default_sr"])
    relative = compute_relative_drift(stats_a, stats_b)
    return build_report(device_a, device_b, stats_a, stats_b, relative, events_log)


def main():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--list-devices", action="store_true")
    parser.add_argument("--primary", default="")
    parser.add_argument("--secondary", default="")
    parser.add_argument("--duration", type=float, default=DEFAULT_DURATION_SECS)
    parser.add_argument("--allow-same-device", action="store_true")
    parser.add_argument("--out", default=None)
    args = parser.parse_args()

    try:
        import sounddevice as sd
    except ImportError as e:
        print(json.dumps({"error": f"missing dependency: {e}"}), flush=True)
        sys.exit(1)

    devices = _enumerate_input_devices(sd)

    if args.list_devices:
        print(json.dumps({"devices": devices}), flush=True)
        return

    try:
        device_a, device_b = pick_device_pair(
            devices, args.primary, args.secondary, allow_same=args.allow_same_device
        )
    except ValueError as e:
        print(json.dumps({"error": str(e)}), flush=True)
        sys.exit(1)

    report = run_dual_capture(sd, device_a, device_b, args.duration)
    output = json.dumps(report, indent=2)
    if args.out:
        with open(args.out, "w") as f:
            f.write(output)
    else:
        print(output, flush=True)

    if not report["both_streams_ran"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
