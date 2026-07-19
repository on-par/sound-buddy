# Decision: Secondary audio-device measurement on macOS — spike findings

- **Issue:** [#459](https://github.com/on-par/sound-buddy/issues/459) (spike)
- **Epic:** [#455](https://github.com/on-par/sound-buddy/issues/455) — Measurement source for live capture
- **Date:** 2026-07-18
- **Status:** Decided
- **Decision:** **Recommend Aggregate Device guidance as the near-term production path.**
  Session-channel measurement ([#456](https://github.com/on-par/sound-buddy/issues/456))
  remains the MVP. **Defer native secondary-device support** ([#460](https://github.com/on-par/sound-buddy/issues/460))
  until it is gated on real-rig drift numbers, which this run could not produce
  (see [Environment constraint](#environment-constraint)).

This is a decision-only spike. It changes **no** product code — no changes to
`stream.py`, `live-capture.ts`, or the renderer. It adds a standalone harness
(`packages/audio-engine/scripts/spike_dual_capture.py`) plus this ADR.

---

## Environment constraint

The machine this spike ran on (the factory build Mac mini) has **zero audio
input devices** — `sd.query_devices()` returns only outputs ("LG FHD", "Mac
mini Speakers"). Every finding below is labeled **measured here** (proved by
running the harness on this machine) or **documented behavior — pending
real-rig confirmation** (PortAudio/sounddevice's documented behavior, not yet
exercised against real hardware). No measurement numbers in this ADR are
fabricated; [How to reproduce](#how-to-reproduce) gives Patrick the exact
commands to fill in the pending ones on the real rig (M32R + USB mic +
MacBook mic + Aggregate Device).

---

## Concurrency

**Documented behavior — pending real-rig confirmation.** PortAudio's stream
API is explicitly designed around one stream per client use: "To open an
input-only or output-only stream use `InputStream`... A stream provides
access to audio hardware represented by one or more devices" (python-sounddevice
[stream docs](https://python-sounddevice.readthedocs.io/en/latest/api/streams.html)).
Opening two independent `sd.InputStream`s on two **distinct** CoreAudio
devices is a standard, supported pattern — each stream gets its own callback
thread and its own PortAudio stream handle; devices are the unit of
contention, not the process. The library's own caveat is about **one
device**: "portable applications should assume that a device may be
simultaneously used by at most one stream" (same docs) — i.e. two streams on
two *different* devices is fine, but two streams on the *same* device is
implementation-defined (works on some CoreAudio configurations, not
guaranteed).

**Measured here.** The harness enumerates input devices via `sd.query_devices()`
and, with zero input devices present, correctly reports that rather than
crashing:

```
$ python3 spike_dual_capture.py --list-devices
{"devices": []}
$ python3 spike_dual_capture.py
{"error": "no input devices found — connect an input device or create an Aggregate Device in Audio MIDI Setup"}
(exit code 1)
```

This live-proves the **no-input-device degradation path**: the harness fails
fast with an actionable message instead of hanging or crashing into a
traceback. The **single-device / `--allow-same-device`** path (opening two
streams against the same device) is implemented and unit-tested against
synthetic data (`test_spike_dual_capture.py`), but could not be exercised
against real PortAudio on this machine — there is no device to open a stream
on at all, same-or-different. Two genuinely distinct concurrent `InputStream`s
were not run here for the same reason.

---

## Timestamps & sample rates

**Documented behavior — pending real-rig confirmation.** PortAudio's per-callback
`time_info` exposes three fields relevant here (`PaStreamCallbackTimeInfo`,
[PortAudio docs](https://files.portaudio.com/docs/v19-doxydocs/structPaStreamCallbackTimeInfo.html)):
`inputBufferAdcTime` (when the first sample of this buffer hit the ADC),
`currentTime` (when the callback fired), both synchronized to that stream's
own `Pa_GetStreamTime()` clock. Critically, `Pa_GetStreamTime` documentation
is explicit that these times are "according to the clock used to generate
buffer timestamps **for the associated stream**" — each stream has its own
time base. Two streams opened on two different CoreAudio devices sit in
**independent clock domains** with **independent default sample rates**: a
board interface typically reports 48 kHz, while a MacBook's built-in mic may
report 44.1 kHz or 48 kHz depending on macOS version and Bluetooth device
history. PortAudio does not lock these together — there is no cross-stream
sample-clock sync API in the InputStream model.

**Measured here.** `spike_dual_capture.py`'s runtime records `host_time`
(`time.monotonic()`, wall-clock reference), `adc_time` (`time_info.inputBufferAdcTime`),
`current_time` (`time_info.currentTime`), and `frames`/`flags` per callback for
each stream independently (`_run_stream`). `compute_stream_stats` turns that
into an effective sample rate via a least-squares slope of cumulative frames
vs. `host_time` — verified against synthetic data in
`test_spike_dual_capture.py::ComputeStreamStats` (exact-nominal-rate and
100-ppm-fast cases both recover the injected rate within 1 ppm).

---

## Drift over 10–30 min

**Method (implemented and unit-tested here).** `compute_relative_drift(stats_a, stats_b)`
takes each stream's `drift_ppm` (from `compute_stream_stats`), computes the
relative ppm between them, and projects the resulting inter-stream offset at
`PROJECTION_WINDOWS_SECS = (600, 1800)` — the issue's 10–30 minute range — via
`offset_ms = relative_ppm × 1e-6 × window_secs × 1000`. A verdict of `"warn"`
fires once `abs(relative_ppm) >= DRIFT_WARN_PPM` (25 ppm, ≈45 ms over 30
minutes — see [Recommendation](#recommendation) for why that threshold).

**Expected magnitude — documented behavior, pending real-rig confirmation.**
Independent consumer-grade audio clocks (built-in laptop mic vs. a
USB/Firewire/board interface) commonly drift tens of ppm relative to each
other; ~20–50 ppm is a typical range cited across audio-sync engineering
literature for uncorrected consumer crystal oscillators, which projects to
roughly **tens to ~180 ms of accumulated inter-stream offset over 30
minutes** — audible/visible drift for anything doing sample-accurate
alignment, though tolerable for a metering-only measurement source if
surfaced honestly.

**Measured results.** None — this machine has no input devices, so no live
dual-stream run (of any duration) was possible. This is a **pending
real-rig run**, not a negative result. See [How to reproduce](#how-to-reproduce).

---

## Device-class differences

**Documented behavior — pending real-rig confirmation.** Three device
classes matter for the measurement-source use case:

- **Built-in mic** (MacBook): its own independent clock domain, typically
  44.1/48 kHz default, most likely to drift relative to a board interface.
- **USB measurement mic**: its own independent clock domain, but often more
  stable (dedicated crystal, no shared power/thermal load with a laptop's
  built-in hardware) — still independent from the board's clock.
- **Aggregate Device** (user-created in Audio MIDI Setup): macOS/CoreAudio
  presents *multiple physical devices as one logical device* to any client,
  including PortAudio/`sounddevice`. Crucially, this means **the OS, not the
  application, does the clock alignment** — CoreAudio picks a designated
  clock-source sub-device and resamples/drift-corrects the others internally
  before the app ever sees a single stream of frames. This is exactly the
  mechanism a native dual-stream implementation would otherwise have to
  reimplement in userspace (per-stream timestamp correlation, drift
  estimation, resampling or realignment) — Aggregate Device gets it "for
  free" at the OS level, at the cost of requiring manual user setup outside
  the app.

No device-class comparison could be measured here (no input devices at all).

---

## Permission / lifecycle states to surface

**Measured/read here** (from `app/electron/ipc/live-capture.ts:64`,
`ensureMicrophoneAccess`): macOS's TCC (Transparency, Consent, and Control)
mic grant is **one process-level permission** covering all Core Audio input
devices — enumeration never prompts, only `start-live` requests the grant
lazily. A second input device therefore adds **no new permission prompt**;
today's single grant already covers a future secondary stream.

**Gap — not implemented today, named for #460.** Disconnect handling has no
existing path for a *second* source: today's engine is built around exactly
one `liveProcess` (`live-capture.ts`) driving exactly one `sd.InputStream`
(`stream.py`). A production secondary-device feature needs:

- a distinct **"measurement source lost"** lifecycle state, surfaced
  independently from board-recording status — losing the measurement mic
  must *not* kill or pause the board multitrack recording;
- either a **second stream process** (mirroring the existing single-process
  model, doubled) or a **multi-source stream controller** inside one process
  (per epic #455's architecture notes) — the latter avoids doubling Python
  process/IPC overhead but is a bigger engine change;
- **event namespacing** so meter/window JSON-lines events from two streams
  don't collide on stdout (today's protocol assumes one stream → one JSON
  stream);
- **independent finalization** — a killed/disconnected measurement stream
  must not block the board session's stem finalization (mirrors
  `SessionRecorder.finalize()`'s idempotent design, but per-source).

This spike's harness proves the *degradation* half of this (a stream error is
caught, logged as a lifecycle event, and the report still finalizes with
`both_streams_ran: false` instead of crashing — see `_run_stream`'s
try/except and `build_report`'s `both_streams_ran` derivation, unit-tested in
`test_spike_dual_capture.py::BuildReport`), but the *concurrent, namespaced,
independently-finalized* production shape is unbuilt — that's #460's scope.

---

## Recommendation

**Aggregate Device guidance now; gate native dual-stream support (#460) on
real-rig numbers.**

1. **Session-channel measurement (#456) remains the MVP.** It reuses the
   single existing capture stream, so it has zero clock-drift risk and no new
   engine work — ship this first regardless of #460's outcome.
2. **For a true second physical device today, recommend Aggregate Device
   guidance** (point users at macOS's Audio MIDI Setup) rather than building
   native dual-stream capture. CoreAudio's Aggregate Device already solves
   the exact problem — one clock-corrected stream — that native dual-stream
   support would need to reimplement in userspace.
3. **Gate native secondary-device support (#460) on real-rig drift numbers.**
   This spike could not produce them (no input hardware on the build
   machine). Before greenlighting #460, run the harness on the real rig per
   [How to reproduce](#how-to-reproduce) and confirm relative drift stays in
   an expected/manageable range over a realistic service length.

**Named risks, if #460 is later greenlit:**

- **Silent drift = misleading measurement accuracy** — the exact risk the
  issue calls out. A user trusting an unmonitored measurement source for
  30+ minutes could be looking at a reading that's drifted tens to ~180 ms
  out of alignment with the board feed, with no indication anything is wrong.
  **Safeguard:** continuous per-stream timestamp logging plus a live drift
  monitor with a user-visible warning once `abs(relative_ppm) >= DRIFT_WARN_PPM`
  (25 ppm ≈ 45 ms/30 min, as implemented in `compute_relative_drift`).
- **Sample-rate mismatch** between devices (e.g. 44.1 kHz mic vs. 48 kHz
  board). **Safeguard:** an explicit resample-or-realign strategy decided
  before #460 starts — this spike deliberately does not attempt one (see
  Non-goals).
- **Mid-service device loss** (measurement mic unplugged, USB dropout).
  **Safeguard:** disconnect surfacing as a distinct, non-fatal lifecycle
  state (see previous section) plus a defined reconnect policy (auto-retry
  vs. requiring the user to restart the measurement source).

---

## How to reproduce

Real-rig commands for Patrick (M32R via USB + a USB or built-in measurement
mic), using this repo's venv:

```bash
# 1. List available input devices — confirm the M32R and a measurement mic
#    both enumerate.
./.venv/bin/python3 packages/audio-engine/scripts/spike_dual_capture.py --list-devices

# 2. 60 s sanity run — confirms both streams open and produce timing data.
./.venv/bin/python3 packages/audio-engine/scripts/spike_dual_capture.py \
  --primary "M32" --secondary "MacBook Pro Microphone" \
  --duration 60 --out /tmp/spike-459-sanity.json

# 3. 600 s (10 min) drift run — the issue's minimum drift window.
./.venv/bin/python3 packages/audio-engine/scripts/spike_dual_capture.py \
  --primary "M32" --secondary "MacBook Pro Microphone" \
  --duration 600 --out /tmp/spike-459.json

# 4. Aggregate Device comparison — create an Aggregate Device combining the
#    M32R and the measurement mic in Audio MIDI Setup, then run against it as
#    a single device with --allow-same-device (only one PortAudio device
#    index for a true two-stream comparison, so this validates the harness's
#    same-device path against the Aggregate Device's OS-level clock
#    correction rather than two independent streams).
./.venv/bin/python3 packages/audio-engine/scripts/spike_dual_capture.py \
  --primary "Aggregate Device" --secondary "Aggregate Device" \
  --allow-same-device --duration 600 --out /tmp/spike-459-aggregate.json
```

Inspect `relative_drift.relative_ppm`, `relative_drift.projections`, and
`relative_drift.verdict` in the output JSON, plus each stream's `stats.*.drift_ppm`
and `stats.*.jitter_ms`, and paste the real numbers into a follow-up ADR
update or #460's spec when that story is picked up.
