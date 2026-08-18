# Proposed epics: console-change coaching, smarter scoring, and Replay

Patrick's 2026-08-16 Sound Buddy idea is that board setting changes should become part of the
assistance loop, the grading loop, and a later playback loop. The common dependency is a
timestamped console-change event log synced to the audio timeline. These epics assume that
foundation exists and that Sound Buddy can read enough board state to identify channel, parameter,
value, and time.

This note deliberately stops short of full story breakdowns. The next input needed is the
board-settings discovery from a machine connected to the console: which desks are in scope, whether
the protocol supports subscriptions or only polling, which setting paths are readable, and how much
timestamp accuracy we can depend on.

GitHub tracking issues:

- Setting-aware coaching instructions: https://github.com/on-par/sound-buddy/issues/871
- Scoring that accounts for console changes: https://github.com/on-par/sound-buddy/issues/870
- Replay of operator changes over a song or service: https://github.com/on-par/sound-buddy/issues/872

## Foundation assumption: console-change event log exists

The three epics below depend on a read-only event stream with this minimum shape:

- Session identity: live session or Soundcheck session id.
- Timeline position: wall-clock time plus audio-relative time when audio is recording or playing.
- Target: console, channel or bus, and stable parameter id.
- Human label: current channel name, bus name, or source label when available.
- Before and after value when the protocol exposes both; otherwise observed value with previous
  cached value.
- Capture source: subscribed event, polled snapshot diff, imported scene diff, or manual marker.
- Confidence: exact event, inferred diff, stale snapshot, or unknown.

Read access is enough for these epics. Write access to the console stays out of scope unless a
separate Tier 2 safety decision changes that.

## Epic A: setting-aware coaching instructions

### Thesis

Sound Buddy should stop saying only what sounds wrong and start naming the console move that most
likely helps, when the evidence is strong enough.

### User value

A volunteer hears a problem during soundcheck or service, and Sound Buddy can say "Vocal 2 high-pass
filter is off, try 90 Hz" instead of a generic "low rumble detected" card. The user still decides
what to do. Sound Buddy stays advisory.

### Scope

- Map existing deterministic rule hits to specific readable settings.
- Compare current board state with the rule's preferred state or safe operating range.
- Suggest one setting move at a time, using the same persistence, cooldown, contradiction, and
  "mark tried" behavior from the live coaching loop.
- Prefer low-risk moves first: gain trim, high-pass filter, obvious mute or routing mismatch,
  broad EQ band, gate or compressor only when the signal evidence is clear.
- Show a confidence label when the recommendation depends on inferred or stale board state.

### Non-goals

- No automatic console changes.
- No free-form AI instructions in the first version.
- No advice for settings Sound Buddy cannot read or cannot map to the detected audio problem.
- No multi-step recipes until one-step suggestions prove useful in pilots.

### Candidate story slices

- Add a setting taxonomy for readable channel and bus parameters.
- Build deterministic rules that map audio findings to setting candidates.
- Render one setting-aware coaching card beside the current live coaching card.
- Extend "mark tried" so the post-action observation records both the audio change and the
  related setting change.
- Add pilot fixtures for common church-console cases: vocal HPF off, acoustic guitar too boomy,
  clipped channel trim, muted crowd mic, wrong bus routed to measurement.

### Open questions

- Which board families are first class: X32/M32 only, Wing, SQ, Avantis, or another target?
- Can the board emit setting-change events, or do we poll and diff snapshots?
- Do fader moves include user/source identity, or only a final value?
- Which setting paths are stable enough to encode in fixtures?
- How do we show "I can see the setting but cannot safely advise on it yet" without creating noise?

## Epic B: scoring that accounts for console changes

### Thesis

Sound Buddy should judge whether a mix improved after an operator change by comparing the audio
before and after that change, not by grading disconnected snapshots.

### User value

A leader can see whether a move helped: "At 2:14, Vocal 2 HPF changed from off to 90 Hz. Low-mid
energy improved after the change." This turns scoring into coaching evidence instead of a static
grade.

### Scope

- Attach console-change markers to report-card timelines and live scoring windows.
- Calculate before and after windows around a setting change.
- Attribute improvement, worsening, or inconclusive result to a time-adjacent change only when the
  measured condition and setting target match.
- Keep causation language careful: Sound Buddy can say the score improved after a move; it cannot
  prove that move caused the improvement.
- Let pilots compare a setting-aware score with the existing report-card grade.

### Non-goals

- No replacement of the current report-card score in the first version.
- No hidden penalties for operators who experiment during a service.
- No claim that one parameter explains the whole mix.
- No cross-session ranking of people or volunteers.

### Candidate story slices

- Add console-change annotations to the analysis timeline data model.
- Create deterministic before and after scoring windows around a setting event.
- Add attribution rules for high-confidence setting/audio pairs.
- Render a report-card "what changed" section with improved, worsened, unchanged, and inconclusive
  outcomes.
- Add fixtures where the same audio issue gets better, worse, and unchanged after a setting move.

### Open questions

- What window size is useful for live changes: 5 seconds, 15 seconds, phrase-length, or configurable?
- Should fader moves affect loudness scoring immediately, while EQ moves wait for more samples?
- How should we handle several changes in the same few seconds?
- Which score dimensions are setting-aware first: gain, tonal balance, harshness, phase, gates, or
  dynamics?
- Should the operator be able to mark a change as intentional so it is excluded from coaching
  analysis?

## Epic C: Replay of operator changes over a song or service

### Thesis

Sound Buddy should be able to replay what the operator did to the console alongside the audio
timeline, so a team can review the mix process after the fact.

### User value

A coach can sit with a volunteer after service and scrub through a song: the audio plays, the
timeline shows fader, EQ, mute, routing, and dynamics changes, and Sound Buddy highlights where the
mix improved or got worse after a move. This is different from Virtual Soundcheck. Virtual
Soundcheck replays audio into a console. Replay reviews the operator's decisions.

### Scope

- Show console-change events on an audio timeline.
- Let users filter by channel, bus, parameter group, and confidence.
- Scrub the timeline and inspect the board state at any point.
- Group dense fader movement into readable gestures instead of rendering every small value change.
- Link Replay events to coaching cards and setting-aware score changes when available.

### Non-goals

- No attempt to drive a live console from the Replay timeline.
- No full DAW replacement.
- No requirement that every console parameter be visualized in v1.
- No cloud sync of church audio or console data unless a later privacy and product decision says so.

### Candidate story slices

- Persist console-change events with a session and audio timeline id.
- Render event markers on the existing Soundcheck waveform timeline.
- Add a side panel that lists changes by channel and parameter.
- Collapse rapid fader moves into one gesture with start value, end value, and duration.
- Add a "jump to change" scrub action.
- Add a coaching review mode that shows setting-aware outcomes next to the related event.

### Open questions

- Should Replay live inside Virtual Soundcheck, Live, or a separate Review tab?
- Does the first version replay only captured sessions, imported multitracks, or both?
- How much board state should be reconstructed at a timeline point: changed fields only or a full
  scene-like snapshot?
- What retention policy should apply to console-change logs?
- Do churches need exportable coaching notes from Replay, or is in-app review enough?

## Product sequencing

1. Ship the read-only console-change event log.
2. Build setting-aware coaching for one console family and three to five high-confidence parameters.
3. Add before and after scoring around those same parameters.
4. Build Replay only after events are reliable enough that a timeline review feels trustworthy.

That order keeps the first wedge small. Coaching proves whether readable board settings make advice
better. Scoring proves whether the advice can be evaluated. Replay becomes valuable after the event
history has enough fidelity to teach from.
