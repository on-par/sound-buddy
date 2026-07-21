import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { auditReleaseWorkflow } from './release-workflow.js';

// A minimal but structurally faithful workflow satisfying every audit rule
// (#624) — each violating fixture below is a targeted mutation of this one.
const CLEAN_WORKFLOW = `name: Release
on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:

env:
  APPLE_CERT_P12_BASE64: \${{ secrets.APPLE_CERT_P12_BASE64 }}
  APPLE_CERT_PASSWORD: \${{ secrets.APPLE_CERT_PASSWORD }}
  APPLE_ID: \${{ secrets.APPLE_ID }}
  APPLE_TEAM_ID: \${{ secrets.APPLE_TEAM_ID }}
  APPLE_APP_SPECIFIC_PASSWORD: \${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}

jobs:
  release:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4

      - name: Verify signing secrets
        run: node scripts/ci-signing.mjs check-secrets

      - name: Import signing certificate (temporary keychain)
        run: |
          set -euo pipefail
          KEYCHAIN_PATH="$RUNNER_TEMP/sound-buddy-signing-$(openssl rand -hex 12).keychain-db"
          security create-keychain -p "x" "$KEYCHAIN_PATH"
          printf '%s' "$APPLE_CERT_P12_BASE64" | base64 --decode > "$RUNNER_TEMP/cert.p12"
          security import "$RUNNER_TEMP/cert.p12" -k "$KEYCHAIN_PATH" -P "$APPLE_CERT_PASSWORD" -A

      - name: Build macOS zip + dmg (signed + notarized)
        run: |
          set -euo pipefail
          npm run dist --prefix app -- -c.mac.identity="$IDENTITY_NAME" -c.mac.notarize=true

      - name: Delete the temporary keychain
        if: always()
        run: |
          set -euo pipefail
          security delete-keychain "$KEYCHAIN_PATH" || true
`;

