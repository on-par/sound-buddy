import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AudioAnalysis, ChannelFile } from '@sound-buddy/audio-engine'
import type { SceneDiff, Insight } from '@sound-buddy/shared'

vi.mock('@sound-buddy/scene-inspector', () => ({
  parseScene: vi.fn(),
  diffScenes: vi.fn(),
}))

vi.mock('@sound-buddy/audio-engine', () => ({
  analyzeAudio: vi.fn(),
  extractChannels: vi.fn(),
  loadChannelFiles: vi.fn(),
  compareChannels: vi.fn(),
  formatMultiChannelReport: vi.fn(),
  cleanupChannelFiles: vi.fn(),
}))

vi.mock('@sound-buddy/ai-analyst', () => ({
  analyzeWithClaude: vi.fn(),
}))

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
import { analyzeWithClaude } from '@sound-buddy/ai-analyst'
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

const mockInsights: Insight[] = [
  { type: 'level', message: 'CH1 fader increase may cause mix buildup', severity: 'warning' },
  { type: 'frequency', message: 'Strong mid presence, watch for muddiness', severity: 'info' },
]

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
  vi.mocked(analyzeWithClaude).mockResolvedValue(mockInsights)
})

describe('buddy analyze — single file', () => {
  it('prints RMS, peak, dynamic range and dominant band for a valid WAV', async () => {
    const t = capture()
    await runAnalyze('/tmp/mix.wav', { noAi: true }, t.io)

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

  it('does not call the AI pass in --json mode', async () => {
    const t = capture()
    await runAnalyze('/tmp/mix.wav', { json: true }, t.io)
    expect(analyzeWithClaude).not.toHaveBeenCalled()
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
    await runAnalyze('/tmp/session.wav', { noAi: true }, t.io)

    const combined = t.out.join('\n')
    for (let i = 1; i <= 32; i++) expect(combined).toContain(`CH${i}`)
  })

  it('renders the per-channel table only once', async () => {
    const t = capture()
    await runAnalyze('/tmp/session.wav', { noAi: true }, t.io)
    expect(t.out.join('\n').match(/CH1\b/g) ?? []).toHaveLength(1)
  })

  it("labels the AI pass as the Multi-Channel Engineer's Read", async () => {
    const t = capture()
    await runAnalyze('/tmp/session.wav', {}, t.io) // AI on

    const combined = t.out.join('\n')
    expect(combined).toMatch(/multi-channel engineer'?s read/i)
    expect(combined).toContain('CH1 fader increase may cause mix buildup')
  })

  it('cleans up the extracted per-channel temp files', async () => {
    const t = capture()
    await runAnalyze('/tmp/session.wav', { noAi: true }, t.io)
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
    await runAnalyze(undefined, { dir: '/tmp/session', noAi: true }, t.io)

    expect(loadChannelFiles).toHaveBeenCalledWith('/tmp/session')
    const combined = t.out.join('\n')
    expect(combined).toContain('kick.wav')
    expect(combined).toContain('snare.wav')
  })
})

describe('buddy analyze — scene diff', () => {
  it('shows the scene diff summary when two --scene files are provided', async () => {
    const t = capture()
    await runAnalyze('/tmp/mix.wav', { scenes: ['before.scn', 'after.scn'], noAi: true }, t.io)

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

  it('sends both the scene diff and audio to the AI pass when combined', async () => {
    const t = capture()
    await runAnalyze('/tmp/mix.wav', { scenes: ['before.scn', 'after.scn'] }, t.io) // AI on

    expect(analyzeWithClaude).toHaveBeenCalledWith(expect.objectContaining({ diff: mockDiff }))
    const input = vi.mocked(analyzeWithClaude).mock.calls[0][0]
    expect(input.audio?.channels).toHaveLength(1)
  })
})

describe('buddy analyze — AI insights', () => {
  it('appends AI insights by default', async () => {
    const t = capture()
    await runAnalyze('/tmp/mix.wav', {}, t.io)

    expect(analyzeWithClaude).toHaveBeenCalled()
    const combined = t.out.join('\n')
    expect(combined).toContain('AI Insights')
    expect(combined).toContain('CH1 fader increase may cause mix buildup')
  })

  it('skips the AI pass when --no-ai is set', async () => {
    const t = capture()
    await runAnalyze('/tmp/mix.wav', { noAi: true }, t.io)

    expect(analyzeWithClaude).not.toHaveBeenCalled()
    expect(t.out.join('\n')).not.toContain('AI Insights')
  })

  it('keeps measurements when the AI pass throws', async () => {
    vi.mocked(analyzeWithClaude).mockRejectedValue(new Error('Not implemented'))
    const t = capture()
    await runAnalyze('/tmp/mix.wav', {}, t.io)

    const combined = t.out.join('\n')
    expect(combined).toContain('-9.11') // measurements still printed
    expect(combined).toContain('AI analysis unavailable')
  })
})
