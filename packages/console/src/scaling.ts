// Raw OSC value -> engineering value conversions for the M32R.
//
// On/off is the one entry here that is NOT a measured scaling formula: it was
// never part of verify_scaling.py's CHECKS list because there is nothing to
// scale. The console reports a boolean parameter as 1 (on) or 0 (off), which
// arrives either as an OSC int arg or as a 32-bit float arg depending on how
// the value was read. The same encoding covers channel on/mute, gate/dynamics/eq
// bypass, and per-headamp phantom power -- one predicate serves all of them.

// Midpoint of the 0..1 range the console uses for a boolean parameter. Compared
// with >= rather than testing equality with 1, so an f-tagged 1.0 that survives
// a float32 round-trip still reads as on (the constitution forbids exact
// floating-point comparison), and so out-of-range values resolve rather than
// throw.
const ON_THRESHOLD = 0.5

/**
 * Converts a raw OSC on/off value to a boolean. 1 -> true, 0 -> false.
 *
 * Used identically for channel on/mute (`/ch/NN/mix/on`) and per-headamp
 * phantom power (`/headamp/NNN/phantom`) -- there is no separate phantom
 * conversion and no address-dependent branch.
 */
export function oscToOnState(value: number): boolean {
  return value >= ON_THRESHOLD
}

// Pan: the console reports position as a normalized 0..1 float where 0.5 is
// dead center, and displays it as -100 (hard left) .. +100 (hard right). The
// formula below was verified live against the M32R's own /node engineering-unit
// text during the #848 discovery session (verify_scaling.py, on the
// docs/848-m32r-console-discovery branch); the measured float/text pairs from
// that run were not committed as a fixture file, so the tests assert the
// formula's own output at the boundaries and representative interior points
// rather than claiming to replay a captured console reading.

// The normalized value the console uses for dead center.
const OSC_PAN_CENTER = 0.5

// Full width of the displayed position range: -100..+100 spans 200 units.
const PAN_RANGE_SPAN = 200

/**
 * Converts a raw OSC pan float (0..1, 0.5 = center) to the console's displayed
 * position (-100 = hard left, 0 = center, +100 = hard right).
 *
 * Linear and total: the value is neither clamped nor rounded, so a caller that
 * needs the console's integer display rounds at the display edge.
 */
export function oscToPan(f: number): number {
  return (f - OSC_PAN_CENTER) * PAN_RANGE_SPAN
}

// Preamp trim: the console reports channel trim gain as a normalized 0..1
// float and displays it in dB over a -18..+18 dB range, with 0.5 as unity
// (0 dB). The formula below was verified live against the M32R's own /node
// engineering-unit text during the #848 discovery session (verify_scaling.py,
// on the docs/848-m32r-console-discovery branch); the measured float/text
// pairs from that run were not committed as a fixture file, so the tests
// assert the formula's own output at the boundaries and representative
// interior points rather than claiming to replay a captured console reading.

// The normalized value the console uses for unity trim (0 dB).
const OSC_TRIM_CENTER = 0.5

// Full width of the displayed trim range: -18..+18 dB spans 36 dB.
const TRIM_RANGE_SPAN = 36

/**
 * Converts a raw OSC preamp trim float (0..1, 0.5 = unity) to the console's
 * displayed trim gain in dB (-18 = minimum, 0 = unity, +18 = maximum).
 *
 * Linear and total: the value is neither clamped nor rounded, so a caller that
 * needs the console's rounded display rounds at the display edge.
 */
export function oscToTrimDb(f: number): number {
  return (f - OSC_TRIM_CENTER) * TRIM_RANGE_SPAN
}

// Headamp gain: the console reports the physical XLR mic preamp's analog gain
// as a normalized 0..1 float on `/headamp/NNN/gain` and displays it in dB over
// a -12..+60 dB range. This is the hardware preamp stage, addressed per
// physical input and independent of channel routing -- distinct from the
// per-channel digital trim above, which has its own narrower range. The
// formula below was verified live against the M32R's own /node
// engineering-unit text during the #848 discovery session (verify_scaling.py,
// on the docs/848-m32r-console-discovery branch); the measured float/text
// pairs from that run were not committed as a fixture file, so the tests
// assert the formula's own output at the boundaries and representative
// interior points rather than claiming to replay a captured console reading.
//
// Unlike pan and trim, this range is asymmetric -- 0 dB sits at f = 1/6, not at
// the midpoint -- so the conversion is expressed as minimum-plus-span rather
// than the center-offset form the two conversions above use.

