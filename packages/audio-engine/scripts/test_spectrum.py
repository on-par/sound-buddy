#!/usr/bin/env python3
"""
Unit tests for spectrum.py's pure numpy/scipy DSP helpers (#662 — librosa removal).

Run: python3 packages/audio-engine/scripts/test_spectrum.py
Requires numpy + scipy. `soundfile`-dependent tests skip when soundfile is
absent (same HAVE_SOUNDFILE guard as test_stream.py/test_playback.py). The
librosa-parity tests skip unless librosa is importable — they run in the dev
venv (which has both librosa and the new deps) and nowhere else; this is the
drift guard that makes the port self-verifying against the library it
replaces.
"""

import io
import os
import sys
import json
import wave
import struct
import tempfile
import subprocess
import unittest
import importlib.util

import numpy as np

try:
    import soundfile as sf
    HAVE_SOUNDFILE = True
except ImportError:
    HAVE_SOUNDFILE = False

try:
    import librosa
    HAVE_LIBROSA = True
except ImportError:
    HAVE_LIBROSA = False

_HERE = os.path.dirname(__file__)
_SPECTRUM_PATH = os.path.join(_HERE, "spectrum.py")
_spec = importlib.util.spec_from_file_location("spectrum", _SPECTRUM_PATH)
spectrum = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(spectrum)


def _sine(freq=1000.0, sr=44100, seconds=1.0, amplitude=0.5):
    n = int(sr * seconds)
    t = np.arange(n) / sr
    return (amplitude * np.sin(2 * np.pi * freq * t)).astype(np.float32), sr


class NoLibrosaGuard(unittest.TestCase):
    def test_librosa_not_imported(self):
        # Checked against the spectrum module's own namespace, not
        # sys.modules — this test file itself imports librosa (for the
        # LibrosaParity drift checks below), which would pollute a
        # sys.modules-based check regardless of what spectrum.py does.
        self.assertNotIn("librosa", vars(spectrum))

    def test_source_has_no_librosa_token(self):
        with open(_SPECTRUM_PATH, "r", encoding="utf-8") as fh:
            source = fh.read()
        self.assertNotIn("librosa", source)


class StftShape(unittest.TestCase):
    def test_shape_matches_centered_framing(self):
        y, _sr = _sine()
        S = spectrum._stft_mag(y, 4096, 1024)
        expected_frames = 1 + len(y) // 1024
        self.assertEqual(S.shape, (2049, expected_frames))


