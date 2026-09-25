"""Generate the Swift spectrum parity fixture from the Mac engine's spectrum.py.

The fixture pins what packages/audio-engine/scripts/spectrum.py computes for
one analysis frame of a known two-tone signal: periodic Hann window (the same
formula as _stft_mag) -> rfft power -> compute_band_energy per legacy band.
SoundBuddyKit's SpectrumParityTests synthesizes the same signal and must land
within tolerance of these numbers.

Scope: single-frame parity only. TODO(parity): extend to spectrum.py's full
centered-framing STFT with HOP averaging and the 48-point curve_from_power
grid once the Swift port grows a clip/STFT path.

Usage: python apps/ios/scripts/make_spectrum_parity_fixture.py
Requires: pip install numpy soundfile
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "packages" / "audio-engine" / "scripts"))
import spectrum  # noqa: E402  (path set up above)

FIXTURE_PATH = (
    REPO_ROOT / "apps" / "ios" / "SoundBuddyKit" / "Tests" / "SoundBuddyKitTests"
    / "Fixtures" / "spectrum-parity.single-frame.json"
)
DB_DECIMALS = 4

SIGNAL = {
    "sampleRate": 48000,
    "fftSize": spectrum.N_FFT,
    "tones": [
        {"hz": 1000.0, "amplitude": 0.5},
        {"hz": 100.0, "amplitude": 0.25},
    ],
}


def camel_case(snake: str) -> str:
    head, *rest = snake.split("_")
    return head + "".join(part.capitalize() for part in rest)


def synth(signal: dict) -> np.ndarray:
    t = np.arange(signal["fftSize"]) / signal["sampleRate"]
    return sum(tone["amplitude"] * np.sin(2.0 * np.pi * tone["hz"] * t) for tone in signal["tones"])


def build_fixture() -> dict:
    n_fft = SIGNAL["fftSize"]
    window = 0.5 - 0.5 * np.cos(2.0 * np.pi * np.arange(n_fft) / n_fft)
    power = np.abs(np.fft.rfft(synth(SIGNAL) * window)) ** 2
    freqs = spectrum._fft_freqs(SIGNAL["sampleRate"], n_fft)
    bands = {
        camel_case(name): round(spectrum.compute_band_energy(power, freqs, float(lo), float(hi)), DB_DECIMALS)
        for name, lo, hi in spectrum.BANDS
    }
    return {
        "source": "packages/audio-engine/scripts/spectrum.py (single frame; see make_spectrum_parity_fixture.py)",
        "signal": SIGNAL,
        "expectedBandDb": bands,
    }


if __name__ == "__main__":  # pragma: no cover - CLI entry
    FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE_PATH.write_text(json.dumps(build_fixture(), indent=2) + "\n")
    print(f"wrote {FIXTURE_PATH.relative_to(REPO_ROOT)}")
