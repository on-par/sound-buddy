// Pure auditor for .github/workflows/release.yml (#624). Plain string/regex
// checks over the file text — no YAML parser dependency, mirroring ciJobIds
// in app/electron/ci-required-checks.test.ts. Enforces the security
// properties CI signing depends on: certs land in a temporary keychain that
// gets deleted even on failure, secrets never reach the log, and the signed +
// notarized build flags are actually passed.

export interface ReleaseWorkflowAudit {
  ok: boolean;
  problems: string[];
}

const CHECK_SECRETS_INVOCATION = 'scripts/ci-signing.mjs check-secrets';
const RUNNER_TEMP_PATTERN = /\$\{\{\s*runner\.temp\s*\}\}|\$RUNNER_TEMP\b/;
const CREATE_KEYCHAIN_PATTERN = /security create-keychain\b/;
const DEFAULT_KEYCHAIN_SWITCH_PATTERN = /security default-keychain\s+-s\b/;
const DELETE_KEYCHAIN_PATTERN = /security delete-keychain\b/;
const ALWAYS_GUARD_PATTERN = /if:\s*always\(\)/;
const NOTARIZE_TEAM_ID_FLAG = '-c.mac.notarize.teamId=';
const BARE_NOTARIZE_FLAG = '-c.mac.notarize=true';
const IDENTITY_FLAG_PATTERN = /-c\.mac\.identity=/;
const APPLE_VAR_PATTERN = /\bAPPLE_(CERT_P12_BASE64|CERT_PASSWORD|ID|TEAM_ID|APP_SPECIFIC_PASSWORD)\b/;
const ECHO_PRINTF_PATTERN = /\b(echo|printf)\b/;
const PIPE_OR_REDIRECT_PATTERN = /[|>]/;
const SECRETS_APPLE_PATTERN = /secrets\.APPLE_/;
const ENV_MAPPING_LINE_PATTERN = /^\s*[A-Za-z0-9_]+:\s*\$\{\{\s*secrets\.APPLE_[A-Z0-9_]+\s*\}\}\s*$/;
const STEPS_MARKER = '\n    steps:\n';
const STEP_START_PATTERN = /\n(?= {6}- )/;
const RUN_BLOCK_PATTERN = /run:\s*\|[+-]?\n([\s\S]*)/;

/** Splits a workflow's `steps:` list (6-space-indented `- ` items) into per-step text chunks. */
function splitSteps(yml: string): string[] {
  const markerIndex = yml.indexOf(STEPS_MARKER);
  if (markerIndex === -1) return [];
  const body = yml.slice(markerIndex + STEPS_MARKER.length);
  return body.split(STEP_START_PATTERN).filter((chunk) => chunk.trimStart().startsWith('-'));
}

function stepName(step: string): string {
  return step.match(/name:\s*(.+)/)?.[1]?.trim() ?? 'unnamed step';
}

export function auditReleaseWorkflow(yml: string): ReleaseWorkflowAudit {
  const problems: string[] = [];
  const steps = splitSteps(yml);

  if (!yml.includes(CHECK_SECRETS_INVOCATION)) {
    problems.push(
      `missing a secrets preflight step running "node ${CHECK_SECRETS_INVOCATION}" before any build work runs`,
    );
  }

  if (!(CREATE_KEYCHAIN_PATTERN.test(yml) && RUNNER_TEMP_PATTERN.test(yml))) {
    problems.push(
      'does not import the signing certificate into a temporary keychain under ${{ runner.temp }} / $RUNNER_TEMP',
    );
  }
  if (DEFAULT_KEYCHAIN_SWITCH_PATTERN.test(yml)) {
    problems.push('runs "security default-keychain -s" — must never replace the login keychain');
  }

  const deleteKeychainStep = steps.find((step) => DELETE_KEYCHAIN_PATTERN.test(step));
  if (!deleteKeychainStep) {
    problems.push('no cleanup step runs "security delete-keychain" to remove the temporary keychain');
  } else if (!ALWAYS_GUARD_PATTERN.test(deleteKeychainStep)) {
    problems.push('the "security delete-keychain" step is not guarded by "if: always()"');
  }

  if (!yml.includes(NOTARIZE_TEAM_ID_FLAG)) {
    problems.push(
      `the build step is missing "${NOTARIZE_TEAM_ID_FLAG}" — electron-builder 24 never reads APPLE_TEAM_ID from the env for the .app notarization, so the team id must be passed via config (#646)`,
    );
  }
  if (yml.includes(BARE_NOTARIZE_FLAG)) {
    problems.push(
      `the build step passes bare "${BARE_NOTARIZE_FLAG}" — with Apple-ID/password auth electron-builder 24 drops the teamId and @electron/notarize rejects the submission; use "${NOTARIZE_TEAM_ID_FLAG}\\"$APPLE_TEAM_ID\\"" instead (#646)`,
    );
  }
  if (!IDENTITY_FLAG_PATTERN.test(yml)) {
    problems.push('the build step is missing "-c.mac.identity="');
  }

  const unsafeEchoPrintfLines = yml
    .split('\n')
    .filter(
      (line) =>
        ECHO_PRINTF_PATTERN.test(line) && APPLE_VAR_PATTERN.test(line) && !PIPE_OR_REDIRECT_PATTERN.test(line),
    );
  if (unsafeEchoPrintfLines.length > 0) {
    problems.push(
      `logs an APPLE_* secret directly via echo/printf without piping or redirecting it: ${unsafeEchoPrintfLines
        .map((line) => line.trim())
        .join(' | ')}`,
    );
  }

  const badSecretsLines = yml
    .split('\n')
    .filter((line) => SECRETS_APPLE_PATTERN.test(line) && !ENV_MAPPING_LINE_PATTERN.test(line));
  if (badSecretsLines.length > 0) {
    problems.push(
      `references secrets.APPLE_* outside an env: mapping (must be "NAME: \${{ secrets.APPLE_… }}"): ${badSecretsLines
        .map((line) => line.trim())
        .join(' | ')}`,
    );
  }

  for (const step of steps) {
    const runBlockMatch = step.match(RUN_BLOCK_PATTERN);
    if (!runBlockMatch) continue;
    const body = runBlockMatch[1];
    if (!/\bsecurity\b/.test(body)) continue;
    const firstContentLine = body
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    if (firstContentLine !== 'set -euo pipefail') {
      problems.push(
        `the "${stepName(step)}" run: block touches "security" but is missing "set -euo pipefail" as its first line`,
      );
    }
  }

  return { ok: problems.length === 0, problems };
}
