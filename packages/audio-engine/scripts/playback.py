#!/usr/bin/env python3
"""
Multitrack session playback: per-track output routing + stereo master mixdown.

Reads a capture session written by stream.py (--session-dir → a folder of
per-track stem WAVs plus a session.json manifest, see stream.py) and plays it
through a sounddevice OutputStream, mirroring the callback/queue/finalize
patterns proven in stream.py (InputStream + worker thread + SIGTERM finalize()).

Usage:
  python3 scripts/playback.py <session_dir> --device <index|name> --route <spec>
                              [--interval S] [--master]

Positional:
  session_dir   folder holding session.json + stem WAVs (from stream.py --session-dir)

Options:
  --device D    output device index or name (empty/omitted = default output device)
  --route SPEC  track → output-channel map (see grammar below); required unless
                --master folds everything to stereo regardless.
  --interval S  progress/level cadence in seconds (default 0.1)
  --master      force the stereo master mixdown fold even if the device is big
                enough for discrete routing.

Routing-spec grammar (comma-separated "track:channels" entries), reusing the
"N" / "N-M" token idea from stream.py's parse_channel_groups:
  I:N     mono track I → output channel N
  I:N-M   stereo track I → output channel pair N (L) and M (R)
  e.g. "0:0,1:1,2:2-3" → track0→ch0, track1→ch1, track2→stereo pair ch2+ch3
Every track in the manifest must appear exactly once; a mono track needs a
single-channel token and a stereo track a pair token.

Stereo master mixdown fold — engaged when the routing needs more output channels
than the device provides (required > device.max_output_channels) OR when
--master is set. All tracks fold to a 2-channel master: mono tracks summed to
both L and R, stereo tracks summed L→L / R→R, scaled by a headroom gain so the
summed peak stays below full scale (never emits abs() > 1.0).

Output: JSON lines on stdout.
  {"type":"mixdown","active":B,"outputChannels":N,"requiredChannels":R,
   "deviceChannels":D,"reason":…}                       — once, at startup
  {"type":"progress","elapsed":…,"duration":…}          — every --interval
  {"type":"level","tracks":[{label,rms,peak,clipping},…]} — every --interval
  {"type":"ended"}                                       — when playback reaches the end

Dependencies: pip install sounddevice numpy soundfile
"""

# Postpones evaluation of annotations (PEP 563) so the `list[dict]` / `str |
# None` style hints below don't need Python 3.10+ at runtime.
from __future__ import annotations

import os
import sys
import json
import time
import queue
import signal
import threading
import numpy as np

try:
    import sounddevice as sd
    import soundfile as sf
except ImportError as e:
    print(json.dumps({"error": f"missing dependency: {e}"}), flush=True)
    sys.exit(1)

# Frames read/written per audio block. Fixed so producer blocks align with the
# callback's request size (only the final block is short).
BLOCKSIZE = 1024

# Bounded look-ahead queue (in blocks) between the file-reading producer and the
# real-time output callback — enough to ride out disk-read jitter without adding
# noticeable start latency.
QUEUE_BLOCKS = 20

# Master-mixdown headroom target. The fold scales the summed mix so its
# worst-case peak lands here (≈ -1 dBFS), leaving margin below full scale.
TARGET_PEAK = 10 ** (-1.0 / 20.0)  # ≈ 0.8913