// The displayed gain at the bottom of the headamp range (f = 0).
const HEADAMP_GAIN_MIN_DB = -12

// Full width of the displayed headamp range: -12..+60 dB spans 72 dB.
const HEADAMP_GAIN_SPAN_DB = 72

/**
 * Converts a raw OSC headamp gain float (0..1) to the console's displayed mic
 * preamp gain in dB (-12 = minimum, +60 = maximum).
 *
 * Applies to the physical headamp (`/headamp/NNN/gain`), not to per-channel
 * trim -- see `oscToTrimDb` for the digital channel stage.
 *
 * Linear and total: the value is neither clamped nor rounded, so a caller that
 * needs the console's rounded display rounds at the display edge.
 */
export function oscToHeadampGainDb(f: number): number {
  return HEADAMP_GAIN_MIN_DB + f * HEADAMP_GAIN_SPAN_DB
}

// Gate threshold: the console reports the channel gate's threshold as a
// normalized 0..1 float and displays it in dB over a -80..0 dB range, where
// f = 0 is the fully-open floor (-80 dB, effectively never gating) and f = 1 is
// the top of the range (0 dB). The formula below was verified live against the
// M32R's own /node engineering-unit text during the #848 discovery session
// (verify_scaling.py, on the docs/848-m32r-console-discovery branch); the
// measured float/text pairs from that run were not committed as a fixture file,
// so the tests assert the formula's own output at the boundaries and
// representative interior points rather than claiming to replay a captured
// console reading.
//
// Like the headamp range and unlike pan and trim, this range has no meaningful
// midpoint landmark, so the conversion is expressed as minimum-plus-span rather
// than the center-offset form those two use.

// The displayed threshold at the bottom of the gate range (f = 0).
const GATE_THRESHOLD_MIN_DB = -80

// Full width of the displayed gate threshold range: -80..0 spans 80 dB.
const GATE_THRESHOLD_SPAN_DB = 80

/**
 * Converts a raw OSC gate threshold float (0..1) to the console's displayed
 * gate threshold in dB (-80 = minimum, 0 = maximum).
 *
 * Applies to the raw OSC float on the channel gate's threshold parameter. It is
 * NOT for `ChannelGate.thr` as produced by `parseChannelStrips`, which comes
 * from the console's `/ch/NN/gate` engineering-unit text line and is already in
 * dB -- converting that value again would double-convert.
 *
 * Linear and total: the value is neither clamped nor rounded, so a caller that
 * needs the console's rounded display rounds at the display edge.
 */
export function oscToGateThresholdDb(f: number): number {
  return GATE_THRESHOLD_MIN_DB + f * GATE_THRESHOLD_SPAN_DB
}

// Gate range: the console reports the channel gate's range -- how far the gate
// attenuates the signal while closed -- as a normalized 0..1 float and displays
// it in dB over a 3..60 dB range. Unlike the gate threshold above, the bottom
// of this range is not zero: the shallowest gate the console will apply still
// attenuates by 3 dB. The formula below was verified live against the M32R's
// own /node engineering-unit text during the #848 discovery session
// (verify_scaling.py, on the docs/848-m32r-console-discovery branch); the
// measured float/text pairs from that run were not committed as a fixture file,
// so the tests assert the formula's own output at the boundaries and
// representative interior points rather than claiming to replay a captured
// console reading.
//
// Like the headamp and gate-threshold ranges and unlike pan and trim, this
// range has no meaningful midpoint landmark, so the conversion is expressed as
// minimum-plus-span rather than the center-offset form those two use.

// The displayed range at the bottom of the gate range control (f = 0).
const GATE_RANGE_MIN_DB = 3

// Full width of the displayed gate range: 3..60 spans 57 dB.
const GATE_RANGE_SPAN_DB = 57

/**
 * Converts a raw OSC gate range float (0..1) to the console's displayed gate
 * range in dB (3 = minimum attenuation, 60 = maximum attenuation).
 *
 * Applies to the raw OSC float on the channel gate's range parameter. It is
 * NOT for `ChannelGate.range` as produced by `parseChannelStrips`, which comes
 * from the console's `/ch/NN/gate` engineering-unit text line and is already in
 * dB -- converting that value again would double-convert. This mirrors the same
 * caveat on `oscToGateThresholdDb` and `ChannelGate.thr`.
 *
 * Linear and total: the value is neither clamped nor rounded, so a caller that
 * needs the console's rounded display rounds at the display edge.
 */
export function oscToGateRangeDb(f: number): number {
  return GATE_RANGE_MIN_DB + f * GATE_RANGE_SPAN_DB
}

