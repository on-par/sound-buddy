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
  // We added nested Mach-O (native bin/lib + the whole Python tree) after
  // electron's ad-hoc sign, which invalidates the bundle seal. A *broken* seal
  // makes Gatekeeper call the app "damaged" (worse than unsigned), so deep
  // re-sign ad-hoc: this signs every nested binary and rebuilds CodeResources.
  log('re-signing app bundle (ad-hoc, deep)');
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: ['ignore', 'ignore', 'pipe'] });
  // Fail the build loudly if the seal still doesn't verify.
  execFileSync('codesign', ['--verify', '--strict', appPath], { stdio: ['ignore', 'ignore', 'pipe'] });

  log('done — app is self-contained');
};
