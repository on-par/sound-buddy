import { describe, expect, it } from 'vitest';
import {
  BANNED_VIDEO_LIB_PATTERN,
  FFMPEG_BUILD_VERSION,
  FFMPEG_VERSION,
  MEDIA_FIXTURE_FORMATS,
  ffmpegConfigureArgs,
  ffmpegTarballUrl,
  findBannedVideoLibs,
  findDanglingBundledLibRefs,
  hasAudioStream,
  parseOtoolLibraryPaths,
} from './ffmpeg-audio-only.js';

describe('ffmpegConfigureArgs', () => {
  const args = ffmpegConfigureArgs('/x');

  it('sets the install prefix', () => {
    expect(args).toContain('--prefix=/x');
  });

  it('builds a shared, non-static library', () => {
    expect(args).toContain('--enable-shared');
    expect(args).toContain('--disable-static');
  });

  it('disables ffplay, docs, avdevice, and networking', () => {
    expect(args).toContain('--disable-ffplay');
    expect(args).toContain('--disable-doc');
    expect(args).toContain('--disable-avdevice');
    expect(args).toContain('--disable-network');
  });

  it('restricts protocols to file and pipe', () => {
    expect(args).toContain('--disable-protocols');
    expect(args).toContain('--enable-protocol=file,pipe');
  });

  it('disables all encoders except the four PCM encoders the app uses', () => {
    expect(args).toContain('--disable-encoders');
    const encoderArg = args.find((a) => a.startsWith('--enable-encoder='));
    expect(encoderArg).toBe('--enable-encoder=pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le');
  });

  it('restricts muxers to wav and null', () => {
    expect(args).toContain('--disable-muxers');
    expect(args).toContain('--enable-muxer=wav,null');
  });

  it('does not disable demuxers, decoders, parsers, filters, or swscale', () => {
    expect(args).not.toContain('--disable-demuxers');
    expect(args).not.toContain('--disable-decoders');
    expect(args).not.toContain('--disable-parsers');
    expect(args).not.toContain('--disable-filters');
    expect(args).not.toContain('--disable-swscale');
  });

  it('does not enable GPL or any external codec library', () => {
    expect(args).not.toContain('--enable-gpl');
    expect(args.some((a) => a.startsWith('--enable-lib'))).toBe(false);
  });
});

describe('ffmpegTarballUrl', () => {
  it('points at the pinned ffmpeg.org release tarball', () => {
    expect(ffmpegTarballUrl(FFMPEG_VERSION)).toBe(`https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz`);
  });
});

describe('parseOtoolLibraryPaths', () => {
  const sample = [
    '/tmp/bin/ffprobe:',
    '\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1345.100.2)',
    '\t@executable_path/../lib/libavcodec.62.dylib (compatibility version 62.0.0, current version 62.3.100)',
    '\t@rpath/libavutil.60.dylib (compatibility version 60.0.0, current version 60.3.100)',
    '\t@loader_path/../lib/libavformat.62.dylib (compatibility version 62.0.0, current version 62.3.100)',
    '\t/opt/homebrew/opt/libx264/lib/libx264.165.dylib (compatibility version 165.0.0, current version 165.0.0)',
    '\t/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation (compatibility version 150.0.0, current version 1970.0.0)',
  ].join('\n');

  it('extracts bundled-relative and leftover absolute paths', () => {
    expect(parseOtoolLibraryPaths(sample)).toEqual([
      '@executable_path/../lib/libavcodec.62.dylib',
      '@rpath/libavutil.60.dylib',
      '@loader_path/../lib/libavformat.62.dylib',
      '/opt/homebrew/opt/libx264/lib/libx264.165.dylib',
    ]);
  });

  it('skips the header line and system libs', () => {
    const paths = parseOtoolLibraryPaths(sample);
    expect(paths).not.toContain('/tmp/bin/ffprobe:');
    expect(paths.some((p) => p.includes('libSystem.B.dylib'))).toBe(false);
    expect(paths.some((p) => p.includes('CoreFoundation'))).toBe(false);
  });

  it('skips blank lines and lines without a compatibility-version marker', () => {
    const withBlankAndMalformedLines = [
      '/tmp/bin/ffprobe:',
      '',
      '\t   ',
      '\tsome unparseable line with no marker',
      '\t@executable_path/../lib/libavcodec.62.dylib (compatibility version 62.0.0, current version 62.3.100)',
    ].join('\n');
    expect(parseOtoolLibraryPaths(withBlankAndMalformedLines)).toEqual([
      '@executable_path/../lib/libavcodec.62.dylib',
    ]);
  });
});