// Dynamics threshold: the console reports the channel compressor's threshold --
// the level above which gain reduction starts -- as a normalized 0..1 float and
// displays it in dB over a -60..0 dB range, where f = 0 is the lowest threshold
// (compressing almost everything) and f = 1 is unity (0 dB, effectively never
// compressing). Note this span is narrower than the gate threshold's -80..0:
// the two thresholds are separate parameters with separate ranges and must not
// share a conversion. The formula below was verified live against the M32R's
// own /node engineering-unit text during the #848 discovery session
// (verify_scaling.py, on the docs/848-m32r-console-discovery branch); the
// measured float/text pairs from that run were not committed as a fixture file,
// so the tests assert the formula's own output at the boundaries and
// representative interior points rather than claiming to replay a captured
// console reading.
//
// Like the headamp, gate-threshold, and gate-range spans and unlike pan and
// trim, this range has no meaningful midpoint landmark, so the conversion is
// expressed as minimum-plus-span rather than the center-offset form those two
// use.

// The displayed threshold at the bottom of the dynamics range (f = 0).
const DYNAMICS_THRESHOLD_MIN_DB = -60

// Full width of the displayed dynamics threshold range: -60..0 spans 60 dB.
const DYNAMICS_THRESHOLD_SPAN_DB = 60

/**
 * Converts a raw OSC dynamics (compressor) threshold float (0..1) to the
 * console's displayed threshold in dB (-60 = minimum, 0 = maximum).
 *
 * Applies to the raw OSC float on the channel dynamics threshold parameter. It
 * is NOT for `ChannelDynamics.thr` as produced by `parseChannelStrips`, which
 * comes from the console's `/ch/NN/dyn` engineering-unit text line and is
 * already in dB -- converting that value again would double-convert. This
 * mirrors the same caveat on `oscToGateThresholdDb` and `ChannelGate.thr`.
 *
 * Distinct from `oscToGateThresholdDb`: the gate threshold floor is -80 dB,
 * the dynamics threshold floor is -60 dB.
 *
 * Linear and total: the value is neither clamped nor rounded, so a caller that
 * needs the console's rounded display rounds at the display edge.
 */
export function oscToDynamicsThresholdDb(f: number): number {
  return DYNAMICS_THRESHOLD_MIN_DB + f * DYNAMICS_THRESHOLD_SPAN_DB
}

// HPF cutoff: the console reports the channel high-pass filter's corner
// frequency as a normalized 0..1 float and displays it in Hz over a 20..400 Hz
// sweep. Unlike every conversion above, this one is logarithmic rather than
// linear -- the control sweeps a constant ratio per unit of travel, which is
// how a frequency control has to behave to feel even under the finger, so
// f = 0.5 lands near 89 Hz rather than at the arithmetic midpoint of 210 Hz.
// The formula was verified live against the M32R's own /node engineering-unit
// text during the #848 discovery session (verify_scaling.py, on the
// docs/848-m32r-console-discovery branch); the measured float/text pairs from
// that run were not committed as a fixture file, so the tests assert the
// formula's own output at the boundaries and representative interior points
// rather than claiming to replay a captured console reading.

// The displayed cutoff at the bottom of the HPF sweep (f = 0).
const HPF_MIN_HZ = 20

// The multiplier across the full sweep: 20 Hz * 20 = 400 Hz at f = 1. It is a
// coincidence, not a shared quantity, that this equals HPF_MIN_HZ -- the two
// are named separately so a future range correction to one cannot silently
// move the other.
const HPF_SPAN_RATIO = 20

/**
 * Converts a raw OSC channel HPF float (0..1) to the console's displayed
 * high-pass cutoff in Hz (20 = minimum, 400 = maximum).
 *
 * Logarithmic, not linear: each equal step of travel multiplies the cutoff by
 * a constant ratio, so the sweep midpoint is ~89.4 Hz, not 210 Hz.
 *
 * Applies to the raw OSC float on the channel HPF frequency parameter. It is
 * NOT for `ChannelStrip.preamp.hpf.freq` as produced by `parseChannelStrips`,
 * which comes from the console's `/ch/NN/preamp` engineering-unit text line
 * and is already in Hz -- converting that value again would double-convert.
 * This mirrors the same caveat on `oscToGateThresholdDb` and `ChannelGate.thr`.
 *
 * Total and unrounded, like every conversion above: the value is neither
 * clamped nor rounded, so a caller that needs the console's integer Hz display
 * rounds at the display edge.
 */
export function oscToHpfHz(f: number): number {
  return HPF_MIN_HZ * HPF_SPAN_RATIO ** f
}
