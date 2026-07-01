import type { AnalystInput, Insight } from '@sound-buddy/shared'

export async function analyzeWithClaude(_input: AnalystInput): Promise<Insight[]> {
  throw new Error('Not implemented')
}

export async function analyzeWithClaudeStream(
  _input: AnalystInput,
  _onChunk: (text: string) => void
): Promise<void> {
  throw new Error('Not implemented')
}
