// Single source of truth for the money-back guarantee copy (#559). Both the
// pricing badge on / and the policy callout on /refund derive their wording
// from here so the two can never drift apart.
export const GUARANTEE_WINDOW_DAYS = 30;

/** Short badge form, used next to the price. */
export const GUARANTEE_BADGE = `${GUARANTEE_WINDOW_DAYS}-day money-back guarantee — no questions asked`;

/** Sentence form, used in the /refund callout. */
export const GUARANTEE_SENTENCE = `${GUARANTEE_WINDOW_DAYS}-day money-back guarantee.`;

/** Where the badge links. */
export const REFUND_PATH = '/refund';
