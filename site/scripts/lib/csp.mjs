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

// Origins the waitlist demo-video slot's iframe embed can point at (#600) —
// the only two embed bases site/src/lib/demo-video.ts ever generates.
export const DEMO_VIDEO_FRAME_SRC_ORIGINS = ['https://www.youtube-nocookie.com', 'https://player.vimeo.com'];

// Each external origin is only expected in its own directive — a directive
// not listed here allows no external origin at all.
const ALLOWED_ORIGINS_BY_DIRECTIVE = {
  'script-src': [CF_ANALYTICS_SCRIPT_SRC],
  'connect-src': [CF_ANALYTICS_CONNECT_SRC],
  'frame-src': DEMO_VIDEO_FRAME_SRC_ORIGINS,
};

/**
 * Check a CSP value against the site's policy: the CF Web Analytics origins
 * must be present in script-src/connect-src, and no OTHER external origin may
 * appear in any directive — including either CF origin showing up outside its
 * own directive. Returns an array of human-readable problem strings (empty
 * === OK). Pure — the caller does the printing and exiting.
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
    const allowedOrigins = ALLOWED_ORIGINS_BY_DIRECTIVE[directive] ?? [];
    for (const source of sources) {
      if (!/^https?:\/\//i.test(source)) continue; // 'self', 'none', data:, etc. are keywords, not origins
      if (allowedOrigins.includes(source)) continue;
      problems.push(
        `${directive}: unexpected external origin '${source}'. Only the origins listed in ` +
          "ALLOWED_ORIGINS_BY_DIRECTIVE are allowed, each in its own directive; bundle assets " +
          'into /_astro/ instead.',
      );
    }
  }

  return problems;
}
