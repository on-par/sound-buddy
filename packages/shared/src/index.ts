// Cross-package DTOs shared among the Sound Buddy TypeScript workspace packages
// (scene-inspector, audio-engine, cli). These are the flat,
// serialization-safe shapes that cross package boundaries.
//
// Mostly NOT consumed by app/ (a separately-bundled, proprietary Electron
// target): the one exception is AnalysisPayload (analysis-payload.ts), which
// app/electron and app/renderer type-import to type the analyze-file IPC seam
// (see the scene-diff precedent in app/electron/scene-diff-format.ts).
// audio-engine's rich *internal* analysis types (SoxStats, AudioAnalysis,
// SpectrumResult live in audio-engine/src/types.ts) stay out of this package
// — AnalysisPayload mirrors them at the boundary instead.

export type {
  AnalysisPayload, AnalysisPayloadSox, AnalysisPayloadFormat, AnalysisPayloadStream,
  AnalysisPayloadFfprobe, AnalysisPayloadBands, AnalysisPayloadCurve,
  AnalysisPayloadContentClass, AnalysisPayloadContentType, AnalysisPayloadFrame,
  AnalysisPayloadSegment, AnalysisPayloadSpectrum, AnalysisPayloadLoudness,
} from './analysis-payload.js'

export { buildReleaseNotes, INSTALL_INTRO, UNSIGNED_STEPS } from './install-instructions.js'
export type { BuildReleaseNotesOptions } from './install-instructions.js'

export {
  buildReleaseManifest, buildReleaseManifestPreview, parseReleaseManifest, validateReleaseManifest,
  summarizeReleaseNotes, verifyUploadedArtifactChecksum,
  RELEASE_MANIFEST_SCHEMA_VERSION, RELEASE_CHANNEL_LATEST, RELEASE_MANIFEST_FILENAME,
  ELECTRON_UPDATER_MANIFEST_FILENAME,
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
  resolveSigningConfig, isMachOBinary, parseSpctlAssessment, parseStaplerValidation,
  planCodesignBatches, CODESIGN_BATCH_SIZE, parseCodesigningIdentity, redactSecrets, REDACTED,
} from './signing.js'
export type { SigningConfig, SpctlVerdict, StaplerVerdict, NotaryAuth } from './signing.js'

export {
  isPrunablePythonDir, isPrunablePythonFile, PYTHON_PRUNE_VERSION,
} from './python-prune.js'

export {
  BANNED_VIDEO_LIB_PATTERN, FFMPEG_BUILD_VERSION, FFMPEG_VERSION, MEDIA_FIXTURE_FORMATS,
  ffmpegConfigureArgs, ffmpegTarballUrl, findBannedVideoLibs, findDanglingBundledLibRefs,
  hasAudioStream, parseOtoolLibraryPaths,
} from './ffmpeg-audio-only.js'
export type { MediaFixtureFormat } from './ffmpeg-audio-only.js'

export {
  selectDmgArtifacts, planDmgNotarization, DMG_EXTENSION, KEYCHAIN_PROFILE_VAR,
} from './dmg-notarization.js'
export type { DmgNotarizationStep, DmgNotarizationPlan } from './dmg-notarization.js'

export {
  resolveCiSigningSecrets, CI_SIGNING_SECRET_VARS,
} from './ci-signing.js'
export type { CiSigningSecretsVerdict } from './ci-signing.js'

export { auditReleaseWorkflow } from './release-workflow.js'
export type { ReleaseWorkflowAudit } from './release-workflow.js'

export {
  planReleasePublish, evaluateReleasePreflight, formatPublishFailure, resumeCommand, classifyWorkingTree,
  planUpdateInfoUpload, selectReleaseByTag,
  findReleaseAssetId, buildReleaseAssetUploadUrl, releaseAssetApiPath, auditReleaseScriptResolution,
  PUBLISH_STEPS,
} from './release-publish.js'
export type {
  PublishStep, PublishState, ExistingRelease, PublishTargets, PublishStepPlan, PublishPlan,
  PreflightVerdict, PublishOutcomeInput, TreeState, UpdateInfoUploadPlan,
  ReleaseListEntry, SelectedRelease,
  ReleaseAssetRef, ReleaseScriptAudit,
} from './release-publish.js'

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

/** AI-analyst input summary (epic #656), not yet wired — see AudioAnalysisResult. */
export interface AnalystInput {
  diff?: SceneDiff
  audio?: AudioAnalysisResult
}

/**
 * AI-analyst input summary (epic #656) — a flat, JSON/IPC-safe per-channel
 * analysis summary that an AI-analyst feature will consume. NOT yet wired and
 * NOT the analyze-file boundary shape: that is AnalysisPayload
 * (analysis-payload.ts). Kept for the future analyst feature; produced by
 * audio-engine's toAnalysisSummary().
 */
export interface AudioAnalysisResult {
  channels: ChannelResult[]
}

/** One channel's entry in an AI-analyst input summary (epic #656), not yet wired. */
export interface ChannelResult {
  name: string
  rmsDbfs: number
  peakDbfs: number
  dynamicRangeDb: number
  dominantBand: string
}
