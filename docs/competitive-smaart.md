# Competitive audit: SMAART by Rational Acoustics (#766)

A short competitive-feature audit answering three questions for Sound Buddy:
what SMAART actually does, where Sound Buddy already has an edge over it, and
which 2-3 concrete feature gaps are worth considering for the roadmap. This is
research/documentation only — nothing here is a commitment to build.

Source of the comparison: field feedback from an AVL contractor/technician who
saw a Sound Buddy demo (relayed by Patrick, 2026-08-13). SMAART is the reference
dB/acoustic-measurement tool that pro-AVL technicians mentally compare Sound
Buddy against. The **live SPL readout idea** referenced throughout this doc came
out of the same conversation.

## 1. What SMAART is

SMAART (Rational Acoustics) is professional audio's most widely used acoustic
test & measurement software platform. Its job is **system tuning and alignment**:
installed-PA and live-sound engineers measure what a loudspeaker system actually
does in a room, then adjust EQ, timing, and level to a target. The operator is a
trained technician — Smaart even runs its own certification program (Smaart
Operator Certification).

Smaart v9 ships as **four editions built off one code base** (same GUI, command
structure, and hotkeys; only the feature set differs):

| Edition | What it is |
| --- | --- |
| **Smaart Suite** | The flagship. All three measurement modes (Real-Time, Impulse Response, SPL) with no functional limitations. |
| **Smaart RT** | Real-Time Mode as a stand-alone edition (RTA, spectrograph, transfer function, live impulse response). |
| **Smaart LE** | A simplified Real-Time Mode — measurement settings are pre-set and fixed; "operating RT on its default settings." |
| **Smaart SPL** | SPL Mode as a stand-alone edition: multi-channel, remotely monitorable, calibrated SPL metering and logging. |

The three **measurement modes**:

- **Real-Time Mode** — RTA (fractional-octave banding down to 1/48 oct, peak
  holds, target curves including cinema X-curves, THD, calibrated per-band SPL),
  spectrograph (spectrum-over-time, amplitude by color), transfer function
  (dual-channel FFT), live impulse response, coherence, and the delay finder.
- **Impulse Response Mode** — IR capture via a test signal, for aligning and
  tuning systems.
- **SPL Mode** — multi-channel, remotely monitorable, calibrated SPL metering
  and logging.

## 2. What SMAART does

A tight feature rundown, grounded in Rational Acoustics' public v9 documentation:

- **Real-time RTA** — single-channel spectrum with fractional-octave banding to
  1/48 oct, multiple simultaneous measurements plus live averaging, fast/slow/
  infinite averaging, peak holds, target curves (including cinema X-curves),
  THD readouts, and calibrated SPL per band.
- **Spectrograph** — spectrum-over-time with amplitude represented by color, a
  signature SMAART view for spotting time-varying problems.
- **Transfer function (dual-channel FFT)** — the core measurement: a reference
  input vs. a measurement-mic input, producing **magnitude, phase, coherence,
  and live impulse response** graphs. Up to 1/48-oct smoothing, AES-75 support,
  A/C/X/inverse weighting.
- **Delay finder** — reference-delay finder with frequency filtering plus
  automatic reference-delay tracking; the tool for aligning subs to mains,
  mains to fills, and delays to arrays.
- **Live impulse response** — IR computed continuously during real-time mode,
  so an engineer can watch system response change while adjusting.
- **Calibrated SPL metering and logging** — SPL A/C/unweighted fast and slow,
  peak C/Z, user-definable Leq, and — in SPL Mode — logging, reporting, and
  alarms, remotely monitorable across multiple channels. Calibrating an input
  against a known SPL source is a first-class setup step.
- **Signal generator** — sine, sweep, and noise (random, pseudorandom, SMPTE,
  speech-weighted) plus file playback, with multiple outputs — the stimulus
  half of a measurement session.
- **Certification ecosystem** — Smaart Operator Certification, an instructor
  network, and formal training. This is part of the moat: operators are
  credentialed on the tool.

