# The Mac Mixer may write seven channel parameters only through a separate, armed writer with read-back and per-move undo; the read-only path stays unable to write

- Status: Accepted
- Date: 2026-11-27

## Context

Patrick decided on 2026-11-27 CT that the Mac Agentic Mixer's **Apply to Board** writes to the console live, with Undo
(`design/sound-buddy/agentic-mixer/spec.md` §0.1). Three records currently forbid that:

- ADR-0161 §1: "The Electron/Mac console surface stays read-only (ADR-0060 guardrail and ADR-0075 unchanged)." Its
  Consequences add: "Any future write beyond EQ needs a new ADR, not an allowlist edit."
- Epic #1660, "Out of scope (parent)": "Writes beyond EQ (faders, mutes, routing, scenes, `/-action`, console undo).
  Electron write access."
- `docs/security/tier-1-tier-2-threat-model.md`, Tier definitions: "All other writes, and every write from the Mac app,
  remain out of scope." Mitigation 2 names the iOS `ConsoleEQWriter` as "the single exception".

What exists at `d6f4fe8`:

- `packages/console/src/index.ts` `encodeOscMessage` calls `assertReadOnlyOscMessage` unconditionally, then serializes.
  The serializer is inline in that function; there is no unguarded serializer to share.
- `packages/console/src/read-only-guard.ts` holds `DENY_ADDRESS_PREFIXES` (12 entries, not exported) and
  `ALLOWED_WITH_ARGS_ADDRESSES`. With `args: []` the guard checks only the deny prefixes and returns.
- `packages/console/src/scaling.ts` is raw-to-engineering only: `oscToEqFreqHz`, `oscToEqGainDb`, `oscToEqQ`,
  `oscToHpfHz`, `oscToLevelDb`, `oscToDynamicsThresholdDb` and others. It has no inverse and no compressor ratio
  conversion.
- `packages/console/src/channel-strip.ts` `parseChannelStrips` parses the `/node` text lines `/ch/NN/mix`,
  `/ch/NN/preamp`, `/ch/NN/dyn`, `/ch/NN/eq`, `/ch/NN/eq/N`. `ChannelDynamics` has `mode`, `thr`, `ratio`.
  `ChannelEq.bands[].freq` stays a string (`"1k09"`). `buildChannelFaderPath(n)` returns `/ch/NN/mix/fader`.
- `packages/console/tsconfig.cjs.json` has `"include": ["src/index.ts"]`. Only `index.ts` and its imports reach
  `dist-cjs`. `app/electron/console-loader.ts` types the module as `typeof import('../../packages/console/dist-cjs/index')`
  and loads it with `loadBundledCjs('console')`. `loadBundledCjs(resourceName, entryRelPath = 'index.js')` already takes
  a second entry. `resource-layout.json` ships all of `packages/console/dist-cjs` as `Resources/console`.
- `app/electron/ipc/console-connection.ts` `queryConsole` opens one socket per query, encodes with `encodeOscMessage`,
  and retries on timeout (`DEFAULT_CONNECTION_QUERY_TIMEOUT_MS = 350`, `DEFAULT_CONNECTION_QUERY_MAX_RETRIES = 3`).
- `app/electron/ipc/console-channel-state.ts` reads with exactly one `queryConsole(deps, ip, '/node', …)` call site and
  parses with `parseChannelStrips`.
- `app/renderer/src/console-read-only-gate.test.ts` (not under `app/electron/ipc/`) pins six `ipcMain.handle` names in
  `app/electron/ipc/console.ts` only, scans eight files for `WRITE_VERB_PATTERN`, and says "A future slice that needs a
  console write path must delete/rewrite this gate in the same PR".
- iOS `apps/ios/SoundBuddyKit/Sources/SoundBuddyKit/Console/`: `ConsoleEQWriteAllowlist` parses by path segment, with
  leaves `on`, `N`, `N/type`, `N/f`, `N/g`, `N/q`. `ConsoleEQ.swift` quantizes writes to grids it cites to the X32 OSC
  doc: EQ freq 201 steps, gain 0.25 dB, Q 72 steps, HPF 101 steps. `ConsoleEQWriter` limits gain to ±3 dB per gesture,
  frequency to 1 octave, and sends at most 20 messages/s.
- `packages/console/src/capture-2026-08-16.scn` (M32R capture) shows, among other lines:
  `/ch/01/preamp +0.0 OFF ON 24 178`, `/ch/01/dyn ON COMP PEAK LOG -23.0 5.0 1 0.00 10 10.0  151 POST 0 100 OFF`,
  `/ch/01/eq/2 PEQ 1k09 -8.25 2.0`. Observed ratio tokens: `3.0`, `4.0`, `5.0`. Observed thresholds sit on 0.5 dB steps.
  Observed EQ gains sit on 0.25 dB steps. HPF `178` and `226` fall on the 101-step grid (k = 73, 81).
