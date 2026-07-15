import { describe, it, expect, vi } from 'vitest'
import type { AudioAnalysisResult, SceneDiff } from '@sound-buddy/shared'
import { ANALYST_SYSTEM_PROMPT } from '@sound-buddy/audio-engine'
import type { NarrativePort, NarrativeResult } from '@sound-buddy/audio-engine/dist/narrative/port.js'
import { PiNarrativeAdapter } from '@sound-buddy/audio-engine/dist/narrative/pi-adapter.js'
import { buildPrompt, parseInsights, generateInsights, defaultNarrativePort } from './insights.js'

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

function fakePort(chunks: string[], result: NarrativeResult): NarrativePort {
  return {
    streamNarrative: vi.fn(async (_sys, _msg, onDelta) => {
      chunks.forEach(onDelta)
      return result
    }),
    listModels: vi.fn(async () => []),
  }
}

describe('generateInsights', () => {
  it('streams the narrative, accumulates chunks, and returns Insight[]', async () => {
    const insight = {
      type: 'level',
      channel: 'Lead Vocal',
      message: 'Lead Vocal RMS is at -18 dBFS, consider boosting fader slightly.',
      severity: 'suggestion',
    }
    const json = JSON.stringify([insight])
    const mid = Math.floor(json.length / 2)
    const port = fakePort([json.slice(0, mid), json.slice(mid)], {
      ok: true,
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    })

    const insights = await generateInsights({ audio: sampleAudio }, port)

    expect(insights).toEqual([insight])
    expect(port.streamNarrative).toHaveBeenCalledWith(
      ANALYST_SYSTEM_PROMPT,
      expect.any(String),
      expect.any(Function)
    )
  })

  it('rejects with an AiError when the port reports failure', async () => {
    const port = fakePort([], { ok: false, reason: 'no key' })

    await expect(generateInsights({ audio: sampleAudio }, port)).rejects.toThrow('AiError: no key')
  })
})

describe('buildPrompt', () => {
  it('includes audio analysis lines for an audio-only input', () => {
    const prompt = buildPrompt({ audio: sampleAudio })

    expect(prompt).toContain('## Audio Analysis')
    expect(prompt).toContain('Channel "Lead Vocal": RMS=-18 dBFS, Peak=-6 dBFS, Dynamic Range=12 dB, Dominant Band=mid')
    expect(prompt).not.toContain('## Scene Changes')
  })

  it('includes scene diff lines for a diff-only input', () => {
    const prompt = buildPrompt({ diff: sampleDiff })

    expect(prompt).toContain('## Scene Changes')
    expect(prompt).toContain('1 change')
    expect(prompt).toContain('Lead Vocal fader: -10 → -6')
    expect(prompt).not.toContain('## Audio Analysis')
  })

  it('includes both sections when audio and diff are both present', () => {
    const prompt = buildPrompt({ audio: sampleAudio, diff: sampleDiff })

    expect(prompt).toContain('## Audio Analysis')
    expect(prompt).toContain('## Scene Changes')
  })
})

describe('parseInsights', () => {
  it('rejects with a handled ParseError when the text is not valid JSON', () => {
    expect(() => parseInsights("Sorry, I can't analyze that.")).toThrow(
      /ParseError: AI response was not valid JSON/
    )
  })

  it('rejects with a handled ParseError when the JSON is not an array', () => {
    expect(() => parseInsights('{"foo":1}')).toThrow(
      'ParseError: AI response was not a JSON array of insights'
    )
  })
})

describe('defaultNarrativePort', () => {
  it('returns a PiNarrativeAdapter instance', () => {
    expect(defaultNarrativePort()).toBeInstanceOf(PiNarrativeAdapter)
  })
})
