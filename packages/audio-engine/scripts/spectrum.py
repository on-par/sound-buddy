#!/usr/bin/env python3
"""
spectrum.py — Frequency band energy analysis using librosa.

Usage: python3 spectrum.py <audio_file_path>

Outputs JSON to stdout with:
  - Per-band RMS energy in dB for 7 frequency bands
  - Spectral centroid (Hz)
  - Spectral rolloff at 85% (Hz)
  - Dynamic range estimate (dB)
"""

import sys
import json
import numpy as np

try:
    import librosa
except ImportError:
    print(
        json.dumps({"error": "librosa not installed. Run: pip install librosa"}),
        file=sys.stdout,
    )
    sys.exit(1)


# Frequency band definitions: (name, low_hz, high_hz)
BANDS = [
    ("sub_bass",   20,    60),
    ("bass",       60,   250),
    ("low_mid",   250,   500),
    ("mid",       500,  2000),
    ("high_mid", 2000,  4000),
    ("presence", 4000,  6000),
    ("brilliance", 6000, 20000),
]


def amplitude_to_db(rms: float) -> float:
    """Convert linear RMS amplitude to dB. Returns -120.0 for silence."""
    if rms <= 0.0:
        return -120.0
    return float(20.0 * np.log10(max(rms, 1e-10)))


def compute_band_energy(y: np.ndarray, sr: int, low_hz: float, high_hz: float) -> float:
    """
    Compute RMS energy (in dB) for a specific frequency band using STFT.
    """
    n_fft = 4096
    hop_length = n_fft // 4

    # Compute STFT magnitude
    stft = np.abs(librosa.stft(y, n_fft=n_fft, hop_length=hop_length))

    # Frequency bin mapping
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)

    # Select bins within the band
    band_mask = (freqs >= low_hz) & (freqs <= high_hz)
    if not np.any(band_mask):
        return -120.0

    band_stft = stft[band_mask, :]

    # RMS across the band energy
    band_power = np.mean(band_stft ** 2)
    rms = float(np.sqrt(band_power))
    return amplitude_to_db(rms)


def compute_dynamic_range(y: np.ndarray, sr: int) -> float:
    """
    Estimate dynamic range using a windowed RMS approach.
    Computes the difference between the 95th and 5th percentile of windowed RMS values (in dB).
    """
    frame_length = int(sr * 0.1)  # 100ms windows
    hop_length = frame_length // 2

    rms_frames = librosa.feature.rms(y=y, frame_length=frame_length, hop_length=hop_length)[0]
    rms_frames = rms_frames[rms_frames > 1e-10]

    if len(rms_frames) == 0:
        return 0.0

    db_frames = 20.0 * np.log10(rms_frames)
    p95 = float(np.percentile(db_frames, 95))
    p5 = float(np.percentile(db_frames, 5))
    return p95 - p5


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: spectrum.py <audio_file>"}))
        sys.exit(1)

    audio_path = sys.argv[1]

    try:
        # Load audio as mono, preserving native sample rate
        y, sr = librosa.load(audio_path, sr=None, mono=True)
    except Exception as exc:
        print(json.dumps({"error": f"Failed to load audio: {exc}"}))
        sys.exit(1)

    # Compute per-band energies
    band_results: dict[str, float] = {}
    for band_name, low_hz, high_hz in BANDS:
        band_results[band_name] = compute_band_energy(y, sr, float(low_hz), float(high_hz))

    # Spectral centroid (mean across frames)
    centroid_frames = librosa.feature.spectral_centroid(y=y, sr=sr)[0]
    spectral_centroid = float(np.mean(centroid_frames))

    # Spectral rolloff at 85%
    rolloff_frames = librosa.feature.spectral_rolloff(y=y, sr=sr, roll_percent=0.85)[0]
    spectral_rolloff_85 = float(np.mean(rolloff_frames))

    # Dynamic range
    dynamic_range = compute_dynamic_range(y, sr)

    output = {
        "bands": band_results,
        "spectral_centroid": spectral_centroid,
        "spectral_rolloff_85": spectral_rolloff_85,
        "dynamic_range": dynamic_range,
    }

    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
