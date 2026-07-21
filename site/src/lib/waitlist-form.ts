// Pure, testable core of the waitlist signup form (#598). The DOM wiring in
// WaitlistHome.astro's <script> tag only calls these — same "extract the logic,
// test the function" pattern as founding-urgency.ts's remainingLabel.
export const WAITLIST_ENDPOINT = '/api/waitlist';

// Wired to soundbuddy.online/api/waitlist via a Cloudflare custom-domain route
// straight to the API worker (worker/wrangler.jsonc), bypassing the site's own
// assets worker — this relative fetch resolves correctly in production.

export const WAITLIST_SUCCESS_MESSAGE =
  "You're on the list. We'll email you the moment early access opens.";

export const WAITLIST_ERROR_MESSAGE =
  "That didn't go through. Try again, or email support@soundbuddy.online.";

export interface WaitlistPayload {
  email: string;
  churchName?: string;
}

/** Trims both fields and omits churchName when blank — mirrors the worker's optional-field contract (worker/src/handlers/waitlist.ts). */
export function buildWaitlistPayload(email: string, churchName: string): WaitlistPayload {
  const trimmedChurchName = churchName.trim();
  return {
    email: email.trim(),
    ...(trimmedChurchName ? { churchName: trimmedChurchName } : {}),
  };
}

/** Maps a fetch outcome to the copy to render. Any non-ok response or network
 *  failure renders the same error state — "not configured yet is a real state"
 *  (mirrors founding-urgency.ts's isCheckoutLive pattern). */
export function waitlistOutcomeMessage(ok: boolean): string {
  return ok ? WAITLIST_SUCCESS_MESSAGE : WAITLIST_ERROR_MESSAGE;
}