- No current-scene read exists in `packages/console` or `app/`. `scene-inventory.ts` reads only stored-scene metadata at
  `/-show/showfile/scene/NNN`, and says scene contents are unreachable over the read-only OSC surface.
- ADR-0161 §8: "Arming for writes is a separate, later step from consent."

## Decision

### 1. Scope and amendment

This ADR amends ADR-0161 §1's sentence "The Electron/Mac console surface stays read-only", ADR-0075's read-only IPC
surface, and #1660's "Electron write access" out-of-scope line. It does so **for the Mac Mixer write tier defined here
only**. It is the "new ADR" ADR-0161 requires for writes beyond EQ.

- Writes happen only in the Electron main process, only when the `mixer` flag (ADR-0148, env-only, default off) and a
  second env-only flag, `mixerWrites` (camelCase to match `FEATURE_FLAG_IDS`; `SOUND_BUDDY_FEATURES` matches tokens case-insensitively), are both on. With either off,
  `registerConsoleWriteHandlers` is not called and no write IPC exists.
- Consoles: X32/M32 family only. SQ-6 and every other model stay out of scope.
- The iOS tier (ADR-0161) is unchanged.
- ADR-0060 (read-only guardrail) is unchanged: the guard still lives inside `encodeOscMessage`, and nothing narrows it.

### 2. Encoder separation

- `packages/console/src/read-only-guard.ts`, `index.ts`, and `osc-parity-fixtures.json` stay byte-identical. Their
  existing specs pass unmodified.
- New file `packages/console/src/armed-writer.ts` is the only code in the repo that produces a console write datagram.
  - Its input is a typed union, not an `OscMessage`, so no caller can pass an address:

    ```ts
    type ChannelIndex = number & { readonly __brand: 'ChannelIndex' } // 1..32
    type EqBand = 1 | 2 | 3 | 4
    type RatioIndex = number & { readonly __brand: 'RatioIndex' }      // 0..RATIO_TOKENS.length-1

    type ArmedWrite =
      | { kind: 'eq-gain';   channel: ChannelIndex; band: EqBand; db: number }
      | { kind: 'eq-freq';   channel: ChannelIndex; band: EqBand; hz: number }
      | { kind: 'eq-q';      channel: ChannelIndex; band: EqBand; q: number }
      | { kind: 'hpf-freq';  channel: ChannelIndex; hz: number }
      | { kind: 'fader';     channel: ChannelIndex; db: number }
      | { kind: 'dyn-thr';   channel: ChannelIndex; db: number }
      | { kind: 'dyn-ratio'; channel: ChannelIndex; ratio: RatioIndex }

    export function encodeArmedWrite(write: ArmedWrite): Uint8Array
    export function parseArmedAddress(address: string): ArmedTarget | null // segment parser, used by encodeArmedWrite and specs
    ```
  - `encodeArmedWrite` builds the address, runs `parseArmedAddress` on it (split on `/`, exact segment match, never a
    prefix test), then calls the exported `assertReadOnlyOscMessage({ address, args: [] })`. With no args that call
    checks only `DENY_ADDRESS_PREFIXES`, so the guard's own deny list is enforced on every write without editing or
    exporting it.
  - It carries its own serializer for exactly one `f` or one `i` argument (address, type tag, one 4-byte big-endian
    value). Duplicating these few lines is the price of leaving `encodeOscMessage` untouched. Drift is caught by
    `packages/console/src/armed-osc-fixtures.json` (new, Mac-only) and a spec that decodes every armed datagram with the
    existing `decodeOscMessage` and asserts the same address and argument. Two fixture rows, computed for this ADR:
    - `/ch/01/eq/1/g ,f 0.5` → `2f63682f30312f65712f312f670000002c6600003f000000`
    - `/ch/05/dyn/ratio ,i 5` → `2f63682f30352f64796e2f726174696f000000002c69000000000005`
- `index.ts` does not import or re-export `armed-writer.ts`. `tsconfig.cjs.json` `include` adds
  `src/armed-writer.ts` so it is emitted as `dist-cjs/armed-writer.js`.

### 3. Day-one allow-list

The allow-list is the ceiling. A kind is reachable only when a rule (§15) emits a move of that kind. In v1 the only
OSC-grounded diagnosis is over-compression, so v1 rules emit only `dyn-thr` and `dyn-ratio`. The other five are allowed
so that their rules can land later without another ADR.

`NN` = `01`..`32` (two digits, `CONSOLE_CHANNEL_COUNT = 32`). `B` = `1`..`4`. Every message carries exactly one argument.

