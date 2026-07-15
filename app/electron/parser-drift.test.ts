import { describe, it, expect, beforeAll, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// ─── Parser drift guard (#150 / #151) ──────────────────────────────────────────
//
// The sox/ffprobe/spectrum/ebur128 parsers used to be duplicated: a canonical
// copy in @sound-buddy/audio-engine (MIT, used by the CLI) and a hand-copied
// fork inline in app/electron/ipc/analysis.ts (used by the Electron app).
// #151 removed the fork — the app now calls the SAME engine functions
// (loaded from the engine's CJS build via ./ipc/engine-loader.ts), parameterized
// with bundled binary/script paths and a cancellation AbortSignal. This test no
// longer compares two independent implementations; it guards the
// parameterization seam itself: the app's wrappers (bundled-path resolution,
// CJS build, loaded through engine-loader) must produce numerically identical
// output, end to end, to the engine source called directly with its default
// paths. A divergence here means the wrapper is passing the wrong bin/script
// path or dropping an option — not that the parsing logic itself disagrees
// (there is only one parsing implementation left to disagree with).
//
// ipc/shared.ts computes SCRIPTS_DIR/SPECTRUM_SCRIPT at module load from
// app.isPackaged + process.resourcesPath. We mock Electron in the packaged
// shape and point resourcesPath at the real audio-engine package so spectrum.py
// resolves; the sox/ffprobe/ffmpeg binaries fall back to PATH (no bundled bin
// dir on disk), and engine-loader's dev fallback resolves the real, built
// dist-cjs parsers via REPO_ROOT (no `engine/` subdir at this mocked
// resourcesPath). The mock factory is hoisted above the ipc import, so
// resourcesPath is set before ipc.ts's module body runs.
vi.mock('electron', () => {
  const p = require('node:path') as typeof import('node:path');
  const os = require('node:os') as typeof import('node:os');
  // Resolve from this test file's location so the path is stable regardless of
  // vitest's cwd (projects mode runs with cwd=repo-root, not app/).
  const __filename2 = fileURLToPath(import.meta.url);
  const __dirname2 = p.dirname(__filename2);
  (process as { resourcesPath?: string }).resourcesPath = p.resolve(
    __dirname2,
    '..',
    '..',
    'packages',
    'audio-engine',
  );
  return {
    app: {
      isPackaged: true,
      getPath: () => os.tmpdir(),
      setName: () => {},
      getName: () => 'sound-buddy-test',
    },
    ipcMain: { handle: () => {} },
    dialog: {},
    BrowserWindow: class {},
    systemPreferences: {},
    shell: {},
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.alloc(0),
      decryptString: () => '',
    },
  };
});

// The app copies (exported from ipc.ts purely for this guard).
import { runSox as appSox, runFfprobe as appFfprobe, runSpectrum as appSpectrum, runEbur128 as appEbur128 } from './ipc';
// The canonical audio-engine copies (imported straight from source).
import { runSox as engSox } from '../../packages/audio-engine/src/analyze/sox.js';
import { runFfprobe as engFfprobe } from '../../packages/audio-engine/src/analyze/ffprobe.js';
import { runSpectrum as engSpectrum } from '../../packages/audio-engine/src/analyze/spectrum.js';
import { runEbur128 as engEbur128 } from '../../packages/audio-engine/src/analyze/ebur128.js';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const fixture = (name: string) =>
  path.join(repoRoot, 'packages', 'audio-engine', 'test-fixtures', name);
const TONE = fixture('tone.wav');
const SILENCE = fixture('silence.wav');
const SPECTRUM_SCRIPT = path.join(repoRoot, 'packages', 'audio-engine', 'scripts', 'spectrum.py');

function ok(cmd: string, args: string[], env?: NodeJS.ProcessEnv): boolean {
  try {
    const r = spawnSync(cmd, args, { stdio: 'ignore', env: env ?? process.env });
    return !r.error && (r.status === 0 || r.status === null);
  } catch {
    return false;
  }
}

