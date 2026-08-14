import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AudioAnalysis, ChannelFile } from '@sound-buddy/audio-engine'
import type { SceneDiff } from '@sound-buddy/shared'

vi.mock('@sound-buddy/scene-inspector', () => ({
  parseScene: vi.fn(),
  diffScenes: vi.fn(),
}))

vi.mock('@sound-buddy/audio-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sound-buddy/audio-engine')>()
  return {
    analyzeAudio: vi.fn(),
    extractChannels: vi.fn(),
    loadChannelFiles: vi.fn(),
    compareChannels: vi.fn(),
    formatMultiChannelReport: vi.fn(),
    cleanupChannelFiles: vi.fn(),
    // Pure presentation helpers (TD-005) — keep the real implementation so
    // printChannelTable/outputJson still produce real table rows/labels.
    dominantBandLabel: actual.dominantBandLabel,
    formatChannelTable: actual.formatChannelTable,
  }
})

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, existsSync: vi.fn(), readFileSync: vi.fn() }
})

import { readFileSync, existsSync } from 'node:fs'
import { parseScene, diffScenes } from '@sound-buddy/scene-inspector'
import {
  analyzeAudio,
  extractChannels,
  loadChannelFiles,
  compareChannels,
  formatMultiChannelReport,
  cleanupChannelFiles,
} from '@sound-buddy/audio-engine'
import { runAnalyze } from './analyze.js'

const mockAnalysis: AudioAnalysis = {
  filePath: '/tmp/mix.wav',
  sox: {
    samplesRead: 44100,
    lengthSeconds: 1.0,
    scaledBy: 2147483647,
    maximumAmplitude: 0.8,
    minimumAmplitude: -0.8,
    midlineAmplitude: 0.0,
    meanNorm: 0.3,
    meanAmplitude: 0.0,
    rmsAmplitude: 0.35,
    maximumDelta: 0.1,
    minimumDelta: 0.0,
    meanDelta: 0.05,
    rmsDelta: 0.06,
    roughFrequency: 220,
    volumeAdjustment: 3.1,
    rmsDbfs: -9.11,
    peakDbfs: -1.94,
    dynamicRangeDb: 7.17,
    clipping: false,
  },
  ffprobe: {
    format: {
      filename: '/tmp/mix.wav',
      formatName: 'wav',
      formatLongName: 'WAV / WAVE (Waveform Audio)',
      durationSeconds: 1.0,
      sizeBytes: 88244,
      bitRate: 705920,
      tags: {},
    },
    stream: {
      codecName: 'pcm_s16le',
      codecLongName: 'PCM signed 16-bit little-endian',
      channels: 2,
      channelLayout: 'stereo',
      sampleRate: 44100,
      bitDepth: 16,
      bitRate: null,
      durationSeconds: 1.0,
    },
  },
  spectrum: {
    bands: { subBass: 0.05, bass: 0.12, lowMid: 0.08, mid: 0.45, highMid: 0.2, presence: 0.07, brilliance: 0.03 },
    spectralCentroid: 1800,
    spectralRolloff85: 4500,
    dynamicRange: 7.17,
    curve: { freqs: [20, 200, 2000, 20000], db: [-30, -18, -16, -35] },
    frames: [
      { t: 0.0, db: [-32, -20, -18, -36], rms: -18.2, class: 'music' },
      { t: 0.5, db: [-28, -16, -14, -34], rms: -14.1, class: 'music' },
    ],
    contentType: 'speech',
    segments: [
      { class: 'speech', start: 0, end: 0.6 },
      { class: 'music', start: 0.6, end: 1.0 },
    ],
  },
  loudness: null,
}

function withChannels(channels: number): AudioAnalysis {
  return { ...mockAnalysis, ffprobe: { ...mockAnalysis.ffprobe, stream: { ...mockAnalysis.ffprobe.stream, channels } } }
}

