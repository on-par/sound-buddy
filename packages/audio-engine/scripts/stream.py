#!/usr/bin/env python3
"""
Live capture + real-time analysis.

Usage:
  python3 scripts/stream.py [device] [window_secs] [channels] [options]
  python3 scripts/stream.py --list-devices
  python3 scripts/stream.py --list-output-devices

Positional args (all optional):
  device        device name or index (empty = default input)
  window_secs   heavy analysis-window length in seconds (default 3.0)
  channels      channel configuration (see below; default = first ≤2 device channels)

Options:
  --interval S  meter cadence in seconds (default 0.1) — how often lightweight
                level/spectrum updates are emitted, independent of window_secs
  --record PATH write captured audio to a single interleaved WAV at PATH (24-bit
                PCM, all device channels). Finalized on SIGINT/SIGTERM so a killed
                capture still yields a valid file.
  --session-dir PATH
                record a multitrack session into PATH: one 24-bit PCM stem WAV per
                armed strip (mono→1ch, stereo→2ch), demuxed from the device stream,
                plus a session.json manifest (see below). Finalized on SIGINT/SIGTERM.
  --arm TOKENS  which strips to record in a --session-dir session, as channel-config
                tokens matched against the configured strips (e.g. "0,2-3"). Defaults
                to all configured strips. Tokens not matching a configured strip error.
  --labels JSON JSON array of per-strip display labels aligned with the channels
                config (e.g. '["Kick","",""]'); "" = unlabeled. Used for stem
                filenames and session.json track labels.

Channel configuration grammar (comma-separated groups):
  N        a mono strip on device channel N
  N-M      a stereo strip on the device-channel pair N and M (metered as L+R mean)
  e.g. "0,1-2,4" → mono ch0, stereo pair ch1+ch2, mono ch4

session.json (written at the --session-dir root on finalize) is the multitrack
contract consumed downstream: { name, createdAt (UTC ISO-8601), sampleRate, tracks[] }
where each track carries { id, label, kind, sourceChannels, file, frames }. `file`
is relative to the session dir so the folder stays movable.

Output: JSON lines on stdout.
  {"type":"meter",  "ts":…, "channels":[…]}                            — every --interval
  {"type":"peaks",  "ts":…, "lanes":[{"id":"mix","data":"…"},{"id":"strip0","data":"…"},…]}
                                                                        — every --interval
  {"type":"window", "window":N, "ts":…, "channels":[…], "masking":[…]} — every window_secs
The "window" events carry the heavier context used by the (gated) LLM path. The
"peaks" events carry a base64-packed min/max waveform envelope for the DAW
workspace's mix lane plus one "strip{i}" lane per configured strip, in
configured order (#520, #521, ADR 0004).

Dependencies: pip install sounddevice numpy scipy soundfile
"""

from __future__ import annotations

import os
import re
import sys
import json
import time
import base64
import queue
import signal
import threading
import numpy as np
from collections import deque
from datetime import datetime, timezone

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

# How long a clip stays latched on the live meter after the last clipped sample,
# so a transient clip is visible rather than flashing for one meter slice.
CLIP_HOLD_SECS = 1.5

# Peak-envelope resolution for the DAW workspace's mix waveform lane (ADR 0004).
WAVEFORM_BUCKETS_PER_SEC = 50
# u8 quantization of a peak value in [-1.0, 1.0] for the peak transport (ADR 0004).
QUANT_LEVELS = 256


def _enumerate_devices(channel_key: str) -> list[dict]:
    """Devices exposing at least one channel on `channel_key`
    ("max_input_channels" or "max_output_channels"), reporting that count as
    `channels`. Input and output enumeration are mirror images over the same
    PortAudio device table, so they share this walk."""
    devs = sd.query_devices()
    out = []
    for i, d in enumerate(devs):
        if d[channel_key] > 0:
            out.append({
                "index": i,
                "name": d["name"],
                "channels": d[channel_key],
                "default_sr": int(d["default_samplerate"]),
            })
    return out


def list_devices():
    print(json.dumps({"devices": _enumerate_devices("max_input_channels")}), flush=True)


def list_output_devices():
    print(json.dumps({"devices": _enumerate_devices("max_output_channels")}), flush=True)


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


