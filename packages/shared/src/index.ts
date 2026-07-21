// Cross-package DTOs shared among the Sound Buddy TypeScript workspace packages
// (scene-inspector, audio-engine, cli). These are the flat,
// serialization-safe shapes that cross package boundaries.
//
// Intentionally NOT consumed by app/ (a separately-bundled, proprietary Electron
// target) or by audio-engine's rich *internal* analysis types (SoxStats,
// AudioAnalysis, SpectrumResult live in audio-engine/src/types.ts). audio-engine
// depends on this package only to PRODUCE the boundary summary below.

export { buildReleaseNotes, INSTALL_INTRO, UNSIGNED_STEPS } from './install-instructions.js'
export type { BuildReleaseNotesOptions } from './install-instructions.js'

export {
  buildReleaseManifest, buildReleaseManifestPreview, parseReleaseManifest, validateReleaseManifest,
  summarizeReleaseNotes, verifyUploadedArtifactChecksum,
  RELEASE_MANIFEST_SCHEMA_VERSION, RELEASE_CHANNEL_LATEST, RELEASE_MANIFEST_FILENAME,
  RELEASE_MANIFEST_URL, SHA256_HEX_PATTERN, NOTES_SUMMARY_MAX_CHARS, DRY_RUN_MEASURED_PLACEHOLDER,
} from './release-manifest.js'
export type {
  ReleaseManifest, ReleaseManifestValidation, ReleaseManifestPreview,
  BuildReleaseManifestPreviewInput, ChecksumVerification,
} from './release-manifest.js'

export {
  runReleaseSmoke, formatSmokeReport, checkManifestLayer, checkArtifactLayer,
  checkSiteRouteLayer, checkAppUpdateLayer, isNewerVersion,
  SMOKE_LAYERS, SITE_DOWNLOAD_URL, DEFAULT_BASELINE_APP_VERSION,
} from './release-smoke.js'
export type {
  SmokeLayer, SmokeCheckResult, ReleaseSmokeReport, ReleaseSmokeFetchers,
} from './release-smoke.js'

export {
  resolveSigningConfig, isMachOBinary, parseNotarySubmission, parseSpctlAssessment,
  planCodesignBatches, CODESIGN_BATCH_SIZE,
} from './signing.js'
export type { SigningConfig, NotarySubmissionResult, SpctlVerdict } from './signing.js'

export interface EQBand {
  type: string
  freq: number
  gain: number
  q: number
}

export interface ChannelMix {
  on: boolean
  fader: number
}

export interface ChannelPreamp {
  gain: number
}

export interface Channel {
  name: string
  mix: ChannelMix
  preamp: ChannelPreamp
  eq: { bands: EQBand[] }
}

export interface DCA {
  on: boolean
  level: number
  name: string
}

export interface Scene {
  name: string
  version: string
  channels: Channel[]
  dcas: DCA[]
}

export interface SceneChange {
  path: string
  label: string
  from: unknown
  to: unknown
}

export interface SceneDiff {
  changes: SceneChange[]
  summary: string
  bySection: {
    channels: SceneChange[]
    dcas: SceneChange[]
    main: SceneChange[]
  }
}

export interface Insight {
  type: string
  channel?: string
  message: string
  severity: 'info' | 'warning' | 'suggestion'
}

export interface AnalystInput {
  diff?: SceneDiff
  audio?: AudioAnalysisResult
}

/**
 * Flat, JSON/IPC-safe per-channel analysis summary. This is the boundary shape
 * consumed by the CLI insights pass and emitted to machine-readable output — deliberately a
 * primitive-only subset of audio-engine's internal ChannelAnalysis. Produced by
 * audio-engine's toAnalysisSummary().
 */
export interface AudioAnalysisResult {
  channels: ChannelResult[]
}

export interface ChannelResult {
  name: string
  rmsDbfs: number
  peakDbfs: number
  dynamicRangeDb: number
  dominantBand: string
}