const emptyComparison = { bandRankings: {}, maskingPairs: [], subBassOffenders: [], mixBandEnergy: {} }

const mockDiff: SceneDiff = {
  summary: '3 changes detected',
  changes: [{ path: 'channels[0].mix.fader', label: 'CH1 Fader', from: -10, to: -6 }],
  bySection: { channels: [], dcas: [], main: [] },
}

/** Collect stdout/stderr/exit for a single runAnalyze call. */
function capture() {
  const out: string[] = []
  const err: string[] = []
  let exitCode: number | undefined
  const io = {
    log: (s: string) => out.push(s),
    error: (s: string) => err.push(s),
    exit: (code: number) => {
      exitCode = code
    },
  }
  return {
    io,
    out,
    err,
    get code() {
      return exitCode
    },
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(existsSync).mockReturnValue(true)
  vi.mocked(readFileSync).mockReturnValue('scene content' as never)
  vi.mocked(parseScene).mockReturnValue({ name: 'Scene', version: '1.0', channels: [], dcas: [] } as never)
  vi.mocked(diffScenes).mockReturnValue(mockDiff)
  vi.mocked(analyzeAudio).mockResolvedValue(mockAnalysis)
  vi.mocked(compareChannels).mockReturnValue(emptyComparison as never)
  vi.mocked(formatMultiChannelReport).mockReturnValue('mock multi-channel report')
})

describe('buddy analyze — single file', () => {
  it('prints RMS, peak, dynamic range and dominant band for a valid WAV', async () => {
    const t = capture()
    await runAnalyze('/tmp/mix.wav', {}, t.io)

    const combined = t.out.join('\n')
    expect(combined).toContain('-9.11') // RMS dBFS
    expect(combined).toContain('-1.94') // Peak dBFS
    expect(combined).toContain('7.17') // Dynamic range
    expect(combined).toMatch(/mid/i) // Dominant band
    expect(t.err).toHaveLength(0)
    expect(t.code).toBeUndefined()
  })

  it('writes "Error: file not found" to stderr and exits 1 when the file is missing', async () => {
    vi.mocked(existsSync).mockReturnValue(false)
    const t = capture()

    await runAnalyze('/tmp/missing.wav', {}, t.io)

    expect(t.err.join('\n')).toContain('Error: file not found')
    expect(t.code).toBe(1)
  })

  it('emits valid JSON with rms, peak and bands per channel when --json is passed', async () => {
    const t = capture()
    await runAnalyze('/tmp/mix.wav', { json: true }, t.io)

    const parsed = JSON.parse(t.out.join(''))
    expect(Array.isArray(parsed.channels)).toBe(true)
    const ch = parsed.channels[0]
    expect(ch).toHaveProperty('rmsDbfs')
    expect(ch).toHaveProperty('peakDbfs')
    expect(ch).toHaveProperty('bands')
  })

  it('includes the whole-file curve and time-sampled frames in --json (PRD 02/03)', async () => {
    const t = capture()
    await runAnalyze('/tmp/mix.wav', { json: true }, t.io)

    const ch = JSON.parse(t.out.join('')).channels[0]
    expect(Array.isArray(ch.frames)).toBe(true)
    expect(ch.frames).toHaveLength(2)
    expect(ch.frames[0]).toMatchObject({ t: 0, class: 'music' })
    expect(Array.isArray(ch.frames[0].db)).toBe(true)
    expect(ch.curve).toMatchObject({ freqs: expect.any(Array), db: expect.any(Array) })
  })

  it('includes speech/music classification (segments + contentType) in --json output', async () => {
    const t = capture()
    await runAnalyze('/tmp/mix.wav', { json: true }, t.io)

    const parsed = JSON.parse(t.out.join(''))
    const ch = parsed.channels[0]
    expect(ch.contentType).toBe('speech')
    expect(Array.isArray(ch.segments)).toBe(true)
    expect(ch.segments[0]).toMatchObject({ class: 'speech', start: 0, end: 0.6 })
  })
})