describe('auditReleaseWorkflow', () => {
  it('the clean fixture passes with no problems', () => {
    expect(auditReleaseWorkflow(CLEAN_WORKFLOW)).toEqual({ ok: true, problems: [] });
  });

  it('flags a missing secrets preflight step', () => {
    const yml = CLEAN_WORKFLOW.replace(
      `      - name: Verify signing secrets
        run: node scripts/ci-signing.mjs check-secrets

`,
      '',
    );
    const result = auditReleaseWorkflow(yml);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([expect.stringMatching(/ci-signing\.mjs check-secrets/)]);
  });

  it('flags a keychain import that never references runner.temp / RUNNER_TEMP', () => {
    const yml = CLEAN_WORKFLOW.replaceAll('$RUNNER_TEMP', '/private/tmp');
    const result = auditReleaseWorkflow(yml);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([expect.stringMatching(/temporary keychain under.*runner\.temp/i)]);
  });

  it('flags a workflow that touches the login keychain via "security default-keychain -s"', () => {
    const yml = CLEAN_WORKFLOW.replace(
      'security import "$RUNNER_TEMP/cert.p12" -k "$KEYCHAIN_PATH" -P "$APPLE_CERT_PASSWORD" -A',
      'security import "$RUNNER_TEMP/cert.p12" -k "$KEYCHAIN_PATH" -P "$APPLE_CERT_PASSWORD" -A\n          security default-keychain -s "$KEYCHAIN_PATH"',
    );
    const result = auditReleaseWorkflow(yml);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([expect.stringMatching(/security default-keychain -s/)]);
  });

  it('flags a missing keychain-cleanup step', () => {
    const yml = CLEAN_WORKFLOW.replace(
      `
      - name: Delete the temporary keychain
        if: always()
        run: |
          set -euo pipefail
          security delete-keychain "$KEYCHAIN_PATH" || true
`,
      '\n',
    );
    const result = auditReleaseWorkflow(yml);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([expect.stringMatching(/no cleanup step runs "security delete-keychain"/)]);
  });

  it('flags a keychain-cleanup step that is not guarded by if: always()', () => {
    const yml = CLEAN_WORKFLOW.replace(
      `      - name: Delete the temporary keychain
        if: always()
        run: |`,
      `      - name: Delete the temporary keychain
        run: |`,
    );
    const result = auditReleaseWorkflow(yml);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([expect.stringMatching(/not guarded by "if: always\(\)"/)]);
  });

  it('flags a build step missing -c.mac.notarize=true', () => {
    const yml = CLEAN_WORKFLOW.replace('-c.mac.notarize=true', '');
    const result = auditReleaseWorkflow(yml);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([expect.stringMatching(/-c\.mac\.notarize=true/)]);
  });

  it('flags a build step missing -c.mac.identity=', () => {
    const yml = CLEAN_WORKFLOW.replace('-c.mac.identity="$IDENTITY_NAME" ', '');
    const result = auditReleaseWorkflow(yml);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([expect.stringMatching(/-c\.mac\.identity=/)]);
  });

  it('flags a bare echo/printf of an APPLE_* secret with no pipe or redirect', () => {
    const yml = CLEAN_WORKFLOW.replace(
      'security create-keychain -p "x" "$KEYCHAIN_PATH"',
      'security create-keychain -p "x" "$KEYCHAIN_PATH"\n          echo "$APPLE_CERT_PASSWORD"',
    );
    const result = auditReleaseWorkflow(yml);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([expect.stringMatching(/echo\/printf/)]);
  });

  it('does not flag the printf that pipes the base64 cert into a decode + redirect', () => {
    // Sanity check for the fixture above: the clean fixture's own printf of
    // APPLE_CERT_P12_BASE64 (piped to base64, redirected to a file) must not trip this rule.
    const result = auditReleaseWorkflow(CLEAN_WORKFLOW);
    expect(result.problems.some((p) => /echo\/printf/.test(p))).toBe(false);
  });

  it('flags a "secrets.APPLE_*" reference outside an env: mapping', () => {
    const yml = CLEAN_WORKFLOW.replace(
      '      - name: Verify signing secrets',
      "      - if: ${{ secrets.APPLE_ID != '' }}\n        name: Verify signing secrets",
    );
    const result = auditReleaseWorkflow(yml);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([expect.stringMatching(/secrets\.APPLE_.*outside an env: mapping/)]);
  });

  it('flags a multi-line run: block touching "security" that is missing "set -euo pipefail" as its first line', () => {
    const yml = CLEAN_WORKFLOW.replace(
      `      - name: Import signing certificate (temporary keychain)
        run: |
          set -euo pipefail
          KEYCHAIN_PATH=`,
      `      - name: Import signing certificate (temporary keychain)
        run: |
          KEYCHAIN_PATH=`,
    );
    const result = auditReleaseWorkflow(yml);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([expect.stringMatching(/missing "set -euo pipefail"/)]);
  });

  it('handles a workflow with no steps: list at all without crashing', () => {
    const result = auditReleaseWorkflow('name: Empty\non: push\n');
    expect(result.ok).toBe(false);
    expect(result.problems.length).toBeGreaterThan(0);
  });

  it('falls back to "unnamed step" when the offending run: block has no name:', () => {
    const yml = `jobs:
  release:
    runs-on: macos-14
    steps:
      - run: |
          security delete-keychain "$KEYCHAIN_PATH"
`;
    const result = auditReleaseWorkflow(yml);
    expect(result.problems).toContainEqual(expect.stringMatching(/"unnamed step" run: block/));
  });
});

const releaseWorkflowPath = fileURLToPath(new URL('../../../.github/workflows/release.yml', import.meta.url));
const hasReleaseWorkflow = existsSync(releaseWorkflowPath);

describe.runIf(hasReleaseWorkflow)('the real .github/workflows/release.yml (#624)', () => {
  it('passes the audit', () => {
    const yml = readFileSync(releaseWorkflowPath, 'utf8');
    const result = auditReleaseWorkflow(yml);
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