@unittest.skipUnless(HAVE_LIBROSA, "librosa not installed — parity check skipped")
class LibrosaParity(unittest.TestCase):
    """Drift guard: the numpy/scipy port must numerically match librosa 0.11.0."""

    def setUp(self):
        self.y, self.sr = _sine()

    def test_stft_matches_librosa(self):
        ours = spectrum._stft_mag(self.y, 4096, 1024)
        theirs = np.abs(librosa.stft(self.y, n_fft=4096, hop_length=1024))
        self.assertEqual(ours.shape, theirs.shape)
        np.testing.assert_allclose(ours, theirs, atol=1e-4)

    def test_centroid_matches_librosa(self):
        S = spectrum._stft_mag(self.y, 2048, 512)
        freqs = spectrum._fft_freqs(self.sr, 2048)
        ours = spectrum._spectral_centroid(S, freqs)
        theirs = librosa.feature.spectral_centroid(y=self.y, sr=self.sr)[0]
        np.testing.assert_allclose(ours, theirs, atol=1e-4)

    def test_rolloff_matches_librosa(self):
        S = spectrum._stft_mag(self.y, 2048, 512)
        freqs = spectrum._fft_freqs(self.sr, 2048)
        ours = spectrum._spectral_rolloff(S, freqs, 0.85)
        theirs = librosa.feature.spectral_rolloff(y=self.y, sr=self.sr, roll_percent=0.85)[0]
        np.testing.assert_allclose(ours, theirs, atol=1e-4)

    def test_flatness_matches_librosa(self):
        S = spectrum._stft_mag(self.y, 4096, 1024)
        ours = spectrum._spectral_flatness(S)
        theirs = librosa.feature.spectral_flatness(S=S)[0]
        np.testing.assert_allclose(ours, theirs, atol=1e-4)

    def test_rms_matches_librosa(self):
        frame_length = max(1, int(self.sr * 0.1))
        hop_length = max(1, frame_length // 2)
        ours = spectrum._rms_frames(self.y, frame_length, hop_length)
        theirs = librosa.feature.rms(y=self.y, frame_length=frame_length, hop_length=hop_length)[0]
        np.testing.assert_allclose(ours, theirs, atol=1e-4)


class CentroidSanity(unittest.TestCase):
    def test_pure_tone_centroid_near_tone_frequency(self):
        y, sr = _sine(freq=1000.0)
        S = spectrum._stft_mag(y, 2048, 512)
        freqs = spectrum._fft_freqs(sr, 2048)
        centroid = spectrum._spectral_centroid(S, freqs)
        self.assertAlmostEqual(float(np.mean(centroid)), 1000.0, delta=25.0)


class RolloffSanity(unittest.TestCase):
    def test_pure_tone_rolloff_within_one_bin(self):
        y, sr = _sine(freq=1000.0)
        S = spectrum._stft_mag(y, 2048, 512)
        freqs = spectrum._fft_freqs(sr, 2048)
        rolloff = spectrum._spectral_rolloff(S, freqs, 0.85)
        bin_hz = sr / 2048.0  # ~21.5 Hz
        self.assertAlmostEqual(float(np.mean(rolloff)), 1000.0, delta=bin_hz)


class DigitalSilence(unittest.TestCase):
    def test_zero_power_bands_hit_floor(self):
        freqs = spectrum._fft_freqs(44100, 4096)
        mean_power = np.zeros(freqs.shape[0])
        for _name, lo, hi in spectrum.BANDS:
            self.assertEqual(
                spectrum.compute_band_energy(mean_power, freqs, float(lo), float(hi)),
                spectrum.SILENCE_FLOOR_DB,
            )

    @unittest.skipUnless(HAVE_SOUNDFILE, "soundfile not installed")
    def test_end_to_end_silence_wav_hits_floor(self):
        y = np.zeros(44100, dtype=np.float32)
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "zeros.wav")
            sf.write(path, y, 44100)
            out = subprocess.run(
                [sys.executable, _SPECTRUM_PATH, path],
                capture_output=True, text=True, check=True,
            )
            result = json.loads(out.stdout)
            for value in result["bands"].values():
                self.assertEqual(value, spectrum.SILENCE_FLOOR_DB)


class LoadAudio(unittest.TestCase):
    @unittest.skipUnless(HAVE_SOUNDFILE, "soundfile not installed")
    def test_loads_stereo_as_channel_mean_mono(self):
        sr = 44100
        left, _ = _sine(freq=440.0, sr=sr, amplitude=0.4)
        right, _ = _sine(freq=440.0, sr=sr, amplitude=0.2)
        stereo = np.stack([left, right], axis=1)
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "stereo.wav")
            sf.write(path, stereo, sr)
            y, loaded_sr = spectrum._load_audio(path)
        self.assertEqual(loaded_sr, sr)
        self.assertEqual(y.dtype, np.float32)
        np.testing.assert_allclose(y, (left + right) / 2.0, atol=1e-4)

    def test_missing_file_raises(self):
        with self.assertRaises(Exception):
            spectrum._load_audio("/nonexistent/path/does-not-exist.wav")


class DynamicRangeOfZeros(unittest.TestCase):
    def test_zero_signal_dynamic_range_is_zero(self):
        y = np.zeros(44100, dtype=np.float32)
        self.assertEqual(spectrum.compute_dynamic_range(y, 44100), 0.0)


@unittest.skipUnless(HAVE_SOUNDFILE, "soundfile not installed")
class EndToEndJsonShape(unittest.TestCase):
    def test_tone_fixture_output_shape(self):
        fixture = os.path.join(_HERE, "..", "test-fixtures", "tone.wav")
        out = subprocess.run(
            [sys.executable, _SPECTRUM_PATH, fixture],
            capture_output=True, text=True, check=True,
        )
        result = json.loads(out.stdout)

        self.assertEqual(
            set(result["bands"].keys()),
            {"sub_bass", "bass", "low_mid", "mid", "high_mid", "presence", "brilliance"},
        )
        self.assertEqual(len(result["curve"]["freqs"]), 48)
        self.assertEqual(len(result["curve"]["db"]), 48)
        self.assertIn("frames", result)
        self.assertIn("segments", result)
        self.assertIn("content_type", result)
        self.assertIn("spectral_centroid", result)
        self.assertIn("spectral_rolloff_85", result)
        self.assertIn("dynamic_range", result)

        bands = result["bands"]
        mid = bands["mid"]
        for name, value in bands.items():
            if name != "mid":
                self.assertGreater(mid, value + 20)


if __name__ == "__main__":
    unittest.main()