def load_manifest(session_dir: str) -> dict:
    """
    Read <session_dir>/session.json into the shape playback needs.

    Consumes the manifest written by stream.py (#42): a top-level `sampleRate`
    (the one session sample rate) plus `tracks[]`, each carrying at least
    `label`, `kind` ('mono'|'stereo') and `file` (dir-relative stem path). Older
    #34-style manifests spell the source channels `channels` instead of
    `sourceChannels`; neither is needed here (the stem WAV is read directly), so
    both are tolerated. Raises ValueError on a missing/malformed manifest.
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


def parse_route_spec(spec: str, tracks: list[dict]) -> list[list[int]]:
    """
    Parse the routing spec into per-track output-channel lists, aligned to
    `tracks` order.

    Each comma-separated entry is "I:CH" where I is the track index and CH is a
    channel token in stream.py's grammar: "N" (mono → [N]) or "N-M" (stereo →
    [N, M]). A mono track requires a single-channel token, a stereo track a pair
    token. Every track must be routed exactly once. Raises ValueError on a
    malformed token, a duplicate/missing/out-of-range track, a negative channel,
    or a token whose arity doesn't match the track kind.
    """
    if not spec or not spec.strip():
        raise ValueError("empty routing spec")

    routes: dict[int, list[int]] = {}
    for entry in spec.split(","):
        entry = entry.strip()
        if not entry:
            continue
        if ":" not in entry:
            raise ValueError(f"invalid route entry: {entry!r} (want I:CH)")
        idx_str, ch_str = entry.split(":", 1)
        try:
            idx = int(idx_str)
        except ValueError:
            raise ValueError(f"invalid track index in {entry!r}")
        if idx < 0 or idx >= len(tracks):
            raise ValueError(f"route references track {idx}, session has {len(tracks)} tracks")
        if idx in routes:
            raise ValueError(f"track {idx} routed more than once")

        ch_str = ch_str.strip()
        if "-" in ch_str:
            parts = ch_str.split("-")
            if len(parts) != 2:
                raise ValueError(f"invalid stereo channel token: {ch_str!r}")
            outs = [int(parts[0]), int(parts[1])]
        else:
            outs = [int(ch_str)]
        for c in outs:
            if c < 0:
                raise ValueError(f"negative output channel in {entry!r}")

        kind = tracks[idx]["kind"]
        if kind == "mono" and len(outs) != 1:
            raise ValueError(f"mono track {idx} needs a single output channel, got {ch_str!r}")
        if kind == "stereo" and len(outs) != 2:
            raise ValueError(f"stereo track {idx} needs an output channel pair, got {ch_str!r}")
        routes[idx] = outs

    missing = [i for i in range(len(tracks)) if i not in routes]
    if missing:
        raise ValueError(f"tracks not routed: {missing}")

    return [routes[i] for i in range(len(tracks))]


def required_output_channels(routes: list[list[int]]) -> int:
    """Highest routed output-channel index + 1 (the channel count discrete
    routing needs)."""
    return 1 + max((c for outs in routes for c in outs), default=-1)


def decide_mixdown(required: int, device_channels: int, force_master: bool) -> tuple[bool, str]:
    """
    Whether to fold to the stereo master, and why.

    Folds when the caller forces it (--master) or when discrete routing needs
    more channels than the device exposes. Returns (active, reason); reason is
    "" when discrete routing is used.
    """
    if force_master:
        return True, "master forced"
    if required > device_channels:
        return True, f"routing needs {required} channels; device provides {device_channels}"
    return False, ""


def master_gain(n_tracks: int, target_peak: float = TARGET_PEAK) -> float:
    """
    Headroom gain for the stereo fold. Any one master channel sums at most
    `n_tracks` tracks (every mono lands on both channels; each stereo leg lands
    on one), so scaling by target_peak / n_tracks bounds the worst-case summed
    peak — assuming full-scale stems — at target_peak, provably below clipping.
    """
    return target_peak / max(1, n_tracks)


def mix_block(track_blocks: list[np.ndarray], routes: list[list[int]],
              n_out: int, master: bool, gain: float) -> np.ndarray:
    """
    Sum per-track sample blocks into one output block.

    `track_blocks[i]` is a (frames, 1|2) float32 slice of track i at the shared
    playback cursor (0-length once a track has ended). In discrete mode each
    track adds into its routed output channel(s); in master mode every track
    folds into a 2-channel master (mono → both L/R, stereo → L/R) and the result
    is scaled by `gain`. Output is hard-clipped to ±1.0 so nothing ever leaves
    full scale.
    """
    frames = max((b.shape[0] for b in track_blocks), default=0)
    width = 2 if master else n_out
    out = np.zeros((frames, width), dtype=np.float32)

    for blk, route in zip(track_blocks, routes):
        m = blk.shape[0]
        if m == 0:
            continue
        if master:
            if blk.shape[1] == 1:
                out[:m, 0] += blk[:, 0]
                out[:m, 1] += blk[:, 0]
            else:
                out[:m, 0] += blk[:, 0]
                out[:m, 1] += blk[:, 1]
        else:
            if blk.shape[1] == 1:
                out[:m, route[0]] += blk[:, 0]
            else:
                out[:m, route[0]] += blk[:, 0]
                out[:m, route[1]] += blk[:, 1]

    if master:
        out *= gain
    np.clip(out, -1.0, 1.0, out=out)
    return out


def track_level(label: str, block: np.ndarray) -> dict:
    """Lightweight per-track meter entry (RMS/peak in dBFS + clipping) for one
    block, mirroring stream.py's analyze_signal level math."""
    if block.size:
        rms = float(np.sqrt(np.mean(block ** 2)))
        peak = float(np.max(np.abs(block)))
    else:
        rms = 0.0
        peak = 0.0
    return {
        "label": label,
        "rms": float(20.0 * np.log10(rms + 1e-12)),
        "peak": float(20.0 * np.log10(peak + 1e-12)),
        "clipping": bool(peak >= 0.999),
    }