| Kind | Address | Arg | Repo grounding | Precondition (read from the pre-read line) |
|---|---|---|---|---|
| `eq-gain` | `/ch/NN/eq/B/g` | `,f` 0..1 | leaf `g` in iOS `ConsoleEQWriteAllowlist`; `oscToEqGainDb` | band type token is `PEQ`, `VEQ`, `LShv` or `HShv` |
| `eq-freq` | `/ch/NN/eq/B/f` | `,f` 0..1 | leaf `f` in iOS allowlist; `oscToEqFreqHz` | band type is not `LCut`/`HCut` |
| `eq-q` | `/ch/NN/eq/B/q` | `,f` 0..1 | leaf `q` in iOS allowlist; `oscToEqQ` | band type is `PEQ` or `VEQ` |
| `hpf-freq` | `/ch/NN/preamp/hpf` [DESK] | `,f` 0..1 | `oscToHpfHz`; iOS HPF grid. **Address not in repo** | HPF on token in `/ch/NN/preamp` line is `ON` |
| `fader` | `/ch/NN/mix/fader` | `,f` 0..1 | `buildChannelFaderPath`; `oscToLevelDb` | fader token is not `-oo` |
| `dyn-thr` | `/ch/NN/dyn/thr` [DESK] | `,f` 0..1 | `oscToDynamicsThresholdDb`. **Address not in repo** | dyn on is `ON` and mode token is `COMP` |
| `dyn-ratio` | `/ch/NN/dyn/ratio` [DESK] | `,i` index [DESK] | none. **Not in `scaling.ts`; address not in repo** | dyn on is `ON` and mode token is `COMP` |

The `COMP` precondition matters: on an expander (`EXP`) "gentler" runs the other way, so dyn writes are refused there.

Not writable, ever, in this tier: `/ch/NN/mix/on` (mute), `/main/st/mix/fader`, `/main/m/mix/fader`, every `/bus`,
`/mtx`, `/dca`, `/auxin`, `/fxrtn`, `/fx`, `/headamp` address, `/ch/NN/eq/on`, `/ch/NN/eq/B/type`, the combined band
`/ch/NN/eq/B ,ifff`, `/ch/NN/preamp/hpon` and HPF slope, `/ch/NN/dyn/on`, Main LR EQ, sends, routing, and the 12 deny
prefixes (§6). A message with no arguments on a writable address is refused (a query is not a write).

`dyn-ratio` table. `RATIO_TOKENS = ['1.1','1.3','1.5','2.0','2.5','3.0','4.0','5.0','7.0','10','20','100']`, sent as
`,i` index 0..11. This list and the int encoding are **from the unofficial Maillot X32 OSC doc, not from the repo**. The
fixture confirms only `3.0`, `4.0`, `5.0` as tokens. If the desk run (§13) contradicts any entry, `dyn-ratio` is removed
from the allow-list and PR 2 ships with `dyn-thr` only.

### 4. Delta limits

Limits are measured from the value read by the pre-read (§7), not from the card's original value. A larger change is
proposed as a new move after the previous one reads back. Steps are never chained automatically; each one is its own Apply.

| Kind | Per-move limit | Direction rule | Absolute bound |
|---|---|---|---|
| `eq-gain` | ±3 dB | none | −15..+15 dB |
| `eq-freq` | ±1 octave | none | 20 Hz..20 kHz |
| `eq-q` | ×/÷ 2 | none | 0.3..10 |
| `hpf-freq` | ±½ octave | none | 20..400 Hz |
| `fader` | ±3 dB | none | ≤ +10 dB, never to or from `-oo` |
| `dyn-thr` | +3 dB | raise only (gentler) | ≤ 0 dB |
| `dyn-ratio` | 1 index | lower index only (gentler) | ≥ index 0 |

EQ gain is **±3 dB per move**, matching ADR-0161 §4 and `ConsoleEQWriteLimits.maxGainStepDb`. This overrules the Pixel
spec's §4.2 "EQ ±6 dB" (signed off by Patrick Robinson on 2026-11-27). Raising it to ±6 dB is a one-constant change in a later ADR. The Pixel spec text must
be corrected to ±3 dB either way.

Values are clamped, then quantized to the console grid (§10) before sending. A move whose quantized value equals the
pre-read value is refused as a no-op.

### 5. Undo model

**Per-move stored value only.** No pre-session snapshot revert on Mac. Never `/-action/undopt`, `/-action/doundo`, or any
`/undo` address (all denied by the guard anyway).

Why not ADR-0161's snapshot revert: a bulk revert writes many parameters at once and overwrites any desk change made
since. That is the opposite of desk-wins (§6) during a live service. This departs from ADR-0161 §6 for Mac only (signed off by Patrick Robinson on 2026-11-27).

The main process keeps an in-memory log, never persisted for replay:

```ts
interface AppliedMove {
  id: string
  write: ArmedWrite            // what was sent
  address: string
  beforeRaw: number            // raw value from the pre-read, quantized to the grid
  beforeToken: string          // console text token from the pre-read line, e.g. "-0.50"
  afterRaw: number
  afterToken: string           // console text token from the read-back line
  consoleIdentity: string      // identity pinned at arm
  appliedAt: number
  state: 'applied' | 'undone' | 'unconfirmed' | 'expired'
}
```

- Undo writes `beforeRaw` to the same address through `encodeArmedWrite`, with the same pre-read, read-back, rate limit,
  and armed requirement as Apply. Undo is exempt from the direction rule (it restores the operator's value) and is
  inside the delta limit by construction.
- Undo is offered only on the newest `applied` entry per address.
- Before sending, Undo pre-reads the parameter. If it no longer matches `afterToken` within tolerance (§18), Undo is
  refused, the entry becomes `expired`, and nothing is sent. Undo never overwrites a desk change.
- UI copy on the button names exactly what it overwrites: "Undo: set Ch 05 comp threshold back to −23.0 dB. Changes
  only this one setting."
- Failure behavior is the same as Apply (§7, §8): a mismatch or no answer halts writes and disarms.
- The log feeds Recent and the Report Card as read-only history. No entry can be replayed as a write.

### 6. Armed state, auto-relock, desk-wins, exclusions

- Every connection starts disarmed. Arming is an explicit toolbar toggle in the Mixer tab. The first arm per app launch
  shows the confirmation dialog in §14. The armed state is never persisted.
- Auto-relock (disarm) on any of:
  - 2 minutes without an Apply or Undo (ADR-0161 §3 parity).
  - The ADR-0079 link state leaving live (offline or reconnecting), a heartbeat failure, or `stop-console-live-state`.
  - Reconnect or resync, a console IP change, or a console identity change (identity pinned at arm from
    `fetchConsoleIdentity`).
  - Electron `powerMonitor` `suspend` or `lock-screen`.
  - Sermon Quiet turned on.
  - Consent revoked.
  - Any read-back mismatch or unconfirmed write (§7). After that, re-arm is blocked until the operator dismisses the error.
  - Rate cap exceeded (§17).
- Desk-wins:
  - Any live-state read (PR 1 fast or slow tier) that shows a parameter different from the value a pending card was
    built from drops that card ("Changed on desk").
  - The Apply pre-read repeats that check immediately before the send.
  - Our own write echoed back through the `/xremote` subscription matches `afterRaw` and is not a desk change.
- Mute (`/ch/NN/mix/on`) and the main faders are never offered as moves and are unwritable (§3).
- These 12 prefixes stay unwritable forever, enforced twice: they are absent from `parseArmedAddress`, and
  `assertReadOnlyOscMessage({ address, args: [] })` runs on every write: `/save`, `/load`, `/copy`, `/paste`,
  `/delete`, `/add`, `/undo`, `/scene`, `/snapshot`, `/cue`, `/-action`, `/-libs`.

### 7. Apply sequence and read-back

One Apply (or Undo) runs this sequence in `app/electron/ipc/console-write.ts`:

1. Check armed, online, and that no other Apply/Undo is in flight.
2. **Pre-read.** `queryConsole(deps, ip, '/node', (m) => parseNodeReplyLine(path, m), { requestArgs: [{ type: 's', value: path }] })`,
   the same call shape `console-channel-state.ts` uses, with `path` = the owning node: `/ch/NN/eq/B` (eq-*),
   `/ch/NN/preamp` (hpf), `/ch/NN/mix` (fader), `/ch/NN/dyn` (dyn-*). Check the precondition (§3), the delta limit,
   the direction rule, and desk-wins against the card.
3. **Write.** Send the one `encodeArmedWrite` datagram once, on a fresh socket, with no retry.
4. **Read-back.** Run the same `/node` query on the same `path` and parse the token.
5. Show "Applied to X32" only when the token matches the expected value within §18 tolerance.

Why `/node` over a single-parameter query (`/ch/NN/dyn/thr` with no args): `/node` is the only read the Mac path uses
today. Its text is what `parseChannelStrips` already parses, what the UI displays, and what desk-wins compares. A no-arg
query on a writable address would also be a new read shape, and the armed writer refuses no-arg messages by design. The
cost is display-precision tolerance (§18).

- Mismatch: the card shows "The X32 reports −20.5 dB, not −20.0 dB. Writes are stopped. Check the desk, then re-arm."
  The entry is stored, the session disarms, and no further write is sent.
- Read-back gets no answer (`queryConsole` exhausts its 3 × 350 ms read retries; re-reading is safe): the entry becomes
  `unconfirmed` and the session disarms. Copy: "Sent, but the X32 didn't confirm. Writes are stopped. Look at the desk
  before re-arming."
  - The next live-state read resolves the entry to `applied` (matches after) or back to not applied (matches before).
  - Nothing is resent.

### 8. Network drop

- An `AbortSignal` tied to the link state and the armed state is checked after the pre-read and immediately before the
  send. A drop before step 3 cancels the Apply and nothing is sent. Copy: "X32 disconnected. Disarmed. Nothing was sent."
- A drop after step 3 is the `unconfirmed` path (§7).
- The write datagram is never retried, never queued, and never replayed on reconnect. There is no backlog to drain.
- Disconnect disarms (§6). Reconnecting does not re-arm.

### 9. Import gate

TypeScript has no `internal`, and `app/` loads `packages/console` through `dist-cjs`. So a static spec pins who can
reach the writer.

- New loader in `app/electron/console-loader.ts`:
  `loadConsoleArmedWriterModule()` → `loadBundledCjs<ArmedWriterModule>('console', 'armed-writer.js')`, typed as
  `typeof import('../../packages/console/dist-cjs/armed-writer')`.
- New spec `app/electron/console-armed-writer-import-gate.test.ts` scans every `.ts`/`.tsx`/`.js` file under `app/`
  (excluding `node_modules`, `dist`, build output) for the substring `armed-writer`. It asserts the full set of matches is
  exactly:
  - `app/electron/console-loader.ts` (the loader and its type import)
  - `app/electron/console-armed-writer-import-gate.test.ts` (itself)
- The same spec asserts `loadConsoleArmedWriterModule` appears only in `app/electron/console-loader.ts` and
  `app/electron/ipc/console-write.ts` (plus their colocated tests).
- New spec `packages/console/src/armed-writer-import-gate.test.ts` asserts:
  - `index.ts` contains no `armed-writer`.
  - The only `src/` files containing `armed-writer` are `armed-writer.ts`, its tests, and the gate.
  - `scaling-inverse.ts` (§10) is imported only by `armed-writer.ts` and specs.
  - `tsconfig.cjs.json` `include` is exactly `["src/index.ts", "src/armed-writer.ts"]`.
- Nothing under `app/renderer/` may match `armed-writer`, `encodeArmedWrite` or `loadConsoleArmedWriterModule`.

### 10. Inverse of `scaling.ts`

New file `packages/console/src/scaling-inverse.ts`, not re-exported from `index.ts`, imported only by `armed-writer.ts`:
`eqGainDbToOsc`, `eqFreqHzToOsc`, `eqQToOsc`, `hpfHzToOsc`, `levelDbToOsc`, `dynamicsThresholdDbToOsc`, plus
`ratioIndexFromToken` / `RATIO_TOKENS` (§3). Each one clamps to 0..1 and quantizes to its grid, as iOS `ConsoleEQScale`
does.

| Function | Grid | Source |
|---|---|---|
| `eqFreqHzToOsc` | 201 steps, log | iOS `freqStepCount`; fixture `1k09` = k 116 |
| `eqGainDbToOsc` | 0.25 dB (121 steps) | iOS `gainStepDb`; fixture gains |
| `eqQToOsc` | 72 steps, log | iOS `qStepCount` |
| `hpfHzToOsc` | 101 steps, log | iOS `hpfStepCount`; fixture `178`, `226` |
| `dynamicsThresholdDbToOsc` | 0.5 dB (121 steps) | fixture thresholds only [DESK] |
| `levelDbToOsc` | 1024 steps, piecewise inverse of `oscToLevelDb` | **not in repo** [DESK] |

Specs (Vitest, 100/95/100/100 floor):
- For every grid index `k` of every function: `inverse(forward(k/(n−1)))` returns `k/(n−1)`, and
  `forward(inverse(x))` lands on a grid point.
- Boundaries, NaN, and out-of-range inputs clamp.
- A cross-language drift spec reads `ConsoleEQ.swift` and asserts its `freqStepCount = 201`, `gainStepDb = 0.25`,
  `qStepCount = 72`, `hpfStepCount = 101` equal the TS constants.

### 11. `console-read-only-gate.test.ts` rewrite

`app/renderer/src/console-read-only-gate.test.ts` is rewritten in PR 2, in the diff, and renamed in its `describe` to
"Console IPC surface: read-only modules stay read-only; writes exist only in console-write.ts (ADR-0163)". It is not
deleted and no assertion is loosened:
- The six `console.ts` handle names stay pinned, in order.
- The eight files keep the `WRITE_VERB_PATTERN` check unchanged.
- `console-channel-state.ts` and `console-scene-capture.ts` still send only `/node`.
- The meter path still holds only `'/renew'` and `'/xremote'`.
- `ConsolePanel.tsx` buttons stay read actions.
- Additions are listed in §16.

### 12. iOS parity

- `osc-parity-fixtures.json` stays byte-identical. Armed fixtures live in the new Mac-only `armed-osc-fixtures.json`.
- EQ leaves use the same wire grammar as iOS (`/ch/NN/eq/B/g|f|q`) and the same grids (§10 drift spec).
- No iOS file changes. iOS stays EQ-only under ADR-0161 until an iOS ADR says otherwise.

### 13. Real-desk proof gate

PR 2 does not merge on mocks. One run on a real X32 or M32 (the church M32R qualifies) is recorded in the PR body with
app logs of every datagram sent and every `/node` reply line, plus screenshots. Each step passes or the PR waits.

1. Disarmed: tap Apply. Nothing is sent (log shows no write address).
2. Arm. The armed indicator shows. Apply one `dyn-thr` raise. Read-back matches. "Applied to X32" shows. The desk screen
   shows the new value.
3. Repeat for each other allow-listed kind that ships: `dyn-ratio`, `eq-gain`, `eq-freq`, `eq-q`, `hpf-freq`, `fader`.
   This confirms the [DESK] addresses, the `,i` ratio encoding, the `RATIO_TOKENS` order including tokens ≥ 10, and
   the threshold and fader grids.
4. Undo each. The value returns to `beforeToken`.
5. Desk-wins: change the parameter on the desk after Apply. Undo refuses and nothing is sent. Change it before Apply.
   The card drops.
6. Idle 2 minutes: relock.
7. Cable pull before Apply: Apply disabled, nothing sent. Cable pull between write and read-back: `unconfirmed`, disarm,
   no resend after reconnect.
8. Recall a scene on the desk. Record what `/node ,s "-show/prepos/current"` returns before and after (§19).
9. Record the display format of a truncated value (for example an EQ gain of −10.75 dB) to confirm §18.
10. Confirm the write lands with no `/xremote` on the sending socket, and that the meter subscription stays live (the
    4-client cap, ADR-0063).

### 14. Sunday-safety copy and armed indicator

The mock drew neither. Both are required.

- Persistent indicator, visible on every tab while armed: a red (`--issue`) pill in `#header` next to LIVE,
  "ARMED · X32 · relocks in 1:42". In the Mixer toolbar the same pill doubles as the arm toggle. When disarmed it reads
  "Read-only" in neutral.
- First-arm dialog per launch:
  - Title: "Let Sound Buddy change the X32?"
  - Body: "While armed, each Apply changes one setting on the desk: an EQ band, the high-pass, compressor threshold or
    ratio, or a channel fader. It never touches mutes, the main fader, scenes or shows. Sound Buddy disarms after 2
    minutes without a change, if the desk disconnects, or when Sermon Quiet turns on. Undo puts back the value from
    before Apply."
  - Buttons: "Not now" / "Arm for this session".
- Apply while disarmed is disabled, with the hint "Arm to apply. Nothing changes on the X32 until you tap Apply."
- Applied: "Applied to X32 · 10:44 · reads −20.0 dB".
- Undo copy per §5. Desk changed: "Changed on the desk after Apply. Undo is off so it won't overwrite the desk."

### 15. Model-output isolation

- Appliable moves are created only in the main process by pure rule functions (new `app/electron/mixer/proposed-moves.ts`)
  from live state main already holds. Main assigns each move an id and pushes moves to the renderer on
  `console-live-state`.
- If PR 1 placed a rule in the renderer, PR 2 moves that rule into a pure module main imports. The renderer only displays.
- `apply-console-move` takes `{ moveId: string }` and nothing else. Main looks the id up in its own map. Unknown, stale,
  or desk-changed ids are refused. The renderer cannot supply an address, value, channel or IP.
- Assist output (PR 3) is typed `string` and only renders. A static spec asserts no file under PR 3's assist folders
  imports `proposed-moves`, `ArmedWrite`, or calls `applyConsoleMove`.

### 16. IPC handler gate

The rewritten gate enumerates `ipcMain.handle('…'` in **every** non-test `.ts` file under `app/electron/ipc/`, and in
every other `.ts` file under `app/electron/`. Today the gate reads only `console.ts`, so a write handler in a new file
would pass it untouched.
- The full file → handle-name map is pinned as an exact literal, generated when PR 2 opens. Any added, removed or moved
  handle fails the gate.
- `console.ts` keeps exactly its six handles.
- New file `app/electron/ipc/console-write.ts` registers exactly `arm-console-writes`, `disarm-console-writes`,
  `apply-console-move`, `undo-console-move`.
- No other file registers a handle whose name contains `console` except the existing consent grant handle, pinned by
  name.
- `console-write.ts` sends reads only as `queryConsole(… '/node' …)` and never calls `encodeOscMessage`.
- `consoleStore.ts` and `ConsolePanel.tsx` still match no write verb. Write vocabulary is allowed only in
  `console-write.ts` and the new Mixer write store, both named in the gate.

### 17. Rate limit and coalescing

ADR-0161 §5 coalesces drag gestures to at most 20 messages/s with no backlog. Mac Apply is a tap, not a drag, so the
limits are tighter:
- At most 1 Apply/Undo in flight, app-wide. Buttons disable while one runs. A second tap is refused, not queued.
- At least 250 ms between write datagrams (at most 4/s).
- At most 10 writes per rolling 60 s per armed session. The 11th disarms, with "Too many changes in a minute. Re-arm to
  continue."
- Coalescing: there is no queue, so there is nothing to coalesce. Latest-wins never applies, and nothing is ever replayed.
- Reads stay within PR 1's cap of 150 `/node` queries per tick. Each Apply adds 2 reads.

### 18. Read-back tolerance and stepped parameters

The `/node` text appears to **truncate**, not round. The evidence: EQ freq k = 116 is 1099.08 Hz and shows `1k09`; Q
k = 32 is 2.0589 and shows `2.0`. This is inferred from the fixture. [DESK] step 9.

Rule (`withinReadBackTolerance(kind, expected, token)`): accept if
`|parse(token) − forward(expectedRaw)| < max(LSD(token), halfGridStep(kind))`.
- `LSD(token)` is the unit of the last digit shown. `halfGridStep` is half the grid step at `expected`. Frequencies and
  Q use ratios.
- The rule rejects a neighbouring grid value wherever the display can tell them apart. Where the display cannot (Q below
  1, HPF near 20 Hz), it accepts what the desk itself shows as equal.
- Comparisons use tolerance, never float equality (the constitution rule quoted in `scaling.ts`).

| Kind | Token example | LSD | Half step | Effective tolerance |
|---|---|---|---|---|
| `eq-gain` | `-8.25`, `-10.7` | 0.01 / 0.1 dB | 0.125 dB | 0.125 dB |
| `eq-freq` | `1k09`, `328.1` | 10 Hz / 0.1 Hz | 1.73 % | max(LSD, 1.73 %) |
| `eq-q` | `2.0` | 0.1 | 2.5 % | max(0.1, 2.5 %) |
| `hpf-freq` | `178` | 1 Hz | 1.5 % | max(1 Hz, 1.5 %) |
| `fader` | `-5.7` | 0.1 dB | [DESK] grid | 0.1 dB until the grid is confirmed |
| `dyn-thr` | `-23.0` | 0.1 dB | 0.25 dB | 0.25 dB |
| `dyn-ratio` | `3.0` | enumerated | n/a | token maps to the exact expected `RATIO_TOKENS` index; float match ≤ 0.05 picks the entry |

The ratio is a stepped, enumerated value. It is written as an index, read back as a label, and never interpolated.
`parseChannelStrips` turns the token into a float. Read-back works on the raw token, so `console-write.ts` parses the
`/node` line with a new pure `parseReadBackToken(line, kind)` in `packages/console`. That function also adds
`parseEqFreqToken` (`'1k09'` → 1090, `'328.1'` → 328.1), specced against every freq token in
`capture-2026-08-16.scn`.

### 19. Consent copy, threat model, and "Undo until the scene changes"

- **Consent stays read-only consent.** `CONSOLE_NETWORK_CONSENT_SCOPE` is unchanged. Arming (§6, §14) is the separate
  write consent, as ADR-0161 §8 says.
  - With `mixerWrites` off, `ConsoleNetworkConsentDialog.tsx` is byte-identical.
  - With it on, the sentence "Read-only: Sound Buddy never writes to or changes console settings." becomes "Sound Buddy
    only reads from your console unless you arm Mixer and tap Apply." The button "Allow read-only access" becomes
    "Allow access".
- **Threat model**, same change as this ADR:
  - Tier definitions: the sentence "All other writes, and every write from the Mac app, remain out of scope." becomes
    "The Mac Mixer may write the seven channel parameters in ADR-0163 through its armed writer. All other writes remain
    out of scope."
  - Mitigation 2: add "*Amended by ADR-0163: the Mac armed writer (`packages/console/src/armed-writer.ts`) is the second
    exception; the read-only path still cannot produce a write.*" `threat-model.test.ts` still passes (mitigations
    mention `#378` and match `/read-only/i`).
  - Review & sign-off: add a checked line "Mac Mixer write tier (ADR-0163) reviewed and approved (Patrick Robinson, 2026-11-27)".