Core use case: **live-sound and installed-PA system tuning/alignment**
(subs/mains/fills, delay alignment, EQ-to-target) by a trained technician,
usually with a measurement microphone and a test signal.

## 3. Overlap with Sound Buddy

Sound Buddy is not a measurement platform, but it already reaches into some of
this space, and one concept — the **measurement source** — already exists:

- **Live spectrum, RTA-style.** The Live tab shows a real-time spectrum during
  capture, driven by `spectrumStore` + the 60 Hz `spectrumTransport` loop
  (spectrum-chrome.ts / SpectrumPanel.tsx; ADR-0005). It is a live RTA-flavored
  view of the board feed, not a calibrated measurement.
- **Per-strip metering with dBFS readouts.** Live multi-channel capture meters
  each channel (`RMS X · Peak Y dBFS`, live-capture-panel.ts) and the capture
  stats read out RMS/Peak in dBFS (root-markup.html).
- **A measurement-source concept already exists.** The secondary measurement
  device (ADR-0003, ADR-0005, ADR-0009) lets a user select a second input —
  e.g. a measurement mic — alongside the board feed, with its own
  `measurement-event` channel, per-device-name persistence, and an
  **unconditional time-alignment warning** (relative clock drift between the two
  sources is unquantified). This is Sound Buddy reaching toward measurement —
  but only as an **input to its own analysis**, not as a general measurement
  tool.
- **Weighted, ballistic dB DSP already exists — but on the marketing site.**
  `site/src/lib/spl-meter.ts` implements pure, dependency-free DSP for exactly
  the live-meter problem: **A/C/Z weighting** (IEC 61672 curves), **slow
  (1 s) / fast (125 ms) ballistics**, and per-preset target windows
  (`TargetRange` / `evaluateRange` / `meterPercent`). It only ships in the
  **Browser Lite** marketing page, and it reads **dBFS**, not calibrated SPL.
- **"Measure vs. ideal" is Sound Buddy's native model.** Ideal Profile Match
  (ADR-0001; profiles/index.ts, compare.ts) and the report-card grade compare a
  capture against a target curve — conceptually the same shape as SMAART's
  target-curve overlay, but aimed at coaching the engineer, not tuning a system.

**Out of Sound Buddy's lane** (SMAART's reason to exist): transfer function /
dual-channel FFT, delay finder, impulse response capture, spectrograph, PA
system alignment, calibrated/legal-limit SPL logging, and remote multi-channel
SPL monitoring. Those tune *systems* (PA + room); Sound Buddy analyzes
*recordings* and coaches the engineer.

## 4. Where Sound Buddy already has an edge

- **Fully-local analysis.** No audio leaves the machine. SMAART is measurement
  software a licensed operator drives; Sound Buddy is a self-contained app that
  does its own capture and analysis locally.
