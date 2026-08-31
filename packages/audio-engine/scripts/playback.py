#!/usr/bin/env python3
"""
Multitrack session playback: per-track output routing + stereo master mixdown.

Reads a capture session written by stream.py (--session-dir → a folder of
per-track stem WAVs plus a session.json manifest, see stream.py) and plays it
through a sounddevice OutputStream, mirroring the callback/queue/finalize
patterns proven in stream.py (InputStream + worker thread + SIGTERM finalize()).

Usage:
  python3 scripts/playback.py <session_dir> --device <index|name> --route <spec>
                              [--interval S] [--start-at S] [--master]

Positional:
  session_dir   folder holding session.json + stem WAVs (from stream.py --session-dir)

Options:
  --device D    output device index or name (empty/omitted = default output device)
  --route SPEC  track → output-channel map (see grammar below); required unless
                --master folds everything to stereo regardless.
  --interval S  progress/level cadence in seconds (default 0.1)
  --start-at S  begin playback S seconds into the session (default 0.0; negative
                clamps to 0). Every stem is seeked to the offset frame before
                the producer starts, so audio begins at that position.
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

`progress.elapsed` is the session-relative position; a --start-at offset is
reflected from the first tick. `duration` is always the full session length.

Commands: NDJSON lines on stdin, one per line, read by a daemon listener
thread while playing (#759). Each line is a full command:
  {"type":"set-routes","spec":"0:1,1:2-3"}  — atomically replace the live route
     map with `spec` (same grammar as --route) between audio blocks, without
     stopping or reopening the output stream. A malformed/unknown command is
     logged to stderr and the previous routes stay in effect.

Dependencies: pip install sounddevice numpy soundfile
"""

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


def flush_and_exit(code: int, exit_fn=os._exit) -> None:
    """
    Terminate immediately, after flushing the NDJSON streams.

    playback.py keeps a daemon thread parked in a blocking read on stdin for its
    whole life (the #759 command channel), and the app always spawns it with
    stdin piped and held open. A daemon thread inside a buffered read holds that
    reader's lock, and CPython's interpreter finalization has to take the same
    lock to close sys.stdin — so a plain sys.exit() can wedge or abort the
    process at shutdown instead of exiting. os._exit() skips finalization, which
    makes the exit code deterministic on every host; the explicit flushes keep
    the stdout/stderr contract that os._exit() would otherwise discard.
    `exit_fn` is injected so the behavior is unit-testable.

    Note: os._exit() skips atexit hooks and `finally` blocks. Any cleanup
    playback.py ever needs must run before this call, not in a `finally`.
    """
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.flush()
        except Exception:
            # A closed/broken pipe on the way out must not change the exit code
            # — the caller's exit status is the contract, not the flush.
            pass
    exit_fn(code)


def install_stop_handlers(on_stop, register=signal.signal) -> None:
    """
    Point SIGTERM and SIGINT at `on_stop`.

    Electron stops playback with SIGTERM (#1340). Registered as the first thing
    main() does — before the manifest read, the stem opens and the device query
    — so a stop can never fall through to the default disposition and kill the
    process with -15. Re-registered by _run_output_stream once a stream exists
    so the stop becomes a graceful unwind. `register` is injected so the wiring
    is unit-testable.
    """
    def _handler(*_args):
        on_stop()

    register(signal.SIGTERM, _handler)
    register(signal.SIGINT, _handler)


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


def route_update_from_line(line: str, tracks: list[dict]) -> list[list[int]]:
    """
    Parse one NDJSON stdin command into a full route map (#759).

    The only understood command is {"type":"set-routes","spec":...}, whose
    `spec` is a routing spec in exactly the --route grammar (validated by
    parse_route_spec: every track exactly once, mono→1 channel, stereo→pair,
    non-negative). Raises ValueError on an empty line, non-JSON input, a
    non-object command, an unknown "type", or an absent/non-string "spec" — so
    the stdin listener can reject the command and keep the previous routes.
    """
    if not line or not line.strip():
        raise ValueError("empty command line")
    try:
        cmd = json.loads(line)
    except ValueError:
        raise ValueError("command is not JSON")
    if not isinstance(cmd, dict):
        raise ValueError("command is not an object")
    if cmd.get("type") != "set-routes":
        raise ValueError(f"unknown command type: {cmd.get('type')!r}")
    spec = cmd.get("spec")
    if not isinstance(spec, str):
        raise ValueError("set-routes requires a string spec")
    return parse_route_spec(spec, tracks)


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


def compute_start_frame(sample_rate: int, total_frames: int, start_secs: float) -> int:
    """Seek frame for --start-at: start_secs → frame, clamped to [0, total_frames].
    Non-positive offsets return 0 (play from start)."""
    if start_secs <= 0:
        return 0
    return min(int(round(start_secs * sample_rate)), total_frames)


