#!/usr/bin/env python3
"""
Unit + integration tests for playback.py.

Run: python3 packages/audio-engine/scripts/test_playback.py
Requires numpy (+ soundfile for the manifest/integration cases). `sounddevice`
is stubbed so the pure helpers run on hosts without PortAudio (e.g. CI);
playback.py imports it at module load.
"""

import io
import os
import sys
import time
import json
import types
import shutil
import signal
import contextlib
import tempfile
import subprocess
import unittest
import importlib.util

# Stub sounddevice before importing playback.py — the output backend isn't
# needed (and PortAudio may be absent) for the pure helpers under test.
if "sounddevice" not in sys.modules:
    sys.modules["sounddevice"] = types.ModuleType("sounddevice")

import numpy as np

try:
    import soundfile as sf
    HAVE_SOUNDFILE = True
except ImportError:
    HAVE_SOUNDFILE = False

_HERE = os.path.dirname(__file__)
_spec = importlib.util.spec_from_file_location("playback", os.path.join(_HERE, "playback.py"))
playback = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(playback)


def _tracks(*kinds):
    """Minimal track dicts (label/kind/file) for routing tests."""
    return [{"label": f"T{i}", "kind": k, "file": f"{i:02d}.wav"} for i, k in enumerate(kinds)]


class ParseRouteSpec(unittest.TestCase):
    def test_mono_and_stereo_mix(self):
        tracks = _tracks("mono", "mono", "stereo")
        routes = playback.parse_route_spec("0:0,1:1,2:2-3", tracks)
        self.assertEqual(routes, [[0], [1], [2, 3]])

    def test_order_independent(self):
        tracks = _tracks("mono", "stereo")
        routes = playback.parse_route_spec("1:2-3,0:0", tracks)
        self.assertEqual(routes, [[0], [2, 3]])

    def test_mono_to_pair_raises(self):
        with self.assertRaises(ValueError):
            playback.parse_route_spec("0:0-1", _tracks("mono"))

    def test_stereo_to_single_raises(self):
        with self.assertRaises(ValueError):
            playback.parse_route_spec("0:0", _tracks("stereo"))

    def test_missing_track_raises(self):
        with self.assertRaises(ValueError):
            playback.parse_route_spec("0:0", _tracks("mono", "mono"))

    def test_duplicate_track_raises(self):
        with self.assertRaises(ValueError):
            playback.parse_route_spec("0:0,0:1", _tracks("mono", "mono"))

    def test_out_of_range_track_raises(self):
        with self.assertRaises(ValueError):
            playback.parse_route_spec("0:0,2:1", _tracks("mono", "mono"))

    def test_negative_channel_raises(self):
        with self.assertRaises(ValueError):
            playback.parse_route_spec("0:-1", _tracks("mono"))

    def test_malformed_entry_raises(self):
        with self.assertRaises(ValueError):
            playback.parse_route_spec("00", _tracks("mono"))

    def test_malformed_stereo_token_raises(self):
        with self.assertRaises(ValueError):
            playback.parse_route_spec("0:1-2-3", _tracks("stereo"))

    def test_empty_spec_raises(self):
        with self.assertRaises(ValueError):
            playback.parse_route_spec("", _tracks("mono"))


class RequiredChannelsAndMode(unittest.TestCase):
    def test_required_is_max_index_plus_one(self):
        self.assertEqual(playback.required_output_channels([[0], [2, 3]]), 4)
        self.assertEqual(playback.required_output_channels([[0], [1]]), 2)
        self.assertEqual(playback.required_output_channels([[5]]), 6)

    def test_discrete_when_device_big_enough(self):
        active, reason = playback.decide_mixdown(4, 8, False)
        self.assertFalse(active)
        self.assertEqual(reason, "")

    def test_fold_when_device_too_small(self):
        active, reason = playback.decide_mixdown(6, 2, False)
        self.assertTrue(active)
        self.assertIn("6", reason)
        self.assertIn("2", reason)

    def test_fold_when_forced(self):
        active, reason = playback.decide_mixdown(2, 8, True)
        self.assertTrue(active)
        self.assertIn("forced", reason)


