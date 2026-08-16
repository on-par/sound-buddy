# M32R Console Discovery — Findings

Read-only OSC discovery session against the church M32R.

- Issue: on-par/sound-buddy#848 (parent spike #371)
- Date: 2026-08-16
- Scripts: [`848-m32r-console-discovery/`](848-m32r-console-discovery/)
- Method: UDP OSC on port 10023, stdlib Python only, no writes of any kind

**Headline: a local scene save is feasible today, purely read-only.** A full
`.scn` capture of the console's current state was taken and validated. See
[Scene-save verdict](#scene-save-verdict).

---

## 1. Console identity

| Field | Value |
|---|---|
| Model | M32R |
| Console name | `TPC M32R A` |
| Firmware | 4.09 |
| OSC server version | V2.07 |
| IP | 10.1.2.247 |
| MAC | `00:15:64:03:0a:50` (OUI 00:15:64 — Behringer Spezielle Studiotechnik) |
| OSC port | UDP 10023 |
| Scene format version | `#2.7#` |
| Loaded show | `MyShow` |
| Sample rate / clock | 48 kHz, internal |
| Expansion card | `/-stat/xcardtype 7` |

The console was idle during this session — peak input meter ≈ 0.0079 linear
(≈ −42 dBFS, noise floor). It had recorded to USB earlier the same day
(`R_20260816-105730am.wav`), so it is in regular service.

### Discovery mechanism

Broadcast discovery works; no manually entered IP is needed.

Send an argument-less `/info` to the subnet broadcast address (and/or
255.255.255.255) on UDP 10023. Every console on the segment answers from its
own IP, which is how you learn the address.

```
--> 10.1.2.255:10023   /info   ,
<-- 10.1.2.247:10023   /info   ,ssss  "V2.07" "osc-server" "M32R" "4.09"
```

Three identity queries, all read-only:

| Query | Reply tags | Fields |
|---|---|---|
| `/info` | `ssss` | server version, `osc-server` (literal), model, firmware |
| `/xinfo` | `ssss` | **IP address**, console name, model, firmware |
| `/status` | `sss` | state (`active`), IP address, console name |

Use `/info` for discovery, then `/xinfo` for the real console name — `/info`'s
second field is the literal string `osc-server`, not the console name.

> **Two traps, both hit during this session — see
> [Notes for #371](#5-notes-for-issue-371) for the detail.**
> 1. The *first* broadcast attempt returned nothing; the retry succeeded.
> 2. Do **not** fall back to a unicast subnet sweep.

---

## 2. Working OSC surface

### 2.1 Message forms confirmed on this console

| Form | Direction | Behaviour |
|---|---|---|
| `<path>` with no arguments | read | Console echoes the value back on the same address with its native type tag. |
| `/node ,s <path>` | read | Console replies on address **`node`** (no leading slash) with one string: a complete scene-file line ending in `\n`. |
| `/meters ,s\|,si\|,siii …` | read | Subscribes to a binary meter stream. See [§3](#3-meter-mechanism). |
| `/xremote` (no arguments) | read | Registers for change pushes. **Sends no acknowledgement.** |
| `/info`, `/xinfo`, `/status` | read | Identity, as above. |

Two corrections to the assumptions we started with:

- **`/xremote` does not reply with `/xremote`.** It returns nothing at all. Any
  client that waits for an echo to confirm the session will hang. The
  subscription lapses after ~10 s and must be re-sent; the protocol doc caps it
  at **four concurrent clients**, so a busy console with iPads and M32-Edit
  already attached can silently refuse ours. Because the console was idle, push
  delivery could not be positively confirmed — only that the message is
  accepted without error.
- **`/node` replies arrive on address `node`, not `/node`.** A client matching
  the reply address against the request address will drop every reply and
  conclude the console is unreachable.

### 2.2 Value encoding

All numeric parameters are **normalised 32-bit floats in 0.0–1.0**, big-endian,
4-byte aligned. Booleans and enumerations are 32-bit ints. Strings are
null-terminated and padded.

The conversions below were **measured**, not assumed: each OSC float was read
and compared against the same parameter's engineering value in the console's
own `/node` text. All 11 passed (`verify_scaling.py`).

| Parameter | OSC path | Type | Formula (`f` = 0.0–1.0) | Range |
|---|---|---|---|---|
| Fader / send level | `/ch/NN/mix/fader`, `/bus/NN/mix/fader`, `/main/st/mix/fader`, `/dca/N/fader`, `/ch/NN/mix/NN/level` | `f` | piecewise, below | −∞ … +10 dB |
| Pan | `/ch/NN/mix/pan` | `f` | `(f − 0.5) × 200` | −100 … +100 |
| On / mute | `/ch/NN/mix/on` | `i` | `1` = ON (unmuted), `0` = muted | — |
| Headamp gain | `/headamp/NNN/gain` | `f` | `−12 + f × 72` | −12 … +60 dB |
| Phantom | `/headamp/NNN/phantom` | `i` | `0`/`1` | — |
| Preamp trim | `/ch/NN/preamp/trim` | `f` | `(f − 0.5) × 36` | −18 … +18 dB |
| HPF frequency | `/ch/NN/preamp/hpf` | `f` | `20 × 20^f` | 20 … 400 Hz |
| EQ frequency | `/ch/NN/eq/N/f` | `f` | `20 × 1000^f` | 20 Hz … 20 kHz |
| EQ gain | `/ch/NN/eq/N/g` | `f` | `(f − 0.5) × 30` | −15 … +15 dB |
| EQ Q | `/ch/NN/eq/N/q` | `f` | `10 × 0.03^f` | 10 … 0.3 |
| Gate threshold | `/ch/NN/gate/thr` | `f` | `−80 + f × 80` | −80 … 0 dB |
| Gate range | `/ch/NN/gate/range` | `f` | `3 + f × 57` | 3 … 60 dB |
| Dyn threshold | `/ch/NN/dyn/thr` | `f` | `−60 + f × 60` | −60 … 0 dB |
| Name | `/ch/NN/config/name` | `s` | free text | ≤ 12 chars |
| Colour | `/ch/NN/config/color` | `i` | palette index | 0 … 15 |
| Icon | `/ch/NN/config/icon` | `i` | icon index | 1 … 74 |

Fader position → dB (verified: 0.522972 → −9.1 dB, 0.357771 → −21.4 dB,
0.642229 → −4.3 dB, all matching the console's own text exactly):

```python
def fader_db(f):
    if f <= 0.0:    return float("-inf")   # -oo
    if f >= 0.5:    return f * 40.0 - 30.0
    if f >= 0.25:   return f * 80.0 - 50.0
    if f >= 0.0625: return f * 160.0 - 70.0
    return f * 480.0 - 90.0
```

Note channel indices are **zero-padded two digits** (`/ch/01`, not `/ch/1`) but
DCAs are **not** (`/dca/1`), and headamps are **three digits** (`/headamp/000`).
DCAs also have no `mix` segment: it is `/dca/1/fader`, not `/dca/1/mix/fader`.

### 2.3 Readable tree, by category

90 of 91 sampled paths answered. Full output: `enumerate_surface.py`.

| Category | Paths | Confirmed |
|---|---|---|
| Identity | `/info`, `/xinfo`, `/status` | yes |
| Channel config | `/ch/01…32/config/{name,icon,color,source}` | yes |
| Channel mix | `…/mix/{fader,on,pan,mono,mlevel}` | yes |
| Bus sends | `/ch/NN/mix/01…16/{level,on,pan}` | yes |
| Preamp | `…/preamp/{trim,invert,hpon,hpslope,hpf}` | yes |
| Headamps | `/headamp/000…127/{gain,phantom}` | yes |
| Gate | `…/gate/{on,mode,thr,range,attack,hold,release}` + `gate/filter` | yes |
| Dynamics | `…/dyn/{on,mode,thr,ratio,knee,mgain,…}` + `dyn/filter` | yes |
| EQ | `…/eq/on`, `…/eq/1…4/{type,f,g,q}` (6 bands on bus/mtx/main) | yes |
| Delay / insert / automix | `…/delay/*`, `…/insert/*`, `…/automix/*` | yes |
| Buses | `/bus/01…16/*` | yes |
| Matrices | `/mtx/01…06/*` | yes |
| Mains | `/main/st/*`, `/main/m/*` | yes |
| DCAs | `/dca/1…8`, `/dca/1…8/config` | yes |
| Aux in / FX return | `/auxin/01…08/*`, `/fxrtn/01…08/*` | yes |
| FX racks | `/fx/1…8/{type,source/*,par/01…64}` | yes |
| Outputs / routing | `/outputs/{main,aux,p16,aes,rec}/*`, `/config/routing/*` | yes |
| Console status | `/-stat/*`, `/-prefs/*`, `/-show/*`, `/-usb` | yes |

One miss: `/-prefs/ip/addr` does not answer. Read the IP from `/xinfo` instead.

**`/node` has no directory listing.** Querying a container returns only its
first child leaf, not a list — `/node ,s "ch"` returns `/ch/01/config …`, not
the 32 channels. Tree enumeration therefore requires a known path list
(`scn_paths.txt`), not recursive discovery. Because the reply line always begins
with the node's *real* path, results can be keyed on the returned path rather
than the requested one, which makes a fixed list safe against drift.

---

## 3. Meter mechanism

Confirmed working, with one important correction to the assumed semantics.

Request: `/meters` with a string naming the meter set, plus optional ints.

```
/meters ,s    "/meters/1"                # 20 Hz  (default)
/meters ,siii "/meters/1" 0 0 20         # 1 Hz
/meters ,siii "/meters/1" 0 0 40         # 0.5 Hz
```

**`time_factor` is the LAST int and requires the full `,siii` form.** Passing a
single int (`,si`) does *not* throttle — it is read as `chn_meter_id`. Measured:
`,s` → 19.8 Hz, `,si … 20` → 20.0 Hz (no effect), `,siii … 0 0 20` → 1.0 Hz,
`,siii … 0 0 40` → 0.5 Hz. Interval is `50 ms × time_factor`; valid range 1–99.

Replies arrive on the meter-set address (e.g. `/meters/1`) with a **blob**:

```
<int32 count, little-endian><count × float32, little-endian>
```

`/meters/1` returns a 388-byte blob = 4-byte count + 96 floats: 32 input levels,
32 gate gain reductions, 32 dynamics gain reductions. Values are linear
0.0–1.0 where 1.0 = digital full scale (headroom allows up to 8.0 ≈ +18 dBFS).

> The count and the floats are **little-endian**, unlike every other value in
> the protocol. The rest of OSC here is big-endian. This is the single easiest
> thing to get wrong in a meter implementation.

Subscriptions expire after ~10 s. Renew with `/renew ,s "meters/1"` (or simply
re-send `/meters`) every ~5 s.

---

## 4. Scene-save verdict

**Feasible, read-only, and already done.** No missing capability.

### Why it works

A `.scn` file is not a proprietary binary export. It is a one-line version
header followed by plain-text OSC node lines — and `/node` returns those exact
lines. Comparing a `/node` reply to a line from a real X32-Edit `.scn`:

```
console:  /ch/01/mix OFF   -oo ON +0 OFF   -oo
.scn file:/ch/01/mix OFF   -oo ON +0 OFF   -oo
```

Identical. So "save a scene locally" is a tree walk of read-only `/node`
queries plus a synthesised header. **Nothing is written to the console and
nothing is stored on the board.**

### Capture taken

`848-m32r-console-discovery/capture-2026-08-16.scn`

| Metric | Result |
|---|---|
| Node paths walked | 2103 |
| Lines written | 2103 / 2103 (**100%**) |
| Paths with no reply | 0 |
| Paths answering with a different node | 0 |
| Output | 2104 lines (header + nodes), 65,926 bytes |
| Wall-clock | 22.9 s at ~250 queries/s |

Validation: the set of node paths in our capture is **identical** to the set in
a real X32-Edit-generated `.scn` (diffed against a published community scene
file, zero differences). Header format matches what the console itself reports
for its stored scenes:

```
#2.7# "TPC M32R A capture" "read-only OSC capture, issue 848" %000000000 1
```

Spot-checked content is correct and live: named channels, IEM bus structure,
8 named DCAs, FX rack types (VRM / PLAT / DLY / GEQ2 / ENH), headamp gains and
phantom states.

### The one real limitation

We can capture the **current live state** only. We cannot read the contents of
a *stored* scene.

`/node` exposes stored scenes' metadata only:

```
/-show/showfile/scene/000 "TPC Sunday"     ""               %000000000 1
/-show/showfile/scene/001 "Worship"        "Raptor AV 4/30" %000000000 1
/-show/showfile/scene/004 "TPC Soundcheck" ""               %010101110 1
```

Name, note, safes bitmask, occupied flag — but no parameter data. That data
lives in console flash and only becomes readable once recalled onto the surface,
and **recall is a write**. So archiving all 8 stored scenes is not possible
read-only; archiving what is on the surface right now is.

For Sound Buddy this is very likely fine: the useful artefact is "capture the
mix as it is now", which is exactly what we can do.

### What a `.scn` does *not* contain

Scene scope excludes console-level state, matching M32-Edit's own behaviour.
These are all separately readable over OSC if we want them, just not part of a
scene file:

- `/-prefs/*` — console preferences, name, clock, sample rate
- `/-stat/*` — transient surface state (selected channel, fader bank, solo)
- `/-show/*` — show and scene/snippet inventory
- `/-libs/*` — channel and effects libraries
- `/-usb/*` — recorder state

No FX or routing gap: `/fx/N/par/*` and `/config/routing/*` **are** in the scene
and captured in full.

### Recommendation

Ship scene capture using the `/node` tree walk. It needs no console writes, no
authentication, no vendor SDK, and no user-entered IP. Budget ~25 s for a full
capture and show progress; it is not instant.

---

## 5. Notes for issue #371

### Unauthenticated exposure — confirmed

**The console has no authentication of any kind.** No password, no pairing, no
handshake, no session token. Anything that can send a UDP packet to port 10023
gets full read *and write* control of a live console: faders, mutes, phantom
power, scene recall.

- Everything in this session was obtained with zero credentials.
- Broadcast discovery means an attacker does not need to know the IP either.
- The console cannot tell our read-only client from a malicious one.
- The protocol cap of four `/xremote` clients is a resource limit, not a
  security control.

Implications for Sound Buddy:

1. **Treat the console LAN as trusted-by-assumption and say so.** We inherit
   whatever the church network provides. On a flat guest WiFi, any phone in the
   building can mute the mains.
2. **Our own safety must be client-side.** There is no server-side guard. The
   read-only guarantee in this session comes entirely from
   [`m32r_osc.py`](848-m32r-console-discovery/m32r_osc.py), which refuses to
   encode anything that could mutate state. Any shipped code needs the same
   structural guardrail, not developer discipline.
3. Worth flagging to the church as a network-hygiene item: the console belongs
   on a management VLAN, not on guest WiFi.

### Behaviour on flaky WiFi

Measured over 150 polite queries on the church WiFi:

| Metric | Value |
|---|---|
| Packet loss | 0 % |
| RTT median | 4.3 ms |
| RTT p95 | 7.9 ms |
| RTT max | **93.3 ms** |

The link is good but has a long tail — a 93 ms spike against a 4 ms median is
a 20× outlier. Concretely:

- **A per-query timeout under ~150 ms will produce false "console offline"
  reports** on a healthy network. Our capture used 350 ms with 3 retries and
  lost nothing across 2103 queries.
- **First contact is the fragile moment.** The very first broadcast returned
  nothing and the retry succeeded. The console must ARP for us before it can
  unicast its reply, so first contact costs a round of address resolution that
  steady-state traffic does not. Discovery needs **retries and a listen window
  of several seconds**, not a single 1-second attempt. A naive
  "broadcast once, wait 1 s, report not found" implementation would have
  concluded there was no console on this network.
- UDP has no delivery guarantee and the console never retransmits. Every read
  needs its own retry; there is no protocol-level recovery.

### Do not use a unicast subnet sweep

Our fallback sweep (a `/info` to all 254 hosts) was **actively harmful** and
should not ship. macOS installed reject (`!`) routes for every silent address,
and those cached negative routes then blocked traffic to the real console —
producing `No route to host` for a board that was up the whole time. It cost
the first part of this session.

Broadcast plus retries is sufficient and was proven to work here. If a fallback
is ever needed, ask the user for the IP instead of sweeping.

### Offline and degraded handling

- **There is no connection.** UDP is stateless; "connected" is a fiction we
  maintain client-side. Liveness = "did `/status` answer recently".
- Poll `/status` (cheap, 3 strings) as a heartbeat rather than inferring health
  from parameter reads.
- `/xremote` and `/meters` subscriptions **expire silently after ~10 s**. A
  stalled UI looks identical to a healthy one that stopped being renewed. Renew
  every ~5 s and treat missing meter frames as a reconnect signal.
- Because `/xremote` never acknowledges, we cannot distinguish "registered" from
  "refused because four clients already attached". Detect this by watching for
  the absence of expected pushes, and degrade to polling.
- A capture interrupted mid-walk yields a partial `.scn`. `dump_scene.py`
  reports missing paths explicitly; a partial file should be rejected rather
  than saved, since a `.scn` with missing lines is silently wrong rather than
  obviously broken.

---

## 6. Scripts

All in [`848-m32r-console-discovery/`](848-m32r-console-discovery/). Stdlib
only, no dependencies. Every one is read-only by construction.

| Script | Purpose |
|---|---|
| `m32r_osc.py` | OSC encode/decode plus the read-only guardrail. Shared by the rest. |
| `discover.py` | Broadcast discovery; optional direct-IP probe. |
| `identity.py` | Identity and reply-format probe. |
| `enumerate_surface.py` | Categorised dump of the readable OSC surface. |
| `verify_scaling.py` | Checks the unit conversions above against the console. |
| `dump_scene.py` | Full `.scn` capture via `/node` tree walk. |
| `list_scenes.py` | Stored show/scene inventory (metadata only). |
| `scn_paths.txt` | The 2103 node paths that make up a scene, in canonical order. |

```bash
python3 discover.py                     # find the console
python3 dump_scene.py 10.1.2.247 --name "Sunday AM" --out sunday.scn
```

### The guardrail

`m32r_osc.py` refuses to *encode* an unsafe message, so nothing unsafe can
reach the socket:

1. Argument-less messages are queries — allowed.
2. Messages **with** arguments are allowed only from a reviewed allowlist
   (`/node`, `/meters`, `/xremote`, `/renew`, `/unsubscribe`, identity).
3. `/save`, `/load`, `/copy`, `/paste`, `/delete`, `/add`, `/undo`, `/scene`,
   `/snapshot`, `/cue`, `/-action`, `/-libs` are rejected outright.

Verified by unit-testing the rejections before any packet was sent.

> **Known gap, deliberately left:** the deny list checks the OSC *address*, not
> `/node`'s string argument. `/node ,s "-libs/…"` would pass. That is still a
> read, so it is safe, but a production port should validate the argument too.

### One bug worth remembering

The first encoder had a padding fault: `4 - (len % 4)` instead of
`(4 - (len % 4)) % 4`, appending a stray 4 null bytes whenever a string was
*already* 4-byte aligned. It affects only strings whose length-with-terminator
is a multiple of 4 — such as `"/meters"` and the `",si"` type tag.

It was nearly invisible: `/info`, `/node` and every parameter read worked fine,
because the console's parser skips the extra nulls. Only `/meters` failed, and
it failed by returning *nothing at all* rather than an error — which reads
exactly like "this console does not support metering."

Any OSC implementation we ship should be checked byte-for-byte against a known
good message. The protocol doc's worked example is ideal:

```
/meters ,si /meters/6 16
2f6d6574657273002c7369002f6d65746572732f3600000000000010
```

---

## 7. Privacy note

**This repository is public.** The raw capture contained three volunteers' first
names as channel labels (channels 02–04), so it is **not** committed.

- `capture-2026-08-16.scn` — **committed.** Scrubbed: those three channel names
  became `Vox 1` / `Vox 2` / `Vox 3`. Everything else is untouched, so it
  remains a faithful 2103-line record of real console state. Verified to still
  parse and to still reproduce the `-oo` diff bug.
- `capture-2026-08-16.raw.local.scn` — **local only,** gitignored via
  `*.local.scn`. The unmodified capture, kept for reference.

All other labels in the file are instrument, bus and routing names
(`Kick`, `IEM1`, `Drum Verb`), which carry no personal information.

If a future capture is committed, scrub it first — git history is permanent and
this repo is world-readable.

## Sources

- [Unofficial X32/M32 OSC Remote Protocol — Patrick-Gilles Maillot](https://tostibroeders.nl/wp-content/uploads/2020/02/X32-OSC.pdf) — meter blob layout, `time_factor`, command table, worked hex example
- [pmaillot/X32-Behringer](https://github.com/pmaillot/X32-Behringer) — reference tooling and `.scn` handling
- [cabcookie/saddleback-x32-general-scene](https://github.com/cabcookie/saddleback-x32-general-scene) — real X32-Edit `.scn` used to validate our capture's structure
