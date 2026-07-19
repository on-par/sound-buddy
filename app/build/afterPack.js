// electron-builder afterPack hook — makes the macOS .app fully self-contained.
//
// The app shells out to sox, ffprobe and a Python interpreter (librosa/numpy/…).
// None of those ship with macOS, so a download-only user hit "spawn sox ENOENT".
// This hook bundles them INTO the app so it runs with zero external setup:
//
//   Contents/Resources/bin/{sox,ffprobe}   native tools (dylibs relocated to ../lib)
//   Contents/Resources/lib/*.dylib         their shared libraries
//   Contents/Resources/python/bin/python3  relocatable CPython + audio deps
//
// Requires on the BUILD machine: sox, ffprobe (Homebrew), dylibbundler, curl.
// ipc.ts resolves these paths via process.resourcesPath when app.isPackaged.

const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

// Pinned relocatable CPython (python-build-standalone). Bump deliberately.
const PY_TAG = '20260623';
const PY_VERSION = '3.12.13';
const PY_ASSET = `cpython-${PY_VERSION}+${PY_TAG}-aarch64-apple-darwin-install_only.tar.gz`;
const PY_URL = `https://github.com/astral-sh/python-build-standalone/releases/download/${PY_TAG}/${PY_ASSET}`;

function sh(cmd, opts = {}) {
  // Capture stderr (don't inherit) so benign tool chatter stays quiet; execSync
  // throws with stderr attached on failure, so real errors still surface.
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...opts }).trim();
}
function log(msg) {
  console.log(`  • [self-contained] ${msg}`);
}

