// electron-builder afterPack hook — makes the macOS .app fully self-contained.
//
// The app shells out to sox, ffprobe/ffmpeg and a Python interpreter
// (numpy/scipy/…). None of those ship with macOS, so a download-only user hit
// "spawn sox ENOENT". This hook bundles them INTO the app so it runs with zero
// external setup:
//
//   Contents/Resources/bin/{sox,ffprobe,ffmpeg}   native tools (dylibs relocated to ../lib)
//   Contents/Resources/lib/*.dylib                their shared libraries
//   Contents/Resources/python/bin/python3          relocatable CPython + audio deps
//
// ffprobe/ffmpeg are an audio-only ffmpeg built from source and cached in
// app/.build-cache (#664) — see ensureAudioOnlyFfmpeg — instead of Homebrew's
// ffmpeg, whose dylib graph hard-links GPL video codecs (x264/x265) that can't
// be pruned after the fact without breaking "Library not loaded" at launch.
//
// Requires on the BUILD machine: sox + Homebrew ffmpeg (release.yml already
// installs both; Homebrew ffmpeg is only used to synthesize the verify-gate's
// media fixtures, never bundled), dylibbundler, curl, and the Xcode Command
// Line Tools (clang/make, to build the audio-only ffmpeg from source — cached
// after the first build).
// ipc.ts resolves these paths via process.resourcesPath when app.isPackaged.

const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
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

  // ── 1. Native tools: sox (Homebrew) + an audio-only ffprobe/ffmpeg (built
  //      from source, cached) with their dylibs ─────────────────────────────
  log('bundling sox + audio-only ffprobe/ffmpeg');
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(libDir, { recursive: true });
  const ffmpegCache = ensureAudioOnlyFfmpeg(cacheRoot, shared);
  // ffmpeg and ffprobe are both built from the same audio-only ffmpeg tree, so
  // they share the same lib set; dylibbundler dedups when it copies them into
  // libDir. ffmpeg lets spectrum.py's subprocess fallback decode m4a/aac when
  // soundfile can't.
  for (const tool of ['sox', 'ffprobe', 'ffmpeg']) {
    const src = tool === 'sox' ? sh('command -v sox') : path.join(ffmpegCache, 'bin', tool);
    if (!src || !fs.existsSync(src)) {
      throw new Error(
        tool === 'sox'
          ? 'afterPack: "sox" not found on build machine (brew install sox)'
          : `afterPack: "${tool}" missing from the audio-only ffmpeg build at ${ffmpegCache} (delete app/.build-cache and rebuild)`,
      );
    }
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

  // ── 1b. Verify the trimmed media libs ──────────────────────────────────────
  // Runs pre-signing (dylibbundler already ad-hoc re-signed what it rewrote, so
  // bundled ffprobe/ffmpeg/sox already execute) and gates the build: a broken
  // bundle must fail here, not at the user's first launch.
  verifyTrimmedMediaLibs(binDir, libDir, shared);

  // ── 2. Relocatable Python with the audio-engine deps ──────────────────────
  const reqHash = crypto.createHash('sha256')
    .update(PY_ASSET + '\n' + shared.PYTHON_PRUNE_VERSION + '\n' + fs.readFileSync(requirements))
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
    // Bytecode strategy: sources-only. We do NOT precompile with compileall —
    // prunePythonRuntime deletes any __pycache__ instead. This costs a one-time
    // bytecode compile on the user's first run, keeps source lines in tracebacks
    // while the Python path is still changing, and saves ~100 MB of .pyc (#663).
    const pruned = prunePythonRuntime(path.join(tmp, 'python'), shared);
    log(`pruned Python runtime (${pruned} entries removed: pip/setuptools/wheel, test suites, __pycache__)`);
    // Fail the build if pruning broke any runtime import (e.g. numpy.testing,
    // which scipy pulls in at import time, or the _*_data native-lib dirs).
    sh(`"${py}" -c "import numpy, soundfile, sounddevice; from scipy.signal import get_window"`);
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
    // Batched, not one `codesign` per file: electron-builder's own sign phase
    // (next, driven by -c.mac.identity) is scoped by `mac.signIgnore` in
    // electron-builder.yml to skip these same trees, so this is the only pass
    // that ever touches them (#620).
    const machO = [binDir, libDir, path.join(resources, 'python')]
      .flatMap((dir) => collectMachOBinaries(dir, shared.isMachOBinary));
    const batches = shared.planCodesignBatches(machO);
    const signedCount = signMachOBatches(batches, signing.identity);
    log(`signed ${signedCount} bundled binaries in ${batches.length} codesign calls`);
  }

  log('done — app is self-contained');
};

