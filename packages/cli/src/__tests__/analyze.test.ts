import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SceneDiff, AudioAnalysisResult, Insight } from '@sound-buddy/shared'

// Mock all external packages
vi.mock('@sound-buddy/scene-inspector', () => ({
  parseScene: vi.fn(),
  diffScenes: vi.fn(),
}))

vi.mock('@sound-buddy/audio-engine', () => ({
  analyzeAudio: vi.fn(),
  extractChannels: vi.fn(),
}))

vi.mock('@sound-buddy/ai-analyst', () => ({
  analyzeWithClaude: vi.fn(),
}))

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
}))

import { readFileSync } from 'node:fs'
import { parseScene, diffScenes } from '@sound-buddy/scene-inspector'
import { analyzeAudio } from '@sound-buddy/audio-engine'
import { analyzeWithClaude } from '@sound-buddy/ai-analyst'
import { runAnalyze } from '../analyze.js'

const mockReadFileSync = vi.mocked(readFileSync)
const mockParseScene = vi.mocked(parseScene)
const mockDiffScenes = vi.mocked(diffScenes)
const mockAnalyzeAudio = vi.mocked(analyzeAudio)
const mockAnalyzeWithClaude = vi.mocked(analyzeWithClaude)

const mockDiff: SceneDiff = {
  summary: '3 changes detected',
  changes: [
    { path: 'channels[0].mix.fader', label: 'CH1 Fader', from: -10, to: -6 },
  ],
  bySection: { channels: [], dcas: [], main: [] },
}

const mockAudioAnalysis = {
  filePath: 'session.wav',
  sox: {
    samplesRead: 44100,
    lengthSeconds: 1,
    scaledBy: 1,
    maximumAmplitude: 0.8,
    minimumAmplitude: -0.8,
    midlineAmplitude: 0,
    meanNorm: 0.3,
    meanAmplitude: 0,
    rmsAmplitude: 0.35,
    maximumDelta: 0.1,
    minimumDelta: -0.1,
    meanDelta: 0,
    rmsDelta: 0.05,
    roughFrequency: 440,
    volumeAdjustment: 0,
    rmsDbfs: -9.1,
    peakDbfs: -1.9,
    dynamicRangeDb: 7.2,
    clipping: false,
  },
  ffprobe: {
    format: { filename: 'session.wav', formatName: 'wav', formatLongName: 'WAV', durationSeconds: 1, sizeBytes: 88200, bitRate: 705600, tags: {} },
    stream: { codecName: 'pcm_s16le', codecLongName: 'PCM 16-bit', channels: 2, channelLayout: 'stereo', sampleRate: 44100, bitDepth: 16, bitRate: null, durationSeconds: 1 },
  },
  spectrum: {
    bands: { subBass: -40, bass: -20, lowMid: -15, mid: -10, highMid: -18, presence: -25, brilliance: -35 },
    spectralCentroid: 1200,
    spectralRolloff85: 4000,
    dynamicRange: 7.2,
  },
}

const mockInsights: Insight[] = [
  { type: 'level', message: 'CH1 fader increase may cause mix buildup', severity: 'warning' },
  { type: 'frequency', message: 'Strong mid presence, watch for muddiness', severity: 'info' },
]

beforeEach(() => {
  vi.clearAllMocks()
  mockReadFileSync.mockReturnValue('scene content' as any)
  mockParseScene.mockReturnValue({
    name: 'Test Scene',
    version: '1.0',
    channels: [],
    dcas: [],
  })
  mockDiffScenes.mockReturnValue(mockDiff)
  mockAnalyzeAudio.mockResolvedValue(mockAudioAnalysis)
  mockAnalyzeWithClaude.mockResolvedValue(mockInsights)
})