describe('buddy analyze — multi-channel WAV', () => {
  beforeEach(() => {
    const channelFiles: ChannelFile[] = Array.from({ length: 32 }, (_, i) => ({
      index: i,
      name: `CH${i + 1}`,
      tmpPath: `/tmp/ch${i + 1}.wav`,
      needsCleanup: true,
    }))
    vi.mocked(extractChannels).mockResolvedValue(channelFiles)
    vi.mocked(analyzeAudio).mockResolvedValueOnce(withChannels(32)).mockResolvedValue(withChannels(1))
    // The multi-channel report owns the per-channel table; echo the names so
    // the table assertions have something to match.
    vi.mocked(formatMultiChannelReport).mockImplementation(
      (chs) => `=== MULTI-CHANNEL SUMMARY ===\n${chs.map((c) => c.channel.name).join('\n')}`
    )
  })

  it('shows a table row for all 32 channels', async () => {
    const t = capture()
    await runAnalyze('/tmp/session.wav', {}, t.io)

    const combined = t.out.join('\n')
    for (let i = 1; i <= 32; i++) expect(combined).toContain(`CH${i}`)
  })

  it('renders the per-channel table only once', async () => {
    const t = capture()
    await runAnalyze('/tmp/session.wav', {}, t.io)
    expect(t.out.join('\n').match(/CH1\b/g) ?? []).toHaveLength(1)
  })

  it('cleans up the extracted per-channel temp files', async () => {
    const t = capture()
    await runAnalyze('/tmp/session.wav', {}, t.io)
    expect(cleanupChannelFiles).toHaveBeenCalledTimes(1)
    const passed = vi.mocked(cleanupChannelFiles).mock.calls[0][0]
    expect(passed).toHaveLength(32)
  })
})

describe('buddy analyze — directory', () => {
  beforeEach(() => {
    vi.mocked(loadChannelFiles).mockResolvedValue([
      { index: 0, name: 'kick.wav', tmpPath: '/tmp/session/kick.wav', needsCleanup: false },
      { index: 1, name: 'snare.wav', tmpPath: '/tmp/session/snare.wav', needsCleanup: false },
    ])
    vi.mocked(analyzeAudio).mockResolvedValue(withChannels(1))
    vi.mocked(formatMultiChannelReport).mockImplementation(
      (chs) => `=== MULTI-CHANNEL SUMMARY ===\n${chs.map((c) => c.channel.name).join('\n')}`
    )
  })

  it('analyzes each file in the directory as a separate channel', async () => {
    const t = capture()
    await runAnalyze(undefined, { dir: '/tmp/session' }, t.io)

    expect(loadChannelFiles).toHaveBeenCalledWith('/tmp/session')
    const combined = t.out.join('\n')
    expect(combined).toContain('kick.wav')
    expect(combined).toContain('snare.wav')
  })
})

