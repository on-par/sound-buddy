// DMG notarization decision logic (#622). Pure functions only — no
// fs/child_process here. app/build/afterAllArtifactBuild.js is a thin shell
// that calls these and acts on the result, mirroring the signing.ts ⇄
// afterPack.js split (#53).
//
// electron-builder 24's notarizeIfProvided() only notarizes+staples the
// .app (inside its sign phase, before the dmg target is built), so a DMG
// carries no ticket of its own unless something submits + staples it
// separately after the build — that "something" is this module's plan,
// executed by afterAllArtifactBuild.js.

export const DMG_EXTENSION = '.dmg';
export const KEYCHAIN_PROFILE_VAR = 'APPLE_KEYCHAIN_PROFILE';

const DMG_EXTENSION_PATTERN = /\.dmg$/i;

/** Filter electron-builder's artifactPaths down to real .dmg files (drops .dmg.blockmap). */
export function selectDmgArtifacts(artifactPaths: readonly string[]): string[] {
  return artifactPaths.filter((path) => DMG_EXTENSION_PATTERN.test(path));
}

export interface DmgNotarizationStep {
  dmgPath: string;
  /** argv for `xcrun` — notarytool submit --wait */
  submitArgs: string[];
  /** argv for `xcrun` — stapler staple */
  stapleArgs: string[];
}

export type DmgNotarizationPlan =
  | { notarize: false; reason: string }
  | { notarize: true; steps: DmgNotarizationStep[] };

function trimmedOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function planDmgNotarization(
  artifactPaths: readonly string[],
  env: Record<string, string | undefined>,
): DmgNotarizationPlan {
  const profile = trimmedOrUndefined(env[KEYCHAIN_PROFILE_VAR]);
  if (!profile) {
    return {
      notarize: false,
      reason:
        `${KEYCHAIN_PROFILE_VAR} not set — skipping DMG notarization (unsigned build). Set ` +
        `SOUND_BUDDY_SIGNING_IDENTITY + SOUND_BUDDY_NOTARY_PROFILE and release via ` +
        `scripts/release.sh to produce a notarized DMG (docs/signing-and-notarization.md).`,
    };
  }

  const dmgPaths = selectDmgArtifacts(artifactPaths);
  if (dmgPaths.length === 0) {
    return {
      notarize: false,
      reason:
        `${KEYCHAIN_PROFILE_VAR} is set but no .dmg was found in the build output — check that ` +
        `mac.target includes "dmg" in app/electron-builder.yml.`,
    };
  }

  return {
    notarize: true,
    steps: dmgPaths.map((dmgPath) => ({
      dmgPath,
      submitArgs: ['notarytool', 'submit', dmgPath, '--keychain-profile', profile, '--wait'],
      stapleArgs: ['stapler', 'staple', dmgPath],
    })),
  };
}
