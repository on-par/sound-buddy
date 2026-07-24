// Pure built-HTML invariant checks shared by check-site-mode.mjs and its tests.
// No I/O, no process.exit — mirrors the lib/pricing-invariants.mjs seam (#560).

// The three legal pages that must stay reachable in both waitlist and live
// mode, and whose footers (LegalLayout) cross-link all three policies (#601).
export const LEGAL_PAGE_PATHS = ['/terms', '/privacy', '/refund'];

const DOWNLOAD_PATH = '/download';
const PRICING_ANCHOR = '#pricing';

/** Extract every <a ... href="..."> value from an HTML string. */
export function collectAnchorHrefs(html) {
  const out = [];
  const re = /<a\b[^>]*\shref="([^"]+)"/gi;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

// Strip a trailing query string and/or fragment so a tracking param appended
// later (e.g. "/download?src=nav") can't silently defeat these checks (#601).
function pathOnly(href) {
  const hashIdx = href.indexOf('#');
  return (hashIdx === -1 ? href : href.slice(0, hashIdx)).split('?')[0];
}

function fragmentOnly(href) {
  const hashIdx = href.indexOf('#');
  return hashIdx === -1 ? null : href.slice(hashIdx + 1).split('?')[0];
}

function isDownloadHref(href) {
  const path = pathOnly(href);
  return path === DOWNLOAD_PATH || path.startsWith(`${DOWNLOAD_PATH}/`);
}

function isPricingAnchorHref(href) {
  return fragmentOnly(href) === 'pricing' && (pathOnly(href) === '' || pathOnly(href) === '/');
}

/**
 * Check the waitlist homepage's built HTML (#601): no Download link, no
 * Pricing link/anchor, but Terms and Privacy stay linked. Returns an array
 * of human-readable problem strings (empty === OK).
 */
export function checkWaitlistHomeInvariants(html) {
  const problems = [];
  const hrefs = collectAnchorHrefs(html);

  for (const href of hrefs) {
    if (isDownloadHref(href)) {
      problems.push(
        `Waitlist homepage links /download ("${href}") — the waitlist nav must not link the download path (#601). Remove the link or gate it on live mode.`,
      );
    }
    if (isPricingAnchorHref(href)) {
      problems.push(
        `Waitlist homepage links #pricing ("${href}") — the waitlist nav must not link the pricing anchor (#601). Remove the link or gate it on live mode.`,
      );
    }
  }

  for (const path of ['/terms', '/privacy']) {
    if (!hrefs.includes(path)) {
      problems.push(
        `Waitlist homepage is missing the ${path} link — legal pages must stay linked in waitlist mode (#601).`,
      );
    }
  }

  return problems;
}

/**
 * Check the live homepage's built HTML (#601): Download, Pricing, and the
 * legal links must all still be present. Returns an array of human-readable
 * problem strings (empty === OK).
 */
export function checkLiveHomeInvariants(html) {
  const hrefs = collectAnchorHrefs(html);
  const problems = [];

  const missingLink = (label) =>
    `Live homepage is missing the ${label} link — the live nav must keep Download/Pricing and the legal links (#601).`;

  if (!hrefs.some(isDownloadHref)) problems.push(missingLink(DOWNLOAD_PATH));
  if (!hrefs.some(isPricingAnchorHref)) problems.push(missingLink(PRICING_ANCHOR));
  for (const path of ['/terms', '/privacy']) {
    if (!hrefs.includes(path)) problems.push(missingLink(path));
  }

  return problems;
}

/**
 * Check a built legal page's HTML (#601): its footer must cross-link all
 * three legal pages, and it must never reference Download or Pricing.
 * Returns an array of human-readable problem strings (empty === OK).
 */
export function checkLegalPageInvariants(html, pathname) {
  const hrefs = collectAnchorHrefs(html);
  const problems = [];

  for (const path of LEGAL_PAGE_PATHS) {
    if (!hrefs.includes(path)) {
      problems.push(`${pathname} is missing the ${path} legal cross-link — LegalLayout must link all three policies (#601).`);
    }
  }

  for (const href of hrefs) {
    if (isDownloadHref(href) || isPricingAnchorHref(href)) {
      problems.push(`${pathname} links "${href}" — LegalLayout must not reference Download/Pricing (#601).`);
    }
  }

  return problems;
}