const HAS_SOX = ok('sox', ['--version']);
const HAS_FFPROBE = ok('ffprobe', ['-version']);
const HAS_FFMPEG = ok('ffmpeg', ['-version']);

// Resolve one Python interpreter with librosa. Both copies must use the SAME
// interpreter for their outputs to be comparable, so we pin it: the app copy
// via SOUND_BUDDY_PYTHON, the audio-engine copy (which spawns bare `python3`)
// via a PATH prepend to that interpreter's directory.
function resolveLibrosaPython(): string | null {
  const candidates = [
    process.env.SOUND_BUDDY_PYTHON,
    path.join(repoRoot, '.venv', 'bin', 'python3'),
    'python3',
  ].filter((c): c is string => Boolean(c));
  for (const c of candidates) {
    const exists = c === 'python3' || fs.existsSync(c);
    if (exists && ok(c, ['-c', 'import librosa, numpy'])) return c;
  }
  return null;
}
const LIBROSA_PYTHON = resolveLibrosaPython();

beforeAll(() => {
  if (LIBROSA_PYTHON && LIBROSA_PYTHON !== 'python3') {
    process.env.SOUND_BUDDY_PYTHON = LIBROSA_PYTHON;
    process.env.PATH = `${path.dirname(LIBROSA_PYTHON)}${path.delimiter}${process.env.PATH ?? ''}`;
  }
});

describe.skipIf(!HAS_SOX)('sox parser: app copy === audio-engine copy', () => {
  it.each([
    ['tone.wav', () => TONE],
    ['silence.wav', () => SILENCE],
  ])('%s produces identical SoxStats', async (_name, file) => {
    const [a, e] = await Promise.all([appSox(file()), engSox(file())]);
    expect(a).toEqual(e);
  });
});

describe.skipIf(!HAS_FFPROBE)('ffprobe parser: app copy === audio-engine copy', () => {
  it.each([
    ['tone.wav', () => TONE],
    ['silence.wav', () => SILENCE],
  ])('%s produces identical FfprobeResult', async (_name, file) => {
    const [a, e] = await Promise.all([appFfprobe(file()), engFfprobe(file())]);
    expect(a).toEqual(e);
  });
});

describe.skipIf(!HAS_FFMPEG)('ebur128 parser: app copy === audio-engine copy', () => {
  it.each([
    ['tone.wav', () => TONE],
    ['silence.wav', () => SILENCE],
  ])('%s produces identical LoudnessStats', async (_name, file) => {
    const [a, e] = await Promise.all([appEbur128(file()), engEbur128(file())]);
    expect(a).toEqual(e);
  });
});

describe.skipIf(!LIBROSA_PYTHON)('spectrum parser: app copy === audio-engine copy', () => {
  // Both spawn the same spectrum.py with the same interpreter, so the numeric
  // fields must be identical. We compare the scalar analysis fields (the seven
  // bands + centroid/rolloff/dynamic range + content type) — not the large
  // frames/segments arrays, which are explicitly out of scope for #150.
  //
  // spectrum.py's cold librosa import alone can exceed vitest's 5 s default
  // on a fresh CI runner — worse under the root aggregated coverage run
  // (#438), where audio-engine's spectrum tests compete for the same
  // interpreter. Same headroom as audio-engine's fixtures.test.ts.
  const SPECTRUM_TIMEOUT = 60_000;

  const core = (s: Awaited<ReturnType<typeof engSpectrum>>) => ({
    bands: s.bands,
    spectralCentroid: s.spectralCentroid,
    spectralRolloff85: s.spectralRolloff85,
    dynamicRange: s.dynamicRange,
    contentType: s.contentType,
  });

  it.each([
    ['tone.wav', () => TONE],
    ['silence.wav', () => SILENCE],
  ])('%s produces identical band + scalar values', { timeout: SPECTRUM_TIMEOUT }, async (_name, file) => {
    const [a, e] = await Promise.all([
      appSpectrum(file()),
      engSpectrum(file(), { scriptPath: SPECTRUM_SCRIPT }),
    ]);
    expect(core(a)).toEqual(core(e));
  });
});
