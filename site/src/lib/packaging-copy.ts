// Single source of truth for tier packaging copy per the #1518 product lock
// and ADR-0147. Free is a browser product (free email account, capped
// uploads, server-side analysis). Pro is the Mac app (on-device analysis,
// live listening, EQ curves, channel select). Any on-device claim must be
// scoped to Pro/desktop — a global "never leaves your machine" claim is
// banned from marketing copy.

// #1518 product lock: Free web accounts get this many uploads per calendar month.
export const FREE_MONTHLY_UPLOADS = 5;

export const FREE_TIER_FEATURES: readonly string[] = [
  'Free account — sign in with your email',
  `${FREE_MONTHLY_UPLOADS} uploads a month`,
  'Report card + letter grade in your browser',
  'Nothing to install',
];

export const PRO_TIER_FEATURES: readonly string[] = [
  'Live listening on your Mac, right at the desk',
  'Customizable EQ curves',
  'Channel select — listen to any input',
  'Record up to 32 channels',
  'Unlimited recordings. Stored on your machine.', // locked phrase, check-positioning.mjs
  'Priority email support',
];

// Global privacy claims the #1518 lock / ADR-0147 retired from marketing copy.
// Any on-device claim must be scoped to Pro/desktop, and these phrases can't be.
export const GLOBAL_PRIVACY_CLAIM_PATTERNS: readonly RegExp[] = [
  /never leaves your machine/i,
  /\bno accounts?\b/i,
  /\bno cloud\b/i,
  /\blocal-only\b/i,
  /\blocal-first\b/i,
  /\bno sign-up\b/i,
  /fully on your own machine/i,
];

export function findGlobalPrivacyClaims(text: string): string[] {
  const matches: string[] = [];
  for (const pattern of GLOBAL_PRIVACY_CLAIM_PATTERNS) {
    const match = text.match(pattern);
    if (match) matches.push(match[0]);
  }
  return matches;
}
