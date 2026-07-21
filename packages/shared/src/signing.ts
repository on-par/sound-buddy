// Developer ID signing + notarization decision logic (#53). Pure functions
// only — no fs/child_process here. release.sh and app/build/afterPack.js are
// thin shells that call these and act on the result.

const SIGNING_IDENTITY_VAR = 'SOUND_BUDDY_SIGNING_IDENTITY';
const NOTARY_PROFILE_VAR = 'SOUND_BUDDY_NOTARY_PROFILE';

// electron-builder rejects a `mac.identity` that carries this prefix ("Please remove
// prefix ... — appropriate certificate will be chosen automatically"), while `codesign -s`
// wants the full string. One env var, two derived forms (#619). No trailing space on the
// constant — matching without it and trimming what follows tolerates a missing/extra space
// after the colon instead of double-prefixing when the exact "prefix + one space" isn't there.
const DEVELOPER_ID_PREFIX = 'Developer ID Application:';

export interface SigningConfig {
  signed: boolean;
  /** Full `Developer ID Application: Name (TEAMID)` string — what `codesign -s` expects. */
  identity?: string;
  /** Identity with the `Developer ID Application: ` prefix stripped — what electron-builder's `mac.identity` expects. */
  identityName?: string;
  notaryProfile?: string;
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

  if (identity && notaryProfile) {
    const { identity: fullIdentity, identityName } = deriveIdentityForms(identity);
    return { signed: true, identity: fullIdentity, identityName, notaryProfile };
  }

  if (!identity && !notaryProfile) {
    return { signed: false };
  }

  const missing = identity ? NOTARY_PROFILE_VAR : SIGNING_IDENTITY_VAR;
  throw new Error(
    `${missing} is missing — both ${SIGNING_IDENTITY_VAR} and ${NOTARY_PROFILE_VAR} are required to ` +
      `produce a Developer ID-signed, notarized release, or neither to build unsigned. Set ${missing} ` +
      `(see docs/signing-and-notarization.md) or unset the other variable.`,
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

export interface NotarySubmissionResult {
  ok: boolean;
  id?: string;
  status?: string;
  error?: string;
}

export function parseNotarySubmission(jsonText: string, notaryProfile: string): NotarySubmissionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return {
      ok: false,
      error:
        'could not parse `xcrun notarytool submit` output — re-run it manually and check your notary ' +
        `credentials: xcrun notarytool submit <zip> --keychain-profile ${notaryProfile} --wait`,
    };
  }

  const v = parsed as Record<string, unknown>;
  const status = typeof v.status === 'string' ? v.status : undefined;
  const id = typeof v.id === 'string' ? v.id : undefined;

  if (status === 'Accepted') {
    return { ok: true, id, status };
  }

  return {
    ok: false,
    error:
      `notarization did not succeed (status: ${status ?? 'unknown'}, submission ${id ?? 'unknown'}) — ` +
      `see why with: xcrun notarytool log ${id ?? '<submission-id>'} --keychain-profile ${notaryProfile}`,
  };
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
