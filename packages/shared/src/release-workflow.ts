// Pure auditor for .github/workflows/release.yml (#624). Plain string/regex
// checks over the file text — no YAML parser dependency, mirroring ciJobIds
// in app/electron/ci-required-checks.test.ts. Enforces the security
// properties CI signing depends on: certs land in a temporary keychain that
// gets deleted even on failure, secrets never reach the log, and the signed +
// notarized build flags are actually passed (the notarize flag shape tracks
// electron-builder 26, where mac.notarize is boolean-only — #1225).

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
const TEAM_ID_ENV_PATTERN = /^\s*APPLE_TEAM_ID:\s*\$\{\{\s*secrets\.APPLE_TEAM_ID\s*\}\}\s*$/m;
const IDENTITY_FLAG_PATTERN = /-c\.mac\.identity=/;
const APPLE_VAR_PATTERN = /\bAPPLE_(CERT_P12_BASE64|CERT_PASSWORD|ID|TEAM_ID|APP_SPECIFIC_PASSWORD)\b/;
const ECHO_PRINTF_PATTERN = /\b(echo|printf)\b/;
const PIPE_OR_REDIRECT_PATTERN = /[|>]/;
const SECRETS_APPLE_PATTERN = /secrets\.APPLE_/;
const ENV_MAPPING_LINE_PATTERN = /^\s*[A-Za-z0-9_]+:\s*\$\{\{\s*secrets\.APPLE_[A-Z0-9_]+\s*\}\}\s*$/;
const STEPS_MARKER = '\n    steps:\n';
const STEP_START_PATTERN = /\n(?= {6}- )/;
const RUN_BLOCK_PATTERN = /run:\s*\|[+-]?\n([\s\S]*)/;
const PUBLISH_ACTION_PATTERN = /uses:\s*softprops\/action-gh-release/;
const DRAFT_TRUE_PATTERN = /^\s*draft:\s*true\s*$/m;
const FEED_VERIFY_PATTERN = /scripts\/ci-update-feed\.mjs|checkUpdateFeed/;
const PROMOTE_PATTERN = /gh api\s+-X\s+PATCH[\s\S]*?-F\s+draft=false/;

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

  if (!yml.includes(BARE_NOTARIZE_FLAG)) {
    problems.push(
      `the build step is missing "${BARE_NOTARIZE_FLAG}" — without it electron-builder never submits the .app to the notary service (#1225)`,
    );
  }
  if (yml.includes(NOTARIZE_TEAM_ID_FLAG)) {
    problems.push(
      `the build step passes "${NOTARIZE_TEAM_ID_FLAG}" — electron-builder 26's mac.notarize is a plain boolean and it reads the credentials from APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID in the env instead, so an object here silently contributes nothing; use "${BARE_NOTARIZE_FLAG}" (#1225)`,
    );
  }
  if (!TEAM_ID_ENV_PATTERN.test(yml)) {
    problems.push(
      'does not export APPLE_TEAM_ID from secrets — electron-builder 26 reads the notarization team id from the environment, and the submission is rejected without it (#1225)',
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

  const publishIndex = steps.findIndex((step) => PUBLISH_ACTION_PATTERN.test(step));
  const feedVerifyIndex = steps.findIndex((step) => FEED_VERIFY_PATTERN.test(step));
  const promoteIndex = steps.findIndex((step) => PROMOTE_PATTERN.test(step));

  if (publishIndex === -1) {
    problems.push(
      'no publish step uses softprops/action-gh-release — CI is the authoritative publisher and must create the release itself (#1238)',
    );
  } else if (!DRAFT_TRUE_PATTERN.test(steps[publishIndex])) {
    problems.push(
      `the "${stepName(steps[publishIndex])}" publish step does not set "draft: true" — a non-draft release is public the instant it is created, before its update feed has been verified (#1238)`,
    );
  }

  if (feedVerifyIndex === -1) {
    problems.push(
      'no step verifies latest-mac.yml against the built artifacts (expected "node scripts/ci-update-feed.mjs") — an unverified feed breaks auto-update for every installed user (#1238)',
    );
  } else if (publishIndex !== -1 && feedVerifyIndex > publishIndex) {
    problems.push(
      'the update-feed verification step runs after the publish step — it must run before anything is published (#1238)',
    );
  }

  if (promoteIndex === -1) {
    problems.push(
      'no promote step runs "gh api -X PATCH … -F draft=false" — the draft would never become public (#1238)',
    );
  } else if (promoteIndex !== steps.length - 1) {
    problems.push(
      'the promote step is not the last step in the job — promoting before every verification and upload step has run defeats the draft-first publish (#1238)',
    );
  }

  return { ok: problems.length === 0, problems };
}