- **AI-assisted coaching at zero inference cost.** The AI narrative is
  user-supplied (local Ollama or the user's own key) — Sound Buddy never proxies
  AI requests and eats zero inference cost. SMAART hands the operator raw
  measurement data and expects a certified operator to interpret it.
- **Report cards + EQ recommendations vs. raw numbers.** Sound Buddy turns a
  capture into a grade, a "why this grade" breakdown, an ideal-profile deviation
  view, and an engineer-voiced recommendation narrative. SMAART's output is
  graphs that require expertise to read.
- **Non-technical accessibility.** SMAART assumes (and certifies) a trained
  operator. Sound Buddy is built for a church-audio volunteer: panels, status
  pills, and an AI engineer who explains what to do.
- **Per-track recording/mixing focus.** Sound Buddy records and analyzes each
  channel of a live capture; SMAART measures the PA. They are adjacent but
  different jobs.
- **One app, no caps, no per-feature editions.** Smaart splits its feature set
  across Suite/RT/LE/SPL paid editions. Sound Buddy is one workflow.

## 5. Roadmap gaps worth considering

Lead candidate — the **live SPL readout** idea from the same field-feedback
conversation (a follow-on issue is filed separately once there's a pick; no issue
number exists yet):

### 5.1 Live SPL readout in the Live tab

**Borrows from SMAART:** a real-time SPL/meter readout during capture — the thing
an AVL technician instinctively looks for when a live feed is running.

**What Sound Buddy already has toward it:** the weighted/ballistic DSP in
`site/src/lib/spl-meter.ts` (A/C/Z weighting, slow/fast ballistics, target
windows) and the existing per-strip metering surface. The DSP is pure and
tested; wiring it into the Live tab is a renderer/transport slice, not new DSP.

**Why it stays in lane:** it feeds the engineer's judgment about the mix, not PA
alignment. It is a readout, not a measurement instrument.

**Be explicit about calibration:** the app's readouts are **dBFS**, and that is
the honest version. Calibrated absolute SPL (a known SPL source sets the
0-reference) is the deeper form and clearly out of scope for now — do not imply
the live readout is a calibrated SPL meter.

### 5.2 RTA-to-target overlay in real time

**Borrows from SMAART:** overlaying the live spectrum against a target curve
(its RTA workflow) so you can see "how far off target am I right now" instead of
after the fact.

**What Sound Buddy already has toward it:** the "measure vs. ideal" model
(ideal profiles + the profile-match deviation view, ADR-0001) and the live
spectrum transport. Overlaying the ideal profile on the live spectrum is the
real-time version of a comparison the app already runs offline on recordings.

**Why it stays in lane:** it stays a coaching signal ("your live curve vs. your
worship-service target") and never becomes a PA-tuning tool.

### 5.3 (Optional) Live coherence/phase — only as a coaching signal

**Borrows from SMAART:** coherence/phase readouts that tell you how trustworthy
a measurement is.

**What Sound Buddy already has toward it:** nothing shipped — this is a genuine
new capability, and that is exactly why it is the optional, weakest gap.

**Why it stays in lane (if built):** framed strictly as a measurement-informed
coaching signal (e.g. flag a channel whose measured data is incoherent during a
live session), not as a full transfer-function tool. This one risks scope creep
and should only be picked if a concrete coaching story falls out of it.

Each gap names what it borrows from SMAART, what Sound Buddy already has toward
it, and why it stays in lane — so a future issue can be cut from this list
directly. None of these are commitments; the issue is research only.

## 6. What Sound Buddy should NOT try to match

- **Transfer function / dual-channel FFT** — the core of SMAART's identity and a
  large, specialized measurement surface.
- **Delay finder** — PA/array time-alignment tooling with no coaching analog.
- **Impulse response capture** — requires test signals and system stimulus; the
  opposite of capturing a live service.
- **Spectrograph** — a genuinely useful view, but building it implies owning the
  system-measurement workflow around it.
- **PA system alignment** — the entire product category SMAART owns; Sound Buddy
  is not system-tuning software.
- **Calibrated SPL logging / legal-limit metering** — compliance-grade metering
  for facilities; out of scope for a coaching app.

These are the reason SMAART exists. Matching them would pull Sound Buddy into
competing measurement platforms. Position Sound Buddy as the **analysis and
coaching layer** — the thing SMAART's raw numbers don't give a volunteer
engineer — not as a competing measurement platform.

## 7. Sources

- Rational Acoustics — [Smaart home](https://www.rationalacoustics.com/smaart/)
  (edition descriptions: Suite / RT / LE / SPL, single code base, three
  measurement modes).
- Rational Acoustics — [Smaart RT (v9) product page](https://www.rationalacoustics.com/products/smaart-rt-v9-perpetual)
  (RTA, spectrograph, transfer function, delay finder, SPL, signal generator,
  calibration, AES-75; "specifically designed for sound system engineers").
- Rational Acoustics — [Smaart Operator Certification](https://www.rationalacoustics.com/pages/smaart-operator-certification).
- Repo files referenced by this audit: `site/src/lib/spl-meter.ts`, ADR-0001
  (ideal profile match), ADR-0003/0005/0009 (secondary measurement device),
  ADR-0005 (discrete spectrum state), `app/renderer/src/spectrum-chrome.ts`,
  `app/renderer/src/live-capture-panel.ts`, `packages/audio-engine/src/profiles/`
  and `analyze/compare.ts`.