module.exports = async function afterPack(context) {
  // Only the macOS build is self-contained; skip other platforms outright.
  if (context.electronPlatformName !== 'darwin') return;

  // The monorepo is always present on the build machine (scriptsDir below
  // already reaches into packages/audio-engine). packages/shared/dist is
  // ESM, and this file is CJS, so a dynamic import is required to reach it.
  const shared = await import(
    pathToFileURL(path.join(__dirname, '..', '..', 'packages', 'shared', 'dist', 'index.js')).href
  );
  const signing = shared.resolveSigningConfig(process.env);

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);
  const resources = path.join(appPath, 'Contents', 'Resources');
  const binDir = path.join(resources, 'bin');
  const libDir = path.join(resources, 'lib');
  const scriptsDir = path.join(__dirname, '..', '..', 'packages', 'audio-engine', 'scripts');
  const requirements = path.join(scriptsDir, 'requirements.txt');

  // Build cache (gitignored) so repeat local builds don't re-download / re-pip.
  const cacheRoot = path.join(__dirname, '..', '.build-cache');
  fs.mkdirSync(cacheRoot, { recursive: true });

  // ── 1. Native tools: sox + ffprobe with their dylibs ──────────────────────
  log('bundling sox + ffprobe + ffmpeg');
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(libDir, { recursive: true });
  // ffmpeg shares ffprobe's dylibs (dylibbundler dedups), so it adds almost no
  // size but lets librosa/audioread decode m4a/aac when soundfile can't.
  for (const tool of ['sox', 'ffprobe', 'ffmpeg']) {
    const src = sh(`command -v ${tool}`);
    if (!src) throw new Error(`afterPack: "${tool}" not found on build machine (brew install sox ffmpeg)`);
    const dest = path.join(binDir, tool);
    fs.copyFileSync(fs.realpathSync(src), dest);
    fs.chmodSync(dest, 0o755);
    // dylibbundler copies every non-system dylib into libDir and rewrites the
    // binary's load paths to @executable_path/../lib, then re-signs ad-hoc.
    // stderr piped (not inherited): install_name_tool prints benign
    // "will invalidate the code signature" notes that dylibbundler then fixes
    // by re-signing. Throws (with output) only on real failure.
    execFileSync('dylibbundler', [
      '-of', '-cd', '-b',
      '-x', dest,
      '-d', libDir + path.sep,
      '-p', '@executable_path/../lib/',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
  }
  log(`native libs bundled (${fs.readdirSync(libDir).length} dylibs)`);

  // ── 2. Relocatable Python with the audio-engine deps ──────────────────────
  const reqHash = crypto.createHash('sha256')
    .update(PY_ASSET + '\n' + fs.readFileSync(requirements))
    .digest('hex').slice(0, 12);
  const pyCache = path.join(cacheRoot, `python-${PY_VERSION}-${reqHash}`);

  if (!fs.existsSync(path.join(pyCache, 'bin', 'python3'))) {
    log('assembling Python runtime (download + pip install; cached afterwards)');
    fs.rmSync(pyCache, { recursive: true, force: true });
    const tmp = path.join(cacheRoot, `tmp-${reqHash}`);
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    const tarball = path.join(cacheRoot, PY_ASSET);
    if (!fs.existsSync(tarball)) {
      sh(`curl -fsSL "${PY_URL}" -o "${tarball}"`);
    }
    sh(`tar xzf "${tarball}" -C "${tmp}"`); // extracts a "python/" dir
    const py = path.join(tmp, 'python', 'bin', 'python3');
    sh(`"${py}" -m pip install --quiet --upgrade pip`);
    sh(`"${py}" -m pip install --quiet -r "${requirements}"`);
    // Drop pip caches / bytecode churn we don't need to ship.
    sh(`"${py}" -c "import compileall,sys; compileall.compile_dir('${path.join(tmp, 'python')}', quiet=2)" || true`);
    fs.renameSync(path.join(tmp, 'python'), pyCache);
    fs.rmSync(tmp, { recursive: true, force: true });
  } else {
    log('using cached Python runtime');
  }

  log('copying Python runtime into app');
  const pyDest = path.join(resources, 'python');
  fs.rmSync(pyDest, { recursive: true, force: true });
  // cp -R preserves symlinks/permissions/signatures of the standalone build.
  sh(`cp -R "${pyCache}" "${pyDest}"`);

  // ── 3. Re-seal the bundle so the added Resources are covered ───────────────
  if (!signing.signed) {
    // We added nested Mach-O (native bin/lib + the whole Python tree) after
    // electron's ad-hoc sign, which invalidates the bundle seal. A *broken* seal
    // makes Gatekeeper call the app "damaged" (worse than unsigned), so deep
    // re-sign ad-hoc: this signs every nested binary and rebuilds CodeResources.
    log('re-signing app bundle (ad-hoc, deep)');
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: ['ignore', 'ignore', 'pipe'] });
    // Fail the build if the signature is actually broken. Plain --verify (not
    // --strict) is the criterion Gatekeeper uses for the ad-hoc / quarantine-open
    // path: passing here means users get the normal "unidentified developer"
    // prompt, never "app is damaged". (--strict adds picky nested-code checks that
    // a zip round-trip can trip without affecting that user-facing behavior.)
    execFileSync('codesign', ['--verify', appPath], { stdio: ['ignore', 'ignore', 'pipe'] });
  } else {
    // Sign every nested Mach-O we just added (native bin/lib + the whole
    // Python tree) with the real Developer ID identity so notarization
    // accepts them. We deliberately do NOT sign the outer .app or run the
    // ad-hoc verify here — electron-builder's own sign phase runs
    // immediately after afterPack (identity passed via -c.mac.identity),
    // signs the frameworks/helpers/outer bundle with the entitlements, and
    // rebuilds the seal. Signing nested binaries here first means that final
    // pass has nothing unsigned left to trip over.
    log('signing bundled native binaries with Developer ID');
    let signedCount = 0;
    for (const dir of [binDir, libDir, path.join(resources, 'python')]) {
      signedCount += signMachOBinariesRecursive(dir, signing.identity, shared.isMachOBinary);
    }
    log(`signed ${signedCount} bundled binaries`);
  }

  log('done — app is self-contained');
};

// Walks `dir` recursively, signing every regular file whose first 4 bytes are
// a Mach-O/universal-binary magic number. Symlinks are skipped — dylibbundler
// and the Python runtime both use them to alias versioned libraries, and
// signing the link target (not the link itself) is what codesign expects.
function signMachOBinariesRecursive(dir, identity, isMachOBinary) {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      count += signMachOBinariesRecursive(entryPath, identity, isMachOBinary);
      continue;
    }
    if (!entry.isFile()) continue;
    const fd = fs.openSync(entryPath, 'r');
    const header = Buffer.alloc(4);
    fs.readSync(fd, header, 0, 4, 0);
    fs.closeSync(fd);
    if (!isMachOBinary(header)) continue;
    execFileSync(
      'codesign',
      ['--force', '--options', 'runtime', '--timestamp', '--sign', identity, entryPath],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    count++;
  }
  return count;
}
