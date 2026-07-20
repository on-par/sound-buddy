import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CF_ANALYTICS_CONNECT_SRC, CF_ANALYTICS_SCRIPT_SRC, checkCspOrigins, parseCsp } from './csp.mjs';

// Derived from the real file (not a hand-copied duplicate) so a future edit
// to site/public/_headers can't silently drift out of sync with these tests.
const headersPath = fileURLToPath(new URL('../../public/_headers', import.meta.url));
const headersText = await readFile(headersPath, 'utf8');
const cspMatch = headersText.match(/Content-Security-Policy:\s*(.+)/);
const PRODUCTION_CSP = cspMatch[1].trim();

describe('parseCsp', () => {
  it('splits directives and their sources', () => {
    const parsed = parseCsp("default-src 'self'; script-src 'self' https://example.com");
    expect(parsed.get('default-src')).toEqual(["'self'"]);
    expect(parsed.get('script-src')).toEqual(["'self'", 'https://example.com']);
  });

  it('tolerates extra whitespace and a trailing semicolon', () => {
    const parsed = parseCsp("  default-src   'self' ;  script-src 'self'  ;  ");
    expect(parsed.get('default-src')).toEqual(["'self'"]);
    expect(parsed.get('script-src')).toEqual(["'self'"]);
  });

  it('handles a valueless directive', () => {
    const parsed = parseCsp("default-src 'self'; upgrade-insecure-requests");
    expect(parsed.get('upgrade-insecure-requests')).toEqual([]);
  });
});

describe('checkCspOrigins', () => {
  it('returns no problems for the production _headers CSP (regression proof)', () => {
    expect(checkCspOrigins(PRODUCTION_CSP)).toEqual([]);
  });

  it('flags a missing script-src analytics origin', () => {
    const csp = PRODUCTION_CSP.replace(` ${CF_ANALYTICS_SCRIPT_SRC}`, '');
    const problems = checkCspOrigins(csp);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('static.cloudflareinsights.com');
    expect(problems[0]).toContain('script-src');
  });

  it('flags a missing connect-src analytics origin', () => {
    const csp = PRODUCTION_CSP.replace(` ${CF_ANALYTICS_CONNECT_SRC}`, '');
    const problems = checkCspOrigins(csp);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('cloudflareinsights.com');
    expect(problems[0]).toContain('connect-src');
  });

  it('flags an unexpected external origin in another directive', () => {
    const csp = PRODUCTION_CSP.replace("img-src 'self' data:", "img-src 'self' data: https://evil.example");
    const problems = checkCspOrigins(csp);
    expect(problems.some((p) => p.includes('evil.example') && p.includes('img-src'))).toBe(true);
  });

  it('flags the connect-src origin appearing outside connect-src', () => {
    const csp = PRODUCTION_CSP.replace(
      'script-src \'self\' https://static.cloudflareinsights.com',
      `script-src 'self' https://static.cloudflareinsights.com ${CF_ANALYTICS_CONNECT_SRC}`,
    );
    const problems = checkCspOrigins(csp);
    expect(problems.some((p) => p.includes(CF_ANALYTICS_CONNECT_SRC) && p.includes('script-src'))).toBe(true);
  });

  it('accumulates problems instead of stopping at the first one', () => {
    const csp = PRODUCTION_CSP.replace(` ${CF_ANALYTICS_SCRIPT_SRC}`, '').replace(` ${CF_ANALYTICS_CONNECT_SRC}`, '');
    const problems = checkCspOrigins(csp);
    expect(problems).toHaveLength(2);
  });

  it('does not flag keyword sources as external origins', () => {
    const csp =
      "default-src 'self'; script-src 'self' https://static.cloudflareinsights.com 'unsafe-inline'; " +
      "connect-src 'self' https://cloudflareinsights.com; object-src 'none'; img-src 'self' data:; " +
      'upgrade-insecure-requests';
    expect(checkCspOrigins(csp)).toEqual([]);
  });
});
