// Live founding-license sold count (#1170) — fetched client-side from the
// Worker's GET /api/stripe/founding-count and rendered on the pricing section.

/** Same-origin endpoint (Worker owns soundbuddy.online/api/stripe/*). */
export const FOUNDING_COUNT_ENDPOINT = '/api/stripe/founding-count';

export interface FoundingCountResponse {
  sold: number;
  cap: number;
  remaining: number;
}

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/** Validate an unknown fetched body into a FoundingCountResponse, else null. */
export function parseFoundingCount(data: unknown): FoundingCountResponse | null {
  if (typeof data !== 'object' || data === null) return null;
  const { sold, cap, remaining } = data as Record<string, unknown>;
  if (!isFiniteNumber(sold) || !isFiniteNumber(cap) || !isFiniteNumber(remaining)) {
    return null;
  }
  return { sold, cap, remaining };
}

/** "142 of 300 founding licenses remaining", or a sold-out line at 0. */
export function foundingRemainingLabel(count: FoundingCountResponse): string {
  if (count.remaining <= 0) {
    return `Founding is sold out — all ${count.cap} licenses claimed.`;
  }
  return `${count.remaining} of ${count.cap} founding licenses remaining.`;
}
