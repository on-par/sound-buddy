// Pure, testable core of the Free-tier sign-in gate (#1525). The DOM wiring
// in BrowserAnalyzer.astro's <script> tag only calls these — same "extract
// the logic, test the function" pattern as waitlist-form.ts. Wired to
// soundbuddy.online/api/auth/* via the same Cloudflare custom-domain route
// pattern as /api/waitlist (worker/wrangler.jsonc).
export const AUTH_START_ENDPOINT = '/api/auth/start';
export const AUTH_VERIFY_ENDPOINT = '/api/auth/verify';
export const AUTH_SESSION_ENDPOINT = '/api/auth/session';

export type SessionState = { signedIn: true; email: string } | { signedIn: false };

// Visible strings for the sign-in panel. Deliberately silent on *why* an
// account is needed — the product lock (#1518) requires the gate to never
// explain or apologize for itself.
export const AUTH_COPY = {
  heading: 'Sign in',
  emailLabel: 'Email',
  sendCode: 'Email me a code',
  codeLabel: 'Sign-in code',
  verify: 'Sign in',
  codeSent: 'Check your email for a 6-digit code.',
  invalidCode: "That code didn't work. Check it, or send a new one.",
  genericError: "That didn't go through. Try again, or email support@soundbuddy.online.",
  signedInAs: (email: string) => `Signed in as ${email}`,
} as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function normalizeCode(raw: string): string {
  return raw.replace(/\D/g, '');
}

const REQUEST_HEADERS = { 'content-type': 'application/json' };

/** Checks whether the visitor is currently signed in. Any non-200 response,
 * network failure, or malformed body degrades to signed-out rather than
 * throwing — a worker hiccup must never crash the page. */
export async function fetchSessionState(fetchImpl: typeof fetch): Promise<SessionState> {
  try {
    const res = await fetchImpl(AUTH_SESSION_ENDPOINT, { credentials: 'same-origin' });
    if (!res.ok) return { signedIn: false };
    const body: unknown = await res.json();
    if (isPlainObject(body) && body.signedIn === true && typeof body.email === 'string') {
      return { signedIn: true, email: body.email };
    }
    return { signedIn: false };
  } catch {
    return { signedIn: false };
  }
}

/** Requests a one-time sign-in code be emailed to `email`. The worker never
 * reveals account existence, so any non-ok response maps to the same generic
 * error as a network failure. */
export async function requestSignInCode(
  fetchImpl: typeof fetch,
  email: string,
): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetchImpl(AUTH_START_ENDPOINT, {
      method: 'POST',
      headers: REQUEST_HEADERS,
      credentials: 'same-origin',
      body: JSON.stringify({ email }),
    });
    return res.ok ? { ok: true, message: AUTH_COPY.codeSent } : { ok: false, message: AUTH_COPY.genericError };
  } catch {
    return { ok: false, message: AUTH_COPY.genericError };
  }
}

/** Verifies a code and, on success, resolves the session cookie the worker
 * just set. 401 gets its own actionable copy; every other failure mode
 * (5xx, network error, malformed body) falls back to the generic error. */
export async function verifySignInCode(
  fetchImpl: typeof fetch,
  email: string,
  code: string,
): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetchImpl(AUTH_VERIFY_ENDPOINT, {
      method: 'POST',
      headers: REQUEST_HEADERS,
      credentials: 'same-origin',
      body: JSON.stringify({ email, code }),
    });

    if (res.status === 200) {
      const body: unknown = await res.json().catch(() => null);
      const signedInEmail = isPlainObject(body) && typeof body.email === 'string' ? body.email : email;
      return { ok: true, message: AUTH_COPY.signedInAs(signedInEmail) };
    }
    if (res.status === 401) {
      return { ok: false, message: AUTH_COPY.invalidCode };
    }
    return { ok: false, message: AUTH_COPY.genericError };
  } catch {
    return { ok: false, message: AUTH_COPY.genericError };
  }
}