def apply_strip_labels(groups: list[dict], labels_json: str | None) -> list[dict]:
    """
    Overlay user-entered display labels (#482) onto configured strips, in place.

    `labels_json` is a JSON array of per-strip labels aligned index-for-index
    with `groups`; "" (or a missing/non-string entry) leaves that strip
    unlabeled. A falsy `labels_json` is a no-op. Extra entries beyond
    len(groups) are ignored. Returns `groups` (mutated) for chaining.
    """
    if not labels_json:
        return groups

    try:
        labels = json.loads(labels_json)
    except (ValueError, TypeError):
        labels = None
    if not isinstance(labels, list):
        raise ValueError('--labels must be a JSON array of strings, e.g. \'["Kick",""]\'')

    for i, g in enumerate(groups):
        if i >= len(labels):
            break
        label = labels[i]
        if isinstance(label, str) and label.strip():
            g["label"] = label.strip()
    return groups


def resolve_armed_strips(groups: list[dict], arm_arg: str | None,
                         n_device_channels: int) -> list[dict]:
    """
    Which configured strips to record in a session, in armed order.

    `arm_arg` is parsed with the same channel-config grammar as the strip layout
    (via parse_channel_groups, so token validation stays in one place); each
    requested strip is matched against a configured strip by its device indices
    (mono "N" → [N], stereo "N-M" → [N, M]). Absent/empty ⇒ all configured strips.
    Raises ValueError on a malformed token or one that isn't a configured strip.
    """
    if not arm_arg or not arm_arg.strip():
        return list(groups)

    requested = parse_channel_groups(arm_arg, n_device_channels)
    by_indices = {tuple(g["indices"]): g for g in groups}
    armed: list[dict] = []
    for rg in requested:
        g = by_indices.get(tuple(rg["indices"]))
        if g is None:
            raise ValueError(f"armed strip not configured: {rg['name']}")
        armed.append(g)
    return armed


def slugify(label: str) -> str:
    """Filename-safe slug of a strip label (e.g. "CH02+CH03" → "ch02-ch03")."""
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", label).strip("-").lower()
    return slug or "strip"


def _unique_stem_name(session_dir: str, base: str) -> str:
    """`base` (an "NN-slug.wav"), suffixed -2/-3/… if that name is already taken."""
    name = base
    stem = base[:-4] if base.endswith(".wav") else base
    n = 2
    while os.path.exists(os.path.join(session_dir, name)):
        name = f"{stem}-{n}.wav"
        n += 1
    return name


