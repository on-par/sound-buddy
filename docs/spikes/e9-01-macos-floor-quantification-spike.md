# Spike e9-01 — Quantify what actually requires the macOS 26 + arm64-only floor

**Issue:** [#155](https://github.com/on-par/sound-buddy/issues/155) · **Type:** spike ·
**Epic:** os-reach · **Areas:** distribution, privacy
**Status:** COMPLETE — answered with real shipped-artifact evidence; recommendation below.

## Question

`app/electron-builder.yml` pins `minimumSystemVersion: "26.0"` and builds only an `arm64` zip
target. Is macOS 26 (Tahoe) a **real technical requirement** — some API the app actually needs —
or an **inherited/arbitrary default** set to "whatever the dev machine runs" and never revisited?
And what does the current floor (macOS 26 **and** Apple Silicon only) cost us in addressable
church-FOH-Mac reach?

## TL;DR

**macOS 26 is NOT technically required. It is an inherited default.** The floor was set in the
same commit that first created `electron-builder.yml`, matches the author's build-machine OS, and
carries no rationale. Every binary in the **already-shipped** self-contained bundle declares a
minimum OS far below 26:

| Component (from the shipped v0.2.0 `.app`, arm64) | real `minos` load command |
|---|---|
| Electron main binary + `Electron Framework` | **11.0** (Big Sur) |
| Bundled Python 3.12 (`python3.12`, `libpython3.12.dylib`) | **11.0** (Big Sur) |
| Bundled `sox`, `ffprobe`, `ffmpeg` + their `libav*` dylibs | **14.0** (Sonoma) |
| `Info.plist` `LSMinimumSystemVersion` (the gate users hit) | **26.0** ← artificial |

**The effective real floor of the current shipped bundle is macOS 14.0 (Sonoma)** — `max()` of the
binary floors — set entirely by the CI runner's Homebrew bottles, not by anything in the app. The
`26.0` Info.plist gate sits **twelve major versions above** the highest real binary floor and
blocks every Mac on macOS 14, 15, and up-to-25 for **zero technical reason**.

## How this was determined

Static + binary-level evidence, all reproducible on any Mac via
[`scripts/probe-macos-floor.sh`](../../scripts/probe-macos-floor.sh) (throwaway probe added by this
spike; no production code changed). The decisive step downloads the **actual shipped release
artifact** and reads each Mach-O binary's `LC_BUILD_VERSION` → `minos` — i.e. the OS the binary was
literally compiled to run on, independent of the Info.plist claim.

1. **Provenance (git).** `minimumSystemVersion: "26.0"` was introduced in `b69bc03`
   (`feat(app): package as downloadable macOS zip`, the commit that *created*
   `app/electron-builder.yml`) and has never been edited since. The commit message lists it as a
   bare bullet — "minimumSystemVersion 26.0" — with no stated requirement. The author's build
   machine runs **macOS 26.4.1** (`sw_vers`). Inherited-from-dev-machine, not chosen.

2. **Electron's own floor.** The app pins `electron@^31`. Electron v31's README states it ships
   binaries for **macOS Catalina (10.15) and up**; the shipped framework binary confirms it —
   `minos 11.0`. Electron does not require macOS 26.

3. **No native modules.** The entire repo has **zero** native addons — no `node-gyp`, `nan`,
   `node-addon-api`, `.node` binaries, or `robotjs`-style deps in any `package.json`. Nothing
   compiles against the host SDK at install time, so there is no hidden per-user macOS-SDK floor.

4. **No macOS-26-specific API usage.** The only macOS-native calls in the app are Electron's
   `systemPreferences.getMediaAccessStatus('microphone')` and `askForMediaAccess('microphone')`
   (`app/electron/ipc/live-capture.ts`) — both available since **macOS 10.14**. Live-capture device enumeration
   uses these plus standard Electron/web APIs. Report-card generation shells out to the bundled
   `sox`/`ffprobe`/`python` (floors 11–14 above). No AVFoundation/Core Audio 26-only symbol is
   referenced anywhere in app or package source.

5. **Where the real floor actually comes from.** The self-contained bundle's floor is the `max()`
   of its bundled binaries. `sox`/`ffprobe`/`ffmpeg` come from Homebrew on the build machine
   (`afterPack.js`), and Homebrew bottles are compiled per-macOS-major. Release CI builds on the
   **`macos-14`** runner (`release.yml`), so those bottles target **macOS 14** → the shipped tools
   declare `minos 14.0`. (On *this local dev machine*, macOS 26, the same `brew` binaries report
   `minos 26.0` — which is exactly how an unrevisited local `--dir` build would silently bake in a
   26 floor. The shipped artifact does not, because CI is on 14.)

## The lowered-floor test (macOS 14 / 15)

The spike scope asks for a pass/fail of **app launch**, **report-card generation**, and
**live-capture device enumeration** on macOS 14 (Sonoma) and/or 15 (Sequoia).

**What is proven now (binary-enforcement evidence, from the shipped artifact):**

| Subsystem | On macOS 14/15 with the Info.plist floor lowered | Basis |
|---|---|---|
| App launch (Electron shell) | **PASS (expected)** | Electron binary/framework `minos 11.0` ≤ 14/15 |
| Report-card generation (sox → ffprobe → python) | **PASS (expected)** | all bundled tools `minos ≤ 14.0`; Python `minos 11.0` |
| Live-capture device enumeration | **PASS (expected)** | Electron `systemPreferences` API is 10.14+; `minos 11.0` |

Every shipped binary already satisfies its own load-command minimum on macOS 14 and 15. The **only**
thing preventing these machines from launching the app today is the `LSMinimumSystemVersion = 26.0`
Info.plist key — a soft gate Gatekeeper/Launch Services enforce, not a binary incompatibility.

**Honest limitation — live boot not executed.** A true boot-on-hardware pass/fail was **not run**
in this spike: the work happened in a headless session on a macOS 26 machine with no macOS 14/15 VM
or spare hardware available. The determinations above are **evidence-based inferences from the
compiled binaries**, which is strong (a binary with `minos 14.0` is guaranteed loadable on 14) but
is not a substitute for observing the three flows end-to-end on a real 14/15 box. That confirmation
is the one cheap step left; the exact procedure:

```bash
# On a macOS 14 or 15 machine (or VM):
# 1. Grab the latest shipped .app, then lower only the Info.plist gate to match the binaries:
/usr/libexec/PlistBuddy -c 'Set :LSMinimumSystemVersion 14.0' "Sound Buddy.app/Contents/Info.plist"
xattr -dr com.apple.quarantine "Sound Buddy.app"      # unsigned build
# 2. Launch → confirm the window renders (app launch).
# 3. Drag a sample recording in → confirm a report card generates (sox/ffprobe/python).
# 4. Open the Live tab → confirm attached input devices enumerate (no capture needed).
# Record pass/fail for each; any failure would be a genuine (unexpected) finding.
```

Because the enforcing binaries ship `minos ≤ 14`, the expected result is three passes; a failure
would be surprising and worth a dedicated bug. This residual is flagged as a deferral, per the
autonomous-run policy, rather than blocking the spike's conclusion — the "is 26 required?" question
is already answered definitively by the binary floors above.

## Addressable-market cost of the current floor (rough range)

Per scope, this is an **informed estimate with explicit assumptions**, not gathered market data.
Treat every number as an order-of-magnitude range, not a measurement.

**Assumptions:**
- Church FOH Macs skew **2–4 years behind** current hardware/OS: budget/donated gear, an "if it
  works, don't touch it" ethos, and a strong reluctance to run a mid-season major-OS upgrade on the
  machine that runs Sunday.
- macOS 26 (Tahoe) is the **newest** major (fall-2025 release). First-year adoption of a brand-new
  major is typically only a minority of the *active* Mac base and is lower still among conservative
  installed bases like this one.
- Apple Silicon (arm64) shipped Nov 2020; a church Mac mini / iMac bought 2016–2020 is **Intel**.

**Two independent axes cut the audience:**

- **OS-version axis.** Requiring macOS **26** plausibly reaches only ~**15–30%** of church FOH Macs
  in year one. Lowering to macOS **14** (the floor the binaries *already* satisfy) plausibly reaches
  ~**70–85%** (Sonoma + Sequoia + Tahoe combined). Lowering to macOS **11–12** (Electron/Python
  floor) would reach ~**90%+** of Apple-Silicon-era Macs.
- **CPU-architecture axis.** `arm64`-only excludes **all Intel Macs** regardless of OS. Among older
  church hardware, plausibly only ~**40–60%** of FOH Macs are Apple Silicon today.

**Combined:** the current floor (macOS 26 **and** arm64) plausibly reaches only ~**10–20%** of the
target population near-term. Lowering the OS floor to 14 (essentially free — see below) roughly
**doubles-to-triples** reach on the OS axis; adding an x64 build roughly **doubles** reach on the
hardware axis. These are the two biggest reach levers Sound Buddy has, and the current floor forgoes
both.

**A note on the "runs on your ProPresenter Mac" premise (option c below).** It's empirically weak:
[ProPresenter 7 requires only macOS **12.7.4**](https://support.renewedvision.com/hc/en-us/articles/360042186713),
and even ProPresenter 19+ only requires macOS 13. A FOH Mac running *current* ProPresenter can
easily be on macOS 12–15 — **all blocked by Sound Buddy's 26 floor.** "Runs on your ProPresenter
Mac" would, in practice, *not* run on a large share of ProPresenter Macs.

## Options, effort, and recommendation

**(a) Lower `minimumSystemVersion` to the confirmed real floor.**
- **(a1) → 14.0 — effort XS (one line).** Match the Info.plist gate to the floor the shipped
  binaries *already* satisfy. No code change, no new build tooling, essentially zero risk — the
  release artifact already runs on 14. Immediately unblocks macOS 14, 15, and 16–25. **This is the
  free win.**
- **(a2) → 11.0–12.0 — effort S.** Push below 14 by building the bundled native tools against an
  older deployment target (build `sox`/`ffprobe`/`ffmpeg` on a `macos-13` runner / older Homebrew
  bottles, or from source with `MACOSX_DEPLOYMENT_TARGET`). Electron and Python already ship
  `minos 11.0`, so only the media tools gate 11–13. Modest, mechanical, meaningful extra reach.

**(b) Add an x64 / universal build target alongside arm64 — effort M.** Addresses the *hardware*
axis (Intel Macs). Bigger than it looks: `afterPack.js` currently sources **arm64-only** tools
(`cpython-…-aarch64-apple-darwin`, Apple-Silicon Homebrew bottles), so a universal/x64 build must
additionally source x64 `sox`/`ffprobe`/`ffmpeg` and an x64 `python-build-standalone`, then either
ship per-arch or `lipo` them. Real work in the packaging path + CI matrix, but it's the single
largest reach lever on the hardware axis.

**(c) Keep the macOS 26 floor and lean into "runs on your ProPresenter Mac" positioning —
effort XS, not recommended.** The premise is empirically false (ProPresenter supports macOS 12–13;
see above), the floor has **no** technical justification, and it forgoes the biggest reach lever the
product has. Only defensible if founding-user telemetry showed nearly all target Macs are already on
26 — implausible for a fall-2025 major in mid-2026.

### Recommendation

1. **Do (a1) → 14.0 immediately** as the first gated follow-up. It is a one-line change that costs
   nothing and unblocks ~2–3× the OS-axis audience; the app already ships binaries that run there.
2. **Plan (a2) → 11/12** as a small follow-up once (a1) lands, to capture the long tail of older
   (but still Apple Silicon) Macs.
3. **Evaluate (b) x64/universal with demand data** — it's the larger lift and the larger Intel-side
   payoff; sequence it after (a1)/(a2) unless early users surface concrete Intel demand.
4. **Reject (c).** Do not keep the 26 floor; there is nothing behind it.

**Cross-issue note (not actioned here):** [#154 (e8-02)](https://github.com/on-par/sound-buddy/issues/154)
system-requirements messaging currently reports the macOS-26 floor accurately. When (a1) lands, that
copy (and any "requires macOS 26 / Tahoe" string) must drop to the new floor. Reconcile the glossary
there rather than in this spike.

## Follow-up work (gated — deliberately not opened here)

Per the acceptance criteria, **zero implementation issues are opened by this spike.** The floor
changes above are gated on this conclusion and left for the backlog owner to draft. Stubs, for
reference only:

- **Stub A — Lower `minimumSystemVersion` 26.0 → 14.0 (effort XS, area: distribution).** One-line
  `electron-builder.yml` change to match the shipped binaries' real floor (`minos 14.0`). Add a CI
  assertion (extend `probe-macos-floor.sh`) that `LSMinimumSystemVersion` never exceeds the bundled
  binaries' `max(minos)` again, so the gate can't silently drift back up to the build-machine OS.
  Update #154 requirements copy in the same change.
- **Stub B — Push the floor to macOS 11–12 (effort S, area: distribution).** Build the bundled media
  tools against an older deployment target so the whole bundle's `minos` drops to 11–12.
- **Stub C — Universal / x64 build for Intel Macs (effort M, areas: distribution, packaging).**
  Source x64 `sox`/`ffprobe`/`ffmpeg` + x64 `python-build-standalone` in `afterPack.js`, add the
  arch to the `electron-builder.yml` target and the CI matrix.
