// CI signing secrets preflight (#624). Pure functions only — no fs/child_process
// here. scripts/ci-signing.mjs is the thin shell that calls this and acts on
// the result, mirroring the signing.ts / afterPack.js split (#53).

export const CI_SIGNING_SECRET_VARS = [
  'APPLE_CERT_P12_BASE64',
  'APPLE_CERT_PASSWORD',
  'APPLE_ID',
  'APPLE_TEAM_ID',
  'APPLE_APP_SPECIFIC_PASSWORD',
] as const;

export interface CiSigningSecretsVerdict {
  ok: boolean;
  missing: string[];
  error?: string;
  teamId?: string;
}

function isMissing(value: string | undefined): boolean {
  return !value || value.trim().length === 0;
}

/**
 * Verifies the five repository secrets a CI signed release needs are all
 * present before any build work starts. An unset GitHub Actions secret
 * expands to an empty string (never `undefined`) in `env:`, so empty and
 * whitespace-only values are treated as missing too.
 */
export function resolveCiSigningSecrets(env: Record<string, string | undefined>): CiSigningSecretsVerdict {
  const missing = CI_SIGNING_SECRET_VARS.filter((name) => isMissing(env[name]));

  if (missing.length > 0) {
    return {
      ok: false,
      missing,
      error:
        `cannot build a signed release — missing repository secret(s): ${missing.join(', ')}. Add them under ` +
        `Settings → Secrets and variables → Actions (see docs/signing-and-notarization.md § CI). Refusing to ` +
        `publish an unsigned build.`,
    };
  }

  return { ok: true, missing: [], teamId: env.APPLE_TEAM_ID?.trim() };
}
