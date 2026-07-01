import { readFileSync } from 'node:fs'
import { parseScene, diffScenes } from '@sound-buddy/scene-inspector'
import { analyzeAudio } from '@sound-buddy/audio-engine'
import { analyzeWithClaude } from '@sound-buddy/ai-analyst'
import type { SceneDiff, AnalystInput, Insight } from '@sound-buddy/shared'
import type { AudioAnalysis } from '@sound-buddy/audio-engine/dist/types.js'

export interface AnalyzeOptions {
  scenes: string[]
  audio?: string
  noAi: boolean
}

export async function runAnalyze(opts: AnalyzeOptions): Promise<string> {
  const lines: string[] = []

  let diff: SceneDiff | undefined

  if (opts.scenes.length === 2) {
    const [contentA, contentB] = opts.scenes.map(f => readFileSync(f, 'utf8'))
    const [sceneA, sceneB] = [parseScene(contentA), parseScene(contentB)]
    diff = diffScenes(sceneA, sceneB)

    lines.push('=== Scene Diff ===')
    lines.push(diff.summary)
    for (const change of diff.changes) {
      lines.push(`  ${change.label}: ${change.from} → ${change.to}`)
    }
    lines.push('')
  }

  let audio: AudioAnalysis | undefined

  if (opts.audio) {
    audio = await analyzeAudio(opts.audio)

    lines.push('=== Audio Measurements ===')
    lines.push(`  RMS:           ${audio.sox.rmsDbfs.toFixed(1)} dBFS`)
    lines.push(`  Peak:          ${audio.sox.peakDbfs.toFixed(1)} dBFS`)
    lines.push(`  Dynamic Range: ${audio.sox.dynamicRangeDb.toFixed(1)} dB`)
    lines.push('')
  }

  const shouldCallAi = !opts.noAi && (opts.audio || diff)

  if (shouldCallAi) {
    const input: AnalystInput = {}
    if (diff) input.diff = diff
    if (audio) {
      input.audio = {
        channels: [{
          name: opts.audio ?? 'main',
          rmsDbfs: audio.sox.rmsDbfs,
          peakDbfs: audio.sox.peakDbfs,
          dynamicRangeDb: audio.sox.dynamicRangeDb,
          dominantBand: 'mid',
        }],
      }
    }

    const insights: Insight[] = await analyzeWithClaude(input)

    if (insights.length > 0) {
      lines.push('=== AI Insights ===')
      for (const insight of insights) {
        const tag = insight.severity === 'warning' ? '⚠' : insight.severity === 'suggestion' ? '→' : 'ℹ'
        lines.push(`  ${tag} ${insight.message}`)
      }
      lines.push('')
    }
  }

  return lines.join('\n')
}
