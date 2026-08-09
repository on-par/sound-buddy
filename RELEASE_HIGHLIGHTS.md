<!-- Edit before each release; contents become the "## What's new" section of the release notes. -->

- **Grading-strictness profiles** — choose "Casual / volunteer" or "Broadcast-ready" judging, so a small volunteer team and a full production crew aren't held to the same bar.
- **Export a multi-week trend PDF** — pull the last several services into one report to show budget-holders real progress over time, not just a single grade.
- **Tier 2 console-network consent modal** — before Sound Buddy ever reads channel data from your console over the network, it now asks first and says exactly what it reads.
- **Secondary audio-device measurement source** — capture from a second device, not just the primary one.
- **Live EQ redesigned** — moved into a resizable right-hand pane with a new 48-point granular analyzer grid, replacing the old 7-band bars.
- **Cleaner navigation** — top bar reduced to Analyze / History, with Build Guide and Ring-Out Assistant linked contextually from the Report Card instead of living in the nav.
- **Smaller, faster install** — trimmed the packaged Python runtime and swapped a heavy audio library for numpy/scipy, cutting real download size.
- **Legal pages reachable from every site mode**, plus a full renderer-migration pass for stability (the old inline app script continues shrinking as more of the UI moves to React).
- **Fixed live-capture meter/EQ flicker** — the live view no longer strobes to "Waiting for live audio…" during capture; a channel-less waveform-envelope frame was briefly overwriting the real meter tick every interval (#720).
- **Secondary measurement device now owns the whole Room view** — when the experimental secondary mic source is active, the big live EQ pane switches to it too, matching the badge, stats, and report-card source that already did (#460).
