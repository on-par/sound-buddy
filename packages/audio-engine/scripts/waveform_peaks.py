#!/usr/bin/env python3
"""
Generate per-track waveform peak buckets for a loaded Soundcheck session.

Reads a capture session written by stream.py (--session-dir -> a folder of
per-track stem WAVs plus a session.json manifest, see stream.py), decodes each
stem in bounded blocks (never the whole file in RAM), and reduces it to
per-track min/max peak buckets using the ADR-0004 b64-packed-u8 technique
(docs/adr/0004-waveform-peak-transport.md): one combined min/max lane per
track (a stereo stem folds to the per-bucket min of L/R mins and max of L/R
maxes), each bucket quantized to a u8 level and packed as interleaved min/max
bytes, base64-encoded per track. The document is written to --out.

Usage:
  python3 scripts/waveform_peaks.py <session_dir> [--out PATH] [--buckets-per-sec N]

Positional:
  session_dir   folder holding session.json + stem WAVs (from stream.py --session-dir)

Options:
  --out PATH            write the peaks JSON document here (default: stdout).
                        The app always passes --out so the child's stdout
                        carries only status lines.
  --buckets-per-sec N   waveform bucket rate (default 50, i.e. one min/max
                        pair per 20ms of audio — matches ADR-0004).

Output: the peaks JSON document to --out (or stdout), then a single status
line {"type":"done","tracks":N} on stdout.

Dependencies: pip install numpy soundfile (imported lazily — the pure helpers
below run on any python3; see test_waveform_peaks.py).
"""

import os
import sys
import json
import base64

# One min/max pair per 20ms of audio (matches ADR-0004 and the #519 spike).
WAVEFORM_BUCKETS_PER_SEC = 50
# Frames read per soundfile block — a bounded read so a full-length service
# recording never lands in RAM at once.
BLOCK_SAMPLES = 16384
# u8 quantization of a peak value in [-1.0, 1.0].
QUANT_LEVELS = 256


def load_manifest(session_dir: str) -> dict:
    """
    Read <session_dir>/session.json into the shape peak generation needs.

    Consumes the manifest written by stream.py (#42): a top-level `sampleRate`
    (the one session sample rate) plus `tracks[]`, each carrying at least
    `label`, `kind` ('mono'|'stereo') and `file` (dir-relative stem path).
    Copy of playback.py's load_manifest (each script is standalone). Raises
    ValueError on a missing/malformed manifest.
    """
    path = os.path.join(session_dir, "session.json")
    if not os.path.isfile(path):
        raise ValueError(f"no session.json in {session_dir!r}")
    with open(path) as f:
        raw = json.load(f)

    if "sampleRate" not in raw:
        raise ValueError("manifest missing sampleRate")
    sample_rate = int(raw["sampleRate"])

    tracks_in = raw.get("tracks")
    if not isinstance(tracks_in, list) or not tracks_in:
        raise ValueError("manifest has no tracks")

    tracks = []
    for i, t in enumerate(tracks_in):
        for key in ("label", "kind", "file"):
            if key not in t:
                raise ValueError(f"track {i} missing {key!r}")
        kind = t["kind"]
        if kind not in ("mono", "stereo"):
            raise ValueError(f"track {i} has unknown kind {kind!r}")
        tracks.append({"label": t["label"], "kind": kind, "file": t["file"]})

    return {"sampleRate": sample_rate, "tracks": tracks}


def bucket_size_for(sample_rate: int, buckets_per_sec: int) -> int:
    """Samples per bucket for a fixed bucket rate, clamped to at least 1 so
    bucket alignment never divides by zero."""
    return max(1, round(sample_rate / buckets_per_sec))


def peaks_for_channel(samples: list, bucket_size: int) -> list:
    """
    Split `samples` into contiguous, globally-aligned chunks of `bucket_size`
    samples and return a (min, max) tuple per chunk.

    Bucket boundaries are fixed multiples of `bucket_size` from sample 0 (so a
    bucket index maps to a time span via `bucket_size / sample_rate`); the
    final partial chunk (the remainder) becomes its own last bucket. Empty
    input or a non-positive bucket_size returns [].
    """
    if not samples or bucket_size <= 0:
        return []
    result = []
    for i in range(0, len(samples), bucket_size):
        chunk = samples[i:i + bucket_size]
        if not chunk:
            continue
        result.append((min(chunk), max(chunk)))
    return result


def quantize_peak(value: float) -> int:
    """Map a peak value in [-1.0, 1.0] to a u8 level in [0, QUANT_LEVELS-1]
    (0.0 -> 128), clamping out-of-range input. Copy of the #519 spike's
    quantize_peak (spikes are not product deps)."""
    clamped = max(-1.0, min(1.0, value))
    return round((clamped + 1.0) * (QUANT_LEVELS - 1) / 2.0)


def encode_track_peaks(peaks: list) -> str:
    """One base64 string packing a track's interleaved u8 min/max bytes
    (min0, max0, min1, max1, ...) — the ADR-0004 encode_frame_b64 layout
    applied to one track's full bucket list. Empty peaks -> empty string."""
    if not peaks:
        return ""
    packed = bytes(
        b
        for mn, mx in peaks
        for b in (quantize_peak(mn), quantize_peak(mx))
    )
    return base64.b64encode(packed).decode("ascii")


