// Pure built-HTML checks proving the live-mode homepage never drifts from
// the pre-waitlist-epic golden copy — the reversibility guarantee of the
// PUBLIC_SITE_MODE toggle (#597). No I/O, no process.exit — mirrors the
// lib/site-mode-invariants.mjs seam (#602).

const EXCERPT_RADIUS = 80;

// Distinctive waitlist-only markers (WaitlistHome.astro) that must never
// leak into a PUBLIC_SITE_MODE=live build.
export const WAITLIST_LEAK_MARKERS = [
  'data-waitlist-form',
  'data-waitlist-status',
  'data-site-mode',
  'data-waitlist',
  'id="waitlist-email"',
  'Join the waitlist',
  'Coming soon.',
];

// Placeholder Founding Payment Link the live build resolves to when
// PUBLIC_FOUNDING_CHECKOUT_URL is unset — source of truth:
// src/lib/founding-urgency.ts's PLACEHOLDER_FOUNDING_URL (plain .mjs scripts
// can't import the .ts lib, so this constant mirrors it).
export const PLACEHOLDER_FOUNDING_URL = 'https://buy.stripe.com/sound-buddy-founding-lifetime';

const LIVE_SECTION_IDS = ['id="how"', 'id="proof"', 'id="faq"', 'id="pricing"'];
const LIVE_TIER_NAMES = ['Founding Lifetime', 'Pro Monthly', 'Pro Annual', 'Free'];
const LIVE_HERO_EYEBROW = 'For church FOH volunteers &amp; worship engineers';

function excerptAround(str, index) {
  const start = Math.max(0, index - EXCERPT_RADIUS);
  const end = Math.min(str.length, index + EXCERPT_RADIUS);
  return str.slice(start, end);
}

function firstDiffIndex(a, b) {
  const maxLen = Math.max(a.length, b.length);
  for (let i = 0; i < maxLen; i += 1) {
    if (a[i] !== b[i]) return i;
  }
  return -1;
}

/**
 * Byte-for-byte compare the built live-mode homepage against the committed
 * golden. Returns an array of human-readable problem strings (empty === OK).
 */
export function compareLiveHomeToGolden(liveHtml, goldenHtml) {
  if (liveHtml === goldenHtml) return [];

  const problems = [];

  if (liveHtml.length !== goldenHtml.length) {
    problems.push(
      `Live-mode homepage length (${liveHtml.length} chars) differs from the golden (${goldenHtml.length} chars) (#602).`,
    );
  }

  const diffIdx = firstDiffIndex(liveHtml, goldenHtml);
  if (diffIdx !== -1) {
    problems.push(
      `Live-mode homepage differs from the golden at character ${diffIdx} — built: "${excerptAround(liveHtml, diffIdx)}" vs golden: "${excerptAround(goldenHtml, diffIdx)}". ` +
        'The fix is to undo whatever changed in the live render, not to regenerate the golden. ' +
        'Only regenerate (via `node scripts/check-live-parity.mjs --update`, then commit the file) for an intentional, human-approved change to the live homepage (#602).',
    );
  }

  return problems;
}

/**
 * Assert the built HTML contains none of the waitlist-only leak markers.
 * Returns an array of human-readable problem strings (empty === OK).
 */
export function checkLiveHomeLeakMarkers(html) {
  const problems = [];
  for (const marker of WAITLIST_LEAK_MARKERS) {
    if (html.includes(marker)) {
      problems.push(
        `Live-mode homepage contains the waitlist marker "${marker}" — this must never leak into a PUBLIC_SITE_MODE=live build (#602). Undo whatever introduced it.`,
      );
    }
  }
  return problems;
}

/**
 * Assert the built HTML retains the live homepage's load-bearing structure:
 * nav section anchors, every pricing tier name, the placeholder Founding
 * checkout href, a footer, and the hero eyebrow. Returns an array of
 * human-readable problem strings (empty === OK).
 */
export function checkLiveHomeStructure(html) {
  const problems = [];

  for (const id of LIVE_SECTION_IDS) {
    if (!html.includes(id)) {
      problems.push(`Live-mode homepage is missing the ${id} section anchor — the live nav depends on it (#602).`);
    }
  }

  for (const name of LIVE_TIER_NAMES) {
    if (!html.includes(name)) {
      problems.push(`Live-mode homepage is missing the "${name}" pricing tier (#602).`);
    }
  }

  if (!html.includes(PLACEHOLDER_FOUNDING_URL)) {
    problems.push(
      `Live-mode homepage is missing the placeholder Founding checkout href "${PLACEHOLDER_FOUNDING_URL}" (#602).`,
    );
  }

  if (!html.includes('<footer')) {
    problems.push('Live-mode homepage is missing a <footer> element (#602).');
  }

  if (!html.includes(LIVE_HERO_EYEBROW)) {
    problems.push(`Live-mode homepage is missing the hero eyebrow "${LIVE_HERO_EYEBROW}" (#602).`);
  }

  return problems;
}