class MixBlock(unittest.TestCase):
    def _block(self, value, frames=64, ch=1):
        return np.full((frames, ch), value, dtype=np.float32)

    def test_discrete_routing_isolates_channels(self):
        # Kick (mono) → ch0, OH (stereo) → ch2-3, on a 4-channel output.
        kick = self._block(0.5, ch=1)
        oh = np.stack([np.full(64, 0.3, np.float32), np.full(64, 0.7, np.float32)], axis=1)
        out = playback.mix_block([kick, oh], [[0], [2, 3]], 4, master=False, gain=1.0)
        self.assertEqual(out.shape, (64, 4))
        np.testing.assert_allclose(out[:, 0], 0.5, atol=1e-6)   # Kick only on ch0
        np.testing.assert_allclose(out[:, 1], 0.0, atol=1e-6)   # nothing on ch1
        np.testing.assert_allclose(out[:, 2], 0.3, atol=1e-6)   # OH L on ch2
        np.testing.assert_allclose(out[:, 3], 0.7, atol=1e-6)   # OH R on ch3

    def test_stereo_stays_stereo_on_two_channel_device(self):
        oh = np.stack([np.full(32, 0.4, np.float32), np.full(32, -0.6, np.float32)], axis=1)
        out = playback.mix_block([oh], [[0, 1]], 2, master=False, gain=1.0)
        np.testing.assert_allclose(out[:, 0], 0.4, atol=1e-6)   # L → 0, not summed to mono
        np.testing.assert_allclose(out[:, 1], -0.6, atol=1e-6)  # R → 1

    def test_master_folds_mono_to_both_and_stereo_lr(self):
        mono = self._block(0.2, ch=1)
        stereo = np.stack([np.full(64, 0.1, np.float32), np.full(64, 0.3, np.float32)], axis=1)
        gain = 1.0
        out = playback.mix_block([mono, stereo], [[0], [0, 1]], 2, master=True, gain=gain)
        self.assertEqual(out.shape, (64, 2))
        np.testing.assert_allclose(out[:, 0], 0.2 + 0.1, atol=1e-6)  # mono + stereoL
        np.testing.assert_allclose(out[:, 1], 0.2 + 0.3, atol=1e-6)  # mono + stereoR

    def test_master_gain_prevents_clipping_with_hot_tracks(self):
        # Eight full-scale mono tracks folded to stereo: without headroom the sum
        # would be 8.0; the track-count gain keeps the peak under full scale.
        n = 8
        blocks = [self._block(1.0, ch=1) for _ in range(n)]
        routes = [[0] for _ in range(n)]
        gain = playback.master_gain(n)
        out = playback.mix_block(blocks, routes, 2, master=True, gain=gain)
        peak = float(np.max(np.abs(out)))
        self.assertLessEqual(peak, playback.TARGET_PEAK + 1e-6)
        self.assertLess(peak, 1.0)
        # No sample ever leaves full scale.
        self.assertLessEqual(float(np.max(np.abs(out))), 1.0)

    def test_output_is_hard_clipped_to_unit(self):
        # Two full-scale monos summed onto the same discrete channel would reach
        # 2.0; the safety clip caps it at 1.0.
        a = self._block(1.0, ch=1)
        b = self._block(1.0, ch=1)
        out = playback.mix_block([a, b], [[0], [0]], 1, master=False, gain=1.0)
        self.assertLessEqual(float(np.max(np.abs(out))), 1.0)

    def test_ended_track_contributes_nothing(self):
        # A 0-length block (track already finished) must not break the mix.
        live = self._block(0.5, frames=64, ch=1)
        dead = np.zeros((0, 1), dtype=np.float32)
        out = playback.mix_block([live, dead], [[0], [1]], 2, master=False, gain=1.0)
        self.assertEqual(out.shape, (64, 2))
        np.testing.assert_allclose(out[:, 0], 0.5, atol=1e-6)
        np.testing.assert_allclose(out[:, 1], 0.0, atol=1e-6)


class MasterGain(unittest.TestCase):
    def test_scales_by_track_count_to_target(self):
        self.assertAlmostEqual(playback.master_gain(1), playback.TARGET_PEAK)
        self.assertAlmostEqual(playback.master_gain(4), playback.TARGET_PEAK / 4)

    def test_never_divides_by_zero(self):
        self.assertAlmostEqual(playback.master_gain(0), playback.TARGET_PEAK)


