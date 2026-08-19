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
