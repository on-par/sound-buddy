# The header Record button records Main and Measurement only, on dedicated record processes independent of Listen; multitrack is deferred

- Status: Accepted
- Date: 2026-10-04

## Context

Issue #1648: Session (appMode 'live', the DAW) is behind the default-off `session` flag
(ADR-0148), so the Analyze-first shell had no clear Record control. Product decision (2026-10-04):
Sound Buddy will not regrow a DAW, and multitrack recording is deferred. Record captures two sources
only. **Main** is the board's mix out, mono or stereo. **Measurement** is the crowd mic or a second
measurement device in the room, mono or stereo. Listen (the Analyze Live RTA, ADR-0151/#1646) must
stay independent. A recording must not be "whatever the RTA is listening to", and starting or
stopping a recording must not stop or replace the live analyzer.

Main has two stream.py slots today. start-live is Session's board capture, and ADR-0159's Analyze
room-mic record also uses it. Its meter ticks feed liveCaptureStore. start-measurement is the
metering-only room stream the RTA reads. Main and Measurement are usually on different devices (a
board USB interface and a USB measurement mic), and one stream.py process opens one device.

## Decision

The header RecordButton (#record-button-island) records a Main + Measurement take everywhere
outside the Session tab. It uses a new pair of IPC handlers, `start-record-take` and
`stop-record-take` (electron/ipc/record-take.ts). These handlers own two python-stream slots of
their own. Each source is one stream.py process in the existing `--session-dir` record mode with one
armed strip. Main writes `<take>/main/01-main.wav`, and Measurement writes
`<take>/measurement/01-measurement.wav`. Each subfolder also gets a session.json. The take folder is
named by start-live's `buildSessionDir` (`sound-buddy-<stamp>` under recordDir or storageDir,
default ~/Music/Sound Buddy). The handlers reuse start-live's Pro gate and its TCC microphone gate.
The meter lines these processes emit are dropped, so recording never feeds the RTA. start-live and
start-measurement are never called, so Listen keeps running untouched.

Sources are resolved in the renderer at the moment the engineer presses Record (record-take.ts,
recordTakeStore):
- Main = Settings ▸ Audio's Input Device.
- Measurement = the secondary measurement device (remembered by name).
- Channels: a new Settings ▸ Audio ▸ Record group has one channel picker per source (mono `N` or
  stereo pair `N-M`). By default a source is mono or stereo as the device presents: a one-input
  device records mono, a wider device records its first pair, and a system-default input records
  mono.

A missing device refuses the start with an actionable error. Stop returns the take folder and each
stem path. A source that wrote nothing is reported by name, and the take is still kept.

A Session recording that is already running (flag-on builds only) keeps the header button as its
Stop, as in #729. An idle or monitoring Session never takes over the button, and the button no
longer promotes a Session monitor into a multitrack recording.

## Consequences

Positive: no engine/stream.py change. No feature-flag change. Session/DAW chrome stays off.
Recording and Listen cannot interfere with each other at the process level. Each stem is a normal
single-track session folder that existing tooling can open, and a WAV that Analyze ▸ File can
analyze.
Negative: the two stems come from two processes, often on two device clocks, so they are not
sample-aligned. ADR-0003 already deferred alignment. A device that is both Main and Measurement, or
also the RTA's device, is opened by several stream.py processes at once. Core Audio allows this.
Channel choices are kept for the session only and are not persisted yet. A source whose stream.py
dies mid-take is reported only at Stop. ADR-0159's single-stem Analyze live-panel Record still
exists. It is now redundant with this button, and removing it is follow-up work.

## References

- [Issue #1648 — Record Main + Measurement without Session/DAW (multitrack deferred)](https://github.com/on-par/sound-buddy/issues/1648)
- ADR-0003 — secondary measurement source, alignment deferred
- ADR-0159 — Analyze's room-mic record-to-file