class TrackLevel(unittest.TestCase):
    def test_full_scale_flags_clipping(self):
        block = np.ones((128, 1), dtype=np.float32)
        lvl = playback.track_level("Kick", block)
        self.assertEqual(lvl["label"], "Kick")
        self.assertTrue(lvl["clipping"])
        self.assertAlmostEqual(lvl["peak"], 0.0, delta=0.1)  # 0 dBFS

    def test_half_scale_levels(self):
        block = np.full((128, 1), 0.5, dtype=np.float32)
        lvl = playback.track_level("OH", block)
        self.assertFalse(lvl["clipping"])
        self.assertAlmostEqual(lvl["peak"], -6.0, delta=0.5)
        self.assertAlmostEqual(lvl["rms"], -6.0, delta=0.5)  # constant ⇒ rms == peak

    def test_empty_block_is_silent(self):
        lvl = playback.track_level("X", np.zeros((0, 1), dtype=np.float32))
        self.assertFalse(lvl["clipping"])


@unittest.skipUnless(HAVE_SOUNDFILE, "soundfile not installed")
class LoadManifest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def _write_manifest(self, obj):
        with open(os.path.join(self.dir, "session.json"), "w") as f:
            json.dump(obj, f)

    def test_reads_42_shape(self):
        self._write_manifest({
            "name": "set", "createdAt": "2026-07-04T00:00:00.000Z", "sampleRate": 48000,
            "tracks": [
                {"id": "t1", "label": "Kick", "kind": "mono", "sourceChannels": [0],
                 "file": "01-kick.wav", "frames": 100},
                {"id": "t2", "label": "OH", "kind": "stereo", "sourceChannels": [4, 5],
                 "file": "05-oh.wav", "frames": 100},
            ],
        })
        m = playback.load_manifest(self.dir)
        self.assertEqual(m["sampleRate"], 48000)
        self.assertEqual([t["kind"] for t in m["tracks"]], ["mono", "stereo"])
        self.assertEqual([t["label"] for t in m["tracks"]], ["Kick", "OH"])
        self.assertEqual(m["tracks"][1]["file"], "05-oh.wav")

    def test_missing_manifest_raises(self):
        with self.assertRaises(ValueError):
            playback.load_manifest(self.dir)

    def test_missing_sample_rate_raises(self):
        self._write_manifest({"tracks": [{"label": "K", "kind": "mono", "file": "k.wav"}]})
        with self.assertRaises(ValueError):
            playback.load_manifest(self.dir)

    def test_empty_tracks_raises(self):
        self._write_manifest({"sampleRate": 48000, "tracks": []})
        with self.assertRaises(ValueError):
            playback.load_manifest(self.dir)

    def test_unknown_kind_raises(self):
        self._write_manifest({"sampleRate": 48000,
                              "tracks": [{"label": "K", "kind": "quad", "file": "k.wav"}]})
        with self.assertRaises(ValueError):
            playback.load_manifest(self.dir)


def _make_session(session_dir, sample_rate=48000, frames=4096):
    """A two-track session on disk: mono Kick (const 0.5) + stereo OH (L 0.3 / R
    0.7), matching the routing integration assertions."""
    os.makedirs(session_dir, exist_ok=True)
    kick = np.full((frames, 1), 0.5, dtype=np.float32)
    oh = np.zeros((frames, 2), dtype=np.float32)
    oh[:, 0] = 0.3
    oh[:, 1] = 0.7
    sf.write(os.path.join(session_dir, "01-kick.wav"), kick, sample_rate, subtype="PCM_24")
    sf.write(os.path.join(session_dir, "02-oh.wav"), oh, sample_rate, subtype="PCM_24")
    manifest = {
        "name": "set", "createdAt": "2026-07-04T00:00:00.000Z", "sampleRate": sample_rate,
        "tracks": [
            {"id": "t1", "label": "Kick", "kind": "mono", "sourceChannels": [0],
             "file": "01-kick.wav", "frames": frames},
            {"id": "t2", "label": "OH", "kind": "stereo", "sourceChannels": [2, 3],
             "file": "02-oh.wav", "frames": frames},
        ],
    }
    with open(os.path.join(session_dir, "session.json"), "w") as f:
        json.dump(manifest, f)


