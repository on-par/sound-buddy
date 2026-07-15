import type { AnalystInput, Insight } from '@sound-buddy/shared'
import { ANALYST_SYSTEM_PROMPT } from '@sound-buddy/audio-engine'
import { PiNarrativeAdapter } from '@sound-buddy/audio-engine/dist/narrative/pi-adapter.js'
import type { NarrativePort } from '@sound-buddy/audio-engine/dist/narrative/port.js'

export function buildPrompt(input: AnalystInput): string {
  const parts: string[] = []

  if (input.audio) {
    parts.push('## Audio Analysis')
    for (const ch of input.audio.channels) {
      parts.push(
        `Channel "${ch.name}": RMS=${ch.rmsDbfs} dBFS, Peak=${ch.peakDbfs} dBFS, Dynamic Range=${ch.dynamicRangeDb} dB, Dominant Band=${ch.dominantBand}`
      )
    }
  }

  if (input.diff) {
    parts.push('\n## Scene Changes')
    parts.push(input.diff.summary)
    for (const change of input.diff.changes) {
      parts.push(`${change.label}: ${change.from} → ${change.to}`)
    }
  }

  parts.push(
    '\nReturn a JSON array of insights. Each insight: { type, channel?, message, severity }'
  )
  return parts.join('\n')
}

/**
 * Parse the model's text response into insights. The model can occasionally
 * return prose or malformed JSON instead of the requested array; guard against
 * that so a bad response surfaces as a handled, descriptive error the caller can
 * show in the AI panel rather than an uncaught crash (#152).
 */
export function parseInsights(text: string): Insight[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`ParseError: AI response was not valid JSON: ${detail}`, { cause: err })
  }
  if (!Array.isArray(parsed)) {
    throw new Error('ParseError: AI response was not a JSON array of insights')
  }
  return parsed as Insight[]
}

/** Default port: the unified Pi-backed adapter (TD-004). Constructor is side-effect free. */
export function defaultNarrativePort(): NarrativePort {
  return new PiNarrativeAdapter()
}

/**
 * Generate structured insights over a NarrativePort: stream the narrative,
 * accumulate the text, parse it as an Insight[] JSON array.
 * NarrativePort never throws — an { ok: false } result is surfaced as a
 * thrown Error so runAnalyze's existing "(AI analysis unavailable: ...)"
 * catch path handles it exactly like the old analyzeWithClaude failures.
 */
export async function generateInsights(
  input: AnalystInput,
  port: NarrativePort = defaultNarrativePort()
): Promise<Insight[]> {
  let text = ''
  const result = await port.streamNarrative(ANALYST_SYSTEM_PROMPT, buildPrompt(input), (chunk) => {
    text += chunk
  })
  if (!result.ok) throw new Error(`AiError: ${result.reason}`)
  return parseInsights(text)
}
