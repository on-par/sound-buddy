#!/usr/bin/env python3
"""
Live capture + real-time analysis.

Usage:
  python3 scripts/stream.py [device] [window_secs] [channels] [options]
  python3 scripts/stream.py --list-devices

Positional args (all optional):
  device        device name or index (empty = default input)
  window_secs   heavy analysis-window length in seconds (default 3.0)
  channels      channel configuration (see below; default = first ≤2 device channels)

Options:
  --interval S  meter cadence in seconds (default 0.1) — how often lightweight
                level/spectrum updates are emitted, independent of window_secs
  --record PATH write captured audio to a WAV at PATH (24-bit PCM, all device
                channels). Finalized on SIGINT/SIGTERM so a killed capture still
                yields a valid file.

Channel configuration grammar (comma-separated groups):
  N        a mono strip on device channel N
  N-M      a stereo strip on the device-channel pair N and M (metered as L+R mean)
  e.g. "0,1-2,4" → mono ch0, stereo pair ch1+ch2, mono ch4

Output: JSON lines on stdout.
  {"type":"meter",  "ts":…, "channels":[…]}                            — every --interval
  {"type":"window", "window":N, "ts":…, "channels":[…], "masking":[…]} — every window_secs
The "window" events carry the heavier context used by the (gated) LLM path.

Dependencies: pip install sounddevice numpy scipy soundfile
"""

import sys
import json
import time
import signal
import threading
import numpy as np
from collections import deque

try:
    import sounddevice as sd
    from scipy import signal as scipy_signal
except ImportError as e:
    print(json.dumps({"error": f"missing dependency: {e}"}), flush=True)
    sys.exit(1)

BANDS = [
    ("sub_bass",    20,    60),
    ("bass",        60,   250),
    ("low_mid",    250,   500),
    ("mid",        500,  2000),
    ("high_mid",  2000,  4000),
    ("presence",  4000,  6000),
    ("brilliance", 6000, 20000),
]

MASKING_THRESHOLD_DB = 3.0

# Shortest trailing slice a meter tick analyses. Long enough to resolve the
# sub-bass band (≈50 ms for 20 Hz) with margin; kept small so meters stay snappy.
METER_WINDOW_SECS = 0.2


def list_devices():
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
    print(json.dumps({"devices": out}), flush=True)


def find_device(name_or_index: str):
    devs = sd.query_devices()
    try:
        idx = int(name_or_index)
        if 0 <= idx < len(devs):
            return idx
    except ValueError:
        pass

    lower = name_or_index.lower()
    for i, d in enumerate(devs):
        if lower in d["name"].lower() and d["max_input_channels"] > 0:
            return i

    return None


def parse_channel_groups(channels_arg: str, n_device_channels: int) -> list[dict]:
    """
    Parse the channel-configuration grammar into a list of strip groups.

    Returns groups like {"kind": "mono"|"stereo", "indices": [i] | [l, r],
    "name": str}. Raises ValueError on malformed tokens or out-of-range indices.
    """
    if not channels_arg:
        indices = list(range(min(2, n_device_channels)))
        return [{"kind": "mono", "indices": [i], "name": f"CH{i+1:02d}"} for i in indices]

    groups: list[dict] = []
    for token in channels_arg.split(","):
        token = token.strip()
        if not token:
            continue
        if "-" in token:
            parts = token.split("-")
            if len(parts) != 2:
                raise ValueError(f"invalid stereo group: {token!r}")
            l, r = int(parts[0]), int(parts[1])
            groups.append({
                "kind": "stereo",
                "indices": [l, r],
                "name": f"CH{l+1:02d}+CH{r+1:02d}",
            })
        else:
            i = int(token)
            groups.append({"kind": "mono", "indices": [i], "name": f"CH{i+1:02d}"})

    for g in groups:
        for ci in g["indices"]:
            if ci < 0 or ci >= n_device_channels:
                raise ValueError(
                    f"device has {n_device_channels} channels; requested index {ci}"
                )
    return groups


def group_signal(frames: np.ndarray, group: dict) -> np.ndarray:
    """Collapse a group's device channels into one analysis signal (L+R mean)."""
    cols = frames[:, group["indices"]].astype(np.float64)
    if cols.shape[1] == 1:
        return cols[:, 0]
    return cols.mean(axis=1)