def find_output_device(name_or_index: str):
    """Resolve an output device by index or (case-insensitive) name substring.
    Returns the device index, or None if nothing matches."""
    devs = sd.query_devices()
    try:
        idx = int(name_or_index)
        if 0 <= idx < len(devs):
            return idx
    except ValueError:
        pass
    lower = name_or_index.lower()
    for i, d in enumerate(devs):
        if lower in d["name"].lower() and d["max_output_channels"] > 0:
            return i
    return None


def play_session(session_dir: str, device_index, route_spec: str,
                 interval_secs: float, force_master: bool):
    manifest = load_manifest(session_dir)
    sample_rate = manifest["sampleRate"]
    tracks = manifest["tracks"]

    # Open every stem up front so a bad file (missing, wrong SR, kind mismatch)
    # fails loudly before we touch the audio device. `always_2d` keeps mono
    # stems as (n, 1) so mix_block's column indexing is uniform.
    handles: list[sf.SoundFile] = []
    try:
        for t in tracks:
            path = os.path.join(session_dir, t["file"])
            if not os.path.isfile(path):
                raise ValueError(f"stem not found: {t['file']}")
            h = sf.SoundFile(path)
            if h.samplerate != sample_rate:
                h.close()
                raise ValueError(
                    f"stem {t['file']} is {h.samplerate} Hz but session is {sample_rate} Hz "
                    f"(sample-rate conversion is out of scope)"
                )
            want_ch = 1 if t["kind"] == "mono" else 2
            if h.channels != want_ch:
                h.close()
                raise ValueError(
                    f"stem {t['file']} has {h.channels} channels but kind {t['kind']!r} "
                    f"expects {want_ch}"
                )
            handles.append(h)
    except Exception:
        for h in handles:
            h.close()
        raise

    try:
        routes = parse_route_spec(route_spec, tracks) if route_spec else None
        if routes is None:
            # --master with no route: fold everything, no discrete map needed.
            if not force_master:
                raise ValueError("a --route spec is required unless --master is set")
            routes = [[0] if t["kind"] == "mono" else [0, 1] for t in tracks]
            required = 2
        else:
            required = required_output_channels(routes)

        dev_info = sd.query_devices(device_index)
        device_channels = dev_info["max_output_channels"]
        if device_channels <= 0:
            raise ValueError(f"device {device_index} has no output channels")

        master, reason = decide_mixdown(required, device_channels, force_master)
        if master:
            n_out = 2
            gain = master_gain(len(tracks))
        else:
            n_out = required
            gain = 1.0

        total_frames = max((h.frames for h in handles), default=0)
        duration = total_frames / sample_rate if sample_rate else 0.0

        print(json.dumps({
            "type": "mixdown",
            "active": master,
            "outputChannels": n_out,
            "requiredChannels": required,
            "deviceChannels": device_channels,
            "reason": reason,
        }), flush=True)

        _run_output_stream(
            handles, tracks, routes, n_out, master, gain,
            device_index, sample_rate, duration, interval_secs,
        )
    finally:
        for h in handles:
            if not h.closed:
                h.close()


