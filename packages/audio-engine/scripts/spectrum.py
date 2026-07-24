#!/usr/bin/env python3
"""
spectrum.py — Frequency-band + fine-grained spectral analysis using numpy/scipy.

Usage: python3 spectrum.py <audio_file_path>

Outputs JSON to stdout with:
  - bands:            per-band RMS energy (dB) for the 7 legacy frequency bands
  - curve:            fine-grained whole-file frequency response on a fixed
                      log-spaced grid  { freqs: [Hz], db: [dB] }   (PRD 02)
  - frames:           time-sampled snapshots of that curve across the file, each
                      with rms + a speech/music/silence class            (PRD 03/04)
  - segments:         contiguous same-class runs { class, start, end }   (PRD 04)
  - content_type:     'speech' | 'music' | 'mixed' | 'silence'           (PRD 04)
  - spectral_centroid, spectral_rolloff_85, dynamic_range

The `bands`, `spectral_centroid`, `spectral_rolloff_85`, and `dynamic_range`
fields are unchanged from the original single-shot analysis (back-compat for the
CLI report, multi-channel compare, and the report card). Everything else is
additive.
"""

import sys
import json
import subprocess
import io
import numpy as np

try:
    import soundfile as sf
    from scipy.signal import get_window
except ImportError:
    print(
        json.dumps({
            "error": "soundfile/scipy not installed. Run: "
                     "pip install -r packages/audio-engine/scripts/requirements.txt",
        }),
        file=sys.stdout,
    )
    sys.exit(1)


# ─── Config ──────────────────────────────────────────────────────────────────

N_FFT = 4096
HOP = N_FFT // 4          # 1024
SILENCE_FLOOR_DB = -120.0

# Legacy scalar spectral_centroid/spectral_rolloff_85 use a separate feature-
# level STFT (n_fft=2048, hop_length=512), not the 4096/1024 STFT above — kept
# verbatim so the pinned golden values (fixtures.test.ts) don't drift.
SCALAR_N_FFT = 2048
SCALAR_HOP = 512
SCALAR_ROLLOFF_PERCENT = 0.85

# Spectral-flatness `amin` floor — keeps bin power from hitting zero before
# the geometric/arithmetic mean ratio, so silence doesn't divide by zero.
FLATNESS_AMIN = 1e-10

# Legacy 7-band definitions: (name, low_hz, high_hz). Kept verbatim.
BANDS = [
    ("sub_bass",   20,    60),
    ("bass",       60,   250),
    ("low_mid",   250,   500),
    ("mid",       500,  2000),
    ("high_mid", 2000,  4000),
    ("presence", 4000,  6000),
    ("brilliance", 6000, 20000),
]

# Fine-grained analyzer grid: fixed log-spaced centers 20 Hz → 20 kHz so curves
# are directly comparable across files and against an ideal profile (PRD 05).
# ~1/6-octave ≈ 48 points.
GRID_LOW_HZ = 20.0
GRID_HIGH_HZ = 20000.0
GRID_POINTS = 48

# Time sampling (PRD 03).
MAX_FRAMES = 24
MIN_FRAME_SECONDS = 0.35   # don't slice finer than this

# Speech/music classification (PRD 04).
SILENCE_RMS_DB = -55.0     # a frame quieter than this is 'silence'


def _grid_freqs() -> np.ndarray:
    return np.geomspace(GRID_LOW_HZ, GRID_HIGH_HZ, GRID_POINTS)


def _load_audio(path: str):
    """Native sample rate, channel-mean mono, float32. soundfile (libsndfile)
    can't decode m4a/aac, so fall back to the ffmpeg subprocess (bundled in
    the packaged app, on PATH in dev)."""
    try:
        data, sr = sf.read(path, dtype="float32", always_2d=True)
    except Exception:
        raw = subprocess.run(
            ["ffmpeg", "-v", "error", "-i", path, "-f", "wav", "-acodec", "pcm_f32le", "-"],
            capture_output=True, check=True,
        ).stdout
        data, sr = sf.read(io.BytesIO(raw), dtype="float32", always_2d=True)
    y = data.mean(axis=1) if data.shape[1] > 1 else data[:, 0]
    return y.astype(np.float32), int(sr)


