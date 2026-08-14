# Audio-engine DSP stays numpy-only; the packaged Python runtime carries no scipy

- Status: Accepted
- Date: 2026-08-14

## Context

Issue #665 targets the final size chunk of the packaged Python runtime: scipy
(~100 MB) is the largest remaining dependency after numpy (33 MB) stays. The
investigation enumerated every scipy use in the audio pipeline — spectrum.py's
`get_window("hann", n_fft, fftbins=True)` (one call site, in `_stft_mag`) and
stream.py's `scipy.signal.stft` (one call site, in `analyze_signal`, under
scipy 1.18 defaults: hann_periodic window, boundary='zeros', padded=True,
scaling='spectrum'). Both are exactly reproducible in numpy (closed-form
periodic Hann; zero-pad both ends by nperseg//2, end-pad to an integer frame
count, sliding-window framing, rfft, divide by win.sum()), verified to
float32-rounding parity (~1.7e-8 max |Δ|). The acceptance criteria for #665
forbid scipy in the bundled site-packages, so once the port lands, the runtime
must never silently re-grow it.

## Decision

The packaged Python runtime ships numpy + soundfile + sounddevice and no scipy.
All audio-engine DSP (stream.py, spectrum.py, playback.py, waveform_peaks.py)
must be expressible in numpy or a vendored equivalent; re-adding a heavy
scientific dependency (scipy, numba, librosa, …) to the runtime requires a
written size-budget decision in the same PR, not a silent requirements.txt
line. The scipy.signal.stft semantics are pinned by a drift test against the
installed scipy in the dev venv, so any future numpy port is provably faithful
to the library it replaces (same pattern #662 established for librosa).

## Consequences

Positive: ~100 MB off the installed app (≈440 → ≈340 MB); faster site-packages
prune and smaller download; the drift tests keep the numpy DSP self-verifying
against the libraries it replaced. Negative: future DSP that genuinely needs
scipy (e.g. an advanced filter design) must be numpy-ported or argued for on
size cost; the two numpy STFTs (spectrum.py's magnitude `_stft_mag` vs
stream.py's scaled complex `_windowed_stft`) are hand-maintained and
drift-guarded rather than shared.

## References

- [Issue #662 plan (librosa removal) — the same drift-test pattern for a removed dependency](.factory/plans/issue-662.md)
- [Pre-#662 baseline commit for the fixture comparison (librosa-era spectrum.py)](df8837f^)
- [Issue #665](https://github.com/on-par/sound-buddy/issues/665)
