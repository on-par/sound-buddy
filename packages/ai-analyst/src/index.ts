import Anthropic from '@anthropic-ai/sdk'
import type { AnalystInput, Insight } from '@sound-buddy/shared'

const SYSTEM_PROMPT = `You are an expert live sound engineer specializing in the Midas M32R digital mixing console.
Analyze the provided audio measurements and/or scene changes and return actionable insights for the engineer.
Reference actual dB values in your insights. Be specific about channel names.
When returning structured insights, respond with a valid JSON array of insight objects matching this shape:
{ type: string, channel?: string, message: string, severity: "info" | "warning" | "suggestion" }
Return ONLY the JSON array, no prose wrapper.`

function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ConfigError: ANTHROPIC_API_KEY is required')
  }
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

function buildPrompt(input: AnalystInput): string {
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

export async function analyzeWithClaude(input: AnalystInput): Promise<Insight[]> {
  const client = getClient()

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildPrompt(input) }],
  })

  const text = response.content.find((b) => b.type === 'text')?.text ?? '[]'
  return JSON.parse(text) as Insight[]
}

export async function analyzeWithClaudeStream(
  input: AnalystInput,
  onChunk: (text: string) => void
): Promise<void> {
  const client = getClient()

  const stream = client.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildPrompt(input) }],
  })

  for await (const event of stream) {
    if (
      event.type === 'content_block_delta' &&
      event.delta.type === 'text_delta'
    ) {
      onChunk(event.delta.text)
    }
  }
}