def _stft_mag(y: np.ndarray, n_fft: int, hop: int) -> np.ndarray:
    """Magnitude STFT, shape (1 + n_fft//2, T). Centered framing with zero
    padding and a periodic Hann window — see the parity tests in
    test_spectrum.py for the reference semantics this must match."""
    pad = n_fft // 2
    ypad = np.pad(y, pad, mode="constant")          # zero-padded, centered framing
    window = get_window("hann", n_fft, fftbins=True)
    n_frames = 1 + (len(ypad) - n_fft) // hop
    frames = np.lib.stride_tricks.sliding_window_view(ypad, n_fft)[::hop][:n_frames]
    return np.abs(np.fft.rfft(frames * window, axis=1)).T


def _fft_freqs(sr: int, n_fft: int) -> np.ndarray:
    return np.fft.rfftfreq(n_fft, 1.0 / sr)


def _frames_to_time(idx: np.ndarray, sr: int, hop: int) -> np.ndarray:
    return np.asarray(idx, dtype=np.float64) * hop / sr


def _rms_frames(y: np.ndarray, frame_length: int, hop_length: int) -> np.ndarray:
    """Centered windowed RMS: zero-pad by frame_length // 2 before framing."""
    ypad = np.pad(y, frame_length // 2, mode="constant")
    n = 1 + (len(ypad) - frame_length) // hop_length
    frames = np.lib.stride_tricks.sliding_window_view(ypad, frame_length)[::hop_length][:n]
    return np.sqrt(np.mean(frames.astype(np.float64) ** 2, axis=1))


def _spectral_centroid(S_mag: np.ndarray, freqs: np.ndarray) -> np.ndarray:
    """Power-weighted mean frequency per column: sum(freq * normalize(S, norm=1))."""
    norm = np.sum(S_mag, axis=0)
    norm = np.where(norm < np.finfo(S_mag.dtype).tiny, 1.0, norm)
    return np.sum(freqs[:, None] * S_mag, axis=0) / norm


def _spectral_rolloff(S_mag: np.ndarray, freqs: np.ndarray, roll_percent: float) -> np.ndarray:
    """Lowest frequency per column whose cumulative magnitude reaches
    roll_percent of the column total."""
    cum = np.cumsum(S_mag, axis=0)
    threshold = roll_percent * cum[-1, :]
    idx = np.argmax(cum >= threshold, axis=0)   # first bin meeting the threshold
    return freqs[idx]


def _spectral_flatness(S_mag: np.ndarray) -> np.ndarray:
    """Geometric-to-arithmetic mean power ratio per column (amin=1e-10, power=2.0)."""
    p = np.maximum(FLATNESS_AMIN, S_mag ** 2)
    return np.exp(np.mean(np.log(p), axis=0)) / np.mean(p, axis=0)


def amplitude_to_db(rms: float) -> float:
    """Convert linear RMS amplitude to dB. Returns SILENCE_FLOOR_DB for silence."""
    if rms <= 0.0:
        return SILENCE_FLOOR_DB
    return float(20.0 * np.log10(max(rms, 1e-10)))


def _band_edges(centers: np.ndarray) -> np.ndarray:
    """Geometric-midpoint edges around each log-spaced center (len = N+1)."""
    mids = np.sqrt(centers[:-1] * centers[1:])
    first = centers[0] * centers[0] / mids[0]
    last = centers[-1] * centers[-1] / mids[-1]
    return np.concatenate([[first], mids, [last]])


def curve_from_power(mean_power_per_bin: np.ndarray, freqs: np.ndarray,
                     centers: np.ndarray, edges: np.ndarray) -> list:
    """
    Reduce per-FFT-bin mean power to a dB level per log-grid point by averaging
    the power of the bins that fall within each grid band, then → dB.
    """
    out = []
    for i in range(len(centers)):
        lo, hi = edges[i], edges[i + 1]
        mask = (freqs >= lo) & (freqs < hi)
        if not np.any(mask):
            # Grid point finer than FFT resolution (low freqs) or above Nyquist:
            # fall back to the single nearest bin so the curve stays continuous.
            nearest = int(np.argmin(np.abs(freqs - centers[i])))
            power = mean_power_per_bin[nearest]
        else:
            power = float(np.mean(mean_power_per_bin[mask]))
        out.append(amplitude_to_db(float(np.sqrt(max(power, 0.0)))))
    return out


def compute_band_energy(mean_power_per_bin: np.ndarray, freqs: np.ndarray,
                        low_hz: float, high_hz: float) -> float:
    """Legacy 7-band RMS energy (dB) from precomputed per-bin mean power."""
    band_mask = (freqs >= low_hz) & (freqs <= high_hz)
    if not np.any(band_mask):
        return SILENCE_FLOOR_DB
    power = float(np.mean(mean_power_per_bin[band_mask]))
    return amplitude_to_db(float(np.sqrt(max(power, 0.0))))


def compute_dynamic_range(y: np.ndarray, sr: int) -> float:
    """Windowed-RMS dynamic range: p95 − p5 of 100 ms RMS frames (dB)."""
    frame_length = max(1, int(sr * 0.1))
    hop_length = max(1, frame_length // 2)
    rms_frames = _rms_frames(y, frame_length, hop_length)
    rms_frames = rms_frames[rms_frames > 1e-10]
    if len(rms_frames) == 0:
        return 0.0
    db_frames = 20.0 * np.log10(rms_frames)
    return float(np.percentile(db_frames, 95) - np.percentile(db_frames, 5))


def classify_chunk(power_per_bin: np.ndarray, freqs: np.ndarray, rms_db: float,
                   rms_var: float, centroid_hz: float, flatness: float) -> str:
    """
    Heuristic speech/music/silence classifier for one time chunk.

    No ML model (keeps the bundled Python light). Uses band-energy distribution,
    temporal amplitude modulation (speech is syllabic → high RMS variance), the
    spectral centroid, and spectral flatness. Tunable; upgrade later behind the
    same interface.
    """
    if rms_db < SILENCE_RMS_DB:
        return "silence"

    total = float(np.sum(power_per_bin)) + 1e-12

    def band_frac(lo, hi):
        m = (freqs >= lo) & (freqs < hi)
        return float(np.sum(power_per_bin[m])) / total

    sub = band_frac(20, 120)          # deep low end — common in music, rare in speech
    speech_band = band_frac(300, 3400)  # telephone/voice band
    highs = band_frac(6000, 20000)    # air/cymbals — music

    speech_score = 0.0
    music_score = 0.0

    # Voice energy concentrated in the speech band.
    if speech_band > 0.55:
        speech_score += 1.0
    if speech_band > 0.7:
        speech_score += 0.5

    # Syllabic amplitude modulation (variance of frame RMS across the chunk).
    if rms_var > 12.0:
        speech_score += 1.0
    elif rms_var < 5.0:
        music_score += 0.7

    # Deep bass and airy highs point to full-range music.
    if sub > 0.06:
        music_score += 0.8
    if highs > 0.04:
        music_score += 0.6

    # Bright, broadband content → music; mid-focused → speech.
    if centroid_hz > 3000:
        music_score += 0.5
    elif centroid_hz < 1800:
        speech_score += 0.4

    # Very tonal (low flatness) sustained content leans musical.
    if flatness < 0.02:
        music_score += 0.3

    if music_score == 0.0 and speech_score == 0.0:
        return "music"
    return "speech" if speech_score > music_score else "music"


def build_segments(frames: list) -> list:
    """Collapse consecutive same-class frames into contiguous segments."""
    if not frames:
        return []
    segs = []
    cur = {"class": frames[0]["class"], "start": 0.0}
    for i in range(1, len(frames)):
        if frames[i]["class"] != cur["class"]:
            cur["end"] = frames[i]["t"]
            segs.append(cur)
            cur = {"class": frames[i]["class"], "start": frames[i]["t"]}
    cur["end"] = frames[-1]["t"]
    segs.append(cur)
    return segs


def smooth_classes(labels: list) -> list:
    """3-tap median smoothing to kill single-frame class flip-flops."""
    if len(labels) < 3:
        return labels
    out = labels[:]
    for i in range(1, len(labels) - 1):
        window = labels[i - 1:i + 2]
        # majority vote
        for c in ("silence", "speech", "music"):
            if window.count(c) >= 2:
                out[i] = c
                break
    return out


def summarize_content(frames: list) -> str:
    """Top-level content_type from the frame classes (excludes silence)."""
    voiced = [f["class"] for f in frames if f["class"] != "silence"]
    if not voiced:
        return "silence"
    speech = voiced.count("speech")
    music = voiced.count("music")
    total = len(voiced)
    if speech / total > 0.8:
        return "speech"
    if music / total > 0.8:
        return "music"
    return "mixed"


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: spectrum.py <audio_file>"}))
        sys.exit(1)

    audio_path = sys.argv[1]

    try:
        y, sr = _load_audio(audio_path)
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": f"Failed to load audio: {exc}"}))
        sys.exit(1)

    duration = float(len(y) / sr) if sr else 0.0

    # One STFT drives the whole-file curve, the legacy bands, and the per-frame
    # time slices (each is just a column range of this matrix).
    stft = _stft_mag(y, N_FFT, HOP)       # (bins, T)
    power = stft ** 2
    freqs = _fft_freqs(sr, N_FFT)
    n_cols = power.shape[1]

    centers = _grid_freqs()
    edges = _band_edges(centers)

    # Whole-file mean power per bin → legacy bands + fine curve.
    mean_power = np.mean(power, axis=1) if n_cols > 0 else np.zeros(power.shape[0])
    band_results = {
        name: compute_band_energy(mean_power, freqs, float(lo), float(hi))
        for name, lo, hi in BANDS
    }
    curve_db = curve_from_power(mean_power, freqs, centers, edges)

    # Per-frame time sampling (PRD 03/04).
    frames = []
    if n_cols > 0 and duration > 0:
        # Choose frame count so slices are ≥ MIN_FRAME_SECONDS.
        by_duration = max(1, int(duration / MIN_FRAME_SECONDS))
        n_frames = max(1, min(MAX_FRAMES, by_duration))
        col_edges = np.linspace(0, n_cols, n_frames + 1, dtype=int)
        col_time = _frames_to_time(np.arange(n_cols), sr, HOP)

        # Precompute per-column features for classification.
        centroid_cols = _spectral_centroid(stft, freqs)
        flatness_cols = _spectral_flatness(stft)

        for fi in range(n_frames):
            c0, c1 = col_edges[fi], max(col_edges[fi] + 1, col_edges[fi + 1])
            chunk_power = power[:, c0:c1]
            chunk_mean_power = np.mean(chunk_power, axis=1)
            t = float(col_time[c0]) if c0 < len(col_time) else float(fi)

            # RMS of the chunk (from full-band power sum per column → dB).
            col_rms = np.sqrt(np.sum(chunk_power, axis=0) / max(power.shape[0], 1))
            col_rms_db = 20.0 * np.log10(np.maximum(col_rms, 1e-10))
            rms_db = float(np.mean(col_rms_db))
            rms_var = float(np.var(col_rms_db))

            centroid_hz = float(np.mean(centroid_cols[c0:c1]))
            flatness = float(np.mean(flatness_cols[c0:c1]))

            cls = classify_chunk(chunk_mean_power, freqs, rms_db, rms_var,
                                 centroid_hz, flatness)
            frames.append({
                "t": round(t, 3),
                "db": [round(v, 2) for v in
                       curve_from_power(chunk_mean_power, freqs, centers, edges)],
                "rms": round(rms_db, 2),
                "class": cls,
            })

        smoothed = smooth_classes([f["class"] for f in frames])
        for f, c in zip(frames, smoothed):
            f["class"] = c

    segments = build_segments(frames)
    content_type = summarize_content(frames)

    # Legacy scalar spectral characteristics (unchanged): a separate
    # feature-level STFT (2048/512), not the 4096/1024 STFT above — see SCALAR_N_FFT.
    scalar_stft = _stft_mag(y, SCALAR_N_FFT, SCALAR_HOP)
    scalar_freqs = _fft_freqs(sr, SCALAR_N_FFT)
    centroid_frames = _spectral_centroid(scalar_stft, scalar_freqs)
    spectral_centroid = float(np.mean(centroid_frames)) if len(centroid_frames) else 0.0
    rolloff_frames = _spectral_rolloff(scalar_stft, scalar_freqs, SCALAR_ROLLOFF_PERCENT)
    spectral_rolloff_85 = float(np.mean(rolloff_frames)) if len(rolloff_frames) else 0.0
    dynamic_range = compute_dynamic_range(y, sr)

    output = {
        "bands": band_results,
        "curve": {
            "freqs": [round(float(f), 2) for f in centers],
            "db": [round(v, 2) for v in curve_db],
        },
        "frames": frames,
        "segments": [
            {"class": s["class"], "start": round(s["start"], 3), "end": round(s["end"], 3)}
            for s in segments
        ],
        "content_type": content_type,
        "spectral_centroid": spectral_centroid,
        "spectral_rolloff_85": spectral_rolloff_85,
        "dynamic_range": dynamic_range,
    }

    print(json.dumps(output))


if __name__ == "__main__":
    main()