def _utc_now_iso() -> str:
    """UTC timestamp as ISO-8601 with millisecond precision, e.g. 2026-07-03T14:32:07.512Z."""
    dt = datetime.now(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def write_session_manifest(session_dir: str, created_at: str, sample_rate: int,
                           strip_writers: list[dict], frames: int) -> None:
    """Emit session.json at the session-dir root. `file` paths are dir-relative."""
    manifest = {
        "name": os.path.basename(os.path.normpath(session_dir)) or "session",
        "createdAt": created_at,
        "sampleRate": int(sample_rate),
        "tracks": [
            {
                "id": sw["id"],
                "label": sw["label"],
                "kind": sw["group"]["kind"],
                "sourceChannels": list(sw["group"]["indices"]),
                "file": sw["file"],
                "frames": int(frames),
            }
            for sw in strip_writers
        ],
    }
    with open(os.path.join(session_dir, "session.json"), "w") as f:
        json.dump(manifest, f, indent=2)


class SessionRecorder:
    """
    One --session-dir multitrack session: a PCM_24 stem WAV per armed strip plus a
    session.json manifest.

    Thread-safe. The writer thread calls write() as blocks arrive while the finalize
    path (normal exit or the SIGTERM/SIGINT handler) calls finalize(); an internal
    lock serializes stem close vs write, and the manifest is emitted exactly once
    (finalize() is idempotent). Stems open eagerly at construction so every manifest
    `file` resolves to a real WAV even for a zero-frame session.
    """

    def __init__(self, session_dir: str, armed_groups: list[dict], sample_rate: int,
                 created_at: str | None = None):
        import soundfile as sf
        self.session_dir = session_dir
        self.sample_rate = int(sample_rate)
        self.created_at = created_at or _utc_now_iso()
        self.frames = 0
        self._lock = threading.Lock()
        self._finalized = False

        os.makedirs(session_dir, exist_ok=True)
        self.tracks: list[dict] = []
        for idx, g in enumerate(armed_groups):
            # A user label with no alphanumeric content (e.g. "../.." or "!!!")
            # falls back to the channel identity, so a label that's effectively
            # empty (or traversal-looking) never drives the stem name (#482).
            label = (g.get("label") or "").strip()
            base = label if re.search(r"[A-Za-z0-9]", label) else g["name"]
            fname = _unique_stem_name(session_dir, f"{idx + 1:02d}-{slugify(base)}.wav")
            writer = sf.SoundFile(
                os.path.join(session_dir, fname), mode="w", samplerate=self.sample_rate,
                channels=len(g["indices"]), subtype="PCM_24",
            )
            self.tracks.append({
                "id": f"t{idx + 1}", "label": (g.get("label") or "").strip() or g["name"], "group": g,
                "file": fname, "writer": writer,
            })

    def write(self, block: np.ndarray) -> None:
        """Demux `block` into every stem (same column-select as analyze_groups) and
        advance the shared frame counter. A no-op once finalized."""
        with self._lock:
            if self._finalized:
                return
            for t in self.tracks:
                t["writer"].write(block[:, t["group"]["indices"]])
            self.frames += block.shape[0]

    def finalize(self) -> None:
        """Close every stem header and emit session.json. Idempotent + signal-safe."""
        with self._lock:
            if self._finalized:
                return
            self._finalized = True
            for t in self.tracks:
                if not t["writer"].closed:
                    t["writer"].close()
            write_session_manifest(
                self.session_dir, self.created_at, self.sample_rate,
                self.tracks, self.frames,
            )


def compute_band_rms_db(freqs, power_spectrum, low, high):
    mask = (freqs >= low) & (freqs < high)
    if not np.any(mask):
        return -120.0
    band_power = np.mean(power_spectrum[mask])
    if band_power <= 0:
        return -120.0
    return float(10.0 * np.log10(band_power + 1e-12))


def analyze_signal(sig: np.ndarray, sample_rate: int, cols: np.ndarray | None = None) -> dict:
    """
    Per-strip acoustic metrics for one collapsed signal.

    `sig` is the collapsed (L+R mean) signal used for level/spectrum. `cols` is
    the raw per-channel matrix for the strip; peak and clipping are taken from the
    hottest individual channel so a single clipping leg of a stereo pair is still
    flagged (averaging would mask it). Defaults to `sig` for a mono strip.
    """
    rms = float(np.sqrt(np.mean(sig ** 2))) if sig.size else 0.0
    peak_src = sig if cols is None else cols
    peak = float(np.max(np.abs(peak_src))) if peak_src.size else 0.0
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
        cols = frames[:, g["indices"]].astype(np.float64)
        sig = cols[:, 0] if cols.shape[1] == 1 else cols.mean(axis=1)
        metrics = analyze_signal(sig, sample_rate, cols=cols)
        channels_out.append({
            "index": g["indices"][0],
            "name": g["name"],
            "kind": g["kind"],
            **metrics,
        })
    return channels_out


def bucket_peaks(samples: list, buckets: int) -> list:
    """
    Split `samples` into `buckets` contiguous slices (the last bucket takes
    any remainder from integer division) and return a (min, max) tuple per
    slice. Empty input or `buckets <= 0` returns [] (ADR 0004).
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
    (0.0 -> 128), clamping out-of-range input (ADR 0004)."""
    clamped = max(-1.0, min(1.0, value))
    return round((clamped + 1.0) * (QUANT_LEVELS - 1) / 2.0)


def mix_indices(groups: list[dict]) -> list[int]:
    """Sorted, de-duplicated device-channel indices across every configured
    strip's g["indices"]. The overall mix is the mean over these columns —
    not all device channels — so unconfigured silent channels never dilute
    the mix (#520)."""
    indices: set[int] = set()
    for g in groups:
        indices.update(g["indices"])
    return sorted(indices)


def build_peak_lanes(wf_samples, groups: list[dict], mix_cols: list[int], n_buckets: int) -> list:
    """One peaks lane per drawable signal: the overall mix first, then one
    "strip{i}" lane per configured strip, in configured order — matching the
    renderer's channelConfig index so lane ids map 1:1 onto the DAW shell's
    data-ch lanes (#521). Same collapse as analyze_groups: a stereo strip is
    the mean of its two columns."""
    lanes = []
    if mix_cols:
        mix_sig = wf_samples[:, mix_cols].astype(np.float64).mean(axis=1)
        pairs = bucket_peaks(mix_sig.tolist(), n_buckets)
        if pairs:
            lanes.append({"id": "mix", "peaks": pairs})
    for idx, g in enumerate(groups):
        cols = wf_samples[:, g["indices"]].astype(np.float64)
        sig = cols[:, 0] if cols.shape[1] == 1 else cols.mean(axis=1)
        pairs = bucket_peaks(sig.tolist(), n_buckets)
        if pairs:
            lanes.append({"id": f"strip{idx}", "peaks": pairs})
    return lanes


def encode_peaks_frame(lanes: list, ts: float) -> str:
    """Per lane, pack interleaved (quantize_peak(min), quantize_peak(max))
    bytes, base64-encode, and wrap in the "peaks" NDJSON envelope. Mirrors
    the spike's encode_frame_b64 candidate (ADR 0004,
    spike_waveform_transport.py:142-156)."""
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
                interval_secs: float, record_path,
                session_dir: str | None = None,
                armed_groups: list[dict] | None = None):
    dev_info = sd.query_devices(device_index)
    sample_rate = int(dev_info["default_samplerate"])
    n_device_channels = dev_info["max_input_channels"]

    window_samples = int(window_secs * sample_rate)
    meter_samples = max(1, int(METER_WINDOW_SECS * sample_rate))

    # Analysis ring buffer of raw blocks (not per-frame), guarded by `lock`.
    # Keeping whole blocks lets the audio callback do one cheap append and lets
    # trailing() copy only the tail it needs instead of the entire window.
    blocks: deque[np.ndarray] = deque()
    buffered_samples = 0
    lock = threading.Lock()

    # Recording is opened lazily so a monitor-only run never touches the disk.
    # Two independent, optional sinks: a single interleaved WAV (--record, guarded
    # by recorder_lock) and a per-strip session (--session-dir → a SessionRecorder,
    # self-guarded). The callback thread writes; the finalize path (normal exit or
    # the signal handler) closes and — for a session — writes session.json.
    recorder = None
    recorder_lock = threading.Lock()
    session = None

    if record_path:
        import soundfile as sf
        recorder = sf.SoundFile(
            record_path, mode="w", samplerate=sample_rate,
            channels=n_device_channels, subtype="PCM_24",
        )

    if session_dir:
        armed = armed_groups if armed_groups is not None else groups
        session = SessionRecorder(session_dir, armed, sample_rate)

    stop = threading.Event()

    def finalize():
        stop.set()
        with recorder_lock:
            if recorder is not None and not recorder.closed:
                recorder.close()
        if session is not None:
            session.finalize()

    # The PortAudio callback runs on a real-time thread: it must not block on
    # disk I/O or do heavy work. It only copies the block onto a queue; a writer
    # thread drains the queue to disk and into the analysis ring buffer.
    audio_q: "queue.Queue[np.ndarray | None]" = queue.Queue()

    def audio_callback(indata, frames, time_info, status):
        audio_q.put(np.array(indata, dtype=np.float32, copy=True))

    def writer_loop():
        nonlocal buffered_samples
        while True:
            block = audio_q.get()
            if block is None:
                return
            try:
                if recorder is not None:
                    with recorder_lock:
                        if not recorder.closed:
                            recorder.write(block)
                if session is not None:
                    session.write(block)
            except Exception as e:
                # A write failure (disk full, I/O error) would otherwise kill
                # this daemon thread silently and freeze the capture. Surface it
                # and stop so the main loop finalizes what was captured.
                print(json.dumps({"error": f"recording write failed: {e}"}), flush=True)
                stop.set()
                return
            with lock:
                blocks.append(block)
                buffered_samples += block.shape[0]
                # Trim from the front, keeping at least a full window.
                while blocks and buffered_samples - blocks[0].shape[0] >= window_samples:
                    buffered_samples -= blocks.popleft().shape[0]

    writer = threading.Thread(target=writer_loop, daemon=True)
    writer.start()

    # Stopping (normal exit or Electron's SIGTERM) must flush blocks already
    # queued to the writer *before* closing headers, or the buffered tail is
    # dropped from every stem. shutdown() sends the end-of-input sentinel, waits
    # (bounded, so a wedged writer can't hang the stop) for the drain, then
    # finalizes. Idempotent, and registered only after the writer exists so an
    # early signal can't reference it.
    shutting_down = threading.Event()

    def shutdown():
        if shutting_down.is_set():
            return
        shutting_down.set()
        stop.set()
        audio_q.put(None)         # end-of-input sentinel
        writer.join(timeout=1.5)  # let the writer flush the queued tail
        finalize()

    # Electron stops capture with SIGTERM; the default handler skips `finally`,
    # so register explicitly to guarantee every header is finalized on stop.
    def _on_signal(*_args):
        shutdown()
        sys.exit(0)
    signal.signal(signal.SIGTERM, _on_signal)
    signal.signal(signal.SIGINT, _on_signal)

    def trailing(n_samples: int) -> np.ndarray:
        # Gather only the tail blocks that cover n_samples, minimizing the copy
        # and the time spent holding the lock.
        with lock:
            if not blocks:
                return np.empty((0, n_device_channels), dtype=np.float32)
            picked = []
            total = 0
            for block in reversed(blocks):
                picked.append(block)
                total += block.shape[0]
                if total >= n_samples:
                    break
            data = np.concatenate(list(reversed(picked)), axis=0)
        if data.shape[0] > n_samples:
            data = data[-n_samples:]
        return data

    # Latch a clip for CLIP_HOLD_SECS so a transient clip stays visible instead of
    # flashing for one 0.2 s meter slice.
    clip_hold: dict[str, float] = {}

    def apply_clip_hold(channels_out: list[dict], now: float):
        for ch in channels_out:
            if ch["clipping"]:
                clip_hold[ch["name"]] = now
            elif now - clip_hold.get(ch["name"], -1e9) < CLIP_HOLD_SECS:
                ch["clipping"] = True

    # Hoisted out of the meter loop — groups don't change mid-capture (#520).
    mix_cols = mix_indices(groups)

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
            now = time.monotonic()
            # If a slow tick left us more than one interval behind, resync to now
            # instead of busy-spinning to "catch up" (which would flood stdout).
            if now - next_tick > interval_secs:
                next_tick = now
            sleep = next_tick - now
            if sleep > 0:
                time.sleep(sleep)

            frames = trailing(meter_samples)
            if frames.shape[0] < 2:
                continue

            # Lightweight meter tick — the real-time view.
            channels_out = analyze_groups(frames, sample_rate, groups)
            apply_clip_hold(channels_out, time.monotonic())
            print(json.dumps({
                "type": "meter",
                "ts": time.time(),
                "channels": channels_out,
            }), flush=True)

            # Peak-envelope frame for the DAW waveform lane (#520, ADR 0004). Emitted from
            # this meter loop only — never the audio callback or writer thread — preserving
            # the recording-safety split the spike's architecture proved.
            n_buckets = max(1, round(WAVEFORM_BUCKETS_PER_SEC * interval_secs))
            wf_samples = trailing(max(1, int(interval_secs * sample_rate)))
            # Require at least n_buckets samples so bucket_peaks fills every bucket
            # (fewer samples than buckets collapses to a single bucket — see
            # bucket_peaks' `base = n // buckets` — which would emit a
            # shorter-than-expected frame and permanently misalign the renderer's
            # bucketsPerSecond assumption for the rest of the capture). Skips the
            # earliest tick(s), before the ring buffer has filled — mirrors the
            # meter loop's own `if frames.shape[0] < 2: continue` skip-tick guard.
            if wf_samples.shape[0] >= n_buckets:
                lanes = build_peak_lanes(wf_samples, groups, mix_cols, n_buckets)
                if lanes:
                    print(encode_peaks_frame(lanes, time.time()), flush=True)

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

    shutdown()  # drain the queued tail, then finalize