def _run_output_stream(handles, tracks, routes, n_out, master, gain,
                       device_index, sample_rate, duration, interval_secs):
    """Drive the OutputStream: a producer thread reads+mixes blocks onto a
    bounded queue, the RT callback drains it into the device, and the main loop
    emits progress/level ticks until playback ends or a stop signal arrives."""
    block_q: "queue.Queue[np.ndarray | None]" = queue.Queue(maxsize=QUEUE_BLOCKS)
    stop = threading.Event()
    producer_done = threading.Event()
    finished = threading.Event()

    meter_lock = threading.Lock()
    latest_levels: list[dict] = [track_level(t["label"], np.zeros((0, 1), np.float32)) for t in tracks]
    played = {"frames": 0}

    def producer():
        try:
            while not stop.is_set():
                blocks = [h.read(BLOCKSIZE, dtype="float32", always_2d=True) for h in handles]
                n = max((b.shape[0] for b in blocks), default=0)
                if n == 0:
                    break
                mixed = mix_block(blocks, routes, n_out, master, gain)
                with meter_lock:
                    latest_levels[:] = [track_level(t["label"], b)
                                        for t, b in zip(tracks, blocks)]
                while not stop.is_set():
                    try:
                        block_q.put(mixed, timeout=0.1)
                        break
                    except queue.Full:
                        continue
                if n < BLOCKSIZE:
                    break
        except Exception as e:
            print(json.dumps({"error": f"playback read failed: {e}"}), flush=True)
            stop.set()
        finally:
            producer_done.set()
            # Wake a callback that may be blocked waiting for the sentinel.
            try:
                block_q.put_nowait(None)
            except queue.Full:
                pass

    def callback(outdata, frames, time_info, status):
        if stop.is_set():
            outdata.fill(0)
            raise sd.CallbackStop
        try:
            block = block_q.get_nowait()
        except queue.Empty:
            if producer_done.is_set():
                outdata.fill(0)
                raise sd.CallbackStop
            outdata.fill(0)  # transient under-run: emit silence, keep going
            return
        if block is None:
            outdata.fill(0)
            raise sd.CallbackStop
        n = block.shape[0]
        if n < frames:
            outdata[:n] = block
            outdata[n:] = 0
            played["frames"] += n
            raise sd.CallbackStop
        outdata[:] = block
        played["frames"] += frames

    def finalize():
        stop.set()

    def _on_signal(*_args):
        finalize()
        sys.exit(0)

    signal.signal(signal.SIGTERM, _on_signal)
    signal.signal(signal.SIGINT, _on_signal)

    prod_thread = threading.Thread(target=producer, daemon=True)
    prod_thread.start()

    with sd.OutputStream(
        device=device_index,
        channels=n_out,
        samplerate=sample_rate,
        dtype="float32",
        blocksize=BLOCKSIZE,
        callback=callback,
        finished_callback=finished.set,
    ):
        next_tick = time.monotonic()
        while not finished.is_set() and not stop.is_set():
            next_tick += interval_secs
            now = time.monotonic()
            if now - next_tick > interval_secs:
                next_tick = now
            sleep = next_tick - now
            if sleep > 0:
                time.sleep(sleep)

            elapsed = played["frames"] / sample_rate if sample_rate else 0.0
            print(json.dumps({
                "type": "progress",
                "elapsed": elapsed,
                "duration": duration,
            }), flush=True)
            with meter_lock:
                levels = [dict(l) for l in latest_levels]
            print(json.dumps({"type": "level", "tracks": levels}), flush=True)

    # A natural end (playback drained, no stop signal) gets the terminal marker;
    # a SIGTERM/SIGINT stop sets `stop` first, so it stays silent.
    if finished.is_set() and not stop.is_set():
        print(json.dumps({"type": "ended"}), flush=True)

    stop.set()
    prod_thread.join(timeout=1.0)


def main():
    args = sys.argv[1:]

    device_arg = ""
    route_spec = ""
    interval_secs = 0.1
    force_master = False
    positional: list[str] = []

    i = 0
    while i < len(args):
        a = args[i]
        if a == "--device" and i + 1 < len(args):
            device_arg = args[i + 1]; i += 2
        elif a == "--route" and i + 1 < len(args):
            route_spec = args[i + 1]; i += 2
        elif a == "--interval" and i + 1 < len(args):
            interval_secs = float(args[i + 1]); i += 2
        elif a == "--master":
            force_master = True; i += 1
        else:
            positional.append(a); i += 1

    if not positional:
        print(json.dumps({"error": "usage: playback.py <session_dir> --device D --route SPEC"}), flush=True)
        sys.exit(1)
    session_dir = positional[0]

    if interval_secs <= 0:
        interval_secs = 0.1

    if device_arg:
        device_index = find_output_device(device_arg)
        if device_index is None:
            print(json.dumps({"error": f"output device not found: {device_arg}"}), flush=True)
            sys.exit(1)
    else:
        device_index = sd.default.device[1]
        if device_index is None or device_index < 0:
            devs = sd.query_devices()
            device_index = next(
                (i for i, d in enumerate(devs) if d["max_output_channels"] > 0), None
            )
            if device_index is None:
                print(json.dumps({"error": "no output device found"}), flush=True)
                sys.exit(1)

    try:
        play_session(session_dir, device_index, route_spec, interval_secs, force_master)
    except ValueError as e:
        print(json.dumps({"error": str(e)}), flush=True)
        sys.exit(1)
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
