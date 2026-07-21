import { describe, expect, it } from 'vitest';
import { CI_SIGNING_SECRET_VARS, resolveCiSigningSecrets } from './ci-signing.js';

const ALL_SECRETS = {
  APPLE_CERT_P12_BASE64: 'base64cert==',
  APPLE_CERT_PASSWORD: 'cert-pw',
  APPLE_ID: 'dev@onpar.example',
  APPLE_TEAM_ID: 'Q7LB49TPBS',
  APPLE_APP_SPECIFIC_PASSWORD: 'abcd-efgh-ijkl-mnop',
};

describe('CI_SIGNING_SECRET_VARS', () => {
  it('lists all five signing secrets in a fixed order', () => {
    expect(CI_SIGNING_SECRET_VARS).toEqual([
      'APPLE_CERT_P12_BASE64',
      'APPLE_CERT_PASSWORD',
      'APPLE_ID',
      'APPLE_TEAM_ID',
      'APPLE_APP_SPECIFIC_PASSWORD',
    ]);
  });
});

describe('resolveCiSigningSecrets', () => {
  it('returns ok: true with the team id when all five secrets are present', () => {
    expect(resolveCiSigningSecrets(ALL_SECRETS)).toEqual({
      ok: true,
      missing: [],
      teamId: 'Q7LB49TPBS',
    });
  });

  it.each(CI_SIGNING_SECRET_VARS)('reports %s as missing when it alone is absent', (missingVar) => {
    const env = { ...ALL_SECRETS, [missingVar]: undefined };
    const verdict = resolveCiSigningSecrets(env);
    expect(verdict.ok).toBe(false);
    expect(verdict.missing).toEqual([missingVar]);
  });

  it('lists several missing vars in CI_SIGNING_SECRET_VARS order, not input order', () => {
    const env = {
      ...ALL_SECRETS,
      APPLE_TEAM_ID: undefined,
      APPLE_CERT_P12_BASE64: undefined,
    };
    const verdict = resolveCiSigningSecrets(env);
    expect(verdict.ok).toBe(false);
    expect(verdict.missing).toEqual(['APPLE_CERT_P12_BASE64', 'APPLE_TEAM_ID']);
  });

  it('treats whitespace-only secrets as missing (an unset GitHub secret expands to an empty string)', () => {
    const env = { ...ALL_SECRETS, APPLE_ID: '   ' };
    const verdict = resolveCiSigningSecrets(env);
    expect(verdict.ok).toBe(false);
    expect(verdict.missing).toEqual(['APPLE_ID']);
  });

  it('treats an empty-string secret as missing', () => {
    const env = { ...ALL_SECRETS, APPLE_CERT_PASSWORD: '' };
    const verdict = resolveCiSigningSecrets(env);
    expect(verdict.ok).toBe(false);
    expect(verdict.missing).toEqual(['APPLE_CERT_PASSWORD']);
  });

  it('error is actionable, names the missing secrets, and points at Settings + docs', () => {
    const env = { ...ALL_SECRETS, APPLE_ID: undefined, APPLE_TEAM_ID: undefined };
    const verdict = resolveCiSigningSecrets(env);
    expect(verdict.ok).toBe(false);
    expect(verdict.error).toMatch(/missing repository secret\(s\): APPLE_ID, APPLE_TEAM_ID/);
    expect(verdict.error).toMatch(/Settings.*Secrets and variables.*Actions/);
    expect(verdict.error).toMatch(/docs\/signing-and-notarization\.md/);
    expect(verdict.error).toMatch(/Refusing to publish an unsigned build/);
  });

  it('never leaks a secret value into the error message', () => {
    const env = { ...ALL_SECRETS, APPLE_ID: undefined };
    const verdict = resolveCiSigningSecrets(env);
    expect(verdict.ok).toBe(false);
    for (const value of Object.values(ALL_SECRETS)) {
      expect(verdict.error).not.toContain(value);
    }
  });

  it('missing is empty and error is undefined when ok', () => {
    const verdict = resolveCiSigningSecrets(ALL_SECRETS);
    expect(verdict.missing).toEqual([]);
    expect(verdict.error).toBeUndefined();
  });
});
