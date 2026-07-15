import type { AudioAnalysisResult, ChannelResult } from '@sound-buddy/shared'
import type { ChannelAnalysis } from './types.js'
import { dominantBandLabel } from './bands.js'

/** Map one analyzed channel to its flat, IPC-safe summary (see @sound-buddy/shared). */
export function toChannelResult({ channel, analysis }: ChannelAnalysis): ChannelResult {
  return {
    name: channel.name,
    rmsDbfs: analysis.sox.rmsDbfs,
    peakDbfs: analysis.sox.peakDbfs,
    dynamicRangeDb: analysis.sox.dynamicRangeDb,
    dominantBand: dominantBandLabel(analysis.spectrum.bands),
  }
}

/** Produce the canonical serialization-safe analysis summary for a set of channels. */
export function toAnalysisSummary(analyses: ChannelAnalysis[]): AudioAnalysisResult {
  return { channels: analyses.map(toChannelResult) }
}
