# electron-builder 26 packaging, signing & notarization verification (#1226)

This is a one-time human gate following the #1227 Electron 31→44 / electron-builder 24→26
upgrade. It is run **once**, by someone with the Developer ID Application certificate and a
stored `sound-buddy-notary` keychain profile on their Mac, and it produces **no public
release** — `scripts/release.sh` Phase B is never reached.

## Security

Never paste the Developer ID certificate, the app-specific password, any `APPLE_*` value, or
notarytool credentials into this doc, a PR, chat, or logs. Reference environment variable names
only.

## Preconditions

- One-time setup from [`docs/signing-and-notarization.md`](./signing-and-notarization.md) is
  complete: `security find-identity -v -p codesigning` shows the Developer ID Application
  certificate, and the `sound-buddy-notary` notarytool keychain profile exists.
- `sox`, `dylibbundler`, `ffmpeg`, and the Xcode Command Line Tools are on the build machine —
  `app/build/afterPack.js` requires all four.
- No stray `APPLE_ID` is set in the shell — it would take precedence over the keychain-profile
  route (see `docs/signing-and-notarization.md`).

## Ordered steps

1. `./scripts/verify.sh --no-e2e` — the gate for a packaging change.
2. Preflight, mutates nothing:
   ```bash
   SOUND_BUDDY_SIGNING_IDENTITY="Developer ID Application: … (Q7LB49TPBS)" \
     SOUND_BUDDY_NOTARY_PROFILE=sound-buddy-notary scripts/release.sh --dry-run
   ```
3. The real signed build. Because this is a verification build and **not** a publish, run
   electron-builder directly rather than letting `scripts/release.sh` reach Phase B:
   ```bash
   cd app && SOUND_BUDDY_SIGNING_IDENTITY="…" SOUND_BUDDY_NOTARY_PROFILE=sound-buddy-notary \
     APPLE_KEYCHAIN_PROFILE=sound-buddy-notary \
     npm run dist -- -c.mac.identity="<name-without-the-Developer ID Application: prefix>" \
     -c.mac.notarize=true
   ```
   This is the exact command `scripts/release.sh` Phase A issues, minus the release notes
   override. It exercises `afterPack.js` (sox/ffprobe/ffmpeg + dylibs + relocatable Python, then
   batched `codesign`) and `afterAllArtifactBuild.js` (DMG submit + staple) unchanged.
4. Bundled-toolchain resolution inside the packaged `.app`:
   ```bash
   APP="app/release/mac-arm64/Sound Buddy.app/Contents/Resources"
   "$APP/bin/sox" --version && "$APP/bin/ffprobe" -version && "$APP/bin/ffmpeg" -version
   "$APP/python/bin/python3" -c 'import numpy, soundfile, sounddevice; print(numpy.__version__)'
   otool -L "$APP/bin/ffprobe"   # every non-system ref must be @executable_path/../lib/…
   ```
   `afterPack.js`'s `verifyTrimmedMediaLibs` already gates banned video dylibs, dangling refs,
   and a real decode of every `MEDIA_FIXTURE_FORMAT` at build time — this step confirms the same
   binaries still run *after* signing and notarization, from inside the bundle.
5. `codesign --verify --deep --strict --verbose=4 "app/release/mac-arm64/Sound Buddy.app"`
6. `xcrun stapler validate "app/release/mac-arm64/Sound Buddy.app"` → expect "The validate action
   worked!" (**AC2**).
7. `spctl -a -vvv -t open "app/release/Sound.Buddy-<version>-arm64.dmg"` → expect `accepted` and
   `source=Notarized Developer ID` (**AC1**). `scripts/release.sh` now enforces this exact source
   string via `parseSpctlAssessment`.
8. Install from the DMG to `/Applications`, launch, confirm no Gatekeeper prompt, and run one
   analysis end-to-end on a real recording using the bundled toolchain (**AC3**).
9. Updater feed: confirm the build's `app/release/latest-mac.yml` names the dotted
   `Sound.Buddy-<version>-arm64-mac.zip` and carries a sha512 matching the built zip — this is
   what `scripts/release.sh` now checks automatically via `checkUpdateFeed`. Re-run
   `scripts/release.sh --dry-run` or read the Phase A log line
   `latest-mac.yml: consistent with the built artifacts`. Then, in the installed app, trigger an
   update check and confirm it resolves the feed with no signature or sha512 error (**AC4**).
   Publishing a release is out of scope — an update check against the current published feed is
   sufficient.

## Results

| AC | Command | Result (PASS/FAIL) | Notes |
| --- | --- | --- | --- |
| AC1 — DMG spctl reports `source=Notarized Developer ID` | `spctl --assess --type open --context context:primary-signature --verbose=4 "app/release/Sound.Buddy-0.8.30-arm64.dmg"` | PASS | 2026-08-30 on the mini: `accepted`, `source=Notarized Developer ID`. |
| AC2 — stapler validate on the `.app` | `xcrun stapler validate "app/release/mac-arm64/Sound Buddy.app"` | PASS | 2026-08-30 on the mini: `The validate action worked!`. |
| AC3 — clean launch from `/Applications` + one analysis | `npx playwright test --config=playwright.config.ts tests/packaged.spec.ts` | PASS | 2026-08-30 on the mini: packaged app extracted from release zip, launched with Homebrew/system tools removed from `PATH`, analyzed `silence.wav`, and confirmed no Python bytecode was written into the signed bundle. |
| AC4 — updater feed resolves with no signature/sha512 error | `node scripts/ci-update-feed.mjs` and `scripts/release.sh 0.9.0 --dry-run` | PASS | 2026-08-30 on the mini: `latest-mac.yml: consistent with the built artifacts (4 checked)`; `v0.9.0` release dry run passed. |

## electron-builder 26 configuration changes required

Record any change this run forced, or write "none — the #1227 config carried over unchanged".
A change lands in one of:

- `app/electron-builder.yml`
- `app/build/afterPack.js`
- `app/build/afterAllArtifactBuild.js`

2026-08-30 result: `app/build/afterPack.js` now prunes Python bytecode from the copied app
resources on every build, and spawned Python subprocesses set `PYTHONDONTWRITEBYTECODE=1`.
The packaged-app smoke test now fails if analysis leaves `__pycache__` or `.pyc` files in the
signed bundle.

## Blocking rule + sign-off

The first public release on the electron-builder 26 toolchain does not cut until every row above
reads PASS. Any FAIL is filed as a P0 against #1226 with the failing command and its output
(secrets redacted), and the release stays held.
