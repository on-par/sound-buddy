// Single source of truth for the Founding-tier urgency copy (#560). Gates the
// countdown on a live checkout URL: a placeholder Payment Link is a dead
// purchase path, so no urgency may render above it until a real link is
// wired in via PUBLIC_FOUNDING_CHECKOUT_URL.
export const FOUNDING_CAP = 300;

/** Placeholder Payment Link — mirrors app/electron/checkout.ts's convention.
 *  Real link arrives with #56/#116. */
export const PLACEHOLDER_FOUNDING_URL = 'https://buy.stripe.com/sound-buddy-founding-lifetime';

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/** Resolve the Founding checkout URL: env override, else the placeholder. */
export function foundingCheckoutUrl(env: Record<string, string | undefined>): string {
  const override = env.PUBLIC_FOUNDING_CHECKOUT_URL?.trim();
  return override ? override : PLACEHOLDER_FOUNDING_URL;
}

/** Checkout is live only when an override URL is configured and differs from
 *  the placeholder. A placeholder link is a dead purchase path — no urgency
 *  may render above it (#560). */
export function isCheckoutLive(env: Record<string, string | undefined>): boolean {
  return foundingCheckoutUrl(env) !== PLACEHOLDER_FOUNDING_URL;
}

export type FoundingUrgency =
  | { mode: 'none' } // checkout not live → render nothing
  | { mode: 'countdown'; remainingLabel: string } // live + before deadline
  | { mode: 'cap' }; // live + deadline passed

/** now/deadline are epoch ms. */
export function foundingUrgency(
  args: { nowMs: number; deadlineMs: number; checkoutLive: boolean },
): FoundingUrgency {
  if (!args.checkoutLive) return { mode: 'none' };
  if (args.nowMs >= args.deadlineMs) return { mode: 'cap' };
  return { mode: 'countdown', remainingLabel: remainingLabel(args.deadlineMs - args.nowMs) };
}

/** "4d 21h 3m left"-style label for a positive ms remainder. Shared by the
 *  server render and the client tick so they can never drift. */
export function remainingLabel(msRemaining: number): string {
  if (msRemaining <= 0) return '';
  const d = Math.floor(msRemaining / MS_PER_DAY);
  const h = Math.floor((msRemaining % MS_PER_DAY) / MS_PER_HOUR);
  const m = Math.floor((msRemaining % MS_PER_HOUR) / MS_PER_MINUTE);
  return `${d}d ${h}h ${m}m left`;
}