describe('buddy analyze — combined scene + audio', () => {
  it('shows scene diff summary when two --scene files are provided', async () => {
    const output = await runAnalyze({
      scenes: ['before.scn', 'after.scn'],
      audio: 'session.wav',
      noAi: false,
    })

    expect(mockReadFileSync).toHaveBeenCalledWith('before.scn', 'utf8')
    expect(mockReadFileSync).toHaveBeenCalledWith('after.scn', 'utf8')
    expect(mockParseScene).toHaveBeenCalledTimes(2)
    expect(mockDiffScenes).toHaveBeenCalled()
    expect(output).toContain('3 changes detected')
  })

  it('shows per-channel audio measurements', async () => {
    const output = await runAnalyze({
      scenes: ['before.scn', 'after.scn'],
      audio: 'session.wav',
      noAi: false,
    })

    expect(mockAnalyzeAudio).toHaveBeenCalledWith('session.wav')
    expect(output).toContain('RMS')
    expect(output).toContain('-9.1')
  })

  it('shows AI insights correlating scene and audio', async () => {
    const output = await runAnalyze({
      scenes: ['before.scn', 'after.scn'],
      audio: 'session.wav',
      noAi: false,
    })

    expect(mockAnalyzeWithClaude).toHaveBeenCalledWith(
      expect.objectContaining({ diff: mockDiff })
    )
    expect(output).toContain('CH1 fader increase may cause mix buildup')
  })
})

describe('buddy analyze — audio only with Claude', () => {
  it('calls Claude when ANTHROPIC_API_KEY is set and no --no-ai flag', async () => {
    const originalEnv = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'sk-test-key'

    const output = await runAnalyze({
      scenes: [],
      audio: 'session.wav',
      noAi: false,
    })

    expect(mockAnalyzeWithClaude).toHaveBeenCalled()
    expect(output).toContain('Strong mid presence')

    process.env.ANTHROPIC_API_KEY = originalEnv
  })

  it('shows audio measurements in output', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key'

    const output = await runAnalyze({
      scenes: [],
      audio: 'session.wav',
      noAi: false,
    })

    expect(output).toContain('-9.1')
    expect(output).toContain('-1.9')
  })
})

describe('buddy analyze — resilience', () => {
  it('keeps audio measurements when the AI call fails', async () => {
    mockAnalyzeWithClaude.mockRejectedValue(new Error('Not implemented'))

    const output = await runAnalyze({
      scenes: [],
      audio: 'session.wav',
      noAi: false,
    })

    expect(output).toContain('-9.1')
    expect(output).toContain('AI analysis unavailable')
    expect(output).toContain('Not implemented')
  })
})

describe('buddy analyze — input validation', () => {
  it('throws when only one --scene file is provided', async () => {
    await expect(
      runAnalyze({ scenes: ['before.scn'], audio: 'session.wav', noAi: false })
    ).rejects.toThrow(/exactly two/)
  })

  it('throws when more than two --scene files are provided', async () => {
    await expect(
      runAnalyze({ scenes: ['a.scn', 'b.scn', 'c.scn'], noAi: false })
    ).rejects.toThrow(/exactly two/)
  })

  it('throws when neither audio nor scenes are provided', async () => {
    await expect(runAnalyze({ scenes: [], noAi: false })).rejects.toThrow(
      /provide an audio file/
    )
  })
})

describe('buddy analyze — --no-ai flag', () => {
  it('skips AI call when --no-ai is set', async () => {
    const output = await runAnalyze({
      scenes: [],
      audio: 'session.wav',
      noAi: true,
    })

    expect(mockAnalyzeWithClaude).not.toHaveBeenCalled()
    expect(output).not.toContain('CH1 fader increase')
  })

  it('still shows raw measurements with --no-ai', async () => {
    const output = await runAnalyze({
      scenes: [],
      audio: 'session.wav',
      noAi: true,
    })

    expect(output).toContain('RMS')
    expect(output).toContain('-9.1')
  })

  it('does not call Claude even if ANTHROPIC_API_KEY is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key'

    await runAnalyze({
      scenes: [],
      audio: 'session.wav',
      noAi: true,
    })

    expect(mockAnalyzeWithClaude).not.toHaveBeenCalled()
  })
})
