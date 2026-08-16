# #895 mapping probe — read-only results

Read-only OSC probe of the M32R (`10.1.2.247`) on 2026-08-16, for #895 / #830.
No writes. Script: `mapping_probe.py`.

## TL;DR

**Tracks 1–30 map 1:1 to channels 1–30. Tracks 31–32 do not.** Tracks 31/32
record console **Outputs 1/2**, not channels 31/32.

This does **not** close #895 on its own — see [Caveats](#caveats). It answers the
mapping *for the console's current routing* and tells you exactly what the
physical experiment needs to confirm.

**Separately: `xcardtype` reports a Dante card, not USB.** #830 and CLAUDE.md
both say "USB multitrack". Worth resolving before building on that assumption.

## Method

Two routing tables have to agree before "track N == channel N" holds:

- `/config/routing/IN` — what feeds console channels, in blocks of 8
- `/config/routing/CARD` — what feeds the card recorder, in blocks of 8

Where a CARD block names the same source as the matching IN block, the recorder
captures exactly what that channel hears. Both can point at a *user patch*
(`UIN`/`UOUT`), resolved via `/config/userrout/`.

`/ch/NN/config/source` returned `N` for **all 32 channels**, so there is no
channel-level source remap. The mapping is decided entirely by the routing
blocks above.

## Raw values

```
/-stat/xcardtype        7            -> DN32-DANTE 32in/32out
/-stat/xcardsync        ON
/-prefs/card/USBmode    32/32
/config/routing         REC          -> routing/IN is active (not routing/PLAY)

/config/routing/IN      UIN9-16  UIN1-8  CARD17-24  UIN17-24  CARD1-6
/config/routing/CARD    UIN9-16  UIN1-8  CARD17-24  UOUT25-32
/config/routing/PLAY    CARD1-8  CARD9-16 CARD17-24 CARD25-32 AUX1-4
```

Block comparison:

| tracks | channels fed by | card fed by | 1:1? |
|---|---|---|---|
| 1–8 | `UIN9-16` | `UIN9-16` | yes |
| 9–16 | `UIN1-8` | `UIN1-8` | yes |
| 17–24 | `CARD17-24` | `CARD17-24` | yes |
| 25–32 | `UIN17-24` | `UOUT25-32` | **no** |

User patch tables (`/config/userrout/`), decoded with the enums from the OSC
protocol doc — in: `0`=OFF, `1–32`=Local, `33–80`=AES50-A, `81–128`=AES50-B,
`129–160`=Card, `161–166`=Aux; out: same plus `169–184`=Outputs 1–16:

```
in   01:77 02:78 03:57 04:80 05:0  06:0  07:0  08:1
     09:33 10:34 11:35 12:36 13:37 14:38 15:49 16:50
     17:73 18:74 19:75 20:76 21:78 22:79 23:58 24:53
     25:0  26:0  27:145 28:146 29:141 30:142 31:143 32:144

out  01:33 02:34 03:35 04:36 05-24:0
     25:73 26:74 27:75 28:76 29:78 30:79 31:169 32:170  33-48:0
```

## Decoded mapping

| track | channel | channel fed by | track fed by | match | name |
|---|---|---|---|---|---|
| 1 | ch01 | AES50-A 1 | AES50-A 1 | ok | |
| 2 | ch02 | AES50-A 2 | AES50-A 2 | ok | Vox 1 |
| 3 | ch03 | AES50-A 3 | AES50-A 3 | ok | Vox 2 |
| 4 | ch04 | AES50-A 4 | AES50-A 4 | ok | Vox 3 |
| 5 | ch05 | AES50-A 5 | AES50-A 5 | ok | MC |
| 6 | ch06 | AES50-A 6 | AES50-A 6 | ok | Headset |
| 7 | ch07 | AES50-A 17 | AES50-A 17 | ok | Keys L |
| 8 | ch08 | AES50-A 18 | AES50-A 18 | ok | Keys R |
| 9 | ch09 | AES50-A 45 | AES50-A 45 | ok | EG L |
| 10 | ch10 | AES50-A 46 | AES50-A 46 | ok | EG R |
| 11 | ch11 | AES50-A 25 | AES50-A 25 | ok | AG |
| 12 | ch12 | AES50-A 48 | AES50-A 48 | ok | Bass |
| 13–15 | ch13–15 | OFF | OFF | ok | *(unnamed)* |
| 16 | ch16 | Local 1 | Local 1 | ok | Crowd |
| 17 | ch17 | Card 17 | Card 17 | ok | TPerc |
| 18 | ch18 | Card 18 | Card 18 | ok | TBass |
| 19 | ch19 | Card 19 | Card 19 | ok | TEG L |
| 20 | ch20 | Card 20 | Card 20 | ok | TEG R |
| 21 | ch21 | Card 21 | Card 21 | ok | TKeys L |
| 22 | ch22 | Card 22 | Card 22 | ok | TKeys R |
| 23 | ch23 | Card 23 | Card 23 | ok | Click |
| 24 | ch24 | Card 24 | Card 24 | ok | Guide |
| 25 | ch25 | AES50-A 41 | AES50-A 41 | ok | Kick |
| 26 | ch26 | AES50-A 42 | AES50-A 42 | ok | Snare |
| 27 | ch27 | AES50-A 43 | AES50-A 43 | ok | F Tom |
| 28 | ch28 | AES50-A 44 | AES50-A 44 | ok | Tom |
| 29 | ch29 | AES50-A 46 | AES50-A 46 | ok | HiHat |
| 30 | ch30 | AES50-A 47 | AES50-A 47 | ok | Cymbals |
| **31** | ch31 | AES50-A 26 | **Output 1** | **MISMATCH** | MD 1 |
| **32** | ch32 | AES50-A 21 | **Output 2** | **MISMATCH** | MD 2 |