# A PortAudio-free sounddevice whose OutputStream pulls the callback from a
# background thread and captures every frame it writes, so a real playback.py
# subprocess can be driven and its routed output inspected.
_FAKE_SOUNDDEVICE = '''
"""PortAudio-free sounddevice stub for playback.py integration tests."""
import os, threading, time
import numpy as np

CAPTURE_PATH = os.environ["PLAYBACK_CAPTURE"]
DEVICE_CHANNELS = int(os.environ.get("FAKE_DEVICE_CHANNELS", "8"))

_INFO = {"name": "Fake Output", "max_input_channels": 0,
         "max_output_channels": DEVICE_CHANNELS, "default_samplerate": 48000}


def query_devices(index=None):
    return _INFO if index is not None else [_INFO]


class CallbackStop(Exception):
    pass


class CallbackAbort(Exception):
    pass


class _Default:
    device = [0, 0]


default = _Default()


class OutputStream:
    def __init__(self, device, channels, samplerate, dtype, blocksize,
                 callback, finished_callback=None):
        self.channels = channels
        self.blocksize = blocksize
        self.callback = callback
        self.finished_callback = finished_callback
        self._stop = threading.Event()
        self._thread = None
        self._captured = []

    def __enter__(self):
        def run():
            while not self._stop.is_set():
                out = np.zeros((self.blocksize, self.channels), dtype="float32")
                try:
                    self.callback(out, self.blocksize, None, None)
                except CallbackStop:
                    self._captured.append(out.copy())
                    break
                except CallbackAbort:
                    break
                self._captured.append(out.copy())
                time.sleep(0.01)
            if self._captured:
                np.save(CAPTURE_PATH, np.concatenate(self._captured, axis=0))
            else:
                np.save(CAPTURE_PATH, np.zeros((0, self.channels), dtype="float32"))
            if self.finished_callback is not None:
                self.finished_callback()
        self._thread = threading.Thread(target=run, daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *a):
        self._stop.set()
        self._thread.join(timeout=2)
        return False
'''