def main():
    args = sys.argv[1:]

    if args and args[0] == "--list-devices":
        list_devices()
        return

    if args and args[0] == "--list-output-devices":
        list_output_devices()
        return

    # Split optional flags from positional args.
    interval_secs = 0.1
    record_path = None
    session_dir = None
    arm_arg = None
    labels_json = None
    positional: list[str] = []
    i = 0
    while i < len(args):
        a = args[i]
        if a == "--interval" and i + 1 < len(args):
            interval_secs = float(args[i + 1]); i += 2
        elif a == "--record" and i + 1 < len(args):
            record_path = args[i + 1]; i += 2
        elif a == "--session-dir" and i + 1 < len(args):
            session_dir = args[i + 1]; i += 2
        elif a == "--arm" and i + 1 < len(args):
            arm_arg = args[i + 1]; i += 2
        elif a == "--labels" and i + 1 < len(args):
            labels_json = args[i + 1]; i += 2
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
        # Attach display labels right after parsing (#482): armed_groups below
        # is built from these same dict objects, so labeling here carries
        # through to whichever strips end up armed.
        apply_strip_labels(groups, labels_json)
    except ValueError as e:
        print(json.dumps({"error": str(e)}), flush=True)
        sys.exit(1)

    armed_groups = None
    if session_dir:
        try:
            armed_groups = resolve_armed_strips(groups, arm_arg, n_device_channels)
        except ValueError as e:
            print(json.dumps({"error": str(e)}), flush=True)
            sys.exit(1)

    try:
        stream_live(device_index, window_secs, groups, interval_secs, record_path,
                    session_dir, armed_groups)
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