**30/32 tracks are 1:1.** Tracks 31–32 record console Outputs 1–2 — almost
certainly a stereo mix feed deliberately parked on the last two tracks. Channels
31/32 (MD 1, MD 2) are **not recorded anywhere**.

## Three things the decode reveals

**Channels 17–24 are playback, not microphones.** They are fed from `Card 17-24`
and named TPerc / TBass / TEG L/R / TKeys L/R / Click / Guide — backing tracks
coming *in* from the playback rig. Recording them is a loopback: the desk
records the tracks it was fed. Analysis should treat 17–24 as reference
material, not captured performance.

**Channels 13–15 are OFF and unnamed** — the patch says `0` and the labels are
empty. Independent confirmation the enum decode is right.

**`AES50-A 46` feeds two channels: ch10 (EG R) and ch29 (HiHat).** Both `UIN2`
and `UIN21` are `78`. Either a deliberate split or a patching slip — worth a
human eye, since one of those channels is not hearing what its label claims.

## The card-type discrepancy

`/-stat/xcardtype` = `7` = **DN32-DANTE 32in/32out**. `xcardsync` is `ON` and
`USBmode` is `32/32`, so a 32×32 card is present and locked.

#830 and CLAUDE.md both describe capturing "the M32R's **USB** multitrack". If
the card is Dante, the capture path is a Dante virtual soundcard, not USB audio
— different drivers, different device enumeration, different failure modes.

Caveat: the protocol doc notes `xcardtype` "seems to be informative only", so it
may be stale. But `7` is specific, not a default. **Confirm physically** — look
at the back of the desk — before more is built on the USB assumption.

The `/-usb` recorder (`R_20260816-105730am.wav`) is the front-panel **stereo**
recorder. Unrelated to multitrack, and not a 32-track source.

## Caveats

1. **This is configuration, not physics.** It reflects routing as of
   2026-08-16. An engineer can repatch any time. The app must **read** these
   blocks, never hardcode 1:1.
2. **Only valid in REC mode.** `/config/routing` is `REC`. Flip it to `PLAY`
   and `/config/routing/PLAY` takes over — every channel is fed from the card
   and the mapping changes completely. That is the virtual-soundcheck path, so
   the app will hit it. Read `/config/routing` first, then the matching block.
3. **Still needs the physical confirmation #895 asks for.** This narrows the
   experiment enormously but does not replace it. Recommended check: put signal
   into one known input (say AES50-A 1), record, confirm it lands on track 1 —
   then verify tracks 31/32 carry a mix rather than MD 1/2.
4. **Enum decode is from the unofficial protocol doc**, corroborated by the
   OFF-channel and card-playback consistency above, but not vendor-confirmed.

## Recommendation for #830

Do not assume 1:1. Build the mapping at capture time by reading
`/config/routing`, `/config/routing/IN`, `/config/routing/CARD` and
`/config/userrout/*`, then resolve as above. It is ~150 read-only queries and a
few seconds. Store the resolved mapping **alongside the recording**, because it
is only true for that session's patch.

Cheap correctness win: when a track's source resolves to something other than
its channel, say so in the UI rather than silently mislabelling. On this desk
that would flag tracks 31/32 immediately.

## Second capture

A second full `.scn` was taken ~35 minutes after the first (`capture-2026-08-16b.scn`,
2103/2103 paths, 25.9 s). The desk **changed between them** — someone was
working:

```
/ch/01/preamp   HPF 178 Hz -> 114 Hz
/ch/01/eq/1     PEQ 328.1 -6.25 2.0 -> PEQ 143.2 -4.00 2.0
/ch/01/eq/2     PEQ 1k09  -8.25 2.0 -> PEQ 701.5 -9.50 1.6
/ch/01/eq/3     PEQ 2k43  -9.50 2.0 -> PEQ 2k99  -6.75 1.5
/ch/01/mix      OFF -oo -> ON -7.0
/ch/05/mix      -5.3 -> -5.7
/dca/1          OFF -> ON
/dca/8          -21.4 -> -29.9
```

Channel 01 was unmuted, EQ'd and brought up; DCA 1 opened. Meters were at
−44 dBFS throughout, so this was setup, not a live service.

Two useful conclusions: the capture is **reproducible** (2103/2103 both times,
zero misses), and a plain text diff of two captures is a genuinely readable
answer to "what did the engineer change?" — which is the before/after diff
product feature working on real data, before a line of UI exists.
