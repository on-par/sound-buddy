# Ableton Live Track Timeline Research

Purpose: actionable reference for Sound Buddy DAW playhead and track timeline issue writing. Sources are Ableton first-party docs/manual pages unless noted.

## Source Set

- Ableton Live 12 Manual, Arrangement View: https://www.ableton.com/en/live-manual/12/arrangement-view/
- Ableton Live 12 Manual, Live Concepts: https://www.ableton.com/en/live-manual/12/live-concepts/
- Ableton Live 12 Manual, Clip View: https://www.ableton.com/en/live-manual/12/clip-view/
- Ableton Live 12 Manual, Keyboard Shortcuts: https://www.ableton.com/en/live-manual/12/live-keyboard-shortcuts/
- Official Arrangement View screenshot assets referenced by the manual:
  - Full arrangement: https://ableton-production.imgix.net/live-manual/12/DemoArrangementL12.png
  - Upper arrangement controls: https://ableton-production.imgix.net/live-manual/12/ArrangementViewTop.png
  - Track/mixer/zoom controls: https://ableton-production.imgix.net/live-manual/12/ArrangementViewLayout.png

## Design Principles for Sound Buddy

- Treat the arrangement as a left-to-right musical timeline, not a generic media list. Ableton defines the Arrangement as clips laid out on a musical and linear timeline, with time moving left to right in Arrangement View. Source: https://www.ableton.com/en/live-manual/12/live-concepts/#arrangement-and-session and https://www.ableton.com/en/live-manual/12/live-concepts/#tracks
- Use vertically stacked tracks with horizontal clip lanes. Ableton's Arrangement View stacks tracks vertically, each track hosts clips, and clips sit at song positions in track lanes. Source: https://www.ableton.com/en/live-manual/12/arrangement-view/#layout and https://www.ableton.com/en/live-manual/12/arrangement-view/#moving-and-resizing-clips
- Keep global playback position visually independent from clip selection. In Ableton, clicking a track background creates/moves a flashing insert marker, while clicking a clip selects the clip; playback can start from the insert marker or from scrub interactions. Source: https://www.ableton.com/en/live-manual/12/arrangement-view/#transport-and-playback and https://www.ableton.com/en/live-manual/12/arrangement-view/#selecting-clips-and-time
- Separate coarse navigation from detailed editing. Ableton pairs the main arrangement timeline with an Overview showing the whole arrangement and a Clip View/Sample Editor for detailed waveform/clip editing. Source: https://www.ableton.com/en/live-manual/12/arrangement-view/#layout and https://www.ableton.com/en/live-manual/12/clip-view/#clip-view
- Make timeline controls spatially predictable: overview/rulers above, track lanes in the main body, track controls near each track, mixer controls optional. Ableton's layout labels these as distinct regions in official screenshots and docs. Source: https://www.ableton.com/en/live-manual/12/arrangement-view/#layout and https://ableton-production.imgix.net/live-manual/12/ArrangementViewLayout.png

## UI Behaviors to Borrow

### Rulers and Time Display

- Provide a musical ruler in bars/beats/subdivisions. Ableton's beat-time ruler displays bars-beats-sixteenths. Source: https://www.ableton.com/en/live-manual/12/arrangement-view/#layout
- If Sound Buddy also needs absolute elapsed time, expose it as a separate lower-priority time ruler or readout. Ableton's time ruler displays minutes-seconds-milliseconds and supports horizontal scrolling. Source: https://www.ableton.com/en/live-manual/12/arrangement-view/#layout
- Let ruler drag gestures navigate: horizontal drag scrolls the timeline; vertical drag changes zoom. Ableton applies this to the Overview and beat-time ruler. Source: https://www.ableton.com/en/live-manual/12/arrangement-view/#layout

### Playhead, Insert Marker, and Scrubbing

- Click in the track timeline background to set a play position/insert marker; Play starts from that marker by default. Ableton says the flashing blue insert marker determines where playback starts and can be moved by clicking within a track. Source: https://www.ableton.com/en/live-manual/12/arrangement-view/#transport-and-playback
- Clicking the scrub area should start playback from that time. Ableton's scrub area launches playback from the clicked point. Source: https://www.ableton.com/en/live-manual/12/arrangement-view/#layout
- Holding in the scrub area should repeatedly play a small region for auditioning. Ableton loops playback around the held scrub point based on global launch quantization. Source: https://www.ableton.com/en/live-manual/12/arrangement-view/#transport-and-playback
- Provide "continue from stop point" as distinct behavior from "play from insert marker." Ableton maps Shift+Space to continue playback from where it last stopped. Source: https://www.ableton.com/en/live-manual/12/arrangement-view/#transport-and-playback and https://www.ableton.com/en/live-manual/12/live-keyboard-shortcuts/#transport
- Auto-follow should pause when the user edits or scrolls horizontally, then resume after stop/restart or a fresh arrangement/scrub click. Ableton's Follow behavior pauses on edit/horizontal scroll/beat-time-ruler click and resumes on stop/restart or arrangement/clip scrub click. Source: https://www.ableton.com/en/live-manual/12/arrangement-view/#navigation-and-zooming

### Tracks and Clips

