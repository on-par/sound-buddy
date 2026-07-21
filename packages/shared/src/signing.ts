// Developer ID signing + notarization decision logic (#53). Pure functions
// only — no fs/child_process here. release.sh and app/build/afterPack.js are
// thin shells that call these and act on the result.

const SIGNING_IDENTITY_VAR = 'SOUND_BUDDY_SIGNING_IDENTITY';
const NOTARY_PROFILE_VAR = 'SOUND_BUDDY_NOTARY_PROFILE';
const APPLE_ID_VAR = 'APPLE_ID';
const APPLE_TEAM_ID_VAR = 'APPLE_TEAM_ID';
const APPLE_APP_SPECIFIC_PASSWORD_VAR = 'APPLE_APP_SPECIFIC_PASSWORD';

// electron-builder rejects a `mac.identity` that carries this prefix ("Please remove
// prefix ... — appropriate certificate will be chosen automatically"), while `codesign -s`
// wants the full string. One env var, two derived forms (#619). No trailing space on the
// constant — matching without it and trimming what follows tolerates a missing/extra space
// after the colon instead of double-prefixing when the exact "prefix + one space" isn't there.
const DEVELOPER_ID_PREFIX = 'Developer ID Application:';

// A fresh CI runner has no stored notarytool keychain profile, so it
// authenticates with discrete App Store Connect credentials instead (#624).
// release.sh keeps using the keychain-profile route (see docs/signing-and-notarization.md).
export type NotaryAuth =
  | { kind: 'keychain-profile'; profile: string }
  | { kind: 'app-store-connect'; appleId: string; teamId: string; appSpecificPassword: string };

export interface SigningConfig {
  signed: boolean;
  /** Full `Developer ID Application: Name (TEAMID)` string — what `codesign -s` expects. */
  identity?: string;
  /** Identity with the `Developer ID Application: ` prefix stripped — what electron-builder's `mac.identity` expects. */
  identityName?: string;
  /** Kept for back-compat with release.sh's `$NOTARY_PROFILE` reads — set only on the keychain-profile route. */
  notaryProfile?: string;
  notaryAuth?: NotaryAuth;
}

function trimmedOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function deriveIdentityForms(raw: string): { identity: string; identityName: string } {
  const identityName = raw.startsWith(DEVELOPER_ID_PREFIX) ? raw.slice(DEVELOPER_ID_PREFIX.length).trim() : raw;
  return { identity: `${DEVELOPER_ID_PREFIX} ${identityName}`, identityName };
}

export function resolveSigningConfig(env: Record<string, string | undefined>): SigningConfig {
  const identity = trimmedOrUndefined(env[SIGNING_IDENTITY_VAR]);
  const notaryProfile = trimmedOrUndefined(env[NOTARY_PROFILE_VAR]);
  const appleId = trimmedOrUndefined(env[APPLE_ID_VAR]);
  const teamId = trimmedOrUndefined(env[APPLE_TEAM_ID_VAR]);
  const appSpecificPassword = trimmedOrUndefined(env[APPLE_APP_SPECIFIC_PASSWORD_VAR]);
  const ascComplete = Boolean(appleId && teamId && appSpecificPassword);
  const anyNotaryHintPresent = Boolean(notaryProfile || appleId || teamId || appSpecificPassword);

  if (identity && notaryProfile) {
    const { identity: fullIdentity, identityName } = deriveIdentityForms(identity);
    return {
      signed: true,
      identity: fullIdentity,
      identityName,
      notaryProfile,
      notaryAuth: { kind: 'keychain-profile', profile: notaryProfile },
    };
  }

  if (identity && ascComplete) {
    const { identity: fullIdentity, identityName } = deriveIdentityForms(identity);
    return {
      signed: true,
      identity: fullIdentity,
      identityName,
      notaryAuth: {
        kind: 'app-store-connect',
        appleId: appleId as string,
        teamId: teamId as string,
        appSpecificPassword: appSpecificPassword as string,
      },
    };
  }

  if (!identity && !anyNotaryHintPresent) {
    return { signed: false };
  }

  if (!identity) {
    throw new Error(
      `${SIGNING_IDENTITY_VAR} is missing — both ${SIGNING_IDENTITY_VAR} and ${NOTARY_PROFILE_VAR} are required to ` +
        `produce a Developer ID-signed, notarized release, or neither to build unsigned. Set ${SIGNING_IDENTITY_VAR} ` +
        `(see docs/signing-and-notarization.md) or unset the other variable.`,
    );
  }

  const missingAscVars = [
    !appleId && APPLE_ID_VAR,
    !teamId && APPLE_TEAM_ID_VAR,
    !appSpecificPassword && APPLE_APP_SPECIFIC_PASSWORD_VAR,
  ].filter((v): v is string => Boolean(v));

  throw new Error(
    `${SIGNING_IDENTITY_VAR} is set but notary credentials are incomplete — missing ${missingAscVars.join(', ')}. ` +
      `Either set ${NOTARY_PROFILE_VAR} (local: see docs/signing-and-notarization.md) or set all of ` +
      `${APPLE_ID_VAR}, ${APPLE_TEAM_ID_VAR}, ${APPLE_APP_SPECIFIC_PASSWORD_VAR} (CI), or unset ${SIGNING_IDENTITY_VAR} ` +
      `to build unsigned.`,
  );
}

