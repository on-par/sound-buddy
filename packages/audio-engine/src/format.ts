/** Canonical numeric formatter for AI narrative prompts (TD-004 slice 5, #429):
 *  fixed decimals for finite values, "-inf" for non-finite dBFS readings. */
export function fmt(n: number, decimals = 2): string {
  return isFinite(n) ? n.toFixed(decimals) : "-inf";
}
