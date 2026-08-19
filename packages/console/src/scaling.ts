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

// EQ band frequency: the console reports each parametric EQ band's centre
// frequency as a normalized 0..1 float and displays it in Hz over the full
// 20 Hz..20 kHz audio sweep. Like the HPF cutoff above and unlike every linear
// conversion before it, this control is logarithmic -- a constant ratio per
// unit of travel, which is how a frequency control has to behave to feel even
// under the finger -- so f = 0.5 lands near 632 Hz rather than at the
// arithmetic midpoint of 10010 Hz. The formula was verified live against the
// M32R's own /node engineering-unit text during the #848 discovery session
// (verify_scaling.py, on the docs/848-m32r-console-discovery branch); the
// measured float/text pairs from that run were not committed as a fixture
// file, so the tests assert the formula's own output at the boundaries and
// representative interior points rather than claiming to replay a captured
// console reading.

// The displayed centre frequency at the bottom of the EQ sweep (f = 0).
const EQ_FREQ_MIN_HZ = 20

// The multiplier across the full sweep: 20 Hz * 1000 = 20 kHz at f = 1. Named
// separately from HPF_SPAN_RATIO (and from EQ_FREQ_MIN_HZ) so a future range
// correction to one control cannot silently move the other -- the two sweeps
// sharing a 20 Hz floor is a coincidence, not a shared quantity.
const EQ_FREQ_SPAN_RATIO = 1000

/**
 * Converts a raw OSC EQ band frequency float (0..1) to the console's displayed
 * band centre frequency in Hz (20 = minimum, 20000 = maximum).
 *
 * Logarithmic, not linear: each equal step of travel multiplies the centre
 * frequency by a constant ratio, so the sweep midpoint is ~632.5 Hz, not
 * 10010 Hz.
 *
 * Applies to the raw OSC float on an EQ band's frequency parameter. It is NOT
 * for `ChannelEq.bands[].freq` as produced by `parseChannelStrips`, which comes
 * from the console's `/ch/NN/eq/N` engineering-unit text line and is already a
 * display string in Hz (e.g. "2k5") -- converting that value again would
 * double-convert. This mirrors the same caveat on `oscToHpfHz` and
 * `ChannelStrip.preamp.hpf.freq`.
 *
 * Total and unrounded, like every conversion above: the value is neither
 * clamped nor rounded, so a caller that needs the console's Hz display (which
 * abbreviates kilohertz) formats at the display edge.
 */
export function oscToEqFreqHz(f: number): number {
  return EQ_FREQ_MIN_HZ * EQ_FREQ_SPAN_RATIO ** f
}

// EQ band gain: the console reports each parametric EQ band's gain as a
// normalized 0..1 float and displays it in dB over a symmetric -15..+15 dB
// range, where f = 0.5 is flat (0 dB, the band applying no boost or cut). Like
// pan and trim and unlike the four minimum-plus-span conversions above, this
// range has a real midpoint landmark -- flat is the value an engineer looks for
// -- so the conversion is expressed in the center-offset form. The formula was
// verified live against the M32R's own /node engineering-unit text during the
// #848 discovery session (verify_scaling.py, on the
// docs/848-m32r-console-discovery branch); the measured float/text pairs from
// that run were not committed as a fixture file, so the tests assert the
// formula's own output at the boundaries and representative interior points
// rather than claiming to replay a captured console reading.

// The normalized value the console uses for a flat band (0 dB).
const OSC_EQ_GAIN_CENTER = 0.5

// Full width of the displayed EQ gain range: -15..+15 dB spans 30 dB. Named
// separately from the pan and trim spans so a future range correction to one
// control cannot silently move another.
const EQ_GAIN_RANGE_SPAN_DB = 30

/**
 * Converts a raw OSC EQ band gain float (0..1, 0.5 = flat) to the console's
 * displayed band gain in dB (-15 = maximum cut, 0 = flat, +15 = maximum boost).
 *
 * Linear, unlike the frequency conversions: equal steps of travel add equal dB.
 *
 * Applies to the raw OSC float on an EQ band's gain parameter. It is NOT for
 * `ChannelEq.bands[].gain` as produced by `parseChannelStrips`, which comes from
 * the console's `/ch/NN/eq/N` engineering-unit text line and is already in dB --
 * converting that value again would double-convert. This mirrors the same caveat
 * on `oscToEqFreqHz` and `ChannelEq.bands[].freq`.
 *
 * Total and unrounded, like every conversion above: the value is neither clamped
 * nor rounded, so a caller that needs the console's rounded dB display rounds at
 * the display edge.
 */
export function oscToEqGainDb(f: number): number {
  return (f - OSC_EQ_GAIN_CENTER) * EQ_GAIN_RANGE_SPAN_DB
}

// EQ band Q: the console reports each parametric EQ band's Q -- its bandwidth,
// how wide a slice of the spectrum the band acts on -- as a normalized 0..1
// float and displays it as a unitless value from 10 down to 0.3. This is the
// only conversion in this file that runs BACKWARDS: more travel means a lower
// number, because a higher Q is a narrower band. Like the two frequency sweeps
// above and unlike every linear conversion, it is exponential -- a constant
// ratio per unit of travel -- but the ratio is below 1, so the value decays
// rather than grows, and f = 0.5 lands near 1.73 rather than at the arithmetic
// midpoint of 5.15. The formula was verified live against the M32R's own /node
// engineering-unit text during the #848 discovery session (verify_scaling.py,
// on the docs/848-m32r-console-discovery branch); the measured float/text pairs
// from that run were not committed as a fixture file, so the tests assert the
// formula's own output at the boundaries and representative interior points
// rather than claiming to replay a captured console reading.