- Each track should have one primary main lane for clips. Ableton states clips are contained and arranged in a track's main lane. Source: https://www.ableton.com/en/live-manual/12/arrangement-view/#layout
- Clips must be draggable horizontally to another song position and vertically to another track; dragging clip edges changes clip length. Source: https://www.ableton.com/en/live-manual/12/arrangement-view/#moving-and-resizing-clips
- Audio clips should show waveform content and support vertical waveform zoom independent of clip gain. Ableton has a Waveform Vertical Zoom Level slider that enlarges waveform display without changing gain. Source: https://www.ableton.com/en/live-manual/12/arrangement-view/#layout
- Track controls should remain adjacent to the track lane and include core state/mix affordances when relevant. Ableton exposes Arrangement Track Controls for volume, panning, I/O, and mixer controls, with customizable visibility. Source: https://www.ableton.com/en/live-manual/12/arrangement-view/#layout
- Track order should be directly manipulable by dragging track headers/rows above or below other tracks. Source: https://www.ableton.com/en/live-manual/12/arrangement-view/#layout

### Selection and Editing

- Preserve different click targets: clip click selects a clip; background click selects a time point; drag selects a timespan; drag inside a waveform/MIDI display selects time within that clip. Source: https://www.ableton.com/en/live-manual/12/arrangement-view/#selecting-clips-and-time
- Support extending selection with Shift-click/drag and arrow-key extension if keyboard editing is in scope. Source: https://www.ableton.com/en/live-manual/12/arrangement-view/#selecting-clips-and-time
- Selected loop contents should be addressable as a time selection. Ableton lets clicking the loop brace select all material within the loop. Source: https://www.ableton.com/en/live-manual/12/arrangement-view/#selecting-clips-and-time
- Editing should be selection-based: commands operate on the selected clip, time, or material. Ableton explicitly describes Arrangement editing as selection-based. Source: https://www.ableton.com/en/live-manual/12/arrangement-view/#selecting-clips-and-time

### Zooming and Navigation

- Include a whole-song overview with a visible viewport rectangle. Ableton's Overview shows the entire arrangement; its black outline represents the currently displayed region. Source: https://www.ableton.com/en/live-manual/12/arrangement-view/#layout
- Double-clicking overview/ruler should be purposeful: zoom to selection when there is a selection, otherwise fit the full arrangement. Ableton's beat-time ruler does this, and the overview can zoom out to full arrangement. Source: https://www.ableton.com/en/live-manual/12/arrangement-view/#layout
- Provide command-level zoom-to-selection and zoom-back. Ableton uses Z to zoom to Arrangement time selection and X to return through prior zoom states. Source: https://www.ableton.com/en/live-manual/12/arrangement-view/#navigation-and-zooming and https://www.ableton.com/en/live-manual/12/live-keyboard-shortcuts/#arrangement-view
- Vertical track zoom should be possible without changing global timeline scale. Ableton allows vertical zoom of selected tracks and fit-height/fit-width controls. Source: https://www.ableton.com/en/live-manual/12/arrangement-view/#navigation-and-zooming and https://www.ableton.com/en/live-manual/12/arrangement-view/#layout

### Loop Behavior

- Arrangement loop should be a global loop brace with start and length. Ableton's Arrangement Loop uses a loop brace controlled by Loop Start and Loop Length fields. Source: https://www.ableton.com/en/live-manual/12/arrangement-view/#the-arrangement-loop
- If a time selection exists, a "loop selection" action should enable looping and set the brace to that selection. Ableton's Loop Selection command does this. Source: https://www.ableton.com/en/live-manual/12/arrangement-view/#the-arrangement-loop
- Loop brace edges should resize the loop, while dragging the brace body should move it without changing length. Source: https://www.ableton.com/en/live-manual/12/arrangement-view/#the-arrangement-loop
- Clip loops are separate from arrangement loops. Ableton has clip region/loop controls in Clip View, while Arrangement View has an Arrangement Loop. Source: https://www.ableton.com/en/live-manual/12/clip-view/#clip-and-loop-region-settings and https://www.ableton.com/en/live-manual/12/arrangement-view/#the-arrangement-loop

## Acceptance Criteria Implications

- The timeline renders stacked track rows with a persistent left track-control/header area and a horizontal main lane per track.
- The timeline has a musical ruler that displays bar/beat subdivisions and a playhead/insert marker that can be set by clicking the arrangement background.
- Play, stop, and continue-from-stop state changes are visually reflected by the playhead/insert marker behavior.
- A scrub target above the track lanes starts playback from the clicked time; holding/dragging for looped scrub auditioning can be a later issue if playback quantization is not yet available.
- Audio clips render visible waveform shapes inside clip rectangles; waveform visual zoom does not alter audio gain.
- Clip interactions distinguish selecting a clip, selecting a time point, selecting a timespan, and resizing clip edges.
- A zoom-to-selection behavior exists, plus a way to fit the full arrangement.
- A global loop brace can be toggled, moved, resized, and set from the current time selection.
- Clip loop state, if exposed, is modeled separately from arrangement loop state.
- Follow-scroll behavior pauses when the user manually scrolls/edits during playback and resumes after an explicit playback/navigation action.

## Non-Goals / Avoid Over-Copying

- Do not replicate Ableton's full Session View launch model unless Sound Buddy needs live clip launching. The researched behavior is mainly relevant because Ableton distinguishes Session launching from Arrangement timeline playback. Source: https://www.ableton.com/en/live-manual/12/live-concepts/#arrangement-and-session
- Do not require every keyboard shortcut in the first issue. Use Ableton's shortcuts as evidence for behavior priority, especially Z/X zoom, Space playback, Shift+Space continue, Cmd/Ctrl+L loop, and Cmd/Ctrl+E split. Source: https://www.ableton.com/en/live-manual/12/live-keyboard-shortcuts/
- Do not conflate source audio files with clips. Ableton treats an audio clip as a reference to a sample plus instructions for what part to play and how to play it. Source: https://www.ableton.com/en/live-manual/12/live-concepts/#audio-clips-and-samples
