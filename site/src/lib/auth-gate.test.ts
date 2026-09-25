import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  AUTH_COPY,
  AUTH_SESSION_ENDPOINT,
  AUTH_START_ENDPOINT,
  AUTH_VERIFY_ENDPOINT,
  fetchSessionState,
  normalizeCode,
  normalizeEmail,
  requestSignInCode,
  verifySignInCode,
} from './auth-gate';

const NO_JUSTIFICATION_PATTERN = /\b(why|because|required|need an account|free account|sorry)\b/i;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Pat@Example.COM  ')).toBe('pat@example.com');
  });
});

describe('normalizeCode', () => {
  it('strips non-digit characters', () => {
    expect(normalizeCode('12 34-56')).toBe('123456');
  });

  it('leaves an already-clean code untouched', () => {
    expect(normalizeCode('482913')).toBe('482913');
  });
});

describe('endpoints', () => {
  it('are the expected worker paths', () => {
    expect(AUTH_START_ENDPOINT).toBe('/api/auth/start');
    expect(AUTH_VERIFY_ENDPOINT).toBe('/api/auth/verify');
    expect(AUTH_SESSION_ENDPOINT).toBe('/api/auth/session');
  });
});

describe('fetchSessionState', () => {
  it('200 with a signed-in body → {signedIn:true,email}', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ signedIn: true, email: 'pat@example.com' }));

    const result = await fetchSessionState(fetchImpl as unknown as typeof fetch);

    expect(result).toEqual({ signedIn: true, email: 'pat@example.com' });
    expect(fetchImpl).toHaveBeenCalledWith(
      AUTH_SESSION_ENDPOINT,
      expect.objectContaining({ credentials: 'same-origin' }),
    );
  });

  it('401 → {signedIn:false}', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ signedIn: false }, 401));

    await expect(fetchSessionState(fetchImpl as unknown as typeof fetch)).resolves.toEqual({ signedIn: false });
  });

  it('throwing fetch → {signedIn:false}', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });

    await expect(fetchSessionState(fetchImpl as unknown as typeof fetch)).resolves.toEqual({ signedIn: false });
  });

  it('malformed body on a 200 → {signedIn:false}', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    await expect(fetchSessionState(fetchImpl as unknown as typeof fetch)).resolves.toEqual({ signedIn: false });
  });

  it('200 with a well-formed but signed-out body → {signedIn:false}', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ signedIn: false }));

    await expect(fetchSessionState(fetchImpl as unknown as typeof fetch)).resolves.toEqual({ signedIn: false });
  });
});

describe('requestSignInCode', () => {
  it('posts the correct URL, body, headers, and credentials', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: 'ok' }));

    const result = await requestSignInCode(fetchImpl as unknown as typeof fetch, 'pat@example.com');

    expect(result).toEqual({ ok: true, message: AUTH_COPY.codeSent });
    expect(fetchImpl).toHaveBeenCalledWith(
      AUTH_START_ENDPOINT,
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email: 'pat@example.com' }),
      }),
    );
  });

  it('non-ok response → genericError', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'rate_limited' }, 429));

    await expect(requestSignInCode(fetchImpl as unknown as typeof fetch, 'pat@example.com')).resolves.toEqual({
      ok: false,
      message: AUTH_COPY.genericError,
    });
  });

  it('throwing fetch → genericError', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });

    await expect(requestSignInCode(fetchImpl as unknown as typeof fetch, 'pat@example.com')).resolves.toEqual({
      ok: false,
      message: AUTH_COPY.genericError,
    });
  });
});

describe('verifySignInCode', () => {
  it('200 → ok + signedInAs the response email', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ signedIn: true, email: 'pat@example.com' }));

    const result = await verifySignInCode(fetchImpl as unknown as typeof fetch, 'pat@example.com', '482913');

    expect(result).toEqual({ ok: true, message: AUTH_COPY.signedInAs('pat@example.com') });
    expect(fetchImpl).toHaveBeenCalledWith(
      AUTH_VERIFY_ENDPOINT,
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email: 'pat@example.com', code: '482913' }),
      }),
    );
  });

  it('401 → invalidCode', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'invalid_code' }, 401));

    await expect(verifySignInCode(fetchImpl as unknown as typeof fetch, 'pat@example.com', '000000')).resolves.toEqual({
      ok: false,
      message: AUTH_COPY.invalidCode,
    });
  });

  it('500 → genericError', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'server_error' }, 500));

    await expect(verifySignInCode(fetchImpl as unknown as typeof fetch, 'pat@example.com', '482913')).resolves.toEqual({
      ok: false,
      message: AUTH_COPY.genericError,
    });
  });

  it('throwing fetch → genericError', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });

    await expect(verifySignInCode(fetchImpl as unknown as typeof fetch, 'pat@example.com', '482913')).resolves.toEqual({
      ok: false,
      message: AUTH_COPY.genericError,
    });
  });
});

describe('AUTH_COPY never explains or apologizes for requiring an account (#1525 AC3)', () => {
  it.each(Object.entries(AUTH_COPY).filter(([, value]) => typeof value === 'string'))('%s passes the no-justification check', (_key, value) => {
    expect(value as string).not.toMatch(NO_JUSTIFICATION_PATTERN);
  });

  it("signedInAs('a@b.co') passes the no-justification check", () => {
    expect(AUTH_COPY.signedInAs('a@b.co')).not.toMatch(NO_JUSTIFICATION_PATTERN);
    expect(AUTH_COPY.signedInAs('a@b.co')).toBe('Signed in as a@b.co');
  });
});

describe('BrowserAnalyzer.astro wires the auth gate (#1525)', () => {
  const browserAnalyzerSrc = readFileSync(
    fileURLToPath(new URL('../components/BrowserAnalyzer.astro', import.meta.url)),
    'utf8',
  );

  it('renders the sign-in panel', () => {
    expect(browserAnalyzerSrc).toContain('data-auth-panel');
  });

  it('gates both the file-pick and live-check entry points behind ensureSignedIn', () => {
    const ensureSignedInCalls = browserAnalyzerSrc.match(/ensureSignedIn\(/g) ?? [];
    expect(ensureSignedInCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('no longer claims the tool needs no account', () => {
    expect(browserAnalyzerSrc.toLowerCase()).not.toContain('no account');
  });
});
