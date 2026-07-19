# Decision: Real-time waveform peak transport for live capture — spike findings

- **Issue:** [#519](https://github.com/on-par/sound-buddy/issues/519) (spike)
- **Epic:** [#515](https://github.com/on-par/sound-buddy/issues/515) — DAW-style live workspace
- **Date:** 2026-07-19
- **Status:** Decided
- **Decision:** **PLACEHOLDER_DECISION**

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
PLACEHOLDER_EXAMPLE_FLOAT
```

**Candidate B — u8** (`encode_frame_u8`): same shape, min/max quantized to a
u8 level in [0, 255] (`quantize_peak`; 0.0 → 128).

```
PLACEHOLDER_EXAMPLE_U8
```

**Candidate C — b64** (`encode_frame_b64`): per lane, one base64 string
packing interleaved u8 min/max bytes.

```
PLACEHOLDER_EXAMPLE_B64
```

**Measured here — bytes per frame / bytes per second, by strip count and
encoding** (from the 60s synthetic sweep, `WAVEFORM_BUCKETS_PER_SEC=50`,
`--interval 0.1`):

| Strips (+mix) | Encoding | bytes/frame | bytes/sec |
|---|---|---|---|
| PLACEHOLDER_TABLE |

---

## Transport under load

**Measured here** — the issue's "at least ten minutes" requirement, run via
`--synthetic --duration 600` (the full `STRIP_COUNTS x` encoder sweep, each
combination run for the full 600s):

PLACEHOLDER_CADENCE_SUMMARY

Renderer-side arrival rate equals producer cadence whenever `late_ticks == 0`
— the meter loop's `next_tick += interval` pacing (mirrored from
`stream.py:586-595`) means every tick that isn't a resync event lands on the
renderer at the same cadence it was produced. A `JSON.parse` of one measured
frame is the renderer's entire per-frame cost on that path (`readNdjsonLines`,
`app/electron/ipc/shared.ts:125`, already does exactly this for `meter`/
`window` events) — no extra decode step for the float/u8 candidates, one
extra `atob`-equivalent for b64.

**Node consume check** (same parse path as `readNdjsonLines`) — exact repro
command in [How to reproduce](#how-to-reproduce):

```
PLACEHOLDER_NODE_CONSUME_OUTPUT
```

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

PLACEHOLDER_RECOMMENDATION

**Recommended encoding:** PLACEHOLDER_ENCODING (fewest bytes/frame among
encoders whose largest-sweep — 32 strips + mix — entry stayed within the
transport budget).

**Recommended cadence:** piggyback on the existing 0.1s meter tick — emit one
`{"type":"peaks", ...}` event alongside each `meter` event, using
`WAVEFORM_BUCKETS_PER_SEC` (50) buckets per tick. No new timer/loop is needed;
`stream.py`'s existing meter cadence (`--interval`, default 0.1s) already
provides the pacing this spike measured against.

**Mix-only vs. per-input vs. both:** PLACEHOLDER_MIX_VS_PER_INPUT

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
