# Developer ID signing + notarization (#53)

Publishing a Developer ID-signed, notarized build requires a one-time human
setup (Apple Developer Program enrollment, certificate creation, notary
credentials), documented below. Once done, every future `scripts/release.sh`
run produces a signed, notarized, stapled build automatically.

## One-time setup

1. Enroll in the [Apple Developer Program](https://developer.apple.com/programs/)
   ($99/yr). Team consensus on doing this is recorded in #53.

2. Create a **Developer ID Application** certificate: Xcode → Settings →
   Accounts → Manage Certificates, or
   [developer.apple.com/account/resources/certificates](https://developer.apple.com/account/resources/certificates).
   Confirm it appears locally:

   ```bash
   security find-identity -v -p codesigning
   ```

3. Create an app-specific password at [appleid.apple.com](https://appleid.apple.com),
   then store notary credentials once (this writes to your keychain, not to
   any file in this repo):

   ```bash
   xcrun notarytool store-credentials sound-buddy-notary \
     --apple-id <apple-id> \
     --team-id <TEAMID> \
     --password <app-specific-password>
   ```

## Releasing signed

```bash
SOUND_BUDDY_SIGNING_IDENTITY="Developer ID Application: <Your Name> (<TEAMID>)" \
SOUND_BUDDY_NOTARY_PROFILE=sound-buddy-notary \
scripts/release.sh
```

Both variables must be set together — set one without the other and
`scripts/release.sh` fails fast with an actionable message. Leave both unset
to build the existing unsigned, self-contained flow unchanged.

## Signing in CI (#624)

`.github/workflows/release.yml` signs and notarizes every tagged release the
same way `scripts/release.sh` does locally, but a GitHub Actions runner is
fresh on every run — it has no keychain with a certificate already imported,
and no stored `notarytool` keychain profile. The workflow authenticates
notarization with `--apple-id`/`--team-id`/`--password` instead of
`--keychain-profile`, and it imports the certificate into a **temporary,
randomly-named keychain** at the start of the job, then deletes it at the end
(even on failure). The login keychain is never touched.

Set these five repository secrets under **Settings → Secrets and variables →
Actions**:

| Secret | Value |
| --- | --- |
| `APPLE_CERT_P12_BASE64` | The Developer ID Application certificate **and its private key**, exported as a `.p12` and base64-encoded |
| `APPLE_CERT_PASSWORD` | The password used to protect that `.p12` on export |
| `APPLE_ID` | The On PAR Dev business Apple ID used for notarization |
| `APPLE_TEAM_ID` | `Q7LB49TPBS` |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password for `APPLE_ID`, created at [appleid.apple.com](https://appleid.apple.com) |

To produce `APPLE_CERT_P12_BASE64`: open Keychain Access, find the Developer
ID Application certificate (it must show the disclosure triangle with its
private key underneath — exporting the certificate alone is not enough),
select both, choose **File → Export Items…**, save as a `.p12`, then:

```bash
base64 -i cert.p12 | pbcopy
```

Paste the clipboard contents directly into the `APPLE_CERT_P12_BASE64` secret.

If any of the five secrets is missing, the workflow's "Verify signing
secrets" step fails the job immediately, before any build work runs — CI
never silently falls back to an unsigned build. `packages/shared/src/release-workflow.ts`
statically audits the workflow file itself (temporary-keychain-only,
guaranteed cleanup, no secret ever logged) so a future edit to
`release.yml` that reintroduces one of these problems fails its own test.

## What the pipeline does automatically

Given both env vars, `scripts/release.sh`:

1. Confirms the certificate is present in the keychain before spending time
   on a build.
2. Builds with `-c.mac.identity` overriding `electron-builder.yml`'s
   `identity: null`, with hardened runtime + entitlements
   (`app/build/entitlements.mac.plist`) enabled — passed as the bare
   certificate name (electron-builder rejects the `Developer ID Application:`
   prefix), while `afterPack.js` receives the full string via
   `SOUND_BUDDY_SIGNING_IDENTITY`.
3. `app/build/afterPack.js` signs every bundled Mach-O (sox, ffmpeg, ffprobe,
   their dylibs, the Python runtime) with the Developer ID identity, batching
   the `codesign` calls so ~262 binaries take a handful of invocations instead
   of one each; electron-builder's own sign phase then signs the frameworks,
   helpers, and outer `.app`. That phase is scoped by `mac.signIgnore` in
   `electron-builder.yml` to skip `Contents/Resources/{python,bin,lib,scripts,
   engine,license-policy,scene-inspector,assets}`, since afterPack already
   signed every Mach-O there and none of the thousands of other files in those
   trees (`.py`, `.pyc`, `.json`, `.txt`, …) are Mach-O or carry a signature of
   their own — walking them individually is what made a signed build take
   ~45 minutes (#620).
4. Verifies the signature (`codesign --verify --deep --strict`).
5. electron-builder submits the signed `.app` to Apple's notary service and
   staples the returned ticket itself (`mac.notarize`, credentials passed as
   `APPLE_KEYCHAIN_PROFILE`) — this happens inside its sign phase, before the
   zip target is built, so the shipped zip always contains a stapled app (#621).
6. Validates the stapled ticket (`xcrun stapler validate`) and aborts if it
   isn't there.
7. Assesses the result with Gatekeeper (`spctl --assess --verbose=4`) and
   aborts the release if it isn't accepted.

## The signed, notarized DMG (#622)

electron-builder 24 notarizes and staples only the `.app` — its
`notarizeIfProvided()` call runs inside the sign phase, before any target
(zip, dmg) is built, and is passed the `.app` path only. The DMG built
afterwards therefore contains a stapled app but carries no notarization
ticket of its own, so `xcrun stapler validate` against the `.dmg` fails
unless something submits and staples the DMG separately.

`app/build/afterAllArtifactBuild.js` does that: it runs once all artifacts
are built, uses `packages/shared`'s `planDmgNotarization()` to decide what to
do, and — if `APPLE_KEYCHAIN_PROFILE` is set — runs `xcrun notarytool submit
--wait` and `xcrun stapler staple` against each `.dmg` electron-builder
produced. All decision logic (which env var gates this, which files count as
a `.dmg`) is a pure function in `packages/shared/src/dmg-notarization.ts`;
the hook itself is a thin shell, mirroring the `signing.ts` ⇄ `afterPack.js`
split. Unsigned builds (no `APPLE_KEYCHAIN_PROFILE`) skip this step silently
— the DMG still builds, just unnotarized.

`scripts/release.sh` verifies the result the same way it verifies the app:
`xcrun stapler validate` and `spctl --assess --type open --context
context:primary-signature` against the `.dmg`, before pushing or publishing.

## Manual verification (acceptance criteria)

On a fresh macOS install (or a machine that has never opened this app):

1. Download the release zip, unzip it, and open **Sound Buddy.app** — there
   should be no Gatekeeper prompt.
2. `spctl --assess --type execute --verbose=4 "/Applications/Sound Buddy.app"`
   prints `accepted`.
3. `codesign -dv --verbose=4 "/Applications/Sound Buddy.app"` shows the
   Developer ID Application certificate.
4. `xcrun stapler validate "/Applications/Sound Buddy.app"` prints "The
   validate action worked!".
5. Download the release `.dmg`, open it — the window shows **Sound Buddy.app**
   next to an `/Applications` shortcut for drag-to-install, with no Gatekeeper
   prompt.
6. `xcrun stapler validate "Sound Buddy-<version>-arm64.dmg"` prints "The
   validate action worked!".

## Troubleshooting

If notarization comes back `Invalid` or `Rejected`, electron-builder prints the
submission id and the failure output directly, and `scripts/release.sh`'s
`die` message repeats the exact command to see why:

```bash
xcrun notarytool log <submission-id> --keychain-profile sound-buddy-notary
```

The most common cause is an unsigned nested Mach-O binary. `afterPack.js`
signs everything under `Contents/Resources/bin`, `lib`, and `python` — if a
new bundled binary lands somewhere else, add that directory to its walk list.

If a future bundled tool lands in a **new** `Contents/Resources` subdirectory
containing Mach-O, it must either be covered by `afterPack.js`'s walk (so it
gets signed) or left out of `mac.signIgnore` in `electron-builder.yml` (so
electron-builder's sign phase catches it instead) — otherwise notarization
will reject the build with an unsigned-nested-code error.