describe('buddy analyze — scene diff', () => {
  it('shows the scene diff summary when two --scene files are provided', async () => {
    const t = capture()
    await runAnalyze('/tmp/mix.wav', { scenes: ['before.scn', 'after.scn'] }, t.io)

    expect(readFileSync).toHaveBeenCalledWith('before.scn', 'utf8')
    expect(readFileSync).toHaveBeenCalledWith('after.scn', 'utf8')
    expect(diffScenes).toHaveBeenCalled()
    expect(t.out.join('\n')).toContain('3 changes detected')
  })

  it('rejects a single --scene file with a non-zero exit', async () => {
    const t = capture()
    await runAnalyze(undefined, { scenes: ['only.scn'] }, t.io)
    expect(t.err.join('\n')).toMatch(/exactly two/i)
    expect(t.code).toBe(1)
  })

  it('rejects more than two --scene files with a non-zero exit', async () => {
    const t = capture()
    await runAnalyze(undefined, { scenes: ['a.scn', 'b.scn', 'c.scn'] }, t.io)
    expect(t.err.join('\n')).toMatch(/exactly two/i)
    expect(t.code).toBe(1)
  })

  it('fails with an actionable error when a scene file is missing', async () => {
    vi.mocked(existsSync).mockReturnValue(false)
    const t = capture()

    await runAnalyze(undefined, { scenes: ['missing.scn', 'after.scn'] }, t.io)

    expect(t.err.join('\n')).toContain('scene file not found: missing.scn')
    expect(t.code).toBe(1)
  })

  it('runs a scene diff alone (no audio file) and skips the audio report', async () => {
    const t = capture()

    await runAnalyze(undefined, { scenes: ['before.scn', 'after.scn'] }, t.io)

    expect(t.out.join('\n')).toContain('3 changes detected')
    expect(t.out.join('\n')).not.toContain('=== Per-Channel Summary ===')
    expect(t.code).toBeUndefined()
  })

  it('emits { diff, channels } JSON when --json is combined with --scene', async () => {
    const t = capture()
    await runAnalyze('/tmp/mix.wav', { scenes: ['before.scn', 'after.scn'], json: true }, t.io)

    const parsed = JSON.parse(t.out.join(''))
    expect(parsed.diff).toMatchObject({ summary: '3 changes detected' })
    expect(parsed.channels).toHaveLength(1)
  })

  it('omits the optional spectrum additive fields from JSON when the analysis lacks them', async () => {
    const bare = {
      ...mockAnalysis,
      spectrum: {
        bands: mockAnalysis.spectrum.bands,
        spectralCentroid: mockAnalysis.spectrum.spectralCentroid,
        spectralRolloff85: mockAnalysis.spectrum.spectralRolloff85,
        dynamicRange: mockAnalysis.spectrum.dynamicRange,
      },
    }
    vi.mocked(analyzeAudio).mockResolvedValue(bare)
    const t = capture()

    await runAnalyze('/tmp/mix.wav', { json: true }, t.io)

    const ch = JSON.parse(t.out.join('')).channels[0]
    expect(ch.curve).toBeUndefined()
    expect(ch.frames).toBeUndefined()
    expect(ch.contentType).toBeUndefined()
    expect(ch.segments).toBeUndefined()
  })
})

