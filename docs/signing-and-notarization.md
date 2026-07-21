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
5. Submits to Apple's notary service and waits
   (`xcrun notarytool submit --wait`).
6. Staples the notarization ticket (`xcrun stapler staple`) and re-zips the
   stapled `.app`.
7. Assesses the result with Gatekeeper (`spctl --assess --verbose=4`) and
   aborts the release if it isn't accepted.

## Manual verification (acceptance criteria)

On a fresh macOS install (or a machine that has never opened this app):

1. Download the release zip, unzip it, and open **Sound Buddy.app** — there
   should be no Gatekeeper prompt.
2. `spctl --assess --type execute --verbose=4 "/Applications/Sound Buddy.app"`
   prints `accepted`.
3. `codesign -dv --verbose=4 "/Applications/Sound Buddy.app"` shows the
   Developer ID Application certificate.

## Troubleshooting

If notarization comes back `Invalid` or `Rejected`, the error from
`scripts/release.sh` includes the exact command to see why:

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
