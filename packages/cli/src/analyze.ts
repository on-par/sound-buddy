import { readFileSync, existsSync } from 'node:fs'
import { basename } from 'node:path'
import { parseScene, diffScenes } from '@sound-buddy/scene-inspector'
import { analyzeAudio } from '@sound-buddy/audio-engine'
import type { AudioAnalysis } from '@sound-buddy/audio-engine'
import { analyzeWithClaude } from '@sound-buddy/ai-analyst'
import type { SceneDiff, AnalystInput, Insight } from '@sound-buddy/shared'

export interface AnalyzeOptions {
  scenes: string[]
  audio?: string
  noAi: boolean
}

export async function runAnalyze(opts: AnalyzeOptions): Promise<string> {
  if (opts.scenes.length !== 0 && opts.scenes.length !== 2) {
    throw new Error('buddy analyze: --scene requires exactly two files (before and after)')
  }
  if (!opts.audio && opts.scenes.length === 0) {
    throw new Error('buddy analyze: provide an audio file and/or two --scene files (see --help)')
  }

  const lines: string[] = []

  let diff: SceneDiff | undefined

  if (opts.scenes.length === 2) {
    for (const f of opts.scenes) {
      if (!existsSync(f)) throw new Error(`buddy analyze: scene file not found: ${f}`)
    }
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
    if (!existsSync(opts.audio)) {
      throw new Error(`buddy analyze: audio file not found: ${opts.audio}`)
    }
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
          name: opts.audio ? basename(opts.audio) : 'main',
          rmsDbfs: audio.sox.rmsDbfs,
          peakDbfs: audio.sox.peakDbfs,
          dynamicRangeDb: audio.sox.dynamicRangeDb,
          dominantBand: dominantBand(audio),
        }],
      }
    }

    // The AI call is supplementary — if it fails, keep the measurements already
    // computed above rather than discarding all output.
    try {
      const insights: Insight[] = await analyzeWithClaude(input)

      if (insights.length > 0) {
        lines.push('=== AI Insights ===')
        for (const insight of insights) {
          const tag = insight.severity === 'warning' ? '⚠' : insight.severity === 'suggestion' ? '→' : 'ℹ'
          lines.push(`  ${tag} ${insight.message}`)
        }
        lines.push('')
      }
    } catch (err) {
      lines.push(`=== AI Insights ===`)
      lines.push(`  (AI analysis unavailable: ${err instanceof Error ? err.message : String(err)})`)
      lines.push('')
    }
  }

  return lines.join('\n')
}

/** Pick the loudest frequency band from the analyzed spectrum. */
function dominantBand(audio: AudioAnalysis): string {
  const bands = Object.entries(audio.spectrum.bands) as [string, number][]
  if (bands.length === 0) return 'mid'
  return bands.reduce((a, b) => (b[1] > a[1] ? b : a))[0]
}
