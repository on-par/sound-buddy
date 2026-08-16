// Shared "2–4 kHz"-style band-range label formatter (#837, story 4 of #375):
// the single source of truth for formatting a band's low/high Hz edges into
// plain-language labels. Extracted verbatim from harshness-narrative.ts (#835)
// so the harshness and phase narratives share one copy instead of two
// hand-copied formatters.

/** Formats a single band edge: >=1000 Hz as a trimmed-kHz label ("2 kHz",
 *  "2.5 kHz"), below as Hz ("500 Hz") — mirroring report.ts's fmtHz
 *  convention minus the trailing ".0". */
function formatFrequency(hz: number): string {
  if (hz >= 1000) return `${trimTrailingZero(hz / 1000)} kHz`;
  return `${hz} Hz`;
}

/** Joins the two band edges with an en-dash and a single unit suffix, matching
 *  RULE_TABLE's copy ("Cut 2–4 kHz"): both edges share the unit class
 *  ("2–4 kHz", "60–250 Hz"); a mixed range carries a suffix per edge
 *  ("500 Hz–2 kHz"). */
export function formatBandRange(lowHz: number, highHz: number): string {
  if ((lowHz >= 1000) === (highHz >= 1000)) {
    const edge = (hz: number) => (lowHz >= 1000 ? trimTrailingZero(hz / 1000) : `${hz}`);
    return `${edge(lowHz)}–${edge(highHz)} ${lowHz >= 1000 ? "kHz" : "Hz"}`;
  }
  return `${formatFrequency(lowHz)}–${formatFrequency(highHz)}`;
}

function trimTrailingZero(n: number): string {
  const s = n.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}