# iOS ships the Mac built-in ideal curves as bundled ideal-curve.v1 JSON, and the RTA target is resampled onto RTA band centers and dB-mean level-matched, never index-paired

- Status: Accepted
- Date: 2026-09-26

## Context

The iOS Analyze RTA is a ~60-band 1/6-octave display grid (RTALayout), the coaching rules run on 7 bands, and
the Mac ideal curves are 48 log-spaced points (GRID_FREQS). iOS has no port of curve_from_power yet, so there is
no measured 48-point curve to pair with the profile. The Mac already learned (#1497, liveTargetDb) that plotting
a profile against a curve of a different length misaligns the target, and it withholds the overlay rather than
misalign. iOS also cannot import packages/audio-engine at runtime, so the built-in curves must reach the phone as
data. The ideal-curve.v1 contract (apps/ios/Contracts) already defines that data shape.

## Decision

SoundBuddyKit bundles the Mac built-ins it needs (flat, music-fullrange, worship-service) as ideal-curve.v1 JSON
SwiftPM resources and loads them through IdealCurveLibrary, whose live default is worship-service (mirroring
LIVE_CAPTURE_DEFAULT_PROFILE_ID) with a fallback to IdealCurve.flat if the resource cannot be decoded. Any iOS
surface that overlays an ideal curve on a measured display grid resamples the curve onto that grid's own
frequencies with IdealCurve.offset(atHz:) (log-frequency linear interpolation, clamped at the ends) and
level-matches it by the finite dB mean (RTATarget.levelMatched, the Swift mirror of levelMatchedTarget). No iOS code
may pair dbOffsets[i] with display band i. The bundled JSON is a hand-synced copy of PROFILES in
packages/audio-engine/src/profiles/index.ts; a SoundBuddyKit test pins the bundled music-fullrange to the
checked-in Contracts example so the two copies cannot drift unnoticed.

## Consequences

The phone shows the same relative target shape as the Mac without a runtime dependency on the Node packages, and
the overlay stays aligned whatever the display grid becomes (including a future 48-point curve, where resampling
becomes identity). The cost is a second copy of the built-in offsets: changing a Mac built-in requires updating
the iOS resource in the same PR, and only music-fullrange is mechanically guarded against drift. The overlay is
level-matched in the dB domain over the whole display grid, so on the fixed iOS dB window a target can clamp at
the floor/ceiling on extreme material. Coaching still grades against flat until the curve-driven coaching slice
points BandDeviationCoach at the same curve.

## References

- [Issue #1542 — iOS: overlay the active ideal EQ curve on the Analyze RTA](https://github.com/on-par/sound-buddy/issues/1542)
- [Parent issue #1541](https://github.com/on-par/sound-buddy/issues/1541)
