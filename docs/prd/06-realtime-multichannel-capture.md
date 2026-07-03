# PRD 06 — Real-time multi-channel live capture

## Problem
Live capture currently updates once per analysis **window** (default 3 s) and, in the
desktop app, always uses the device's default ≤2 channels with no channel picker. Users
want (a) genuinely **real-time** monitoring — updates well under 1 s — with a choice to
**record or just monitor**, and (b) the ability to **add channels up to the device's
channel count**, choosing **mono or stereo** per channel.

## Scope

### Faster cadence + monitor/record
- `stream.py` decouples the **meter cadence** from the **analysis window**: emit a
  lightweight level/spectrum update every ~100–150 ms (a hop), computed over a short
  trailing window, instead of only when a full window fills. Add a `--interval` arg
  (default 0.1 s). Keep the heavier full-window analysis available for the LLM report.
- **Monitor vs. Record modes** in the UI:
  - *Monitor* (default): live meters/curve only, nothing written to disk.
  - *Record*: same live view **plus** stream captured audio to a WAV in a chosen folder;
    on stop, offer to open the recording in the File analysis view.
- The live view uses the PRD 02 curve renderer (real-time RTA) instead of / alongside
  the horizontal meters, updating at the faster cadence.

### Device channel & mono/stereo selection
- Surface the device's `max_input_channels` (already returned by `--list-devices`) in
  the UI.
- A **channel configuration** control lets the user add up to that many channels, each
  configured as **mono** (one device channel) or **stereo** (a pair), with a label.
  This maps to the `channels: number[]` (and grouping) already accepted by `start-live`
  / `stream.py`; extend the arg to carry mono/stereo grouping.
- Live meters render one strip per configured channel (mono) or per stereo pair.

## Non-goals
- Multi-device aggregate capture.
- Punch-in/out editing of recordings (record is a simple start/stop to WAV).
- Loudness metering standards (LUFS) — future.

## Acceptance criteria
- Live meters visibly update several times per second (cadence configurable).
- A Monitor/Record switch; Record writes a valid WAV and offers to analyze it on stop.
- Channel picker offers exactly `max_input_channels` channels for the selected device,
  each toggleable mono/stereo, and capture reflects the selection.
- Stopping cleanly tears down the Python process and (if recording) finalizes the WAV.
</content>