// The displayed Q at the wide end of the sweep (f = 0).
const EQ_Q_MAX = 10

// The multiplier across the full sweep: 10 * 0.03 = 0.3 at f = 1. Named
// separately from EQ_FREQ_SPAN_RATIO and HPF_SPAN_RATIO so a future range
// correction to one control cannot silently move another.
const EQ_Q_DECAY_RATIO = 0.03

/**
 * Converts a raw OSC EQ band Q float (0..1) to the console's displayed band Q
 * (10 = widest bandwidth, 0.3 = narrowest). Unitless.
 *
 * Exponential and inverted: each equal step of travel divides the Q by a
 * constant ratio, so the sweep midpoint is ~1.73, not 5.15, and the result
 * falls as f rises -- the opposite direction to every other conversion here.
 *
 * Applies to the raw OSC float on an EQ band's Q parameter. It is NOT for
 * `ChannelEq.bands[].q` as produced by `parseChannelStrips`, which comes from
 * the console's `/ch/NN/eq/N` engineering-unit text line and is already a Q
 * value -- converting that value again would double-convert. This mirrors the
 * same caveat on `oscToEqFreqHz` and `ChannelEq.bands[].freq`.
 *
 * Total and unrounded, like every conversion above: the value is neither
 * clamped nor rounded, so a caller that needs the console's rounded Q display
 * rounds at the display edge.
 */
export function oscToEqQ(f: number): number {
  return EQ_Q_MAX * EQ_Q_DECAY_RATIO ** f
}

// Fader and send level: the console reports both a channel fader
// (`/ch/NN/mix/fader`) and a send level as a normalized 0..1 float and displays
// them in dB. Unlike every conversion above -- which is either linear across the
// whole range or exponential across the whole range -- this taper is
// PIECEWISE LINEAR: the console trades resolution for range, giving the top of
// the travel a gentle 40 dB-per-unit slope where an engineer makes fine
// adjustments, and steepening to 80 and then 160 dB-per-unit further down where
// only coarse moves matter. The three segments meet exactly (both f = 0.5 and
// f = 0.25 give the same dB from either neighbouring line), so the curve is
// continuous with no step at a boundary.
//
// This story implements the three UPPER segments only -- f >= 0.0625, which is
// -60 dB and up, the normal working range. The segment below 0.0625 and the
// "-oo" / -Infinity floor are out of scope here and land in the follow-on story
// under epic #880; see the note on the trailing return below.
//
// The three breakpoints below are measured console readings from the #848
// discovery session, not formula output: 0.522972 -> -9.1 dB,
// 0.357771 -> -21.4 dB, 0.642229 -> -4.3 dB, each agreeing with the formula to
// better than 0.05 dB.

// Normalized value where the console's taper breaks from the top segment to the
// mid segment.
const LEVEL_UPPER_SEGMENT_MIN = 0.5

// Normalized value where the taper breaks from the mid segment to the lower
// in-scope segment.
const LEVEL_MID_SEGMENT_MIN = 0.25

// Slope (dB per unit of travel) and intercept (dB at f = 0 on that segment's
// line) for each of the three in-scope segments. Named per segment so a future
// correction to one cannot silently move another -- the same rule the frequency
// and Q span ratios above follow.
const LEVEL_UPPER_SLOPE_DB = 40
const LEVEL_UPPER_INTERCEPT_DB = -30
const LEVEL_MID_SLOPE_DB = 80
const LEVEL_MID_INTERCEPT_DB = -50
const LEVEL_LOWER_SLOPE_DB = 160
const LEVEL_LOWER_INTERCEPT_DB = -70

/**
 * Converts a raw OSC fader or send level float (0..1) to the console's
 * displayed level in dB over the upper working range (+10 dB at f = 1 down to
 * -60 dB at f = 0.0625).
 *
 * Piecewise linear, unlike every conversion above: three straight segments meet
 * at f = 0.5 and f = 0.25, so equal steps of travel add equal dB *within* a
 * segment but the dB-per-unit slope triples from top to bottom of the in-scope
 * range.
 *
 * Only the three upper segments are implemented. Below f = 0.0625 the return
 * value is the lowest in-scope segment linearly extrapolated -- NOT the
 * console's real behavior, which floors at "-oo". That segment and the
 * -Infinity floor belong to the follow-on story under epic #880, which turns
 * the trailing return below into an `f >= 0.0625` guarded branch. Do not
 * "fix" the missing lower guard here; the three upper formulas are pinned by
 * measured console readings.
 *
 * Applies to the raw OSC float on a fader or send level parameter. It is NOT
 * for `ChannelStrip.fader` as produced by `parseChannelStrips`, which comes
 * from the console's `/ch/NN/mix` engineering-unit text line and is already in
 * dB (or -Infinity for "-oo") -- converting that value again would
 * double-convert. This mirrors the same caveat on `oscToEqFreqHz` and
 * `ChannelEq.bands[].freq`.
 *
 * Total and unrounded, like every conversion above: the value is neither
 * clamped nor rounded and never throws, so a caller that needs the console's
 * rounded dB display rounds at the display edge.
 */
export function oscToLevelDb(f: number): number {
  if (f >= LEVEL_UPPER_SEGMENT_MIN) return f * LEVEL_UPPER_SLOPE_DB + LEVEL_UPPER_INTERCEPT_DB
  if (f >= LEVEL_MID_SEGMENT_MIN) return f * LEVEL_MID_SLOPE_DB + LEVEL_MID_INTERCEPT_DB
  return f * LEVEL_LOWER_SLOPE_DB + LEVEL_LOWER_INTERCEPT_DB
}
