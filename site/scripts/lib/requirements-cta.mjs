// Pure built-HTML invariant checks for "state requirements at every download
// CTA" (#154). No I/O — mirrors lib/pricing-invariants.mjs. Any drift from the
// canonical floor string is caught because this guard hardcodes the expected
// literal and asserts the built dist/index.html against it.

export const REQUIREMENT_LINE = 'Apple Silicon · macOS 26+';
export const REQUIREMENT_TOOLTIP = `Requires ${REQUIREMENT_LINE}`;

function sliceTag(html, tag) {
  const start = html.indexOf(`<${tag}`);
  const end = html.indexOf(`</${tag}>`);
  if (start === -1 || end === -1) return '';
  return html.slice(start, end);
}

export function checkRequirementsAtCtas(html) {
  const problems = [];

  // Hero fine-print remains the canonical, version-free line. Astro injects a
  // data-astro-cid-* attribute onto elements styled by a component's scoped
  // <style> block, so the built markup never matches a bare `<p class="...">`
  // literal — tolerate extra attributes between the class and the closing `>`.
  const heroMatch = html.match(/<p class="hero-fine mono"[^>]*>([^<]*)<\/p>/);
  if (!heroMatch || heroMatch[1] !== REQUIREMENT_LINE) {
    problems.push(`Hero fine-print must state "${REQUIREMENT_LINE}" verbatim (#154).`);
  }

  // One requirement line per pricing tier card (ties count to tier count, no hardcode).
  const tierCount = (html.match(/class="tier card/g) ?? []).length;
  const tierReq = [...html.matchAll(/<p class="tier-req mono"[^>]*>([^<]*)<\/p>/g)];
  if (tierCount === 0) {
    problems.push('No pricing tier cards found in built HTML (#154).');
  } else if (tierReq.length !== tierCount) {
    problems.push(
      `Each pricing tier card must state the requirement: ${tierCount} tiers but ${tierReq.length} tier-req lines (#154).`,
    );
  }
  for (const m of tierReq) {
    if (m[1] !== REQUIREMENT_LINE) {
      problems.push(`Pricing tier requirement text drifted: "${m[1]}" !== "${REQUIREMENT_LINE}" (#154).`);
    }
  }

  // Browser-compare "Get the Mac app" download CTA.
  const compareReq = [...html.matchAll(/<p class="req-fine mono"[^>]*>([^<]*)<\/p>/g)];
  if (compareReq.length === 0) {
    problems.push('Browser-compare desktop download CTA must state the requirement (req-fine) (#154).');
  }
  for (const m of compareReq) {
    if (m[1] !== REQUIREMENT_LINE) {
      problems.push(`req-fine requirement text drifted: "${m[1]}" !== "${REQUIREMENT_LINE}" (#154).`);
    }
  }

  // Terse header + footer download entry points carry the requirement tooltip.
  if (!sliceTag(html, 'header').includes(REQUIREMENT_TOOLTIP)) {
    problems.push('Header download button must carry the requirement tooltip (#154).');
  }
  if (!sliceTag(html, 'footer').includes(REQUIREMENT_TOOLTIP)) {
    problems.push('Footer download link must carry the requirement tooltip (#154).');
  }

  // Drift guard: an outdated macOS floor must never appear anywhere on the page.
  if (/macOS 1[0-9]\+/.test(html)) {
    problems.push('An outdated macOS floor (e.g. "macOS 15+") appears — requirements must read "macOS 26+" everywhere (#154).');
  }

  return problems;
}
