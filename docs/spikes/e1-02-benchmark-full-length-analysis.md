# Spike e1-02 — Benchmark full-length service + large multichannel analysis

**Issue:** [#126](https://github.com/on-par/sound-buddy/issues/126) · **Type:** spike ·
**Epic:** core-loop · **Area:** analysis
**Status:** COMPLETE — measured; recommendation below.

## Question

`packages/audio-engine/scripts/spectrum.py` does `librosa.load(audio_path, sr=None, mono=True)`
— it loads the **entire** waveform into memory, then computes one full-file STFT
(`np.abs(librosa.stft(y, n_fft=4096, hop_length=1024))`) that drives the curve, the legacy
bands, and every per-frame slice. There were no max-duration/size guards or benchmarks.

Does a full-length (90–120 min) service file analyze within the **<5 min cold-start** target —
or at all? And where does the pipeline break on a large multichannel session?

## How this was measured

Throwaway harness `packages/audio-engine/scripts/benchmark.mjs` (peak RSS via `_measure.py` /
`getrusage(RUSAGE_CHILDREN)`). It exercises the same three stages the app runs concurrently in
`analyzeAudio` — `sox stat` ‖ `ffprobe` ‖ `spectrum.py` — plus the multichannel channel-split
path (`extractChannels` → per-channel `spectrum.py`). **No production code was modified.**

Inputs are synthetic sine-mix recordings from `sox` (content is irrelevant to compute cost;
classification still runs). Stereo, 48 kHz, 16-bit.

- **Machine:** Apple Silicon, **16 GB RAM**, macOS — a realistic low end of the target user's Mac.
- **Interpreter:** local `.venv`, librosa 0.11.0, numpy 2.4.6.
- Reproduce: `node packages/audio-engine/scripts/benchmark.mjs --out results.json`

Per-stage wall-clock is measured **sequentially** to isolate each stage. In production the three
stages run concurrently (`Promise.all`), so real end-to-end latency ≈ **max(stage)**, which is
always `spectrum.py`. `sox` and `ffprobe` are streaming/metadata-only and stay negligible
(< 2 s, < 20 MB) at every size, so the numbers below track `spectrum.py`.

## Results — stereo sweep

| Duration | File size | sox | ffprobe | spectrum.py | spectrum peak RSS | JSON out | e2e (≈spectrum) | <5 min? |
|---|---|---|---|---|---|---|---|---|
| 1 min | 11 MB | 0.0 s | 0.0 s | 1.5 s | 0.53 GB | 11.4 KB | 1.5 s | ✅ |
| 2 min | 22 MB | 0.1 s | 0.1 s | 1.8 s | 0.85 GB | 11.4 KB | 1.8 s | ✅ |
| 15 min | 165 MB | 0.4 s | 0.0 s | 9.5 s | 2.61 GB | 11.4 KB | 9.5 s | ✅ |
| 30 min | 330 MB | 0.7 s | 0.1 s | 23.8 s | 3.65 GB | 11.5 KB | 23.8 s | ✅ |
| **45 min** | 494 MB | 1.2 s | 0.0 s | **2 m 34 s** | 4.26 GB¹ | 11.2 KB | 2 m 34 s | ⚠️ swap thrash |
| **60 min** | 659 MB | 1.5 s | 0.3 s | **did not complete**² | > RAM | — | — | ❌ thrash-stall |
| 90 min | ~1.0 GB | ~2 s | ~0.5 s | ~78 s³ | **~11 GB (modeled)** | ~11.5 KB | infeasible⁴ | ❌ OOM |
| 120 min | ~1.4 GB | ~2 s | ~0.5 s | ~105 s³ | **~15 GB (modeled)** | ~11.5 KB | infeasible⁴ | ❌ OOM |

¹ Resident is capped by physical RAM once swapping begins; true demand ≈ 4.7 GB. The 45-min run
finished but at **2 m 34 s vs a ~37 s compute-only extrapolation — a 4× slowdown that is entirely
swap I/O**, not CPU.
² With no other heavy app running, the 60-min run drove the machine to 12 GB swap, `spectrum.py`
went to 0 % CPU (blocked on page I/O) and made no forward progress; killed after minutes.
³ Compute-only extrapolation from the clean region (≤ 30 min, ≈ 0.8 s per audio-minute). This is
what a machine with enough RAM would spend on CPU — **well under the 5-min target.**
⁴ Not because of CPU, but because peak memory (~11–15 GB) exceeds usable RAM on 8–16 GB Macs
(the app's Electron/Chromium processes already hold 1–2 GB), so the run OOMs or thrashes.

## Results — multichannel (32ch × 5 min session)

| Stage | Time | Peak RSS |
|---|---|---|
| ffprobe (whole file) | 0.2 s | 24 MB |
| ffmpeg split, 1 channel (`pan=mono`) | 0.3 s | 29 MB |
| spectrum.py, 1 channel (5 min mono) | 2.0 s | 1.78 GB |
| **est. full 32ch session (serial split + spectrum)** | **~1 m 14 s** | ~1.8 GB (one channel at a time) |

`extractChannels` splits an N-channel file into N mono temp WAVs, then the app analyzes each. For
**short** sessions this is fine: channels run one at a time, so peak memory is per-channel, not
additive, and total time is modest.

The danger is a **full-length** multichannel session (a 90–120 min, 32-channel M32 capture):
- Each channel is then a 90–120 min mono file → hits the **same per-channel memory wall** as the
  stereo case above (~11–15 GB), one channel after another.
- The split writes **N full-length mono WAVs to the temp dir** simultaneously (32 × ~500 MB ≈
  **16 GB of scratch disk** for a 90-min session) before any cleanup.
- Total wall-clock is **× N channels** serially (≈ 32 × single-file time).

## Findings

1. **Memory, not CPU, is the wall.** `spectrum.py` peak memory grows linearly with duration:
   ~0.5 GB (1 min) → 2.6 GB (15 min) → 3.65 GB (30 min) → ~4.7 GB (45 min). A simple array model
   (float32 waveform + complex64 STFT + `abs` + `power`, all co-resident during `power = stft**2`,
   plus the `spectral_centroid(y=y)` / `spectral_rolloff(y=y)` recomputes) matches the measured
   points within ~15 % and projects **~11 GB at 90 min and ~15 GB at 120 min**. CPU, by contrast,
   is cheap: extrapolated compute-only time for 120 min is **< 2 min**, comfortably inside the
   5-min target.

2. **The <5 min cold-start promise is NOT met for 90–120 min stereo on the reference 16 GB Mac.**
   Not by a small margin from CPU — the run does not complete at all. The practical ceiling on
   this machine is **~30 min clean / ~45 min degraded (swap)**; at ~60 min it thrashes to a stall.
   In the real app (Electron + Chromium resident) the swap onset happens *earlier* than in this
   headless harness. **First grade < 5 min from cold start: NOT met; a 90–120 min file cannot be
   graded at all without a fix.**

3. **Failure mode = OOM / swap thrash**, triggered by **audio duration** (∝ sample count), not
   file size or channel count per se. Trigger characteristics on 16 GB: onset ~45 min (4× wall
   slowdown), hard stall ~60 min, infeasible ≥ 90 min. Multichannel adds a second failure axis:
   **temp-disk exhaustion** (N full-length mono stems written at once) plus **× N serial time**.

4. **Cold-start (numba JIT) is a one-time ~17 s tax, not a per-run one.** The very first
   `spectrum.py` invocation after install pays ~17–19 s of numba JIT compilation (measured: a cold
   1-min run took 20.8 s vs 1.5 s warm). numba caches compiled kernels to disk across *processes*,
   so subsequent grades — even in fresh Python processes, which is how `spectrum.ts` spawns it —
   do not pay it again. Budget ~17 s for the user's first-ever grade.

5. **The 1 MiB `maxBuffer` in `spectrum.ts` is safe.** `spectrum.py` output is bounded by
   `MAX_FRAMES = 24` and `GRID_POINTS = 48`, so JSON stays **~11.4 KB at every duration** (≈ 90×
   under the 1 MiB cap). Long files do **not** risk a stdout-buffer overflow. No action needed here.

## Recommendation

**Add a large-file guard now (fast follow), and plan chunked/streamed spectrum analysis as the
real fix.** Not "fine as-is": the core promise breaks on exactly the inputs it targets (full-length
services).

- **Immediate — guard (S):** Before `librosa.load`, read duration from the (already-run) ffprobe
  result and **refuse / warn above a threshold**, with a clear message instead of an OOM crash.
  Recommended threshold: **~40 min** for the current whole-file implementation. Rationale: 30 min
  is clean (24 s, 3.65 GB) and 45 min already thrashes 4× under swap on 16 GB; 40 min keeps peak
  demand ≈ 4 GB, which fits alongside the Electron app on an 8 GB machine with headroom. Make the
  threshold configurable and memory-aware if cheap. This unblocks a graceful UX and is the gate
  #148 (timeout ceiling) needs — the timeout must exceed the *guarded* worst case (~40 min ≈ ≤ 40 s
  compute), not the unbounded one.

- **Real fix — chunked/streamed STFT (M):** Process the file in overlapping windowed blocks
  (`librosa.stream` or manual framing) and accumulate the mean-power spectrum and per-frame slices
  incrementally, so peak memory is **O(block)** instead of **O(whole file)**. Compute time is
  already within budget, so this is purely a memory refactor and would lift the duration ceiling to
  the full 90–120 min range (and beyond) on any Mac. This is the path to actually keeping the
  "handle a 90–120 min service, first grade < 5 min" promise.

- **Multichannel:** the same chunking fixes per-channel memory. Separately, **stream channel
  extraction** (split → analyze → delete one channel at a time) so temp disk is O(1 stem), not
  O(N stems), and consider a parallelism cap so N channels don't each spin up a multi-GB Python
  process at once.

## Follow-up issue stubs

Drafted for the backlog; numbers reference this spike.

### Stub A — Large-file duration guard on analysis (effort: S, P1, area: analysis)
> **Problem:** `spectrum.py` loads the whole waveform + full-file STFT into RAM; peak memory grows
> ~linearly with duration (measured: 3.65 GB @ 30 min, ~4.7 GB @ 45 min, modeled ~11 GB @ 90 min,
> ~15 GB @ 120 min — see [spike e1-02](docs/spikes/e1-02-benchmark-full-length-analysis.md)). On a
> 16 GB Mac it thrashes at ~45 min and stalls by ~60 min. Until chunking lands, unguarded
> full-length files OOM the app.
> **Scope (in):** read duration from the existing ffprobe result before `librosa.load`; if it
> exceeds a configurable threshold (default ~40 min), fail fast with a clear, user-facing message
> ("This recording is N min; full-length analysis isn't supported yet — trim to under 40 min").
> Wire the threshold so #148's timeout ceiling can key off the guarded worst case. **(out):** the
> actual chunking fix (Stub B).
> **Acceptance:** a 90-min file returns a friendly guard message in < 2 s instead of thrashing;
> threshold is one constant/config; unit test covers over/under threshold.

### Stub B — Chunked / streamed spectrum analysis to remove the memory ceiling (effort: M, P1, area: analysis)
> **Problem:** whole-file STFT makes peak memory O(duration) (~11–15 GB at 90–120 min), which is
> why full-length services can't be graded (spike e1-02). CPU is *not* the bottleneck (compute-only
> ≈ < 2 min at 120 min), so this is a pure memory refactor.
> **Scope (in):** refactor `spectrum.py` to process overlapping windowed blocks (`librosa.stream`
> or manual framing), accumulating mean-power bands, the fine curve, and the ≤ 24 per-frame slices
> incrementally so peak memory is O(block). Preserve the exact JSON contract (`bands`, `curve`,
> `frames`, `segments`, `content_type`, scalars) — guard with a golden-output test against a short
> fixture so numbers don't drift. Remove/raise the Stub A guard once landed.
> **Acceptance:** 120-min stereo analyzes in < 5 min with peak RSS < ~1.5 GB; band/curve/scalar
> outputs match the pre-refactor values within rounding on a fixture file.

### Stub C — Stream multichannel extraction + cap concurrency (effort: S/M, area: analysis)
> **Problem:** `extractChannels` writes all N mono stems to temp before analysis (~16 GB scratch
> for a 90-min 32ch session) and each full-length channel hits the same per-channel memory wall,
> × N serially (spike e1-02).
> **Scope (in):** split → analyze → delete one channel at a time (O(1) temp stems); bound how many
> channel analyses run at once. Depends on Stub B for per-channel memory.
> **Acceptance:** a 90-min 32ch session peaks at O(1) stem on disk and one Python analysis process'
> memory at a time.