describe('findDanglingBundledLibRefs', () => {
  const bundledLibNames = ['libavcodec.62.dylib', 'libavutil.60.dylib'];

  it('reports nothing when every bundled ref resolves', () => {
    const entries = [{ file: 'bin/ffprobe', deps: ['@executable_path/../lib/libavcodec.62.dylib'] }];
    expect(findDanglingBundledLibRefs(entries, bundledLibNames)).toEqual([]);
  });

  it('reports a bundled-style ref whose target is not in the bundle', () => {
    const entries = [{ file: 'bin/ffprobe', deps: ['@executable_path/../lib/libavformat.62.dylib'] }];
    expect(findDanglingBundledLibRefs(entries, bundledLibNames)).toEqual([
      { file: 'bin/ffprobe', missing: '@executable_path/../lib/libavformat.62.dylib' },
    ]);
  });

  it('reports a leftover absolute path outside the bundle', () => {
    const entries = [{ file: 'lib/libavcodec.62.dylib', deps: ['/opt/homebrew/opt/libx264/lib/libx264.165.dylib'] }];
    expect(findDanglingBundledLibRefs(entries, bundledLibNames)).toEqual([
      { file: 'lib/libavcodec.62.dylib', missing: '/opt/homebrew/opt/libx264/lib/libx264.165.dylib' },
    ]);
  });

  it('never reports system paths', () => {
    const entries = [{ file: 'bin/ffprobe', deps: ['/usr/lib/libSystem.B.dylib', '/System/Library/Foo'] }];
    expect(findDanglingBundledLibRefs(entries, bundledLibNames)).toEqual([]);
  });

  it('accepts @rpath and @loader_path prefixes as bundled-style refs', () => {
    const entries = [
      { file: 'bin/ffprobe', deps: ['@rpath/libmissing.1.dylib'] },
      { file: 'bin/ffmpeg', deps: ['@loader_path/../lib/libmissing2.1.dylib'] },
    ];
    expect(findDanglingBundledLibRefs(entries, bundledLibNames)).toEqual([
      { file: 'bin/ffprobe', missing: '@rpath/libmissing.1.dylib' },
      { file: 'bin/ffmpeg', missing: '@loader_path/../lib/libmissing2.1.dylib' },
    ]);
  });
});

describe('findBannedVideoLibs', () => {
  it('flags the banned video/codec libs from the issue', () => {
    expect(
      findBannedVideoLibs([
        'libx265.216.dylib',
        'libSvtAv1Enc.4.1.0.dylib',
        'libvpx.12.dylib',
        'libvmaf.3.dylib',
        'libx264.165.dylib',
        'libdav1d.7.dylib',
        'libaom.3.dylib',
        'librav1e.0.dylib',
        'libtheora.0.dylib',
        'libopenh264.7.dylib',
      ]),
    ).toEqual([
      'libx265.216.dylib',
      'libSvtAv1Enc.4.1.0.dylib',
      'libvpx.12.dylib',
      'libvmaf.3.dylib',
      'libx264.165.dylib',
      'libdav1d.7.dylib',
      'libaom.3.dylib',
      'librav1e.0.dylib',
      'libtheora.0.dylib',
      'libopenh264.7.dylib',
    ]);
  });

  it('does not flag audio libs', () => {
    expect(findBannedVideoLibs(['libmp3lame.0.dylib', 'libsndfile.1.dylib', 'libopus.0.dylib'])).toEqual([]);
  });

  it('exposes the pattern used to classify banned libs', () => {
    expect(BANNED_VIDEO_LIB_PATTERN.test('libx264.165.dylib')).toBe(true);
    expect(BANNED_VIDEO_LIB_PATTERN.test('libmp3lame.0.dylib')).toBe(false);
  });
});

describe('MEDIA_FIXTURE_FORMATS', () => {
  it('covers wav, flac, aiff, mp3, aac, and a video container', () => {
    expect(MEDIA_FIXTURE_FORMATS.map((f) => f.name).sort()).toEqual(
      ['aac', 'aiff', 'flac', 'mp3', 'mp4-with-video', 'wav'].sort(),
    );
  });

  it('never depends on libx264 to synthesize fixtures', () => {
    for (const format of MEDIA_FIXTURE_FORMATS) {
      expect(format.encodeArgs.join(' ')).not.toContain('libx264');
    }
  });

  it('uses mpeg4 (not a GPL codec) for the video-container fixture', () => {
    const videoFixture = MEDIA_FIXTURE_FORMATS.find((f) => f.name === 'mp4-with-video');
    expect(videoFixture).toBeDefined();
    expect(videoFixture?.encodeArgs).toContain('mpeg4');
    expect(videoFixture?.file).toBe('fixture.mp4');
  });

  it('gives every fixture a distinct output file name', () => {
    const files = MEDIA_FIXTURE_FORMATS.map((f) => f.file);
    expect(new Set(files).size).toBe(files.length);
  });

  it('ends every encodeArgs list with its own output file name (afterPack.js swaps this last element for a tmpdir path)', () => {
    for (const format of MEDIA_FIXTURE_FORMATS) {
      expect(format.encodeArgs[format.encodeArgs.length - 1]).toBe(format.file);
    }
  });
});

describe('hasAudioStream', () => {
  it('recognizes an ffprobe JSON report containing an audio stream', () => {
    const probeJson = JSON.stringify({ streams: [{ codec_type: 'audio' }] });
    expect(hasAudioStream(probeJson)).toBe(true);
  });

  it('rejects a report with only a video stream', () => {
    const probeJson = JSON.stringify({ streams: [{ codec_type: 'video' }] });
    expect(hasAudioStream(probeJson)).toBe(false);
  });

  it('finds the audio stream among multiple streams (e.g. the mp4-with-video fixture)', () => {
    const probeJson = JSON.stringify({ streams: [{ codec_type: 'video' }, { codec_type: 'audio' }] });
    expect(hasAudioStream(probeJson)).toBe(true);
  });

  it('rejects a report with no streams at all', () => {
    const probeJson = JSON.stringify({ streams: [] });
    expect(hasAudioStream(probeJson)).toBe(false);
  });

  it('rejects a report missing the streams key entirely', () => {
    expect(hasAudioStream(JSON.stringify({}))).toBe(false);
  });
});

describe('FFMPEG_BUILD_VERSION', () => {
  it('is a non-empty, stable cache-bust token', () => {
    expect(FFMPEG_BUILD_VERSION).toMatch(/^ffbuild-v\d+$/);
  });
});