def compute_band_rms_db(freqs, power_spectrum, low, high):
    mask = (freqs >= low) & (freqs < high)
    if not np.any(mask):
        return -120.0
    band_power = np.mean(power_spectrum[mask])
    if band_power <= 0:
        return -120.0
    return float(10.0 * np.log10(band_power + 1e-12))


def analyze_signal(sig: np.ndarray, sample_rate: int) -> dict:
    """Per-strip acoustic metrics for one collapsed signal."""
    rms = float(np.sqrt(np.mean(sig ** 2))) if sig.size else 0.0
    peak = float(np.max(np.abs(sig))) if sig.size else 0.0
    clipping = bool(peak >= 0.999)

    rms_db = float(20.0 * np.log10(rms + 1e-12))
    peak_db = float(20.0 * np.log10(peak + 1e-12))

    # STFT power spectrum for band analysis. nperseg adapts to short meter
    # windows so a 0.2 s slice doesn't error out.
    nperseg = min(4096, sig.size)
    if nperseg >= 32:
        hop = max(1, nperseg // 4)
        freqs, _t, Zxx = scipy_signal.stft(
            sig, fs=sample_rate, nperseg=nperseg, noverlap=nperseg - hop
        )
        power = np.mean(np.abs(Zxx) ** 2, axis=1)
    else:
        freqs = np.array([0.0])
        power = np.array([0.0])

    bands = {name: compute_band_rms_db(freqs, power, low, high) for name, low, high in BANDS}

    power_nz = np.clip(power, 0, None)
    total_power = float(np.sum(power_nz))
    if total_power > 0:
        centroid = float(np.sum(freqs * power_nz) / total_power)
        cumulative = np.cumsum(power_nz)
        rolloff_idx = int(np.searchsorted(cumulative, 0.85 * total_power))
        rolloff = float(freqs[min(rolloff_idx, len(freqs) - 1)])
    else:
        centroid = 0.0
        rolloff = 0.0

    return {
        "bands": bands,
        "rms": rms_db,
        "peak": peak_db,
        "clipping": clipping,
        "centroid": centroid,
        "rolloff": rolloff,
    }


def analyze_groups(frames: np.ndarray, sample_rate: int, groups: list[dict]) -> list[dict]:
    """One channel entry per configured strip (mono channel or stereo pair)."""
    channels_out = []
    for g in groups:
        metrics = analyze_signal(group_signal(frames, g), sample_rate)
        channels_out.append({
            "index": g["indices"][0],
            "name": g["name"],
            "kind": g["kind"],
            **metrics,
        })
    return channels_out


def compute_masking(channels_out: list[dict]) -> list[dict]:
    """Pairs of strips within MASKING_THRESHOLD_DB in any band (potential masking)."""
    masking = []
    for band_name, _, _ in BANDS:
        for i in range(len(channels_out)):
            for j in range(i + 1, len(channels_out)):
                a = channels_out[i]["bands"][band_name]
                b = channels_out[j]["bands"][band_name]
                diff = abs(a - b)
                if diff <= MASKING_THRESHOLD_DB and max(a, b) > -60:
                    masking.append({
                        "band": band_name,
                        "channelA": channels_out[i]["name"],
                        "channelB": channels_out[j]["name"],
                        "diffDb": round(diff, 2),
                    })
    return masking


def stream_live(device_index, window_secs: float, groups: list[dict],
                interval_secs: float, record_path):
    dev_info = sd.query_devices(device_index)
    sample_rate = int(dev_info["default_samplerate"])
    n_device_channels = dev_info["max_input_channels"]

    window_samples = int(window_secs * sample_rate)
    meter_samples = max(1, int(METER_WINDOW_SECS * sample_rate))
    buffer = deque(maxlen=window_samples)
    lock = threading.Lock()

    # Optional recorder: all device channels, 24-bit PCM. Opened lazily so a
    # monitor-only run never touches the disk.
    recorder = None
    recorder_lock = threading.Lock()
    if record_path:
        import soundfile as sf
        recorder = sf.SoundFile(
            record_path, mode="w", samplerate=sample_rate,
            channels=n_device_channels, subtype="PCM_24",
        )

    stop = threading.Event()

    def finalize():
        stop.set()
        with recorder_lock:
            if recorder is not None and not recorder.closed:
                recorder.close()

    # Electron stops capture with SIGTERM; the default handler skips `finally`,
    # so register explicitly to guarantee the WAV header is finalized.
    def _on_signal(*_args):
        finalize()
        sys.exit(0)
    signal.signal(signal.SIGTERM, _on_signal)
    signal.signal(signal.SIGINT, _on_signal)

    def audio_callback(indata, frames, time_info, status):
        block = np.asarray(indata, dtype=np.float32)
        with lock:
            for frame in block:
                buffer.append(frame.copy())
        if recorder is not None:
            with recorder_lock:
                if not recorder.closed:
                    recorder.write(block)

    def trailing(n_samples: int) -> np.ndarray:
        with lock:
            if not buffer:
                return np.empty((0, n_device_channels), dtype=np.float32)
            data = np.array(list(buffer), dtype=np.float32)
        if data.shape[0] > n_samples:
            data = data[-n_samples:]
        return data

    with sd.InputStream(
        device=device_index,
        channels=n_device_channels,
        samplerate=sample_rate,
        dtype="float32",
        callback=audio_callback,
    ):
        window_counter = 0
        ticks_per_window = max(1, round(window_secs / interval_secs))
        tick = 0
        next_tick = time.monotonic()

        while not stop.is_set():
            next_tick += interval_secs
            sleep = next_tick - time.monotonic()
            if sleep > 0:
                time.sleep(sleep)

            frames = trailing(meter_samples)
            if frames.shape[0] < 2:
                continue

            # Lightweight meter tick — the real-time view.
            channels_out = analyze_groups(frames, sample_rate, groups)
            print(json.dumps({
                "type": "meter",
                "ts": time.time(),
                "channels": channels_out,
            }), flush=True)

            # Heavier window tick — trend context for the (gated) LLM path.
            tick += 1
            if tick >= ticks_per_window:
                tick = 0
                window_counter += 1
                win_frames = trailing(window_samples)
                win_channels = analyze_groups(win_frames, sample_rate, groups)
                print(json.dumps({
                    "type": "window",
                    "window": window_counter,
                    "ts": time.time(),
                    "channels": win_channels,
                    "masking": compute_masking(win_channels),
                }), flush=True)

    finalize()


def main():
    args = sys.argv[1:]

    if args and args[0] == "--list-devices":
        list_devices()
        return

    # Split optional flags from positional args.
    interval_secs = 0.1
    record_path = None
    positional: list[str] = []
    i = 0
    while i < len(args):
        a = args[i]
        if a == "--interval" and i + 1 < len(args):
            interval_secs = float(args[i + 1]); i += 2
        elif a == "--record" and i + 1 < len(args):
            record_path = args[i + 1]; i += 2
        else:
            positional.append(a); i += 1

    device_arg = positional[0] if len(positional) > 0 else ""
    window_secs = float(positional[1]) if len(positional) > 1 and positional[1] else 3.0
    channels_arg = positional[2] if len(positional) > 2 and positional[2] else ""

    if interval_secs <= 0:
        interval_secs = 0.1

    if device_arg:
        device_index = find_device(device_arg)
        if device_index is None:
            print(json.dumps({"error": f"device not found: {device_arg}"}), flush=True)
            sys.exit(1)
    else:
        device_index = sd.default.device[0]
        if device_index is None or device_index < 0:
            devs = sd.query_devices()
            device_index = next(
                (i for i, d in enumerate(devs) if d["max_input_channels"] > 0), None
            )
            if device_index is None:
                print(json.dumps({"error": "no input device found"}), flush=True)
                sys.exit(1)

    dev_info = sd.query_devices(device_index)
    n_device_channels = dev_info["max_input_channels"]

    try:
        groups = parse_channel_groups(channels_arg, n_device_channels)
    except ValueError as e:
        print(json.dumps({"error": str(e)}), flush=True)
        sys.exit(1)

    try:
        stream_live(device_index, window_secs, groups, interval_secs, record_path)
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