- **Scene change.** No current-scene read exists in the repo, so v1 does not detect scene changes.
  - Undo availability rests on the value-match check (§5). A scene recall that changes the parameter expires its Undo.
    A recall that leaves the parameter unchanged keeps Undo valid, and Undo then restores the pre-Apply value.
  - Undo also expires when the console identity changes and when the app quits.
  - The UI copy is "Undo stays available while this setting is unchanged on the desk", not the mock's "until the scene
    changes".
  - The candidate read is `/node ,s "-show/prepos/current"`. The read-only guard permits it (`/-show` is not a deny
    prefix). Whether the desk answers, and with what, is unknown. [DESK] step 8.
  - If the desk run shows a usable index, a follow-up adds it to PR 1's slow tier (a new path, not a new call site) and
    expires all Undo entries when it changes. That follow-up changes only expiry, so it needs no new ADR.

## Consequences

Positive:
- Apply to Board works on the real desk with structural rails: a type the read path cannot import, a typed input with
  no free-form address, the guard's own deny list re-run on every write, one write per tap, a read-back before success,
  and specs on emitted datagrams.
- `encodeOscMessage`, the guard and the parity fixtures do not change.

Negative:
- The "Sound Buddy never writes" message no longer holds for flag-on Mac builds.
- About 25 lines of serializer are duplicated. Fixtures and a decode round trip guard them.
- Per-move Undo cannot restore a whole session in one tap.
- Four addresses and the ratio table are not repo-grounded until the desk run.
- The console has no authentication, so these rails stop our own mistakes, not a hostile LAN device. ADR-0060's
  management-VLAN advice stands.
