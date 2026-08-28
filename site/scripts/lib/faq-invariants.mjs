// Pure built-HTML invariant checks shared by check-faq.mjs and its tests.
// No I/O, no process.exit — mirrors the lib/pricing-invariants.mjs seam (#558).

const EXPECTED_FAQ_COUNT = 8;
// #1234: the shipped build is Developer ID-signed and notarized, so the install answer must
// say so — and the old Gatekeeper-bypass copy must never come back anywhere on the page.
// The unsigned wording survives only in packages/shared's buildReleaseNotes({ signed: false }).
const SIGNED_INSTALL_MARKERS = ['Developer ID', 'notarized'];
const UNSIGNED_BYPASS_MARKERS = ['Open Anyway', 'Gatekeeper', 'Apple could not verify', 'com.apple.quarantine'];
const EXPECTED_FAQ_IDS = [
  'faq-privacy',
  'faq-unsigned-install',
  'faq-ai',
  'faq-refund',
  'faq-requirements',
  'faq-offline',
  'faq-free-tier',
  'faq-trial',
];

function extractFaqBlock(html) {
  const start = html.indexOf('id="faq"');
  if (start === -1) return null;
  const closeIdx = html.indexOf('</section>', start);
  return closeIdx === -1 ? html.slice(start) : html.slice(start, closeIdx);
}

/**
 * Check the built FAQ / objection-handling section (#558). Returns an array
 * of human-readable problem strings (empty === OK).
 */
export function checkFaqInvariants(html) {
  const problems = [];

  const faqIdx = html.indexOf('id="faq"');
  const pricingIdx = html.indexOf('id="pricing"');
  const installIdx = html.indexOf('id="install-walkthrough"');

  if (faqIdx === -1) {
    problems.push('FAQ section (id="faq") not found in built HTML — add the FAQ section (#558).');
    return problems;
  }

  if (pricingIdx === -1) {
    problems.push('#pricing section not found in built HTML — cannot verify FAQ placement (#558).');
  } else if (!(faqIdx > pricingIdx)) {
    problems.push('FAQ must render after #pricing — move the `#faq` section below the pricing block (#558).');
  }

  if (installIdx === -1) {
    problems.push('#install-walkthrough section not found in built HTML — cannot verify FAQ placement (#558).');
  } else if (!(faqIdx < installIdx)) {
    problems.push(
      'FAQ must render before the sysreq/install-walkthrough section — move the `#faq` section near pricing (#558).',
    );
  }

  const faqItemMatches = html.match(/<details class="faq-item/g) ?? [];
  if (faqItemMatches.length !== EXPECTED_FAQ_COUNT) {
    problems.push(
      `Expected exactly ${EXPECTED_FAQ_COUNT} FAQ entries, found ${faqItemMatches.length} — check FAQ_ENTRIES in src/lib/faq.ts (#558).`,
    );
  }

  for (const id of EXPECTED_FAQ_IDS) {
    if (!html.includes(`id="${id}"`)) {
      problems.push(`FAQ entry "${id}" is missing from the built HTML — check FAQ_ENTRIES in src/lib/faq.ts (#558).`);
    }
  }

  const faqBlock = extractFaqBlock(html);
  if (faqBlock !== null) {
    const summaryCount = (faqBlock.match(/<summary/g) ?? []).length;
    const summaryWithH3Count = (faqBlock.match(/<summary[\s\S]*?<h3/g) ?? []).length;
    if (summaryCount === 0) {
      problems.push('No <summary> elements found in the FAQ block — check the FAQ markup (#558).');
    } else if (summaryCount !== summaryWithH3Count) {
      problems.push(
        'Every FAQ <summary> must contain a real <h3> for the document outline — a summary is missing one (#558).',
      );
    }

    for (const marker of SIGNED_INSTALL_MARKERS) {
      if (!faqBlock.includes(marker)) {
        problems.push(
          `The install answer must state the app is signed and notarized — "${marker}" is missing from the FAQ block (#1234).`,
        );
      }
    }
  }

  if (installIdx !== -1) {
    const notarizedIdx = html.indexOf('notarized');
    if (notarizedIdx === -1 || !(notarizedIdx < installIdx)) {
      problems.push(
        'The signed-install answer must appear before #install-walkthrough — it cannot be buried only in the footer (#558, #1234).',
      );
    }
  }

  for (const marker of UNSIGNED_BYPASS_MARKERS) {
    if (html.includes(marker)) {
      problems.push(
        `Unsigned-install bypass copy "${marker}" found in the built HTML — the shipped build is signed and notarized (#1234).`,
      );
    }
  }

  if (/14[-\s]day money-back/i.test(html)) {
    problems.push('Guarantee window must derive from GUARANTEE_WINDOW_DAYS — "14-day money-back" found (#558).');
  }

  return problems;
}
