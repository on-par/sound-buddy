# Analyze's record-to-file reuses start-live record mode on the room-mic listen channel, engineer-triggered, and never outlives the Analyze listen

- Status: Accepted
- Date: 2026-10-02

## Context

Dogfood #1636: recording became unreachable once Session (appMode 'live') was put behind the
default-off `session` flag (ADR-0148). The only record transport left (RecordButton →
recordCapture → capture-lifecycle) requires Session's rig/channelConfig/arm UI and DAW shell
side effects. Main already supports `start-live` with mode 'record' (stream.py writes WAV stems +
session.json into a timestamped folder and stop-live returns it), and there is exactly one
start-live slot in main. Analyze already resolves a room-mic device and a single listen channel
(ADR-0151). We needed the smallest path that does not regrow DAW chrome and cannot leave an
invisible recording running.

## Decision

Analyze's Record control (AnalyzeRecordControl, backed by analyzeRecordStore) is the only record
path outside Session. It calls the existing start-live IPC with mode 'record' directly. It
never goes through liveCaptureStore.startCapture, recordCapture, or capture-lifecycle. It records exactly
one mono stem: the room-mic device and the listen channel Analyze is listening to at the moment of
the press. Start and stop are engineer-triggered only. A later listen-channel switch does not
retarget or restart a recording in progress. The recording never outlives the Analyze listen:
analyzeEntryStore.stopListening() and exitAnalyze() stop it. While a Session capture owns the
start-live slot (liveCaptureStore.isCapturing), Analyze refuses to start rather than replacing it.
The output location follows start-live's existing convention (recordDir default ~/Music/Sound Buddy),
and the user reaches the file through the existing reveal-path IPC.

## Consequences

Positive: no main-process change, no feature-flag change, Session/DAW untouched, and the file layout
matches Session recordings (session.json + stem WAV), so later tooling treats both alike.
Negative: the room mic is opened by two stream.py processes during a recording (measurement +
record). Analyze recording is single-channel only. Multichannel board recording still needs the
flagged Session. start-live record ticks also populate liveCaptureStore.liveWindows, which the
Analyze grade ignores only because roomFeed prefers the active secondary feed. Future code must not
start Analyze recording when listening is off without revisiting that.

## References

- [Issue #1636 — restore record-to-file without full Session DAW](https://github.com/on-par/sound-buddy/issues/1636)
