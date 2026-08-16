# Handoff: M32R discovery findings → user stories

**Audience:** the agent breaking these findings out into GitHub user stories.
**Companion doc:** [`m32r-discovery-findings.md`](m32r-discovery-findings.md) — full protocol reference.
**Working scripts:** [`848-m32r-console-discovery/`](848-m32r-console-discovery/) — proven against the real console.

**Related issues:** [#848](https://github.com/on-par/sound-buddy/issues/848) (console discovery + read-only scan) · [#371](https://github.com/on-par/sound-buddy/issues/371) (OSC feasibility spike) · [#830](https://github.com/on-par/sound-buddy/issues/830) (console-aware channel analysis)

---

## How to use this document

A live read-only discovery session was run against the church's M32R on
2026-08-16. Everything below is **measured against real hardware**, not assumed.

Your job: turn this into implementable user stories in the house format
(see [§8](#8-house-format-for-the-stories)).

Read [§1](#1-corrections-to-existing-issue-text--read-first) first. It contains
factual errors in the current issue text that will send implementation down the
wrong path if copied forward.

> **Scope note.** The session was read-only *by choice*, to avoid disturbing a
> console in active church use. It is **not** a permanent product constraint.
> The app is expected to write once properly designed. See
> [§7](#7-the-future-write-tier).

---

## 1. Corrections to existing issue text — READ FIRST

Three things in #848's body are wrong. They came from the pre-session brief and
were disproved on the hardware. Do not carry them into stories.

| # | Issue #848 says | Reality on the console | Consequence if copied |
|---|---|---|---|
| 1 | handshake via `/-status` | **`/-status` does not exist.** It returns nothing. The real command is **`/status`** (no hyphen). | Handshake silently fails; console reads as offline. |
| 2 | handshake via `/xremote` | `/xremote` **sends no acknowledgement** — not even an echo. | A client that waits for a handshake reply hangs forever. |
| 3 | "`/meters` snapshots" | Meters are a **push subscription**, not a poll. You subscribe once; the console streams blobs for ~10 s, then stops unless renewed. | A polling design gets one frame and concludes metering is broken. |

Confirmed by direct query:

```
/status   -> ,sss   ["active", "10.1.2.247", "TPC M32R A"]
/-status  -> NO REPLY
/xremote  -> (nothing, ever)
```

**Action for you:** the stories should correct these, and it is worth posting a
short correction comment on #848 so the issue body stops misleading readers.

---

## 2. Settled facts — do not re-litigate

These are answered. Stories should treat them as given.

**Console:** Midas M32R · firmware 4.09 · OSC server V2.07 · IP `10.1.2.247`
· name `TPC M32R A` · OSC on **UDP 10023**.

| Question | Answer |
|---|---|
| Can we find the console without a manual IP? | **Yes.** Broadcast `/info` to the subnet broadcast address on UDP 10023. This satisfies #848's primary acceptance criterion. |
| Is there authentication? | **No. None at all.** No password, pairing, handshake, or token. Any UDP sender on the segment has full read **and write** control. |
| Can we read the full channel surface? | **Yes.** 90 of 91 sampled paths answered. Only `/-prefs/ip/addr` failed — use `/xinfo` for the IP. |
| Do meters work? | **Yes.** 20 Hz default, throttleable. |
| Can we save a scene locally, like M32-Edit `.scn`? | **Yes, read-only.** Already done and validated. See [§4](#4-read-only-scene-capture--and-it-plugs-into-code-we-already-have). |
| Is the network good enough? | **Yes, with care.** 0% loss over 150 queries; median RTT 4.3 ms, p95 7.9 ms, **max 93.3 ms**. |
| How long does a full state capture take? | **~23 s** for 2103 parameter groups at ~250 queries/s. |

### The three protocol shapes

```
1.  <path>  with NO arguments        → console echoes the value, natively typed
2.  /node ,s "<path>"                → reply arrives on address `node`
                                       (no leading slash!), one text line
3.  /meters ,siii "<set>" 0 0 <tf>   → binary blob push subscription
```

Two footguns worth a line in the stories:

- **`/node` replies come back on `node`, not `/node`.** Matching reply address
  against request address drops every reply.
- **`/node` has no directory listing.** Querying a container returns only its
  first child. Tree walks need a known path list — we have one:
  [`scn_paths.txt`](848-m32r-console-discovery/scn_paths.txt), 2103 paths in
  canonical order.

### Verified unit conversions

All numeric parameters are normalised **0.0–1.0 big-endian floats**. Each
formula below was checked by reading the OSC float and comparing to the
console's own engineering-unit text. **11/11 matched.** #830 needs this table.

| Parameter | Path | Formula (`f` = 0.0–1.0) | Range |
|---|---|---|---|
| Fader / send level | `/ch/NN/mix/fader`, `/dca/N/fader` | piecewise (below) | −∞ … +10 dB |
| Pan | `/ch/NN/mix/pan` | `(f − 0.5) × 200` | −100 … +100 |
| On / mute | `/ch/NN/mix/on` | int: `1` = ON (unmuted) | — |
| Headamp gain | `/headamp/NNN/gain` | `−12 + f × 72` | −12 … +60 dB |
| Preamp trim | `/ch/NN/preamp/trim` | `(f − 0.5) × 36` | −18 … +18 dB |
| HPF freq | `/ch/NN/preamp/hpf` | `20 × 20^f` | 20 … 400 Hz |
| EQ freq | `/ch/NN/eq/N/f` | `20 × 1000^f` | 20 Hz … 20 kHz |
| EQ gain | `/ch/NN/eq/N/g` | `(f − 0.5) × 30` | −15 … +15 dB |
| EQ Q | `/ch/NN/eq/N/q` | `10 × 0.03^f` | 10 … 0.3 |
| Gate threshold | `/ch/NN/gate/thr` | `−80 + f × 80` | −80 … 0 dB |
| Gate range | `/ch/NN/gate/range` | `3 + f × 57` | 3 … 60 dB |
| Dyn threshold | `/ch/NN/dyn/thr` | `−60 + f × 60` | −60 … 0 dB |

```python
def fader_db(f):
    if f <= 0.0:    return float("-inf")   # -oo
    if f >= 0.5:    return f * 40.0 - 30.0
    if f >= 0.25:   return f * 80.0 - 50.0
    if f >= 0.0625: return f * 160.0 - 70.0
    return f * 480.0 - 90.0
```

Index padding is inconsistent and bites: channels/buses are **two digits**
(`/ch/01`), headamps **three** (`/headamp/000`), DCAs **one** (`/dca/1`). DCAs
also have **no `mix` segment** — it is `/dca/1/fader`, not `/dca/1/mix/fader`.

---

## 3. Issue-by-issue impact

### #848 — console discovery + read-only scan

**Status: fully de-risked. Every acceptance criterion is achievable as written**
(after the [§1](#1-corrections-to-existing-issue-text--read-first) corrections).
This is now a build task, not an unknown.

Ready to lift directly into implementation:

- Discovery mechanism — proven
- Identity commands and exact reply shapes — proven
- Channel/bus/main/DCA read surface — proven, with conversions
- Meter subscribe/renew/decode — proven
- Offline/degraded behaviour — specified in
  [findings §5](m32r-discovery-findings.md)

Reference implementations of every piece exist in
[`848-m32r-console-discovery/`](848-m32r-console-discovery/) — Python, stdlib
only. They are a **protocol reference to port**, not shippable app code.

### #371 — OSC feasibility spike

**Status: all four "Must Include" deliverables are answered.** This spike can be
closed out. One story should be "write up #371's conclusions and close it,"
drawing on:

| #371 requirement | Answer |
|---|---|
| Security assessment (auth, network exposure) | **No authentication exists.** Full read/write to any UDP sender on the segment. Broadcast discovery removes even the need to know the IP. The 4-client `/xremote` cap is a resource limit, not a security control. |
| Read-only vs read-write scope | Read surface is comprehensive. Read-only cannot be enforced by the console — **it must be a client-side architectural guarantee.** |
| Rate-limiting / error handling on unstable WiFi | Measured. 350 ms timeout + 3 retries lost zero of 2103 queries. Timeouts under ~150 ms produce false-offline reports. |
| Offline/degraded spec | Written up in [findings §5](m32r-discovery-findings.md). |

Verdict for the spike: **feasible, low technical risk, meaningful security risk
that is environmental rather than fixable in our code.**

### #830 — console-aware channel analysis

**Status: the console-read half is fully de-risked.** #830 needs per-channel EQ
band gain/freq/Q, HPF on/freq, gate on/thr, comp on/thr/ratio, fader, pan, mute,
and channel name. **All confirmed readable, all with verified conversions**
(table above). The "read the board settings" risk is gone.

**Still open — and #830's actual hard part:** the multitrack track N ↔ console
channel N mapping. This session did **not** solve it. What was learned that
bears on it:

- `/ch/NN/config/source` exists and returns an int source index
- `/config/routing/CARD` describes what feeds the USB/card recorder
- `/-stat/xcardtype` returned `7` on this console

Those are the threads to pull, but the mapping is unverified. **Do not write a
story that assumes it is solved.** It deserves its own investigation story,
ideally against a known multitrack recording where channel identity is
independently confirmable.

---

## 4. Read-only scene capture — and it plugs into code we already have

The biggest new finding. No *issue* covers it, but **half the work already
exists in the repo**: `packages/scene-inspector` already ships `parseScene()`
and `diffScenes()` for `.scn` files.

So the gap is not parsing — it is **acquisition**. Nothing today can get a
`.scn` off the console. This session proves we can, read-only.

**Verified end to end during this session:** the captured file was run through
the repo's own `parseScene()` and parsed cleanly — version `2.7`, 32 channels,
8 DCAs. Our OSC capture is directly consumable by existing app code, with no
format shim.

> ### Bug found in `packages/scene-inspector` — fix before any diff story
>
> `diffScenes(x, x)` — a scene diffed **against itself** — reports **7 phantom
> changes** on our capture. It should report none.
>
> Cause: `parseFloat2("-oo")` returns `NaN` (`parseFloat` cannot read the
> console's `-oo` notation for a fader at −∞). `diffScenes` then compares with
> `!==`, and `NaN !== NaN` is always `true`. Every channel parked at `-oo`
> becomes a false "changed" entry, every time.
>
> This matters in practice: **7 of 32 channels** on the real console sit at
> `-oo` (unused inputs). A before/after diff would open with 7 fabricated
> changes before a single real one.
>
> Fix has two parts — parse `-oo` to `-Infinity` (or `null`) rather than `NaN`,
> and make the comparison NaN-safe (`Object.is`, or normalise first). Both need
> a regression test. `capture-2026-08-16.scn` is an ideal fixture: it is real
> console output and self-diffing it must yield zero changes.
>
> Worth its own bug issue, blocking story C3.

A `.scn` file is not a proprietary binary export. It is a version header
followed by plain-text OSC node lines — and `/node` returns those lines
verbatim:

```
console reply:  /ch/01/mix OFF   -oo ON +0 OFF   -oo
.scn file line: /ch/01/mix OFF   -oo ON +0 OFF   -oo
```

Identical. So **"save the current console state as a scene file" is a read-only
tree walk plus a synthesised header.** Nothing is written to the console;
nothing is stored on the board.

**Already proven end to end:**

| Metric | Result |
|---|---|
| Node paths walked | 2103 |
| Lines captured | 2103 / 2103 (**100%**) |
| No-reply / mismatched paths | 0 / 0 |
| Wall clock | 22.9 s |
| Validation | Node-path set **identical** to a real X32-Edit-generated `.scn` |

Artefact: [`capture-2026-08-16.scn`](848-m32r-console-discovery/capture-2026-08-16.scn).

### The one real limitation — state it in the story

We can capture the **current live state** only. We **cannot** read the contents
of a *stored* scene. `/node` exposes stored scenes' metadata only:

```
/-show/showfile/scene/000 "TPC Sunday"     ""               %000000000 1
/-show/showfile/scene/001 "Worship"        "Raptor AV 4/30" %000000000 1
```

Name, note, safes mask, occupied flag — no parameter data. That lives in console
flash and only becomes readable once recalled onto the surface, and **recall is
a write.** So "back up all 8 stored scenes" is not achievable read-only;
"snapshot the desk as it stands right now" is.

### Product angles worth a story each

- **Backup before a service** — one-click capture of the desk as-is
- **Before/after diff** — "what did the engineer change during rehearsal?"
  `diffScenes()` already exists, so this is mostly wiring — **once the `-oo` bug
  above is fixed**
- **Portability** — output opens in M32-Edit; not a Sound-Buddy-only format
- **Grounding for #830** — a capture is a complete, timestamped record of board
  state to pair with a multitrack recording
- **Test fixtures** — `scene-inspector` currently has no real-console fixture.
  Our capture is 2103 lines of genuine M32R output and would harden its tests
  considerably

---

## 5. Suggested story breakdown

A starting skeleton — refine as you see fit. Sizes are rough.

**Foundation (blocks everything else)**

| # | Story | Size | Notes |
|---|---|---|---|
| F1 | OSC transport: encode/decode, 4-byte alignment, type tags | S | Pure, fully unit-testable with no console. See the padding bug in [§6](#6-constraints-every-story-must-respect). |
| F2 | Read-only guardrail enforced at the encoder | S | Non-negotiable. See [§6](#6-constraints-every-story-must-respect). |
| F3 | Console discovery via broadcast + retries | S | **No subnet sweep** — see [§6](#6-constraints-every-story-must-respect). |
| F4 | Connection lifecycle: identity, heartbeat, offline detection | M | `/status` as heartbeat. There is no "connection" — UDP is stateless. |

**Read surface (#848)**

| # | Story | Size | Notes |
|---|---|---|---|
| R1 | Channel-strip model + verified unit conversions | M | Table in [§2](#2-settled-facts--do-not-re-litigate). Unit-testable against captured fixtures. |
| R2 | Bus / main / DCA / aux read surface | S | Same shapes; mind the index-padding inconsistency. |
| R3 | Meter subscription, renewal, blob decode | M | **Little-endian blob** — see [§6](#6-constraints-every-story-must-respect). |
| R4 | Console panel in Live tab: scan, found list, identity, live read-only state | M | The #848 UI criterion. |
| R5 | Offline / degraded states | S | Console absent, mid-session loss, subscription lapse. |

**Scene capture (new — [§4](#4-read-only-scene-capture--and-it-plugs-into-code-we-already-have))**

| # | Story | Size | Notes |
|---|---|---|---|
| C0 | **Bug: `diffScenes` reports phantom changes on `-oo` faders** | S | Confirmed in shipped code — see [§4](#4-read-only-scene-capture--and-it-plugs-into-code-we-already-have). Blocks C3. Use our capture as the regression fixture. |
| C1 | `.scn` capture via `/node` tree walk | M | ~23 s; needs progress UI. Reject partial captures. Output already parses with `scene-inspector`. |
| C2 | Stored-scene inventory (metadata only) | S | Must be explicit that contents are unreadable. |
| C3 | Capture diff / before-after view | M | `diffScenes()` exists; mostly wiring. **Depends on C0.** |
| C4 | Add real-console `.scn` fixture to `scene-inspector` tests | S | Package has no real-hardware fixture today. |

**Spike closure**

| # | Story | Size | Notes |
|---|---|---|---|
| K1 | Write up #371 conclusions, architecture proposal, threat model; close spike | S | Content in [§3](#3-issue-by-issue-impact). |

**Investigation**

| # | Story | Size | Notes |
|---|---|---|---|
| I1 | Verify multitrack track ↔ console channel mapping | ? | Genuinely unknown. Spike, not a build story. |

---

## 6. Constraints every story must respect

Five things that cost real time to discover. Each is cheap to honour up front
and expensive to find later.

**1. The read-only guarantee must be structural, not disciplinary.**
The console enforces nothing. In the session scripts the guarantee lives in the
encoder: it *refuses to encode* an unsafe message, so nothing unsafe can reach
the socket. The rule set — argument-less messages are reads; only a reviewed
allowlist may carry arguments; `/save`, `/load`, `/copy`, `/paste`, `/delete`,
`/add`, `/undo`, `/scene`, `/snapshot`, `/cue`, `/-action`, `/-libs` are refused
outright. Any story touching the wire should inherit that shape.

**2. Never ship a unicast subnet sweep.**
The session's fallback sweep was actively harmful: macOS cached reject (`!`)
routes for every silent host, and those then blocked traffic to the **real
console**, producing `No route to host` for a board that was up the whole time.
Broadcast plus retries is sufficient and proven. If a fallback is ever needed,
**ask the user for the IP.**

**3. Budget for first contact being slower than steady state.**
The first broadcast returned nothing; the retry succeeded. The console must ARP
for us before it can unicast a reply, so first contact costs an address
resolution round that later traffic does not. Discovery needs retries and a
listen window of **several seconds** — a "broadcast once, wait 1 s, report not
found" implementation would have declared this network console-free.

**4. Meter blobs are little-endian. Everything else is big-endian.**
Count and floats inside the meter blob are little-endian, against the grain of
the rest of the protocol. The single easiest thing to get wrong.

**5. Verify the OSC encoder byte-for-byte against a known-good message.**
The session's first encoder had a padding fault — `4 - (len % 4)` instead of
`(4 - (len % 4)) % 4` — appending 4 stray nulls whenever a string was *already*
4-byte aligned. It was nearly invisible: `/info`, `/node` and every parameter
read worked fine because the console's parser skips the extra nulls. Only
`/meters` broke, and it broke by returning **nothing at all** rather than an
error — indistinguishable from "this console does not support metering." Use
the protocol doc's worked example as a test vector:

```
/meters ,si /meters/6 16
2f6d6574657273002c7369002f6d65746572732f3600000000000010
```

---

## 7. The future write tier

Out of scope for #848, but the session settled facts that will shape it. Worth
capturing now so they are not rediscovered.

- **Writes are trivially available.** A parameter path *with* a correctly typed
  argument sets the value. There is no permission layer, confirmation, or
  locking. The difficulty is entirely product-side safety, not protocol.
- **The console cannot protect itself from us.** Any write guard is ours to
  build. Recommend the read-only encoder guardrail stays permanently, with
  writes going through a separate, explicitly-constructed path — so writing is
  something you opt into deliberately, never something that leaks out of a
  read-path bug.
- **Scene recall is the sharp edge.** Recalling a stored scene would let us read
  its contents, but it **changes the live desk** — catastrophic mid-service.
  Treat scene recall as the highest-risk operation in the whole surface.
- **Four-client cap.** `/xremote` supports at most four concurrent clients. On a
  Sunday with iPads and M32-Edit already attached, we may be refused — silently,
  since `/xremote` never acknowledges. Any write tier needs to handle "we are
  not actually registered" as a real state.
- **Sunday safety.** The console recorded to USB at 10:57 the morning of the
  session. This is a working desk in weekly service. Anything that writes needs
  an unmistakable armed/disarmed state in the UI.

---

## 8. House format for the stories

Match the existing issues (#848, #830). No template file exists in `.github/`,
but both follow this shape:

```markdown
Parent: #NNN. [one-line origin/context]

## Problem statement
## In scope
## Out of scope
## Acceptance criteria
- [ ] checkbox items, externally verifiable
## Verification
[unit tests for pure logic; manual/e2e against the real M32R]

Dependencies: #NNN
```

Conventions observed in the repo:

- Labels in use: `ready`, `feature`, `spike`, `live-capture`, `P2`, `effort:s`,
  `epic:reliability`, `should`, `mvp-deferred`
- Acceptance criteria are checkboxes and stated so they can be verified from
  outside the code
- Verification distinguishes **pure unit-testable logic** from
  **needs-real-hardware**. That split matters here: protocol
  encode/decode/conversion is fully testable offline against captured fixtures;
  only discovery, subscription and live reads need the console.
- Every story should say whether it needs console access, since that gates when
  it can be worked on

---

## 9. Open questions — genuinely unanswered

Be honest about these in the stories rather than papering over them.

1. **Multitrack ↔ console channel mapping** (#830's core risk). Not solved. See
   [§3](#3-issue-by-issue-impact).
2. **`/xremote` push delivery was never positively confirmed.** The console was
   idle, so no changes existed to push. We confirmed the message is accepted
   without error and that subscriptions work in general (meters stream fine),
   but not that parameter-change pushes arrive. **Verify against a console
   someone is actively touching.**
3. **Four-client cap untested.** Never hit it; behaviour when refused is
   documented-but-unobserved.
4. **Only one console, one firmware.** M32R / firmware 4.09 / OSC V2.07. X32
   compatibility is inferred from the shared protocol and a matching community
   `.scn`, **not tested.** #273 (non-M32 consoles) should assume nothing.
5. **Capture round-trip not verified.** Our `.scn` is structurally identical to
   a real one, but loading it into M32-Edit was not tested — that would require
   writing to a console.

---

## 10. Privacy note

**This repository is public.** The committed capture,
[`capture-2026-08-16.scn`](848-m32r-console-discovery/capture-2026-08-16.scn),
has been **scrubbed**: three volunteers' first names on channels 02–04 were
replaced with `Vox 1` / `Vox 2` / `Vox 3`. Nothing else was altered, so it is
still a faithful 2103-line record of real console state — it parses correctly
and still reproduces the `-oo` diff bug in [§4](#4-read-only-scene-capture--and-it-plugs-into-code-we-already-have).
The unmodified capture is local-only and gitignored (`*.local.scn`).

**Carry this into the stories:** captures are taken from a live church desk and
routinely contain real people's names in channel labels. Any story that
persists, exports, uploads or attaches a capture must say where the file lands
and who can read it. A capture is not anonymous data.
