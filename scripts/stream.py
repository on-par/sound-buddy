#!/usr/bin/env python3
"""
Usage: python3 scripts/stream.py [device_name_or_index] [window_secs] [channel_indices_comma_sep]
       python3 scripts/stream.py --list-devices

Outputs one JSON line per analysis window to stdout.

Dependencies: pip install sounddevice numpy scipy
"""

import sys
import json
import time
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


def compute_band_rms_db(freqs, power_spectrum, low, high):
    mask = (freqs >= low) & (freqs < high)
    if not np.any(mask):
        return -120.0
    band_power = np.mean(power_spectrum[mask])
    if band_power <= 0:
        return -120.0
    # power_spectrum is already |X|^2/N style; convert to dBFS assuming full-scale = 1.0
    return float(10.0 * np.log10(band_power + 1e-12))


def analyze_window(frames: np.ndarray, sample_rate: int, channel_indices: list[int], channel_names: list[str]) -> dict:
    """
    frames: shape (n_samples, n_device_channels) float32 in [-1, 1]
    """
    n_samples = frames.shape[0]
    n_fft = 4096
    hop = 1024

    channels_out = []

    for ci, ch_idx in enumerate(channel_indices):
        ch_name = channel_names[ci] if ci < len(channel_names) else f"CH{ch_idx+1:02d}"
        ch_data = frames[:, ch_idx].astype(np.float64)

        # Amplitude stats
        rms = float(np.sqrt(np.mean(ch_data ** 2)))
        peak = float(np.max(np.abs(ch_data)))
        clipping = bool(peak >= 0.999)

        rms_db = float(20.0 * np.log10(rms + 1e-12))
        peak_db = float(20.0 * np.log10(peak + 1e-12))

        # FFT via scipy to get power spectrum for band analysis
        freqs, t_stft, Zxx = scipy_signal.stft(ch_data, fs=sample_rate, nperseg=n_fft, noverlap=n_fft - hop)
        power = np.mean(np.abs(Zxx) ** 2, axis=1)

        bands = {}
        for band_name, low, high in BANDS:
            bands[band_name] = compute_band_rms_db(freqs, power, low, high)

        # Spectral centroid
        power_nz = power.copy()
        power_nz[power_nz < 0] = 0
        total_power = np.sum(power_nz)
        if total_power > 0:
            centroid = float(np.sum(freqs * power_nz) / total_power)
        else:
            centroid = 0.0

        # Spectral rolloff at 85%
        cumulative = np.cumsum(power_nz)
        rolloff_idx = np.searchsorted(cumulative, 0.85 * total_power)
        rolloff = float(freqs[min(rolloff_idx, len(freqs) - 1)])

        channels_out.append({
            "index": ch_idx,
            "name": ch_name,
            "bands": bands,
            "rms": rms_db,
            "peak": peak_db,
            "clipping": clipping,
            "centroid": centroid,
            "rolloff": rolloff,
        })

    # Masking pairs: channels within MASKING_THRESHOLD_DB in any band
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

    return {"channels": channels_out, "masking": masking}


def stream_live(device_index, window_secs: float, channel_indices: list[int], channel_names: list[str]):
    dev_info = sd.query_devices(device_index)
    sample_rate = int(dev_info["default_samplerate"])
    n_device_channels = dev_info["max_input_channels"]

    # Validate requested channels against device
    for ci in channel_indices:
        if ci >= n_device_channels:
            print(json.dumps({"error": f"device has only {n_device_channels} channels; requested index {ci}"}), flush=True)
            sys.exit(1)

    window_samples = int(window_secs * sample_rate)
    buffer = deque(maxlen=window_samples)
    lock = threading.Lock()
    window_counter = [0]
    ready_event = threading.Event()

    def audio_callback(indata, frames, time_info, status):
        with lock:
            for frame in indata:
                buffer.append(frame.copy())
            if len(buffer) >= window_samples:
                ready_event.set()

    with sd.InputStream(
        device=device_index,
        channels=n_device_channels,
        samplerate=sample_rate,
        dtype="float32",
        callback=audio_callback,
    ):
        while True:
            ready_event.wait()
            ready_event.clear()

            with lock:
                frames = np.array(list(buffer), dtype=np.float32)
                # Clear buffer so next window is fresh
                buffer.clear()

            window_counter[0] += 1
            result = analyze_window(frames, sample_rate, channel_indices, channel_names)
            out = {
                "window": window_counter[0],
                "ts": time.time(),
                "channels": result["channels"],
                "masking": result["masking"],
            }
            print(json.dumps(out), flush=True)


def main():
    args = sys.argv[1:]

    if args and args[0] == "--list-devices":
        list_devices()
        return

    device_arg = args[0] if len(args) > 0 else ""
    window_secs = float(args[1]) if len(args) > 1 and args[1] else 3.0
    channels_arg = args[2] if len(args) > 2 and args[2] else ""

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

    if channels_arg:
        channel_indices = [int(c.strip()) for c in channels_arg.split(",")]
    else:
        channel_indices = list(range(min(2, n_device_channels)))

    channel_names = [f"CH{i+1:02d}" for i in channel_indices]

    try:
        stream_live(device_index, window_secs, channel_indices, channel_names)
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