@unittest.skipUnless(HAVE_SOUNDFILE, "soundfile not installed")
class PlaybackIntegration(unittest.TestCase):
    """End-to-end: a real playback.py subprocess (fed by a fake sounddevice)
    routes each track to its output channel, emits the JSON envelope, and folds
    to stereo master when the device is too small."""

    def _run(self, args, device_channels=8, timeout=15):
        work = tempfile.mkdtemp()
        session_dir = os.path.join(work, "session")
        _make_session(session_dir)
        fake_dir = os.path.join(work, "fake")
        os.makedirs(fake_dir)
        with open(os.path.join(fake_dir, "sounddevice.py"), "w") as f:
            f.write(_FAKE_SOUNDDEVICE)
        capture = os.path.join(work, "capture.npy")
        env = dict(os.environ)
        env["PYTHONPATH"] = fake_dir + os.pathsep + env.get("PYTHONPATH", "")
        env["PLAYBACK_CAPTURE"] = capture
        env["FAKE_DEVICE_CHANNELS"] = str(device_channels)
        proc = subprocess.run(
            [sys.executable, os.path.join(_HERE, "playback.py"), session_dir, *args],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, timeout=timeout,
        )
        lines = [json.loads(l) for l in proc.stdout.decode().splitlines() if l.strip()]
        captured = np.load(capture) if os.path.exists(capture) else None
        shutil.rmtree(work, ignore_errors=True)
        return proc, lines, captured

    def test_discrete_routing_places_tracks_on_channels(self):
        proc, lines, out = self._run(
            ["--device", "0", "--route", "0:0,1:2-3", "--interval", "0.02"],
            device_channels=8,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr.decode())
        types_seen = [l.get("type") for l in lines]
        self.assertIn("mixdown", types_seen)
        self.assertIn("ended", types_seen)
        mix = next(l for l in lines if l.get("type") == "mixdown")
        self.assertFalse(mix["active"])
        self.assertEqual(mix["requiredChannels"], 4)
        # Kick only on ch0; OH L on ch2, R on ch3; ch1 silent.
        self.assertGreater(out.shape[0], 0)
        self.assertAlmostEqual(float(np.max(out[:, 0])), 0.5, delta=0.01)
        self.assertAlmostEqual(float(np.max(np.abs(out[:, 1]))), 0.0, delta=0.01)
        self.assertAlmostEqual(float(np.max(out[:, 2])), 0.3, delta=0.01)
        self.assertAlmostEqual(float(np.max(out[:, 3])), 0.7, delta=0.01)

    def test_progress_and_level_emitted(self):
        _proc, lines, _out = self._run(
            ["--device", "0", "--route", "0:0,1:2-3", "--interval", "0.02"],
        )
        progress = [l for l in lines if l.get("type") == "progress"]
        level = [l for l in lines if l.get("type") == "level"]
        self.assertTrue(progress)
        self.assertTrue(level)
        self.assertEqual({t["label"] for t in level[0]["tracks"]}, {"Kick", "OH"})
        self.assertGreater(progress[-1]["duration"], 0)

    def test_folds_to_stereo_master_when_device_too_small(self):
        proc, lines, out = self._run(
            ["--device", "0", "--route", "0:0,1:2-3", "--interval", "0.02"],
            device_channels=2,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr.decode())
        mix = next(l for l in lines if l.get("type") == "mixdown")
        self.assertTrue(mix["active"])
        self.assertEqual(mix["outputChannels"], 2)
        self.assertEqual(out.shape[1], 2)
        # Never exceeds full scale.
        self.assertLessEqual(float(np.max(np.abs(out))), 1.0)

    def test_master_flag_forces_fold_on_large_device(self):
        _proc, lines, out = self._run(
            ["--device", "0", "--route", "0:0,1:2-3", "--master", "--interval", "0.02"],
            device_channels=8,
        )
        mix = next(l for l in lines if l.get("type") == "mixdown")
        self.assertTrue(mix["active"])
        self.assertIn("forced", mix["reason"])
        self.assertEqual(out.shape[1], 2)

    def test_bad_route_errors_cleanly(self):
        proc, lines, _out = self._run(["--device", "0", "--route", "0:0"])  # OH unrouted
        self.assertEqual(proc.returncode, 1)
        self.assertTrue(any("error" in l for l in lines))


@unittest.skipUnless(HAVE_SOUNDFILE, "soundfile not installed")
class SigtermFinalizes(unittest.TestCase):
    """A running playback.py must exit cleanly (no orphaned stream) on SIGTERM."""

    def test_sigterm_exits_clean(self):
        work = tempfile.mkdtemp()
        session_dir = os.path.join(work, "session")
        # A long session (fake stream drains ~1 block/10ms) so the process is
        # still playing when we signal it.
        _make_session(session_dir, frames=48000 * 10)
        fake_dir = os.path.join(work, "fake")
        os.makedirs(fake_dir)
        with open(os.path.join(fake_dir, "sounddevice.py"), "w") as f:
            f.write(_FAKE_SOUNDDEVICE)
        env = dict(os.environ)
        env["PYTHONPATH"] = fake_dir + os.pathsep + env.get("PYTHONPATH", "")
        env["PLAYBACK_CAPTURE"] = os.path.join(work, "capture.npy")
        env["FAKE_DEVICE_CHANNELS"] = "8"
        proc = subprocess.Popen(
            [sys.executable, os.path.join(_HERE, "playback.py"), session_dir,
             "--device", "0", "--route", "0:0,1:2-3", "--interval", "0.05"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env,
        )
        try:
            # Let it get well into playback, then confirm it's still running.
            time.sleep(0.5)
            self.assertIsNone(proc.poll(), "process exited before SIGTERM")
            proc.send_signal(signal.SIGTERM)
            self.assertEqual(proc.wait(timeout=5), 0)
            # A SIGTERM stop must NOT emit the natural-end marker.
            out = proc.stdout.read().decode()
            self.assertNotIn('"type": "ended"', out)
        finally:
            proc.stdout.close()
            proc.stderr.close()
            if proc.poll() is None:
                proc.kill()
            shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
