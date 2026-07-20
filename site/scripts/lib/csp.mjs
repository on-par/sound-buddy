// Pure CSP parsing/validation shared by check-headers.mjs and its tests. No
// I/O, no process.exit — mirrors the lib/inline-script.mjs seam.

/** Parse a CSP header value into a Map of directive name -> array of sources. */
export function parseCsp(value) {
  const directives = new Map();
  for (const rawDirective of value.split(';')) {
    const trimmed = rawDirective.trim();
    if (!trimmed) continue;
    const [name, ...sources] = trimmed.split(/\s+/);
    directives.set(name, sources);
  }
  return directives;
}

// Origins the Cloudflare Web Analytics beacon needs (#555).
export const CF_ANALYTICS_SCRIPT_SRC = 'https://static.cloudflareinsights.com';
export const CF_ANALYTICS_CONNECT_SRC = 'https://cloudflareinsights.com';

/**
 * Check a CSP value against the site's policy: the CF Web Analytics origins
 * must be present in script-src/connect-src, and no OTHER external origin may
 * appear in any directive. Returns an array of human-readable problem strings
 * (empty === OK). Pure — the caller does the printing and exiting.
 */
export function checkCspOrigins(value) {
  const directives = parseCsp(value);
  const problems = [];

  const scriptSrc = directives.get('script-src') ?? [];
  if (!scriptSrc.includes(CF_ANALYTICS_SCRIPT_SRC)) {
    problems.push(
      `script-src must allow ${CF_ANALYTICS_SCRIPT_SRC} — the Cloudflare Web Analytics beacon ` +
        'is injected at the edge and will be CSP-blocked without it (#555).',
    );
  }

  const connectSrc = directives.get('connect-src') ?? [];
  if (!connectSrc.includes(CF_ANALYTICS_CONNECT_SRC)) {
    problems.push(
      `connect-src must allow ${CF_ANALYTICS_CONNECT_SRC} — the Cloudflare Web Analytics beacon ` +
        'reports its RUM payload to cloudflareinsights.com/cdn-cgi/rum and will be CSP-blocked ' +
        'without it (#555).',
    );
  }

  for (const [directive, sources] of directives) {
    for (const source of sources) {
      if (!/^https?:\/\//i.test(source)) continue; // 'self', 'none', data:, etc. are keywords, not origins
      if (source === CF_ANALYTICS_SCRIPT_SRC || source === CF_ANALYTICS_CONNECT_SRC) continue;
      problems.push(
        `${directive}: unexpected external origin '${source}'. Only the two Cloudflare Web ` +
          'Analytics origins are allowed; bundle assets into /_astro/ instead.',
      );
    }
  }

  return problems;
}
