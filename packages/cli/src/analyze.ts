import { readFileSync, existsSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { parseScene, diffScenes } from '@sound-buddy/scene-inspector'
import {
  analyzeAudio,
  extractChannels,
  loadChannelFiles,
  compareChannels,
  formatMultiChannelReport,
  cleanupChannelFiles,
  dominantBandLabel,
  formatChannelTable,
  toAnalysisSummary,
} from '@sound-buddy/audio-engine'
import type { ChannelAnalysis, ChannelFile } from '@sound-buddy/audio-engine'
import type { NarrativePort } from '@sound-buddy/audio-engine/dist/narrative/port.js'
import { generateInsights } from './insights.js'
import type { SceneDiff, AnalystInput } from '@sound-buddy/shared'

export interface AnalyzeOptions {
  /** Two .scn files (before/after) for a scene diff. */
  scenes?: string[]
  /** Directory of per-channel audio files. */
  dir?: string
  /** Emit machine-readable JSON instead of a formatted report. */
  json?: boolean
  /** Skip the supplementary AI insights pass. */
  noAi?: boolean
}

/** Injectable I/O so the command is testable without touching real stdio. */
export interface AnalyzeIO {
  log?: (s: string) => void
  error?: (s: string) => void
  exit?: (code: number) => void
  /** Injectable so tests can stub the AI pass without a real provider. */
  narrativePort?: NarrativePort
}

function printChannelTable(channelAnalyses: ChannelAnalysis[], log: (s: string) => void): void {
  for (const line of formatChannelTable(channelAnalyses)) log(line)
}

function outputJson(
  channelAnalyses: ChannelAnalysis[],
  diff: SceneDiff | undefined,
  log: (s: string) => void
): void {
  const channels = channelAnalyses.map(({ channel, analysis }) => {
    const { spectrum } = analysis
    return {
      name: channel.name,
      rmsDbfs: analysis.sox.rmsDbfs,
      peakDbfs: analysis.sox.peakDbfs,
      dynamicRangeDb: analysis.sox.dynamicRangeDb,
      bands: spectrum.bands,
      dominantBand: dominantBandLabel(spectrum.bands),
      // Whole-file frequency response (PRD 02) and time-sampled snapshots (PRD 03).
      // Optional on SpectrumResult for back-compat, so only emit when present.
      ...(spectrum.curve ? { curve: spectrum.curve } : {}),
      ...(spectrum.frames ? { frames: spectrum.frames } : {}),
      // Speech/music delineation (PRD 04). Emitted only when the classifier ran
      // (older spectrum.py builds omit these), so the shape stays back-compatible.
      ...(spectrum.contentType ? { contentType: spectrum.contentType } : {}),
      ...(spectrum.segments ? { segments: spectrum.segments } : {}),
    }
  })
  log(JSON.stringify(diff ? { diff, channels } : { channels }, null, 2))
}

async function analyzeChannelSafe(
  ch: ChannelFile,
  error: (s: string) => void
): Promise<ChannelAnalysis | null> {
  try {
    const analysis = await analyzeAudio(ch.tmpPath)
    return { channel: ch, analysis }
  } catch (err) {
    error(`Warning: failed to analyze channel "${ch.name}": ${String(err)}`)
    return null
  }
}

/**
 * `buddy analyze` — the unified audio/scene analysis command.
 *
 * Handles, in any combination:
 *   - a scene diff from two `--scene` files
 *   - a single audio file (mono/stereo per-channel summary, or an auto-detected
 *     multi-channel WAV that is split into per-channel measurements)
 *   - a `--dir` of per-channel files
 *   - `--json` machine output
 *   - a supplementary AI insights pass (skipped with `--no-ai` or `--json`)
 */
export async function runAnalyze(
  file: string | undefined,
  opts: AnalyzeOptions = {},
  io: AnalyzeIO = {}
): Promise<void> {
  const log = io.log ?? console.log
  const error = io.error ?? ((s: string) => console.error(s))
  const exit = io.exit ?? process.exit
  const scenes = opts.scenes ?? []

  if (scenes.length !== 0 && scenes.length !== 2) {
    error('buddy analyze: --scene requires exactly two files (before and after)')
    exit(1)
    return
  }

  // --- Scene diff ---------------------------------------------------------
  let diff: SceneDiff | undefined
  if (scenes.length === 2) {
    for (const f of scenes) {
      if (!existsSync(f)) {
        error(`buddy analyze: scene file not found: ${f}`)
        exit(1)
        return
      }
    }
    const [contentA, contentB] = scenes.map((f) => readFileSync(f, 'utf8'))
    diff = diffScenes(parseScene(contentA), parseScene(contentB))

    if (!opts.json) {
      log('=== Scene Diff ===')
      log(diff.summary)
      for (const change of diff.changes) {
        log(`  ${change.label}: ${change.from} → ${change.to}`)
      }
      log('')
    }
  }

  // --- Audio measurements -------------------------------------------------
  let channelAnalyses: ChannelAnalysis[] = []
  let multiChannel = false

  if (opts.dir) {
    const collected = await collectDirectory(opts.dir, error, exit)
    if (!collected) return
    channelAnalyses = collected
    multiChannel = true
  } else if (file) {
    const resolved = resolve(file)
    if (!existsSync(resolved)) {
      error(`Error: file not found: ${file}`)
      exit(1)
      return
    }
    const collected = await collectFile(resolved, error, exit)
    if (!collected) return
    channelAnalyses = collected.channels
    multiChannel = collected.multiChannel
  } else if (scenes.length === 0) {
    error('Usage: buddy analyze <file>  OR  buddy analyze --dir <directory>  OR  buddy analyze --scene <a> --scene <b>')
    exit(1)
    return
  }

  // --- JSON short-circuit -------------------------------------------------
  if (opts.json) {
    outputJson(channelAnalyses, diff, log)
    return
  }

  // --- Formatted report ---------------------------------------------------
  // Multi-channel runs render the richer report (which already contains the
  // per-channel table); single mono/stereo files just get the summary table.
  if (channelAnalyses.length > 0) {
    if (multiChannel) {
      const comparison = compareChannels(channelAnalyses)
      log(formatMultiChannelReport(channelAnalyses, comparison))
    } else {
      log('=== Per-Channel Summary ===')
      printChannelTable(channelAnalyses, log)
      log('')
    }
  }

  // --- AI insights / engineer's read (supplementary) ---------------------
  // The heading matches the domain language of each mode; the section is only
  // emitted when there is something to show, so no empty header is ever left
  // dangling.
  if (!opts.noAi && (channelAnalyses.length > 0 || diff)) {
    const heading = multiChannel ? "--- Multi-Channel Engineer's Read ---" : '=== AI Insights ==='
    const input: AnalystInput = {}
    if (diff) input.diff = diff
    if (channelAnalyses.length > 0) {
      input.audio = toAnalysisSummary(channelAnalyses)
    }

    // The AI call is supplementary — if it fails, keep the measurements already
    // printed above rather than discarding all output.
    try {
      const insights = await generateInsights(input, io.narrativePort)
      if (insights.length > 0) {
        log(heading)
        for (const insight of insights) {
          const tag = insight.severity === 'warning' ? '⚠' : insight.severity === 'suggestion' ? '→' : 'ℹ'
          log(`  ${tag} ${insight.message}`)
        }
        log('')
      }
    } catch (err) {
      log(heading)
      log(`  (AI analysis unavailable: ${err instanceof Error ? err.message : String(err)})`)
      log('')
    }
  }
}

/** Analyze a single file, splitting multi-channel WAVs into per-channel measurements. */
async function collectFile(
  filePath: string,
  error: (s: string) => void,
  exit: (code: number) => void
): Promise<{ channels: ChannelAnalysis[]; multiChannel: boolean } | null> {
  let analysis
  try {
    analysis = await analyzeAudio(filePath)
  } catch (err) {
    error(`Analysis failed: ${String(err)}`)
    exit(1)
    return null
  }

  if (analysis.ffprobe.stream.channels <= 2) {
    return {
      channels: [
        {
          channel: { index: 0, name: basename(filePath), tmpPath: filePath, needsCleanup: false },
          analysis,
        },
      ],
      multiChannel: false,
    }
  }

  // Multi-channel WAV — split into one file per channel.
  let channelFiles: ChannelFile[]
  try {
    channelFiles = await extractChannels(filePath, [])
  } catch (err) {
    error(`Failed to extract channels: ${String(err)}`)
    exit(1)
    return null
  }

  // extractChannels writes per-channel temp WAVs (needsCleanup: true); remove
  // them once every channel has been analyzed, regardless of success/failure.
  try {
    const channels = await analyzeChannels(channelFiles, error, exit)
    return channels ? { channels, multiChannel: true } : null
  } finally {
    cleanupChannelFiles(channelFiles)
  }
}

/** Analyze a directory of per-channel files. */
async function collectDirectory(
  dir: string,
  error: (s: string) => void,
  exit: (code: number) => void
): Promise<ChannelAnalysis[] | null> {
  let channelFiles: ChannelFile[]
  try {
    channelFiles = await loadChannelFiles(dir)
  } catch (err) {
    error(`Failed to read directory: ${String(err)}`)
    exit(1)
    return null
  }

  if (channelFiles.length === 0) {
    error(`No audio files found in: ${dir}`)
    exit(1)
    return null
  }

  // loadChannelFiles may split a multi-channel source into temp WAVs
  // (needsCleanup: true); remove any it created once analysis is done.
  try {
    return await analyzeChannels(channelFiles, error, exit)
  } finally {
    cleanupChannelFiles(channelFiles)
  }
}

async function analyzeChannels(
  channelFiles: ChannelFile[],
  error: (s: string) => void,
  exit: (code: number) => void
): Promise<ChannelAnalysis[] | null> {
  const results = await Promise.all(channelFiles.map((ch) => analyzeChannelSafe(ch, error)))
  const channelAnalyses = results.filter((r): r is ChannelAnalysis => r !== null)

  if (channelAnalyses.length === 0) {
    error('All channel analyses failed.')
    exit(1)
    return null
  }

  return channelAnalyses
}