def _read_track_buckets(sf, np, h, bucket_size: int) -> list:
    """
    Stream one stem handle into per-bucket (min, max) tuples.

    Reads in BLOCK_SAMPLES blocks (always_2d, so mono stems are (n, 1)) and
    accumulates into a rolling buffer across block boundaries: each full
    bucket_size chunk is drained and reduced to (min, max) — for a stereo stem
    `chunk.min()`/`chunk.max()` over both columns is exactly the min of L/R
    mins and max of L/R maxes, so the fold needs no special case — and the
    partial remainder is kept for the next block. The final partial bucket at
    EOF becomes its own last bucket. Bucket boundaries are aligned to the
    global start because bucket_size is fixed and we always drain the front.
    """
    buffer = np.empty((0, h.channels), dtype="float32")
    peaks = []
    while True:
        block = h.read(BLOCK_SAMPLES, dtype="float32", always_2d=True)
        if block.shape[0] == 0:
            break
        buffer = np.concatenate([buffer, block])
        while buffer.shape[0] >= bucket_size:
            chunk = buffer[:bucket_size]
            peaks.append((float(chunk.min()), float(chunk.max())))
            buffer = buffer[bucket_size:]
    if buffer.shape[0] > 0:
        peaks.append((float(buffer.min()), float(buffer.max())))
    return peaks


def read_track_peaks(session_dir: str, track: dict, sample_rate: int, buckets_per_sec: int) -> dict:
    """
    Decode one stem into a per-track peak document entry.

    Validates the stem's sample rate and channel count against the manifest
    (sample-rate conversion is out of scope), then streams it through
    _read_track_buckets and packs the result. `track` carries `index` (its
    position in the manifest, added by generate_peaks), `label`, `kind` and
    `file`. Lazily imports soundfile/numpy so the pure helpers above stay
    plain-Python.
    """
    import soundfile as sf
    import numpy as np

    path = os.path.join(session_dir, track["file"])
    if not os.path.isfile(path):
        raise ValueError(f"stem not found: {track['file']}")
    h = sf.SoundFile(path)
    try:
        if h.samplerate != sample_rate:
            raise ValueError(
                f"stem {track['file']} is {h.samplerate} Hz but session is {sample_rate} Hz "
                f"(sample-rate conversion is out of scope)"
            )
        want_ch = 1 if track["kind"] == "mono" else 2
        if h.channels != want_ch:
            raise ValueError(
                f"stem {track['file']} has {h.channels} channels but kind {track['kind']!r} "
                f"expects {want_ch}"
            )
        bucket_size = bucket_size_for(sample_rate, buckets_per_sec)
        peaks = _read_track_buckets(sf, np, h, bucket_size)
    finally:
        h.close()

    return {
        "index": track["index"],
        "label": track["label"],
        "kind": track["kind"],
        "bucketCount": len(peaks),
        "data": encode_track_peaks(peaks),
    }


def generate_peaks(session_dir: str, buckets_per_sec: int) -> dict:
    """
    Build the peaks document for a whole session: per-track decode of every
    stem (tracks are independent, so differing stem lengths naturally yield
    differing bucketCounts). Lazily imports numpy/soundfile via read_track_peaks.
    """
    manifest = load_manifest(session_dir)
    sample_rate = manifest["sampleRate"]
    tracks = []
    for i, t in enumerate(manifest["tracks"]):
        tracks.append(read_track_peaks(session_dir, {**t, "index": i}, sample_rate, buckets_per_sec))
    return {"bucketsPerSecond": buckets_per_sec, "tracks": tracks}


def main():
    args = sys.argv[1:]

    out_path = None
    buckets_per_sec = WAVEFORM_BUCKETS_PER_SEC
    positional: list[str] = []

    i = 0
    while i < len(args):
        a = args[i]
        if a == "--out" and i + 1 < len(args):
            out_path = args[i + 1]; i += 2
        elif a == "--buckets-per-sec" and i + 1 < len(args):
            buckets_per_sec = int(args[i + 1]); i += 2
        else:
            positional.append(a); i += 1

    if not positional:
        print(json.dumps({"error": "usage: waveform_peaks.py <session_dir> [--out PATH] [--buckets-per-sec N]"}), flush=True)
        sys.exit(1)
    session_dir = positional[0]

    try:
        doc = generate_peaks(session_dir, buckets_per_sec)
    except ImportError as e:
        print(json.dumps({"error": f"missing dependency: {e}"}), flush=True)
        sys.exit(1)
    except ValueError as e:
        print(json.dumps({"error": str(e)}), flush=True)
        sys.exit(1)

    output = json.dumps(doc)
    if out_path:
        with open(out_path, "w") as f:
            f.write(output)
    else:
        print(output, flush=True)

    print(json.dumps({"type": "done", "tracks": len(doc["tracks"])}), flush=True)


if __name__ == "__main__":
    main()
