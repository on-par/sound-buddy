<!-- Edit before each release; contents become the "## What's new" section of the release notes. -->

- **Smoother live monitoring:** The Live board now keeps waveforms stable across meter/window ticks instead of rebuilding the whole board.
- **Cleaner live animation path:** Playhead and meter updates now share one coordinated frame loop, with cached track DOM nodes and hidden EQ panes skipped.
- **Release verification aid:** A dev-only frame probe can report live tick p50/p95 timing and board rebuild counts for the choppy-monitoring regression.
