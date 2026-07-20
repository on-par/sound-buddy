// Pure built-HTML invariant checks shared by check-pricing.mjs and its tests.
// No I/O, no process.exit — mirrors the lib/csp.mjs seam (#560).

/**
 * Check the Founding urgency block in the built pricing HTML. The block is
 * now conditional on a live checkout URL (#560): when a countdown ships, the
 * original #377 guarantees still hold; when it doesn't, the countdown must be
 * fully absent (no half-rendered state) and the 300-cap framing must still be
 * visible. The retired "now live — final licenses going fast" claim may never
 * appear either way. Returns an array of human-readable problem strings
 * (empty === OK).
 */
export function checkFoundingUrgencyInvariants(html) {
  const problems = [];
  const pricingSectionIdx = html.indexOf('id="pricing"');

  if (/now live — final licenses going fast/i.test(html)) {
    problems.push(
      'Built HTML contains the retired "now live — final licenses going fast" claim — this must never render (#560).',
    );
  }

  const deadlineMatch = html.match(/data-drop-deadline="([^"]+)"/);
  if (deadlineMatch) {
    if (Number.isNaN(new Date(deadlineMatch[1]).getTime())) {
      problems.push(`data-drop-deadline is not a valid date: "${deadlineMatch[1]}" (#560).`);
    }
    if (!/data-fc-remaining/.test(html)) {
      problems.push('Founding countdown missing its live-remaining (data-fc-remaining) node (#560).');
    }
    if (!/demo video/i.test(html)) {
      problems.push('Countdown copy must reference the demo video drop (#560).');
    }
    const countdownIdx = html.indexOf('founding-countdown');
    if (countdownIdx === -1 || !(pricingSectionIdx !== -1 && countdownIdx > pricingSectionIdx)) {
      problems.push('Founding countdown must render inside the #pricing section (#560).');
    }
  } else {
    if (/data-fc-remaining/.test(html)) {
      problems.push('data-fc-remaining present without a data-drop-deadline — half-rendered countdown (#560).');
    }
    if (html.includes('founding-countdown')) {
      problems.push('founding-countdown present without a data-drop-deadline — half-rendered countdown (#560).');
    }
    if (/left to claim/i.test(html)) {
      problems.push('Countdown timer copy ("left to claim") present without a live countdown (#560).');
    }
    if (!html.includes('300')) {
      problems.push('300-cap framing missing from the built HTML when the countdown is not live (#560).');
    }
  }

  return problems;
}

/**
 * The hero spec line (`class="hero-fine mono"`) must never carry a version
 * string — the version still reaches the user via the /download redirect
 * (#560). Returns an array of human-readable problem strings (empty === OK).
 */
export function checkHeroVersionInvariant(html) {
  const match = html.match(/<p class="hero-fine mono">([^<]*)<\/p>/);
  if (!match) return [];
  if (/\bv\d+\.\d+\.\d+/.test(match[1])) {
    return ['Hero spec line ("hero-fine mono") must not carry a version string (#560).'];
  }
  return [];
}