// Mach-O / universal-binary magic numbers (big-endian as they appear in the
// file's first 4 bytes). Named per otool/mach-o/loader.h conventions.
const MH_MAGIC = 0xfeedface; // 32-bit Mach-O
const MH_MAGIC_64 = 0xfeedfacf; // 64-bit Mach-O
const FAT_MAGIC = 0xcafebabe; // 32-bit universal binary
const FAT_MAGIC_64 = 0xbebafeca; // 64-bit universal binary
const MH_CIGAM = 0xcefaedfe; // byte-swapped 32-bit Mach-O (opposite endianness)
const MH_CIGAM_64 = 0xcffaedfe; // byte-swapped 64-bit Mach-O (opposite endianness)

const MACHO_MAGICS = new Set([MH_MAGIC, MH_MAGIC_64, FAT_MAGIC, FAT_MAGIC_64, MH_CIGAM, MH_CIGAM_64]);

export function isMachOBinary(header: Uint8Array): boolean {
  if (header.length < 4) return false;
  const magic = ((header[0] << 24) | (header[1] << 16) | (header[2] << 8) | header[3]) >>> 0;
  return MACHO_MAGICS.has(magic);
}

// afterPack signs ~262 nested Mach-O binaries. One `codesign` process per file
// means 262 process spawns and 262 Apple timestamp-server round trips (#620).
// `codesign` accepts many paths per invocation, so batching collapses that to a
// handful of calls. The cap is a compromise: large enough to matter, small
// enough to stay well under ARG_MAX and to keep a failure's error message
// pointing at a small set of files.
export const CODESIGN_BATCH_SIZE = 32;

/**
 * Split `paths` into batches for `codesign`, preserving order.
 * Returns [] for an empty input. Throws on a non-positive batch size.
 */
export function planCodesignBatches(paths: readonly string[], batchSize = CODESIGN_BATCH_SIZE): string[][] {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error(`planCodesignBatches: batchSize must be a positive integer, got ${batchSize}`);
  }

  const batches: string[][] = [];
  for (let i = 0; i < paths.length; i += batchSize) {
    batches.push(paths.slice(i, i + batchSize));
  }
  return batches;
}

export interface SpctlVerdict {
  accepted: boolean;
  error?: string;
}

const SPCTL_ACCEPTED_LINE = /:\s*accepted\s*$/m;

export function parseSpctlAssessment(output: string): SpctlVerdict {
  if (SPCTL_ACCEPTED_LINE.test(output)) {
    return { accepted: true };
  }

  return {
    accepted: false,
    error:
      `Gatekeeper did not accept the build — it will be blocked on a fresh macOS install. Check that ` +
      `notarization and stapling completed. spctl output:\n${output}`,
  };
}

export interface StaplerVerdict {
  stapled: boolean;
  error?: string;
}

// `xcrun stapler validate` prints this line when a ticket is present and valid.
// Anything else (missing ticket, "The validate action failed! Error 65") is a
// failure: without a stapled ticket, first launch breaks for offline users
// because Gatekeeper can't reach Apple to look the ticket up.
const STAPLER_VALID_LINE = /The validate action worked!/;

export function parseStaplerValidation(output: string): StaplerVerdict {
  if (STAPLER_VALID_LINE.test(output)) {
    return { stapled: true };
  }

  return {
    stapled: false,
    error:
      'no valid notarization ticket is stapled to the app — offline first launch will be ' +
      'blocked by Gatekeeper. Confirm electron-builder ran notarization (mac.notarize must ' +
      'not be false and APPLE_KEYCHAIN_PROFILE must be set), then re-run the build. ' +
      `stapler output:\n${output}`,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface ParsedCodesigningIdentity {
  identity?: string;
  error?: string;
}

/**
 * Extracts the full "Developer ID Application: … (TEAM)" string from
 * `security find-identity -v -p codesigning` output, scoped to `teamId` so a
 * keychain holding other certificates doesn't pick the wrong one.
 */
export function parseCodesigningIdentity(output: string, teamId: string): ParsedCodesigningIdentity {
  const pattern = new RegExp(`"(Developer ID Application: [^"]*\\(${escapeRegExp(teamId)}\\))"`, 'g');
  const matches = new Set<string>();
  for (const match of output.matchAll(pattern)) {
    matches.add(match[1]);
  }
  const identities = Array.from(matches);

  if (identities.length === 0) {
    return {
      error:
        `no "Developer ID Application: … (${teamId})" certificate found in the signing keychain — check ` +
        `APPLE_CERT_P12_BASE64 exports the Developer ID Application certificate *and* its private key, and ` +
        `that APPLE_TEAM_ID matches the certificate. find-identity output:\n${output}`,
    };
  }

  if (identities.length > 1) {
    return {
      error:
        `ambiguous — multiple "Developer ID Application: … (${teamId})" certificates found in the signing ` +
        `keychain: ${identities.join(', ')}. Export a single Developer ID Application certificate into ` +
        `APPLE_CERT_P12_BASE64 (see docs/signing-and-notarization.md).`,
    };
  }

  return { identity: identities[0] };
}

export const REDACTED = '***';

/** Replaces every occurrence of each secret with `REDACTED` so a thrown command's message can be logged safely. */
export function redactSecrets(text: string, secrets: readonly (string | undefined)[]): string {
  let result = text;
  for (const secret of secrets) {
    if (!secret || secret.trim().length === 0) continue;
    result = result.split(secret).join(REDACTED);
  }
  return result;
}