// Builds (or reuses a cached) audio-only ffmpeg/ffprobe from source, per #664:
// Homebrew's ffmpeg hard-links GPL video codecs (x264/x265/vpx/…) via
// LC_LOAD_DYLIB, so those dylibs can't be deleted after bundling without
// "Library not loaded" at first launch. Configure flags come from the tested
// shared module (packages/shared/src/ffmpeg-audio-only.ts); this function only
// does I/O, mirroring the Python cache below.
function ensureAudioOnlyFfmpeg(cacheRoot, shared) {
  const hash = crypto.createHash('sha256')
    .update(shared.FFMPEG_BUILD_VERSION + '\n' + shared.ffmpegConfigureArgs('PREFIX').join('\n'))
    .digest('hex').slice(0, 12);
  const ffmpegCache = path.join(cacheRoot, `ffmpeg-${shared.FFMPEG_VERSION}-${hash}`);

  if (fs.existsSync(path.join(ffmpegCache, 'bin', 'ffprobe'))) {
    log('using cached audio-only ffmpeg');
    return ffmpegCache;
  }

  if (!sh('command -v make || true') || !sh('command -v clang || true')) {
    throw new Error('afterPack: building the audio-only ffmpeg needs the Xcode Command Line Tools (xcode-select --install)');
  }

  log(`building audio-only ffmpeg ${shared.FFMPEG_VERSION} (one-time; cached afterwards)`);
  const tmp = path.join(cacheRoot, `tmp-ffmpeg-${hash}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const tarball = path.join(cacheRoot, `ffmpeg-${shared.FFMPEG_VERSION}.tar.xz`);
  if (!fs.existsSync(tarball)) {
    sh(`curl -fsSL "${shared.ffmpegTarballUrl(shared.FFMPEG_VERSION)}" -o "${tarball}"`);
  }
  sh(`tar xJf "${tarball}" -C "${tmp}"`); // extracts a "ffmpeg-<version>/" dir
  const srcDir = path.join(tmp, `ffmpeg-${shared.FFMPEG_VERSION}`);
  // Unlike the relocatable Python build below, ffmpeg's `make install` bakes
  // --prefix into every dylib's install name (LC_ID_DYLIB) and every
  // consumer's load command as an ABSOLUTE path — there's no DESTDIR staging
  // support in its Makefiles. So --prefix must already be the real final
  // cache dir; installing into a tmp dir and renaming afterwards (the Python
  // cache's atomic-publish idiom) would leave every binary pointing at a
  // deleted tmp path, which is silently fatal until something tries to
  // resolve those libs. Clear any partial dir from an interrupted prior
  // build first so a retry starts clean.
  fs.rmSync(ffmpegCache, { recursive: true, force: true });
  sh(`./configure ${shared.ffmpegConfigureArgs(ffmpegCache).join(' ')}`, { cwd: srcDir });
  sh(`make -j${os.cpus().length}`, { cwd: srcDir });
  sh('make install', { cwd: srcDir });
  fs.rmSync(tmp, { recursive: true, force: true });
  return ffmpegCache;
}

// Hard build-time gate for the trimmed ffmpeg/ffprobe/sox bundle (#664): a
// broken bundle must fail the build, not the user's first launch. All policy
// (which libs are banned, which refs are dangling, which fixtures to
// synthesize) is the tested shared module; this function only does I/O.
function verifyTrimmedMediaLibs(binDir, libDir, shared) {
  const offenders = shared.findBannedVideoLibs(fs.readdirSync(libDir));
  if (offenders.length > 0) {
    throw new Error(
      `afterPack: banned video/codec dylibs found in the bundle: ${offenders.join(', ')} ` +
      '(check packages/shared/src/ffmpeg-audio-only.ts ffmpegConfigureArgs, then bump FFMPEG_BUILD_VERSION to force a clean rebuild)',
    );
  }

  const bundledLibNames = fs.readdirSync(libDir);
  const entries = [];
  for (const dir of [binDir, libDir]) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const filePath = path.join(dir, entry.name);
      entries.push({ file: `${path.basename(dir)}/${entry.name}`, deps: shared.parseOtoolLibraryPaths(sh(`otool -L "${filePath}"`)) });
    }
  }
  const dangling = shared.findDanglingBundledLibRefs(entries, bundledLibNames);
  if (dangling.length > 0) {
    const detail = dangling.map((d) => `${d.file} -> ${d.missing}`).join(', ');
    throw new Error(`afterPack: dangling library references found (would crash "Library not loaded" at first launch): ${detail}`);
  }

  const buildMachineFfmpeg = sh('command -v ffmpeg');
  if (!buildMachineFfmpeg) {
    throw new Error('afterPack: "ffmpeg" not found on build machine (brew install ffmpeg) — needed to synthesize verify-gate fixtures');
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-ffmpeg-fixtures-'));
  try {
    for (const format of shared.MEDIA_FIXTURE_FORMATS) {
      const fixturePath = path.join(tmpDir, format.file);
      execFileSync(buildMachineFfmpeg, ['-y', ...format.encodeArgs.slice(0, -1), fixturePath], { stdio: ['ignore', 'ignore', 'pipe'] });

      const probeOut = execFileSync(
        path.join(binDir, 'ffprobe'),
        ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', fixturePath],
        { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' },
      );
      if (!shared.hasAudioStream(probeOut)) {
        throw new Error(`afterPack: bundled ffprobe found no audio stream in the ${format.name} fixture`);
      }

      // Byte output (raw PCM-in-WAV on stdout), not utf8 — capture as a Buffer.
      const pcmOut = execFileSync(
        path.join(binDir, 'ffmpeg'),
        ['-v', 'error', '-i', fixturePath, '-f', 'wav', '-acodec', 'pcm_f32le', '-'],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      if (pcmOut.length === 0) {
        throw new Error(`afterPack: bundled ffmpeg produced no PCM output decoding the ${format.name} fixture`);
      }
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  sh(`"${path.join(binDir, 'sox')}" --version`);

  const libSize = sh(`du -sh "${libDir}"`);
  log(`verified trimmed media libs (${libSize})`);
}

// Prunes the assembled runtime using the pure predicates from packages/shared
// (isPrunablePythonDir / isPrunablePythonFile — unit-tested there). Walks
// top-down; a pruned directory is removed whole and not descended into.
function prunePythonRuntime(rootDir, shared) {
  let removed = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      const rel = path.relative(rootDir, entryPath).split(path.sep).join('/');
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (shared.isPrunablePythonDir(rel)) {
          fs.rmSync(entryPath, { recursive: true, force: true });
          removed++;
        } else {
          walk(entryPath);
        }
      } else if (entry.isFile() && shared.isPrunablePythonFile(rel)) {
        fs.rmSync(entryPath);
        removed++;
      }
    }
  };
  walk(rootDir);
  return removed;
}

// Walks `dir` recursively, collecting every regular file whose first 4 bytes
// are a Mach-O/universal-binary magic number. Symlinks are skipped —
// dylibbundler and the Python runtime both use them to alias versioned
// libraries, and signing the link target (not the link itself) is what
// codesign expects.
function collectMachOBinaries(dir, isMachOBinary) {
  if (!fs.existsSync(dir)) return [];
  const paths = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      paths.push(...collectMachOBinaries(entryPath, isMachOBinary));
      continue;
    }
    if (!entry.isFile()) continue;
    const fd = fs.openSync(entryPath, 'r');
    const header = Buffer.alloc(4);
    fs.readSync(fd, header, 0, 4, 0);
    fs.closeSync(fd);
    if (!isMachOBinary(header)) continue;
    paths.push(entryPath);
  }
  return paths;
}

// codesign accepts many paths per invocation, so signing `batches` (already
// split by planCodesignBatches) collapses hundreds of process spawns + Apple
// timestamp-server round trips into a handful (#620).
function signMachOBatches(batches, identity) {
  let count = 0;
  for (const batch of batches) {
    execFileSync(
      'codesign',
      ['--force', '--options', 'runtime', '--timestamp', '--sign', identity, ...batch],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    count += batch.length;
  }
  return count;
}
