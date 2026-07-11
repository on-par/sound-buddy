import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AudioAnalysisResult, SceneDiff } from '@sound-buddy/shared'

const mockCreate = vi.fn()
const mockStream = vi.fn()

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class Anthropic {
      messages = {
        create: mockCreate,
        stream: mockStream,
      }
    },
  }
})

const sampleAudio: AudioAnalysisResult = {
  channels: [
    {
      name: 'Lead Vocal',
      rmsDbfs: -18,
      peakDbfs: -6,
      dynamicRangeDb: 12,
      dominantBand: 'mid',
    },
    {
      name: 'Kick',
      rmsDbfs: -12,
      peakDbfs: -3,
      dynamicRangeDb: 9,
      dominantBand: 'sub',
    },
  ],
}

const sampleDiff: SceneDiff = {
  changes: [
    {
      path: 'channels.0.mix.fader',
      label: 'Lead Vocal fader',
      from: -10,
      to: -6,
    },
  ],
  summary: '1 change',
  bySection: {
    channels: [
      {
        path: 'channels.0.mix.fader',
        label: 'Lead Vocal fader',
        from: -10,
        to: -6,
      },
    ],
    dcas: [],
    main: [],
  },
}

describe('analyzeWithClaude', () => {
  let originalKey: string | undefined

  beforeEach(() => {
    originalKey = process.env.ANTHROPIC_API_KEY
    vi.clearAllMocks()
  })

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY
    } else {
      process.env.ANTHROPIC_API_KEY = originalKey
    }
  })

  it('throws ConfigError when ANTHROPIC_API_KEY is not set', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const { analyzeWithClaude } = await import('./index.js')
    await expect(analyzeWithClaude({ audio: sampleAudio })).rejects.toThrow(
      'ConfigError: ANTHROPIC_API_KEY is required'
    )
  })

  it('returns Insight[] for audio-only analysis', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: JSON.stringify([
            {
              type: 'level',
              channel: 'Lead Vocal',
              message: 'Lead Vocal RMS is at -18 dBFS, consider boosting fader slightly.',
              severity: 'suggestion',
            },
          ]),
        },
      ],
    })

    const { analyzeWithClaude } = await import('./index.js')
    const insights = await analyzeWithClaude({ audio: sampleAudio })

    expect(Array.isArray(insights)).toBe(true)
    expect(insights.length).toBeGreaterThanOrEqual(1)
    for (const insight of insights) {
      expect(typeof insight.type).toBe('string')
      expect(typeof insight.message).toBe('string')
      expect(['info', 'warning', 'suggestion']).toContain(insight.severity)
      if (insight.channel !== undefined) {
        expect(typeof insight.channel).toBe('string')
      }
    }
  })

  it('rejects with a handled ParseError when the model returns non-JSON', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: 'Sorry, I could not analyze that audio right now.',
        },
      ],
    })

    const { analyzeWithClaude } = await import('./index.js')
    await expect(analyzeWithClaude({ audio: sampleAudio })).rejects.toThrow(
      /ParseError: AI response was not valid JSON/
    )
  })

  it('rejects with a handled ParseError when the JSON is not an array', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ message: 'not an array' }),
        },
      ],
    })

    const { analyzeWithClaude } = await import('./index.js')
    await expect(analyzeWithClaude({ audio: sampleAudio })).rejects.toThrow(
      /ParseError: AI response was not a JSON array of insights/
    )
  })

  it('references specific channels when given diff + audio', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: JSON.stringify([
            {
              type: 'scene-change',
              channel: 'Lead Vocal',
              message:
                'Lead Vocal fader raised from -10 to -6 dB; RMS reading of -18 dBFS supports this adjustment.',
              severity: 'info',
            },
          ]),
        },
      ],
    })

    const { analyzeWithClaude } = await import('./index.js')
    const insights = await analyzeWithClaude({ diff: sampleDiff, audio: sampleAudio })

    const hasChannelRef = insights.some((i) => i.channel !== undefined)
    expect(hasChannelRef).toBe(true)

    const mentionsSceneChange = insights.some(
      (i) => i.message.toLowerCase().includes('fader') || i.message.toLowerCase().includes('scene')
    )
    expect(mentionsSceneChange).toBe(true)
  })
})

describe('analyzeWithClaudeStream', () => {
  let originalKey: string | undefined

  beforeEach(() => {
    originalKey = process.env.ANTHROPIC_API_KEY
    vi.clearAllMocks()
  })

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY
    } else {
      process.env.ANTHROPIC_API_KEY = originalKey
    }
  })

  it('calls onChunk with text chunks and accumulates valid prose', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'

    const chunks = ['The mix ', 'sounds balanced. ', 'Consider reducing kick level.']
    const asyncIterable = {
      async *[Symbol.asyncIterator]() {
        for (const text of chunks) {
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text } }
        }
      },
    }
    mockStream.mockReturnValueOnce(asyncIterable)

    const { analyzeWithClaudeStream } = await import('./index.js')
    const received: string[] = []
    await analyzeWithClaudeStream({ audio: sampleAudio }, (chunk) => {
      received.push(chunk)
    })

    expect(received.length).toBeGreaterThan(0)
    const accumulated = received.join('')
    expect(accumulated.length).toBeGreaterThan(0)
    expect(typeof accumulated).toBe('string')
  })
})
