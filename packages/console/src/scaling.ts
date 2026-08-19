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