- If ADR-0162 (draft #1712, native Swift Mac) is accepted, this writer is ported to SoundBuddyKit next to
  `ConsoleEQWriter`. The rules in this ADR carry over unchanged.

## Checklist traceability

| # | Item | Section |
|---|---|---|
| 1 | Scope, amends ADR-0161 and #1660 | §1 |
| 2 | Separate armed encoder; guard and `encodeOscMessage` untouched | §2 |
| 3 | Day-one allow-list | §3 |
| 4 | Delta limits (±3 dB) | §4 |
| 5 | Undo model | §5 |
| 6 | Armed state, relock, desk-wins, mute/main, 12 deny prefixes | §6 |
| 7 | Read-back via `/node`, mismatch halts | §7 |
| 8 | Network drop | §8 |
| 9 | Import gate (source + `dist-cjs`) | §9 |
| 10 | Inverse of `scaling.ts` with round-trip specs | §10 |
| 11 | `console-read-only-gate.test.ts` visibly rewritten | §11 |
| 12 | iOS parity | §12 |
| 13 | Real-desk proof gate | §13 |
| 14 | Sunday-safety copy and armed indicator | §14 |
| 15 | Model-output isolation | §15 |
| 16 | IPC handler gate across all `app/electron/ipc` files | §16 |
| 17 | Rate limit and coalescing | §17 |
| 18 | Read-back tolerance; ratio is enumerated | §18 |
| 19 | Consent copy, threat model, scene-change mechanism | §19 |

## References

- [ADR-0161: iOS EQ-only armed writer](0161-ios-may-write-console-eq-only-through-a-separate-armed-writer-with-delta-limits-auto-relock-and-pre-session-undo-the-read-only-path-stays-unable-to-write.md)
- [Epic #1660](https://github.com/on-par/sound-buddy/issues/1660)
- [Tier 1/Tier 2 threat model](../security/tier-1-tier-2-threat-model.md)
- [ADR-0006: consent modal only](0006-tier-2-console-network-consent-is-granted-only-by-the-first-run-modal-never-by-a-settings-toggle.md)
- [ADR-0060: read-only guardrail inside encodeOscMessage](0060-read-only-guardrail-is-enforced-inside-encodeoscmessage-itself-not-by-callers.md)
- [ADR-0060: OSC feasibility spike](0060-osc-feasibility-spike-371-concludes-feasible-with-environmental-security-risk-packages-console-owns-the-wire-format-electron-main-owns-the-socket.md)
- [ADR-0063: four-client cap](0063-silent-four-client-cap-refusal-is-detected-via-absence-of-meters-frames-not-absence-of-xremote-pushes.md)
- [ADR-0075: read-only console IPC surface](0075-the-console-ipc-surface-is-read-only-by-construction-two-read-channels-guarded-by-a-source-scan-gate.md)
- [ADR-0079: console degraded states](0079-console-degraded-states-are-one-derived-link-state-pushed-on-the-existing-live-state-channel-and-the-four-client-refusal-reads-as-meters-unavailable-never-offline.md)
- [ADR-0148: feature-flag registry](0148-non-hedgehog-workspaces-sit-behind-an-env-only-feature-flag-registry-default-off-enforced-at-switchmode.md)
- [Unofficial X32/M32 OSC protocol (P-G. Maillot)](https://sites.google.com/site/patrickmaillot/x32): source of the [DESK] addresses and ratio table