def session_elapsed(start_secs: float, played_frames: int, sample_rate: int, duration: float) -> float:
    """Progress `elapsed` for one tick: session-relative position (offset + frames played),
    clamped so it never overshoots the session duration."""
    return min(start_secs + (played_frames / sample_rate if sample_rate else 0.0), duration)


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
                 interval_secs: float, force_master: bool, start_secs: float = 0.0):
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
            # Open the discrete stream at the device's FULL channel count
            # (#759): a sounddevice OutputStream's width is fixed at open, so
            # every in-device re-route (required <= device_channels by
            # construction) must be addressable without reopening the stream.
            n_out = device_channels
            gain = 1.0

        total_frames = max((h.frames for h in handles), default=0)
        duration = total_frames / sample_rate if sample_rate else 0.0

        # A --start-at offset seeks every stem to the same frame before the
        # producer starts, so the first read (and therefore the first output
        # block) begins at that session position. soundfile clamps the seek at
        # EOF, which is exactly the "offset past the end" behavior we want.
        start_frame = compute_start_frame(sample_rate, total_frames, start_secs)
        for h in handles:
            h.seek(start_frame)

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
            device_index, sample_rate, duration, interval_secs, start_secs,
        )
    finally:
        for h in handles:
            if not h.closed:
                h.close()


def _run_output_stream(handles, tracks, routes, n_out, master, gain,
                       device_index, sample_rate, duration, interval_secs, start_secs):
    """Drive the OutputStream: a producer thread reads+mixes blocks onto a
    bounded queue, the RT callback drains it into the device, and the main loop
    emits progress/level ticks until playback ends or a stop signal arrives."""
    block_q: "queue.Queue[np.ndarray | None]" = queue.Queue(maxsize=QUEUE_BLOCKS)
    stop = threading.Event()
    producer_done = threading.Event()
    finished = threading.Event()

    # The live route map (#759). The stdin listener swaps it atomically under
    # the lock; the producer copies it each block so a re-route takes effect on
    # the next block with no stream reopen.
    routes_lock = threading.Lock()
    shared_routes = [list(r) for r in routes]

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
                with routes_lock:
                    routes_now = [list(r) for r in shared_routes]
                mixed = mix_block(blocks, routes_now, n_out, master, gain)
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

    def apply_command(line):
        # Best-effort push (#759): a malformed/unknown command is logged to
        # stderr and leaves the current routing in effect — playback never dies
        # on a bad command, and the renderer gets no error surface for it.
        try:
            new_routes = route_update_from_line(line, tracks)
        except ValueError as e:
            print(f"playback: route update rejected: {e}", file=sys.stderr, flush=True)
            return
        with routes_lock:
            shared_routes[:] = [list(r) for r in new_routes]

    def stdin_listener():
        # Daemon: blocks on read; dies with the process on exit (main() exits via
        # flush_and_exit so this thread can never wedge interpreter shutdown).
        # When stdin is a TTY, /dev/null or already closed the loop simply
        # blocks or ends harmlessly.
        try:
            for line in sys.stdin:
                if stop.is_set():
                    break
                apply_command(line)
        except (ValueError, OSError):
            return

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

    # Re-point the process-wide stop handlers (installed in main()) at the
    # graceful path now that a stream exists: setting `stop` unwinds the `with
    # sd.OutputStream(...)` block, so the device closes and the natural-end
    # marker is correctly suppressed before main() exits the process.
    install_stop_handlers(stop.set)

    prod_thread = threading.Thread(target=producer, daemon=True)
    prod_thread.start()

    stdin_thread = threading.Thread(target=stdin_listener, daemon=True)
    stdin_thread.start()

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
            # Event.wait (not time.sleep) so a stop signal breaks the loop at
            # once instead of after the remainder of the current --interval.
            if stop.wait(sleep if sleep > 0 else 0):
                break

            elapsed = session_elapsed(start_secs, played["frames"], sample_rate, duration)
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
    # Before any work that can block (manifest read, stem opens, device query):
    # until #1340 the handlers went up inside _run_output_stream, so a SIGTERM
    # during startup used the default disposition and exited -15.
    install_stop_handlers(lambda: flush_and_exit(0))

    args = sys.argv[1:]

    device_arg = ""
    route_spec = ""
    interval_secs = 0.1
    start_secs = 0.0
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
        elif a == "--start-at" and i + 1 < len(args):
            start_secs = max(0.0, float(args[i + 1])); i += 2
        elif a == "--master":
            force_master = True; i += 1
        else:
            positional.append(a); i += 1

    if not positional:
        print(json.dumps({"error": "usage: playback.py <session_dir> --device D --route SPEC"}), flush=True)
        flush_and_exit(1)
    session_dir = positional[0]

    if interval_secs <= 0:
        interval_secs = 0.1

    if device_arg:
        device_index = find_output_device(device_arg)
        if device_index is None:
            print(json.dumps({"error": f"output device not found: {device_arg}"}), flush=True)
            flush_and_exit(1)
    else:
        device_index = sd.default.device[1]
        if device_index is None or device_index < 0:
            devs = sd.query_devices()
            device_index = next(
                (i for i, d in enumerate(devs) if d["max_output_channels"] > 0), None
            )
            if device_index is None:
                print(json.dumps({"error": "no output device found"}), flush=True)
                flush_and_exit(1)

    try:
        play_session(session_dir, device_index, route_spec, interval_secs, force_master, start_secs)
    except ValueError as e:
        print(json.dumps({"error": str(e)}), flush=True)
        flush_and_exit(1)
    except KeyboardInterrupt:
        flush_and_exit(0)
    flush_and_exit(0)


if __name__ == "__main__":
    main()
