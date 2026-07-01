import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  analyzeAudio,
  extractChannels,
  loadChannelFiles,
  compareChannels,
  formatMultiChannelReport,
} from '@sound-buddy/audio-engine'
import type { ChannelAnalysis, ChannelFile } from '@sound-buddy/audio-engine'

export interface AnalyzeOptions {
  dir?: string
  json?: boolean
  noAi?: boolean
  scene?: string[]
}

export interface AnalyzeIO {
  log?: (s: string) => void
  error?: (s: string) => void
  exit?: (code: number) => void
}

const BAND_LABELS: Record<string, string> = {
  subBass: 'Sub-bass',
  bass: 'Bass',
  lowMid: 'Low-mid',
  mid: 'Mid',
  highMid: 'High-mid',
  presence: 'Presence',
  brilliance: 'Brilliance',
}

function dominantBand(bands: Record<string, number>): string {
  const entries = Object.entries(bands)
  const top = entries.reduce((a, b) => (b[1] > a[1] ? b : a))[0]
  return BAND_LABELS[top] ?? top
}

function printChannelTable(channelAnalyses: ChannelAnalysis[], io: Required<AnalyzeIO>): void {
  const cols = {
    name: Math.max(10, ...channelAnalyses.map((c) => c.channel.name.length)),
    rms: 12,
    peak: 13,
    dyn: 13,
    dominant: 14,
  }

  const header = [
    'Channel'.padEnd(cols.name),
    'RMS dBFS'.padEnd(cols.rms),
    'Peak dBFS'.padEnd(cols.peak),
    'Dyn Range'.padEnd(cols.dyn),
    'Dominant Band',
  ].join('  ')

  io.log(header)
  io.log('-'.repeat(header.length))

  for (const { channel, analysis } of channelAnalyses) {
    const { sox, spectrum } = analysis
    const rmsStr = isFinite(sox.rmsDbfs) ? sox.rmsDbfs.toFixed(2) + ' dBFS' : '-inf dBFS'
    const peakStr = isFinite(sox.peakDbfs) ? sox.peakDbfs.toFixed(2) + ' dBFS' : '-inf dBFS'
    const dynStr = sox.dynamicRangeDb.toFixed(2) + ' dB'

    io.log(
      [
        channel.name.padEnd(cols.name),
        rmsStr.padEnd(cols.rms),
        peakStr.padEnd(cols.peak),
        dynStr.padEnd(cols.dyn),
        dominantBand(spectrum.bands),
      ].join('  ')
    )
  }
}

function outputJson(channelAnalyses: ChannelAnalysis[], io: Required<AnalyzeIO>): void {
  const channels = channelAnalyses.map(({ channel, analysis }) => ({
    name: channel.name,
    rmsDbfs: analysis.sox.rmsDbfs,
    peakDbfs: analysis.sox.peakDbfs,
    dynamicRangeDb: analysis.sox.dynamicRangeDb,
    bands: analysis.spectrum.bands,
    dominantBand: dominantBand(analysis.spectrum.bands),
  }))
  io.log(JSON.stringify({ channels }, null, 2))
}

async function analyzeChannelSafe(ch: ChannelFile, io: Required<AnalyzeIO>): Promise<ChannelAnalysis | null> {
  try {
    const analysis = await analyzeAudio(ch.tmpPath)
    return { channel: ch, analysis }
  } catch (err) {
    io.error(`Warning: failed to analyze channel "${ch.name}": ${String(err)}`)
    return null
  }
}

export async function runAnalyze(
  file: string | undefined,
  opts: AnalyzeOptions,
  io: AnalyzeIO = {}
): Promise<void> {
  const log = io.log ?? console.log
  const error = io.error ?? ((s: string) => console.error(s))
  const exit = io.exit ?? process.exit
  const fullIo: Required<AnalyzeIO> = { log, error, exit }

  if (opts.dir) {
    await runDirectory(opts.dir, opts, fullIo)
    return
  }

  if (!file) {
    error('Usage: buddy analyze <file>  OR  buddy analyze --dir <directory>')
    exit(1)
    return
  }

  const resolved = resolve(file)
  if (!existsSync(resolved)) {
    error('Error: file not found')
    exit(1)
    return
  }

  await runSingleFile(resolved, opts, fullIo)
}

async function runSingleFile(
  filePath: string,
  opts: AnalyzeOptions,
  io: Required<AnalyzeIO>
): Promise<void> {
  let analysis
  try {
    analysis = await analyzeAudio(filePath)
  } catch (err) {
    io.error(`Analysis failed: ${String(err)}`)
    io.exit(1)
    return
  }

  const channelCount = analysis.ffprobe.stream.channels

  if (channelCount <= 2) {
    const channelAnalyses: ChannelAnalysis[] = [
      {
        channel: { index: 0, name: filePath.split('/').pop() ?? filePath, tmpPath: filePath, needsCleanup: false },
        analysis,
      },
    ]

    if (opts.json) {
      outputJson(channelAnalyses, io)
      return
    }

    io.log('=== Per-Channel Summary ===')
    printChannelTable(channelAnalyses, io)
    return
  }

  // Multi-channel WAV
  let channelFiles: ChannelFile[]
  try {
    channelFiles = await extractChannels(filePath, [])
  } catch (err) {
    io.error(`Failed to extract channels: ${String(err)}`)
    io.exit(1)
    return
  }

  const results = await Promise.all(channelFiles.map((ch) => analyzeChannelSafe(ch, io)))
  const channelAnalyses = results.filter((r): r is ChannelAnalysis => r !== null)

  if (channelAnalyses.length === 0) {
    io.error('All channel analyses failed.')
    io.exit(1)
    return
  }

  if (opts.json) {
    outputJson(channelAnalyses, io)
    return
  }

  const comparison = compareChannels(channelAnalyses)

  io.log('=== Per-Channel Summary ===')
  printChannelTable(channelAnalyses, io)
  io.log('')
  io.log(formatMultiChannelReport(channelAnalyses, comparison))
  io.log("--- Multi-Channel Engineer's Read ---")
}

async function runDirectory(
  dir: string,
  opts: AnalyzeOptions,
  io: Required<AnalyzeIO>
): Promise<void> {
  let channelFiles: ChannelFile[]
  try {
    channelFiles = await loadChannelFiles(dir)
  } catch (err) {
    io.error(`Failed to read directory: ${String(err)}`)
    io.exit(1)
    return
  }

  if (channelFiles.length === 0) {
    io.error(`No audio files found in: ${dir}`)
    io.exit(1)
    return
  }

  const results = await Promise.all(channelFiles.map((ch) => analyzeChannelSafe(ch, io)))
  const channelAnalyses = results.filter((r): r is ChannelAnalysis => r !== null)

  if (channelAnalyses.length === 0) {
    io.error('All channel analyses failed.')
    io.exit(1)
    return
  }

  if (opts.json) {
    outputJson(channelAnalyses, io)
    return
  }

  const comparison = compareChannels(channelAnalyses)

  io.log('=== Per-Channel Summary ===')
  printChannelTable(channelAnalyses, io)
  io.log('')
  io.log(formatMultiChannelReport(channelAnalyses, comparison))
}
