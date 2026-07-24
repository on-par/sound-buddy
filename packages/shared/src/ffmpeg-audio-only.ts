// Build-time policy for the audio-only ffmpeg bundled by app/build/afterPack.js
// (#664). Pure predicates/constants only — no fs, no child_process; afterPack.js
// does the I/O and calls these to decide what to build, bundle, and verify,
// mirroring the python-prune.ts / afterPack.js split (#663).

// Matches the avcodec 62 major shipped by ffmpeg 8.0. channels.ts already
// assumes ffmpeg 7+ `pan` filter syntax.
export const FFMPEG_VERSION = '8.0';

// Bump this when configure flags change so afterPack.js's cache key changes too
// — otherwise a stale, differently-configured cached build would be reused.
export const FFMPEG_BUILD_VERSION = 'ffbuild-v1';

const BUNDLED_LIB_PREFIXES = ['@executable_path/', '@loader_path/', '@rpath/'];

const SYSTEM_LIB_PREFIXES = ['/usr/lib/', '/System/'];

const PCM_ENCODERS = ['pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_f32le'];

const BANNED_VIDEO_LIB_NAMES = ['x264', 'x265', 'vpx', 'SvtAv1Enc', 'dav1d', 'vmaf', 'aom', 'rav1e', 'theora', 'openh264'];

export const BANNED_VIDEO_LIB_PATTERN = new RegExp(`^lib(${BANNED_VIDEO_LIB_NAMES.join('|')})\\.`);

export function ffmpegTarballUrl(version: string): string {
  return `https://ffmpeg.org/releases/ffmpeg-${version}.tar.xz`;
}

/**
 * Configure flags for an audio-only ffmpeg build. Deliberately does NOT pass
 * --disable-decoders, --disable-demuxers, --disable-parsers, --disable-filters,
 * --disable-swscale, --enable-gpl, or any --enable-lib* flag (the
 * demuxer-safety rule from #664): every demuxer and decoder stays so ffprobe
 * still reads video containers and users can still pull the audio track out of
 * a video file. Savings come from dropping every external codec lib and all
 * internal encoders except the PCM ones the app uses (pcm_f32le for
 * spectrum.py's decode fallback, pcm_s16le for channels.ts's `pan` -> .wav
 * output).
 */
export function ffmpegConfigureArgs(prefix: string): string[] {
  return [
    `--prefix=${prefix}`,
    '--enable-shared',
    '--disable-static',
    '--disable-ffplay',
    '--disable-doc',
    '--disable-avdevice',
    '--disable-network',
    '--disable-protocols',
    '--enable-protocol=file,pipe',
    '--disable-encoders',
    `--enable-encoder=${PCM_ENCODERS.join(',')}`,
    '--disable-muxers',
    '--enable-muxer=wav,null',
  ];
}

/**
 * Parses `otool -L <file>` output into the list of linked library paths,
 * skipping the header (first) line and system libs (/usr/lib/, /System/).
 */
export function parseOtoolLibraryPaths(otoolOutput: string): string[] {
  const lines = otoolOutput.split('\n').slice(1);
  const paths: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const marker = ' (compatibility version';
    const markerIndex = trimmed.indexOf(marker);
    if (markerIndex === -1) continue;
    const libPath = trimmed.slice(0, markerIndex);
    if (SYSTEM_LIB_PREFIXES.some((prefix) => libPath.startsWith(prefix))) continue;
    paths.push(libPath);
  }
  return paths;
}

/**
 * Given each bundled file's linked-library deps (already filtered of system
 * libs, e.g. via parseOtoolLibraryPaths), reports every dep that will fail to
 * resolve at runtime: a bundled-style ref (@executable_path/, @loader_path/,
 * @rpath/) whose target dylib name is not in `bundledLibNames`, or any
 * leftover non-bundled absolute path (e.g. a stray /opt/homebrew/... ref).
 */
export function findDanglingBundledLibRefs(
  entries: Array<{ file: string; deps: string[] }>,
  bundledLibNames: string[],
): Array<{ file: string; missing: string }> {
  const results: Array<{ file: string; missing: string }> = [];
  for (const entry of entries) {
    for (const dep of entry.deps) {
      if (SYSTEM_LIB_PREFIXES.some((prefix) => dep.startsWith(prefix))) continue;
      const bundledPrefix = BUNDLED_LIB_PREFIXES.find((prefix) => dep.startsWith(prefix));
      if (bundledPrefix) {
        const name = dep.slice(dep.lastIndexOf('/') + 1);
        if (!bundledLibNames.includes(name)) {
          results.push({ file: entry.file, missing: dep });
        }
      } else {
        results.push({ file: entry.file, missing: dep });
      }
    }
  }
  return results;
}

export function findBannedVideoLibs(libFileNames: string[]): string[] {
  return libFileNames.filter((name) => BANNED_VIDEO_LIB_PATTERN.test(name));
}

export interface MediaFixtureFormat {
  name: string;
  file: string;
  encodeArgs: string[];
}

const SINE_INPUT_ARGS = ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1'];

export const MEDIA_FIXTURE_FORMATS: MediaFixtureFormat[] = [
  { name: 'wav', file: 'fixture.wav', encodeArgs: [...SINE_INPUT_ARGS, '-c:a', 'pcm_s16le', 'fixture.wav'] },
  { name: 'flac', file: 'fixture.flac', encodeArgs: [...SINE_INPUT_ARGS, '-c:a', 'flac', 'fixture.flac'] },
  { name: 'aiff', file: 'fixture.aiff', encodeArgs: [...SINE_INPUT_ARGS, '-c:a', 'pcm_s16be', 'fixture.aiff'] },
  { name: 'mp3', file: 'fixture.mp3', encodeArgs: [...SINE_INPUT_ARGS, '-c:a', 'libmp3lame', 'fixture.mp3'] },
  { name: 'aac', file: 'fixture.m4a', encodeArgs: [...SINE_INPUT_ARGS, '-c:a', 'aac', 'fixture.m4a'] },
  {
    name: 'mp4-with-video',
    file: 'fixture.mp4',
    encodeArgs: [
      '-f', 'lavfi', '-i', 'testsrc=duration=1:size=128x72:rate=10',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
      '-c:v', 'mpeg4', '-c:a', 'aac', 'fixture.mp4',
    ],
  },
];
