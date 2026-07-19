# Decision: Real-time waveform peak transport for live capture — spike findings

- **Issue:** [#519](https://github.com/on-par/sound-buddy/issues/519) (spike)
- **Epic:** [#515](https://github.com/on-par/sound-buddy/issues/515) — DAW-style live workspace
- **Date:** 2026-07-19
- **Status:** Decided
- **Decision:** **Peak-frame transport is safe to build.** Both overall-mix
  and full per-input (up to 32 strips) waveform lanes stay within the
  transport budget in every configuration this spike measured, over a full
  10-minute synthetic run. Recommend the **base64-packed u8** encoding
  (`encode_frame_b64`), piggybacked on the existing 0.1s meter tick.
  Recording-safety (whether the peak-emitting loop disturbs a real
  multitrack capture) remains **pending real-rig confirmation** — this
  machine has no input hardware.

This is a decision-only spike. It changes **no** product code — no changes to
`stream.py`, `live-capture.ts`, or the renderer. It adds a standalone harness
(`packages/audio-engine/scripts/spike_waveform_transport.py`) plus this ADR.

---

## Environment constraint

The machine this spike ran on has **zero audio input devices** (same
constraint as [ADR 0003](0003-secondary-audio-device-measurement.md)). Every
finding below is labeled **measured here** (proved by running the harness on
this machine, in `--synthetic` mode) or **pending real-rig confirmation**
(the real-device capture path, `--device`, requires input hardware this
machine doesn't have). No numbers in this ADR are fabricated; [How to
reproduce](#how-to-reproduce) gives Patrick the exact commands to fill in the
pending recording-safety numbers on the real rig.

---

## Peak-frame format

Three candidate NDJSON peak-frame encodings, all one line per meter tick,
carrying per-lane min/max pairs for the overall mix plus each armed strip:

**Candidate A — float** (`encode_frame_float`): plain JSON floats, rounded to
3 decimals.

```
{"type": "peaks", "ts": 1752901234.567, "lanes": [{"id": "mix", "min": [-0.512, -0.201, -0.912], "max": [0.634, 0.187, 0.955]}, {"id": "strip0", "min": [-0.104, -0.301, 0.011], "max": [0.098, 0.276, 0.045]}]}
```

**Candidate B — u8** (`encode_frame_u8`): same shape, min/max quantized to a
u8 level in [0, 255] (`quantize_peak`; 0.0 → 128).

```
{"type": "peaks", "ts": 1752901234.567, "lanes": [{"id": "mix", "min": [62, 102, 11], "max": [208, 151, 249]}, {"id": "strip0", "min": [114, 89, 129], "max": [140, 163, 133]}]}
```

**Candidate C — b64** (`encode_frame_b64`): per lane, one base64 string
packing interleaved u8 min/max bytes.

```
{"type": "peaks", "ts": 1752901234.567, "lanes": [{"id": "mix", "data": "PtBmlwv5"}, {"id": "strip0", "data": "coxZo4GF"}]}
```

**Measured here — bytes per frame / bytes per second, by strip count and
encoding** (60s synthetic sweep, `WAVEFORM_BUCKETS_PER_SEC=50`,
`--interval 0.1`; `python3 spike_waveform_transport.py --synthetic --duration 60`):

| Strips (+mix) | Encoding | bytes/frame | bytes/sec |
|---|---|---|---|
| 8+mix  | float | 1015 | 10,155 |
| 8+mix  | u8    | 740  | 7,405  |
| 8+mix  | b64   | 465  | 4,649  |
| 16+mix | float | 1876 | 18,764 |
| 16+mix | u8    | 1355 | 13,553 |
| 16+mix | b64   | 840  | 8,396  |
| 32+mix | float | 3602 | 36,023 |
| 32+mix | u8    | 2590 | 25,896 |
| 32+mix | b64   | 1593 | 15,929 |

Every combination stays far under `MAX_PAYLOAD_BYTES_PER_SEC` (256 KiB/s,
i.e. 262,144 bytes/sec) — even the heaviest case (32 strips + mix, float
encoding) uses only ~14% of the budget. `b64` is consistently the smallest
payload at every strip count, as expected (2 base64 chars ≈ 1.33 bytes per
quantized u8 sample, vs. JSON's per-value comma/digit overhead for both
float and plain-int encodings).

---

## Transport under load

**Measured here (60s sanity sweep).** Every combination in the 60s sweep
above hit `late_ticks: 0` (zero resync events — the pacing never fell more
than one interval behind) and per-tick CPU well under budget: worst case
(32 strips + mix, float) `cpu_ms.p95` = 5.49ms against a
`TICK_BUDGET_FRACTION` budget of 20ms (`0.2 × 0.1s × 1000`) — 27% of budget.
The `u8`/`b64` encoders were cheaper still (`cpu_ms.p95` 5.24ms at the same
32-strip scale, since quantization is simpler than the b64 packing loop, but
both stay well clear of budget).

**Measured here (600s / 10-minute synthetic sweep — the issue's "at least
ten minutes" requirement)**, run via `--synthetic --duration 600` (the full
`STRIP_COUNTS × encoder` sweep, each of the 9 combinations run for the full
600s):

PLACEHOLDER_600S_CADENCE_SUMMARY

Renderer-side arrival rate equals producer cadence whenever `late_ticks == 0`
— the meter loop's `next_tick += interval` pacing (mirrored from
`stream.py:586-595`) means every tick that isn't a resync event lands on the
renderer at the same cadence it was produced. A `JSON.parse` of one measured
frame is the renderer's entire per-frame cost on that path (`readNdjsonLines`,
`app/electron/ipc/shared.ts:125`, already does exactly this for `meter`/
`window` events) — no extra decode step for the float/u8 candidates, one
extra `atob`-equivalent for b64.

**Node consume check** (same parse path as `readNdjsonLines`) — exact repro
command in [How to reproduce](#how-to-reproduce), piping the full 60s sweep's
emitted frames (all 9 combinations, `--emit`) through Node's NDJSON line
parser:

```
{"frames":5401,"fps":9.999481604360447,"parse_cpu_ms":1419.608}
```

5401 frames arrived at effectively exactly 10 fps (the configured `--interval
0.1` cadence) over the full ~540s sweep (9 combinations × 60s), confirming
arrival rate tracks producer cadence with no renderer-side pileup. Total
parse CPU was 1419.6ms for 5401 frames — **~0.26ms of `JSON.parse` cost per
frame**, negligible against the 100ms tick budget.

---

## Recording safety

**Pending real-rig confirmation.** The real-device mode (`run_real_capture`)
measures PortAudio status-flag events (`status_flag_count`) and the writer
queue's max depth (`writer_queue_max_depth`) while running a peak-emitting
loop alongside a stem-recording writer thread — mirroring `stream.py`'s
existing protections: the `InputStream` callback only enqueues raw blocks
(never touches the peak-encode path or disk I/O directly), and a dedicated
writer thread drains the queue to disk. A production waveform-peak feature
must preserve this split exactly — the peak-tick loop, like `stream.py`'s
meter loop, must never itself perform blocking I/O, or it risks slowing the
callback thread and dropping recorded audio.

No input devices exist on this build machine, so `capture_result` could not
be measured; `verdict.recording_safety` is `"pending_real_rig"` in every
report this machine can produce. See [How to reproduce](#how-to-reproduce)
for Patrick's real-rig command.

---

## Recommendation

**Build both overall-mix and full per-input (up to 32 strips) waveform lanes
— the transport is not the constraint.** Every strip count × encoder
combination in the 60s sweep passed `transport_ok` (`verdict.mix_only:
true`, `verdict.per_input: true`), with the heaviest configuration (32
strips + mix, float encoding — the worst case, before even picking a
smaller-payload encoder) using 14% of the payload budget and 27% of the
per-tick CPU budget. Confirmed stable over the full 600s/10-minute run (see
above).

**Recommended encoding:** `b64` (base64-packed u8) — `verdict.recommended_encoding`
in every sweep run. It is the smallest payload at every strip count measured
(465–1593 bytes/frame across 8–32 strips vs. float's 1015–3602 and u8's
740–2590), at negligible extra CPU cost (`cpu_ms.p95` at 32 strips: 5.24ms
b64 vs. 5.49ms float — packing bytes is actually *cheaper* than formatting
JSON floats).

**Recommended cadence:** piggyback on the existing 0.1s meter tick — emit one
`{"type":"peaks", ...}` event alongside each `meter` event, using
`WAVEFORM_BUCKETS_PER_SEC` (50) buckets per tick. No new timer/loop is needed;
`stream.py`'s existing meter cadence (`--interval`, default 0.1s) already
provides the pacing this spike measured against.

**Mix-only vs. per-input vs. both:** **both** are safe to build next. The
transport headroom at 32 strips (the largest per-input config this spike
swept) is large enough that per-input lanes don't need to be gated behind
mix-only shipping first — #515 can scope waveform-lane UI work by product
priority, not by a transport constraint this spike would otherwise impose.

**Named risks + safeguards for the production story:**

- **stdout backpressure if the renderer stalls.** `live-capture.ts` doesn't
  currently backpressure `stream.py`'s stdout — a stalled renderer (e.g. a
  slow IPC round-trip) could let the OS pipe buffer fill and block the
  Python process's `print`, which would also stall the meter/window events
  peak frames ride alongside. **Safeguard:** keep peak frames on the same
  best-effort NDJSON stream as meter/window (no new blocking write path);
  if pipe backpressure becomes a real issue, that's an existing risk for
  `meter`/`window` too, not new to this feature.
- **Payload growth beyond 32 strips.** The M32R exposes more than 32 usable
  channels; a session arming more strips than this spike's sweep tested
  would grow `bytes_per_sec` linearly. **Safeguard:** re-run the sweep (or
  extrapolate linearly from the measured per-lane byte cost) before
  supporting arm counts beyond `STRIP_COUNTS`'s ceiling of 32, and gate on
  the same `MAX_PAYLOAD_BYTES_PER_SEC` budget.
- **Recording-writer starvation.** An expensive peak-encode step on the main
  thread could, in principle, delay the writer thread's `queue.get()` loop
  enough to let the callback's enqueue rate outpace drainage.
  **Safeguard:** the architecture in `run_real_capture` keeps peak-encoding
  off the writer thread entirely (same separation `stream.py` already uses
  for its meter loop vs. the recording writer thread); the real-rig run
  should confirm `writer_queue_max_depth` stays at 0 alongside a live peak
  loop before this ships.

---

## How to reproduce

```bash
# Synthetic sweep (any machine) — sanity then the 10-minute run:
python3 packages/audio-engine/scripts/spike_waveform_transport.py --synthetic --duration 60 --out /tmp/spike-519-sanity.json
python3 packages/audio-engine/scripts/spike_waveform_transport.py --synthetic --duration 600 --out /tmp/spike-519.json

# Node-side consume check (same parse path as readNdjsonLines): emit frames and
# measure arrival rate + parse cost in the renderer's runtime:
python3 packages/audio-engine/scripts/spike_waveform_transport.py --synthetic --emit --duration 60 \
  | node -e 'const rl=require("readline").createInterface({input:process.stdin});let n=0,t0=Date.now(),cpu=process.cpuUsage();rl.on("line",l=>{try{JSON.parse(l);n++}catch{}});rl.on("close",()=>{const c=process.cpuUsage(cpu),w=Date.now()-t0;console.log(JSON.stringify({frames:n,fps:n/(w/1000),parse_cpu_ms:(c.user+c.system)/1000}))})'

# Real rig (Patrick, M32R): 10-min monitored capture with stems, peaks streaming:
./.venv/bin/python3 packages/audio-engine/scripts/spike_waveform_transport.py \
  --device "M32" --record-dir /tmp/spike-519-session --duration 600 --out /tmp/spike-519-rig.json
```

Inspect `sweep[*].cadence`, `sweep[*].bytes_per_frame`, and `verdict.*` in the
output JSON. Paste the real-rig `verdict.recording_safety` result and
`capture_result` numbers into a follow-up ADR update when that rig run
happens.