describe('buddy analyze — error paths', () => {
  it('prints Usage and exits 1 when no file, dir or scene is provided', async () => {
    const t = capture()
    await runAnalyze(undefined, {}, t.io)
    expect(t.err.join('\n')).toMatch(/Usage: buddy analyze/)
    expect(t.code).toBe(1)
  })

  it('reports "Analysis failed" and exits 1 when analyzing a single file throws', async () => {
    vi.mocked(analyzeAudio).mockRejectedValueOnce(new Error('ffprobe crash'))
    const t = capture()

    await runAnalyze('/tmp/mix.wav', {}, t.io)

    expect(t.err.join('\n')).toContain('Analysis failed: Error: ffprobe crash')
    expect(t.code).toBe(1)
  })

  it('reports a per-channel warning but keeps going when one channel fails', async () => {
    vi.mocked(extractChannels).mockResolvedValue([
      { index: 0, name: 'kick.wav', tmpPath: '/tmp/session/kick.wav', needsCleanup: true },
      { index: 1, name: 'snare.wav', tmpPath: '/tmp/session/snare.wav', needsCleanup: true },
    ])
    vi.mocked(analyzeAudio)
      .mockResolvedValueOnce(withChannels(32))
      .mockRejectedValueOnce(new Error('bad channel'))
      .mockResolvedValue(withChannels(1))
    const t = capture()

    await runAnalyze('/tmp/session.wav', {}, t.io)

    expect(t.err.join('\n')).toContain('Warning: failed to analyze channel')
    expect(t.out.join('\n')).toContain('mock multi-channel report')
    expect(t.code).toBeUndefined()
  })

  it('fails with an actionable error when channel extraction throws', async () => {
    vi.mocked(extractChannels).mockRejectedValueOnce(new Error('no sox'))
    vi.mocked(analyzeAudio).mockResolvedValueOnce(withChannels(32))
    const t = capture()

    await runAnalyze('/tmp/session.wav', {}, t.io)

    expect(t.err.join('\n')).toContain('Failed to extract channels: Error: no sox')
    expect(t.code).toBe(1)
  })

  it('reports "Failed to read directory" and exits 1 when loadChannelFiles throws', async () => {
    vi.mocked(loadChannelFiles).mockRejectedValueOnce(new Error('EACCES'))
    const t = capture()

    await runAnalyze(undefined, { dir: '/tmp/session' }, t.io)

    expect(t.err.join('\n')).toContain('Failed to read directory: Error: EACCES')
    expect(t.code).toBe(1)
  })

  it('reports "No audio files found" and exits 1 for an empty directory', async () => {
    vi.mocked(loadChannelFiles).mockResolvedValue([])
    const t = capture()

    await runAnalyze(undefined, { dir: '/tmp/session' }, t.io)

    expect(t.err.join('\n')).toContain('No audio files found in: /tmp/session')
    expect(t.code).toBe(1)
  })

  it('reports "All channel analyses failed" and exits 1 when every channel fails', async () => {
    vi.mocked(loadChannelFiles).mockResolvedValue([
      { index: 0, name: 'kick.wav', tmpPath: '/tmp/session/kick.wav', needsCleanup: false },
      { index: 1, name: 'snare.wav', tmpPath: '/tmp/session/snare.wav', needsCleanup: false },
    ])
    vi.mocked(analyzeAudio).mockRejectedValue(new Error('corrupt file'))
    const t = capture()

    await runAnalyze(undefined, { dir: '/tmp/session' }, t.io)

    expect(t.err.join('\n')).toContain('All channel analyses failed.')
    expect(t.err.join('\n')).toMatch(/Warning: failed to analyze channel/)
    expect(t.code).toBe(1)
  })

  it('returns null (no report, no exit) when every extracted channel of a multi-channel file fails', async () => {
    vi.mocked(extractChannels).mockResolvedValue([
      { index: 0, name: 'kick.wav', tmpPath: '/tmp/session/kick.wav', needsCleanup: true },
      { index: 1, name: 'snare.wav', tmpPath: '/tmp/session/snare.wav', needsCleanup: true },
    ])
    vi.mocked(analyzeAudio)
      .mockResolvedValueOnce(withChannels(32))
      .mockRejectedValue(new Error('corrupt file'))
    const t = capture()

    await runAnalyze('/tmp/session.wav', {}, t.io)

    expect(t.err.join('\n')).toMatch(/Warning: failed to analyze channel/)
    expect(t.out).toHaveLength(0)
    expect(t.code).toBe(1)
  })
})

describe('buddy analyze — default stdio (no io injected)', () => {
  it('logs to console.log when no io is provided', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await runAnalyze('/tmp/mix.wav', {})
      expect(logSpy).toHaveBeenCalled()
      expect(logSpy.mock.calls.join('\n')).toContain('-9.11')
    } finally {
      logSpy.mockRestore()
    }
  })

  it('falls back to console.error when no io.error is provided on an error path', async () => {
    vi.mocked(existsSync).mockReturnValue(false)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exitMock = vi.fn()
    try {
      await runAnalyze('/tmp/missing.wav', {}, { exit: exitMock })
      expect(errorSpy).toHaveBeenCalled()
      expect(errorSpy.mock.calls.join('\n')).toContain('Error: file not found')
      expect(exitMock).toHaveBeenCalledWith(1)
    } finally {
      errorSpy.mockRestore()
    }
  })
})
