import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AudioAnalysis, ChannelAnalysis, ChannelFile } from '@sound-buddy/audio-engine'

// Mock the audio-engine module
vi.mock('@sound-buddy/audio-engine', () => ({
  analyzeAudio: vi.fn(),
  extractChannels: vi.fn(),
  loadChannelFiles: vi.fn(),
  compareChannels: vi.fn(),
  buildReport: vi.fn(),
  formatMultiChannelReport: vi.fn(),
}))

// Mock node:fs existsSync
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    existsSync: vi.fn(),
  }
})

import * as audioEngine from '@sound-buddy/audio-engine'
import * as fs from 'node:fs'
import { runAnalyze } from '../commands/analyze.js'

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
    bands: {
      subBass: 0.05,
      bass: 0.12,
      lowMid: 0.08,
      mid: 0.45,
      highMid: 0.2,
      presence: 0.07,
      brilliance: 0.03,
    },
    spectralCentroid: 1800,
    spectralRolloff85: 4500,
    dynamicRange: 7.17,
  },
}

function makeChannelAnalysis(name: string, channels = 1): ChannelAnalysis {
  const ch: ChannelFile = { index: 0, name, tmpPath: `/tmp/${name}.wav`, needsCleanup: false }
  return {
    channel: ch,
    analysis: {
      ...mockAnalysis,
      ffprobe: {
        ...mockAnalysis.ffprobe,
        stream: { ...mockAnalysis.ffprobe.stream, channels },
      },
    },
  }
}

describe('buddy analyze — single file', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(audioEngine.analyzeAudio).mockResolvedValue(mockAnalysis)
    vi.mocked(audioEngine.buildReport).mockReturnValue('mock report')
    vi.mocked(audioEngine.compareChannels).mockReturnValue({
      bandRankings: {},
      maskingPairs: [],
      subBassOffenders: [],
      mixBandEnergy: {},
    })
    vi.mocked(audioEngine.formatMultiChannelReport).mockReturnValue('mock multi-channel report')
  })

  it('exits 0 and prints RMS, peak, dynamic range, dominant band for a valid WAV', async () => {
    const output: string[] = []
    const errors: string[] = []

    await runAnalyze('/tmp/mix.wav', {}, {
      log: (s: string) => output.push(s),
      error: (s: string) => errors.push(s),
    })

    const combined = output.join('\n')
    expect(combined).toContain('-9.11')       // RMS dBFS
    expect(combined).toContain('-1.94')       // Peak dBFS
    expect(combined).toContain('7.17')        // Dynamic range
    expect(combined).toMatch(/mid/i)          // Dominant band
    expect(errors).toHaveLength(0)
  })

  it('exits 1 and writes "Error: file not found" to stderr when file does not exist', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)

    const errors: string[] = []
    let exitCode = 0

    await runAnalyze('/tmp/missing.wav', {}, {
      log: () => {},
      error: (s: string) => errors.push(s),
      exit: (code: number) => { exitCode = code },
    })

    expect(errors.join('\n')).toContain('Error: file not found')
    expect(exitCode).toBe(1)
  })

  it('outputs valid JSON with RMS, peak, and bands per channel when --json is passed', async () => {
    const output: string[] = []

    await runAnalyze('/tmp/mix.wav', { json: true }, {
      log: (s: string) => output.push(s),
      error: () => {},
    })

    const parsed = JSON.parse(output.join(''))
    expect(parsed).toHaveProperty('channels')
    expect(Array.isArray(parsed.channels)).toBe(true)
    const ch = parsed.channels[0]
    expect(ch).toHaveProperty('rmsDbfs')
    expect(ch).toHaveProperty('peakDbfs')
    expect(ch).toHaveProperty('bands')
  })
})

describe('buddy analyze — multi-channel WAV (32 channels)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(fs.existsSync).mockReturnValue(true)

    const thirtyTwoCh = {
      ...mockAnalysis,
      ffprobe: {
        ...mockAnalysis.ffprobe,
        stream: { ...mockAnalysis.ffprobe.stream, channels: 32 },
      },
    }
    // extractChannels returns 32 channel files
    const channelFiles: ChannelFile[] = Array.from({ length: 32 }, (_, i) => ({
      index: i,
      name: `CH${i + 1}`,
      tmpPath: `/tmp/ch${i + 1}.wav`,
      needsCleanup: false,
    }))
    vi.mocked(audioEngine.extractChannels).mockResolvedValue(channelFiles)

    // First analyzeAudio call (for the source file) returns 32 channels
    // Subsequent calls (per extracted channel) return single-channel analysis
    const singleChAnalysis = {
      ...mockAnalysis,
      ffprobe: {
        ...mockAnalysis.ffprobe,
        stream: { ...mockAnalysis.ffprobe.stream, channels: 1 },
      },
    }
    vi.mocked(audioEngine.analyzeAudio)
      .mockResolvedValueOnce(thirtyTwoCh)
      .mockResolvedValue(singleChAnalysis)
    vi.mocked(audioEngine.compareChannels).mockReturnValue({
      bandRankings: {},
      maskingPairs: [],
      subBassOffenders: [],
      mixBandEnergy: {},
    })
    vi.mocked(audioEngine.formatMultiChannelReport).mockReturnValue('Multi-Channel Engineer\'s Read section here')
  })

  it('shows a table with all 32 channels', async () => {
    const output: string[] = []

    await runAnalyze('/tmp/session.wav', {}, {
      log: (s: string) => output.push(s),
      error: () => {},
    })

    const combined = output.join('\n')
    // Should show all 32 channels
    for (let i = 1; i <= 32; i++) {
      expect(combined).toContain(`CH${i}`)
    }
  })

  it('includes "Multi-Channel Engineer\'s Read" section after the table', async () => {
    const output: string[] = []

    await runAnalyze('/tmp/session.wav', {}, {
      log: (s: string) => output.push(s),
      error: () => {},
    })

    const combined = output.join('\n')
    expect(combined).toMatch(/multi-channel engineer'?s read/i)
  })
})

describe('buddy analyze — directory', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(fs.existsSync).mockReturnValue(true)

    const channelFiles: ChannelFile[] = [
      { index: 0, name: 'kick.wav', tmpPath: '/tmp/session/kick.wav', needsCleanup: false },
      { index: 1, name: 'snare.wav', tmpPath: '/tmp/session/snare.wav', needsCleanup: false },
    ]
    vi.mocked(audioEngine.loadChannelFiles).mockResolvedValue(channelFiles)

    const singleChAnalysis = {
      ...mockAnalysis,
      ffprobe: {
        ...mockAnalysis.ffprobe,
        stream: { ...mockAnalysis.ffprobe.stream, channels: 1 },
      },
    }
    vi.mocked(audioEngine.analyzeAudio).mockResolvedValue(singleChAnalysis)
    vi.mocked(audioEngine.compareChannels).mockReturnValue({
      bandRankings: {},
      maskingPairs: [],
      subBassOffenders: [],
      mixBandEnergy: {},
    })
    vi.mocked(audioEngine.formatMultiChannelReport).mockReturnValue('mock multi report')
  })

  it('analyzes each file in the directory as a separate channel and shows per-channel table', async () => {
    const output: string[] = []

    await runAnalyze(undefined, { dir: '/tmp/session' }, {
      log: (s: string) => output.push(s),
      error: () => {},
    })

    expect(audioEngine.loadChannelFiles).toHaveBeenCalledWith('/tmp/session')
    const combined = output.join('\n')
    expect(combined).toContain('kick.wav')
    expect(combined).toContain('snare.wav')
  })
})
