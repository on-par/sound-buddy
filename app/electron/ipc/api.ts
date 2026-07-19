// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The typed IPC contract shared between the Electron preload bridge
// (electron/preload.ts), the main-process handlers (electron/ipc/*.ts), and
// the renderer's useElectron() hook (renderer/src/useElectron.ts). This file
// is pulled into BOTH tsc programs (app/tsconfig.json's CommonJS/node
// program and app/renderer/tsconfig.json's Bundler/DOM program), so it MUST
// stay dependency-free — no imports of `electron`, node builtins, or any
// main-process module.
//
// This is also the renderer-safe DTO home (TD-011, #405): node-side modules
// that produce these shapes (settings.ts, llm-config.ts, storage.ts, ...)
// import their DTOs back from here — a one-way dependency toward the
// boundary type — so the shape is defined exactly once and can't drift.
// `SoundBuddyApi` itself is decomposed into cohesive per-domain
// sub-interfaces (AnalysisApi, LiveApi, ...) so a client can depend on a
// narrow slice instead of the full ~50-method surface; the runtime bridge
// stays a single `window.soundBuddy` object (see api.contract.test.ts for the
// coverage/drift guards).
//
// A few payloads stay `Promise<unknown>` deliberately: `detectOllama` /
// `testLlmProvider` (probe result shapes aren't obviously stable),
// `analyzeFile`'s `data` and the streaming event callbacks (`onLiveEvent`,
// `onPlaybackEvent`, `onAnalysisResult`, `triggerLlmAnalysis`, `onLlmDelta`'s
// upstream) — sharpening those would drag audio-engine's node-only types or a
// large heterogeneous event union into the renderer program. See the TD-011
// PR for the full list.

export interface UpdateSettingsPatch {
  aiEnabled?: boolean;
  idealProfile?: string;
  customIdealProfiles?: unknown[];
  storageDir?: string;
  usageSignalEnabled?: boolean;
  channelLabels?: Record<string, Record<string, string>>;
  channelGroups?: Record<string, PersistedChannelGroup[]>;
  crashReportingEnabled?: boolean;
}

/** A renderer patch: `apiKey` semantics — undefined = keep, '' = clear. */
export interface LlmConfigPatch {
  provider?: string;
  model?: string;
  ollamaHost?: string;
  apiBaseUrl?: string;
  apiKey?: string;
}

export interface TestLlmProviderOpts {
  provider: string;
  apiKey?: string;
  apiBaseUrl?: string;
}

export interface AnalyzeFileOpts {
  filePath: string;
  noSpectrum?: boolean;
}

export interface StartLiveOpts {
  device?: string;
  // Channel-config tokens: "N" (mono) or "N-M" (stereo pair), e.g. ["0","1-2"].
  channels?: string[];
  windowSecs: number;
  // Real-time meter cadence in seconds (default 0.1 in stream.py).
  intervalSecs?: number;
  llmIntervalSecs: number;
  // "monitor" (default) = live view only; "record" = also capture a session.
  mode?: 'monitor' | 'record';
  // Optional output folder for Record mode (defaults to ~/Music/Sound Buddy).
  recordDir?: string;
  // Record mode: which strips to arm as session stems, as channel-config
  // tokens (e.g. ['0', '2-3']). Omitted ⇒ stream.py arms all configured strips.
  arm?: string[];
  // Record mode: per-strip display labels aligned index-for-index with
  // `channels`; '' = unlabeled. Only sent in record mode (#482).
  labels?: string[];
}

export interface StartPlaybackOpts {
  // Session folder holding session.json + stem WAVs (from a Record capture).
  sessionDir: string;
  // Output device index or name; omitted ⇒ playback.py uses the default output.
  device?: string;
  // Routing spec mapping track → output channel(s), e.g. "0:0,1:2-3".
  route?: string;
  // Progress/level cadence in seconds (default 0.1 in playback.py).
  intervalSecs?: number;
  // Force the stereo master mixdown fold even on a big-enough device.
  master?: boolean;
}

export interface AnalysisProgress {
  stage?: string;
  status: string;
}

export interface UpdateInfo {
  version: string;
  url: string;
  notes: string;
  downloadUrl: string;
  sha256: string;
  sizeBytes: number;
}

export interface UpdateStatus {
  state: string;
  version?: string;
}

/** Mirrors electron/update-download.ts's UpdateDownloadStatus (#504). */
export type UpdateDownloadStatus =
  | { state: 'downloading'; receivedBytes: number; totalBytes: number; percent: number }
  | { state: 'verifying' }
  | { state: 'done'; filePath: string; version: string }
  | { state: 'cancelled' }
  | { state: 'error'; message: string };

/** Standard IPC result envelope used by mutating/side-effecting handlers. */
export interface OperationResult {
  success: boolean;
  error?: string;
}

// ─── Settings / capture-rig DTOs (moved from electron/settings.ts, TD-011) ───
// settings.ts imports these back via `import type { ... } from './ipc/api'`
// and re-exports them so its existing consumers (settings.test.ts,
// ipc/settings.ts) don't need to change their import path.

/**
 * One strip of a rig's channel config — mirrors the renderer's inline shape
 * (`{ kind, a, b }` at index.html ~896). `a`/`b` are device channel indices;
 * `b` is only meaningful for a stereo pair. `label` is written later by #39.
 */
export interface CaptureRigChannel {
  kind: 'mono' | 'stereo';
  a: number;
  b: number;
  label?: string;
}

/**
 * A saved preflight baseline (#373): the channel assignments + routing snapshot
 * the engineer confirms pre-service, later diffed against the live config to
 * surface drift. Excludes per-strip arming (a capture choice, not routing).
 */
export interface PreflightBaseline {
  deviceName: string;
  strips: Array<{ kind: 'mono' | 'stereo'; a: number; b: number; label?: string }>;
  /** ISO 8601 capture time, for "baseline saved <when>" UI. */
  savedAt: string;
}

/**
 * A saved capture setup ("rig"): a named device + channel + capture config the
 * user can reload instead of re-seeding defaults each launch. The device is
 * matched by {@link deviceName}, not index, so it survives device reordering.
 */
export interface CaptureRig {
  /** Stable id, generated on create. */
  id: string;
  name: string;
  /** Input device matched by name (resilient to reordering). */
  deviceName: string;
  channelConfig: CaptureRigChannel[];
  mode: 'monitor' | 'record';
  recordDir: string;
  /** Real-time meter cadence (ms). */
  intervalMs: number;
  /** Rolling analysis window (seconds). */
  windowSecs: number;
  /** LLM analysis cadence (ms); optional until #37 wires the slider. */
  llmIntervalMs?: number;
  /** Pre-service checklist baseline (#373); optional until an engineer saves one. */
  baseline?: PreflightBaseline;
}

/**
 * One persisted named channel group (#483): `members` are strip indices, in
 * manual display order (not sorted). `collapsed` is omitted (≡ false/expanded)
 * unless the engineer has folded the group. Mirrors the renderer's
 * `ChannelGroup` shape (live-capture-panel.ts) at the persistence boundary.
 */
export interface PersistedChannelGroup {
  name: string;
  members: number[];
  collapsed?: boolean;
}

export interface CustomIdealProfile {
  id: string;
  label: string;
  description: string;
  freqs: number[];
  dbOffsets: number[];
  source?: 'manual' | 'analysis';
  createdAt?: string;
  updatedAt?: string;
}

export interface AppSettings {
  /** Master switch for all AI/LLM analysis. Default false (off). */
  aiEnabled: boolean;
  /** Selected ideal EQ profile id (PRD 05). Empty = auto by content type. */
  idealProfile: string;
  /** User-authored ideal EQ curves for analysis/report comparison. */
  customIdealProfiles: CustomIdealProfile[];
  /**
   * Folder where recordings, stems, and captured sessions are stored (#91).
   * Empty = the platform default (`~/Music/Sound Buddy`), resolved by the main
   * process. There is deliberately no size/count/duration cap on this folder —
   * storage is the user's own disk (#68). Users who want sync/backup point this
   * inside a folder their cloud client already syncs (iCloud/Dropbox/Drive).
   */
  storageDir: string;
  /** Saved capture setups. Default []. */
  rigs: CaptureRig[];
  /** Id of the currently selected rig, or null when none. Default null. */
  activeRigId: string | null;
  /**
   * Opt-in anonymous usage counts (#145). Default false (off). This is a
   * persisted preference ONLY — no collection, batching, or network code
   * exists anywhere in the app, and none may be added until a receiving
   * endpoint ships in the worker (re-verify before wiring anything).
   */
  usageSignalEnabled: boolean;
  /**
   * Persisted per-device channel labels (#482): deviceName ('' = Default
   * Device) → strip token ("0" mono, "2-3" stereo) → display label. Restores
   * user-entered labels across monitor/live sessions without needing a saved
   * (Pro-gated) rig. No env layer — pure persisted data, like `rigs`.
   */
  channelLabels: Record<string, Record<string, string>>;
  /**
   * Persisted per-device named channel groups (#483): deviceName ('' =
   * Default Device) → ordered list of groups. Restores collapse state and
   * both group order and per-group member order across monitor/live sessions,
   * mirroring `channelLabels`'s per-device persistence (#482). No env layer —
   * pure persisted data, like `rigs`.
   */
  channelGroups: Record<string, PersistedChannelGroup[]>;
  /**
   * Opt-in crash reporting (#473). Default false (off). Unlike
   * usageSignalEnabled, this flag *does* gate real behavior — it controls
   * all capture and sending in crash-reporting.ts. No env layer: opt-in
   * must be an explicit user action, never a launch-time override.
   */
  crashReportingEnabled: boolean;
}

// ─── LLM DTOs (PublicLlmConfig moved from electron/llm-config.ts, TD-011) ────

/** What the renderer sees — no ciphertext, no key material. */
export interface PublicLlmConfig {
  provider: string;
  model: string;
  ollamaHost: string;
  apiBaseUrl: string;
  hasApiKey: boolean;
  /** Provider the stored key belongs to ('' when no key). */
  apiKeyProvider: string;
}

/** The `llm-save-config` handler's envelope (ipc/narrative.ts) — distinct from
 *  `saveLlmConfig()` itself, which returns a bare {@link PublicLlmConfig}. */
export type SaveLlmConfigResult =
  | { ok: true; config: PublicLlmConfig }
  | { ok: false; reason: string };

/** A model the settings screen can offer for a given provider (TD-004 slice 3,
 *  #427) — sourced from Pi's ModelRegistry via `listLlmModels`. */
export interface LlmModelInfo {
  provider: string;
  id: string;
  name: string;
}

// ─── Analysis / storage DTOs (AnalysisSummary moved from electron/storage.ts) ─

export interface AnalysisSummary {
  /** ISO 8601 timestamp of when the analysis completed. */
  date: string;
  sourceFilename: string;
  gradeLetter: string;
  score: number;
  recordingType: string;
  topFixes: string[];
}

/** The renderer submits everything but the server-stamped `date`. */
export type AnalysisSummaryInput = Omit<AnalysisSummary, 'date'>;

export type SaveSummaryResult = OperationResult;

export interface ListSummariesResult extends OperationResult {
  summaries: AnalysisSummary[];
}

/** analyze-file resolves to a typed envelope; `data` is the audio-engine analysis,
 *  kept `unknown` at the boundary so audio-engine's node-only types don't enter the
 *  renderer program (see the file header). */
export type AnalyzeFileResult =
  | { success: true; data: unknown }
  | { success: false; cancelled?: boolean; error?: string };

export interface CancelAnalysisResult {
  success: boolean;
}

// ─── Storage-usage DTO (new — mirrors ipc/settings.ts's get-storage-usage) ───

export interface StorageUsage {
  path: string;
  isDefault: boolean;
  defaultPath: string;
  bytes: number;
  human: string;
  exists: boolean;
}

// ─── License DTOs (new — mirror electron/license.ts's own LicenseState) ─────
// Deliberately duplicated rather than moved: license.ts's LicenseState
// references LicenseKind from packages/license-policy, and importing that
// package here would violate this file's dependency-free contract. Kept in
// sync by api.contract.test.ts's drift guard.

export type LicenseKind = 'subscription' | 'lifetime';

export interface LicenseState {
  tier: 'free' | 'pro';
  status: 'none' | 'valid' | 'grace' | 'expired' | 'invalid' | 'trial' | 'trial-expired';
  kind?: LicenseKind;
  email?: string;
  expiresAt?: string;
  /** Present only while status === 'grace'. */
  graceEndsAt?: string;
  /** Present while status === 'trial' or 'trial-expired' (#61). */
  trialEndsAt?: string;
  /** Human-readable reason when status === 'invalid'. */
  error?: string;
}

// ─── Misc new mirrored DTOs ──────────────────────────────────────────────────

/** Mirrors electron/feedback.ts's RevealDiagnosticsResult (#144). */
export interface RevealDiagnosticsResult {
  revealed: boolean;
  missing?: boolean;
}

/** Mirrors electron/feedback.ts's submitFeedback() input/output (#472). */
export type FeedbackCategory = 'bug' | 'idea' | 'question' | 'other';

export interface FeedbackSubmission {
  message: string;
  category: FeedbackCategory;
  contactEmail?: string;
}

export type SubmitFeedbackResult =
  | { ok: true }
  | { ok: false; retryable: boolean; error: string };

/** Mirrors ipc/live-capture.ts's stop-live handler return. */
export interface StopLiveResult {
  success: boolean;
  sessionDir: string | null;
}

// ─── Domain sub-interfaces ───────────────────────────────────────────────────
// SoundBuddyApi is composed from these so a client can depend on a narrow
// slice (e.g. `AnalysisApi`) instead of the full bridge. The runtime bridge
// stays one `window.soundBuddy` object — see api.contract.test.ts.

export interface AppInfoApi {
  getAppVersion(): Promise<string>;
  toFileUrl(filePath: string): Promise<string>;
  isOnboardingDisabled(): Promise<boolean>;
}

export interface SettingsApi {
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: UpdateSettingsPatch): Promise<AppSettings>;
}

export interface StorageApi {
  getStorageUsage(): Promise<StorageUsage>;
}

export interface RigApi {
  listRigs(): Promise<CaptureRig[]>;
  saveRig(rig: CaptureRig): Promise<AppSettings>;
  deleteRig(id: string): Promise<AppSettings>;
  setActiveRig(id: string | null): Promise<AppSettings>;
}

export interface LlmApi {
  getLlmConfig(): Promise<PublicLlmConfig>;
  saveLlmConfig(patch: LlmConfigPatch): Promise<SaveLlmConfigResult>;
  detectOllama(host?: string): Promise<unknown>;
  testLlmProvider(opts: TestLlmProviderOpts): Promise<unknown>;
  listLlmModels(): Promise<LlmModelInfo[]>;
  triggerLlmAnalysis(data: unknown): Promise<unknown>;
  onLlmDelta(cb: (text: string) => void): void;
  onLlmDone(cb: () => void): void;
}

export interface LicenseApi {
  getLicense(): Promise<LicenseState>;
  activateLicense(key: string): Promise<LicenseState>;
  removeLicense(): Promise<LicenseState>;
  refreshLicense(): Promise<LicenseState>;
  onOpenLicenseDialog(cb: () => void): void;
  openCheckout(plan: 'monthly' | 'annual'): Promise<void>;
}

export interface AnalysisApi {
  analyzeFile(opts: AnalyzeFileOpts): Promise<AnalyzeFileResult>;
  cancelAnalysis(): Promise<CancelAnalysisResult>;
  saveAnalysisSummary(summary: AnalysisSummaryInput): Promise<SaveSummaryResult>;
  listAnalysisSummaries(): Promise<ListSummariesResult>;
  onAnalysisProgress(cb: (data: AnalysisProgress) => void): void;
  onAnalysisResult(cb: (data: unknown) => void): void;
  getDemoAudio(): Promise<string | null>;
  onMenuOpenFile(cb: (filePath: string) => void): void;
}

export interface LiveApi {
  listDevices(): Promise<unknown>;
  startLive(opts: StartLiveOpts): Promise<unknown>;
  stopLive(): Promise<StopLiveResult>;
  onLiveEvent(cb: (data: unknown) => void): void;
}

export interface PlaybackApi {
  listOutputDevices(): Promise<unknown>;
  startPlayback(opts: StartPlaybackOpts): Promise<unknown>;
  stopPlayback(): Promise<OperationResult>;
  readSession(sessionDir: string): Promise<unknown>;
  onPlaybackEvent(cb: (data: unknown) => void): void;
  revealPath(targetPath: string): Promise<OperationResult>;
}

export interface DialogApi {
  openFileDialog(): Promise<string | null>;
  openDirDialog(): Promise<string | null>;
  saveReportImage(
    bytes: Uint8Array,
    suggestedName: string
  ): Promise<{ saved: boolean; filePath?: string }>;
}

export interface UpdateApi {
  checkForUpdates(): Promise<void>;
  openReleasePage(url?: string): Promise<void>;
  onUpdateAvailable(cb: (info: UpdateInfo) => void): void;
  onUpdateStatus(cb: (status: UpdateStatus) => void): void;
  downloadUpdate(): Promise<OperationResult>;
  cancelUpdateDownload(): Promise<void>;
  revealUpdateDownload(): Promise<OperationResult>;
  onUpdateDownloadStatus(cb: (status: UpdateDownloadStatus) => void): void;
}

export interface FeedbackApi {
  openFeedback(): Promise<void>;
  openCaptureGuide(): Promise<void>;
  revealDiagnostics(): Promise<RevealDiagnosticsResult>;
  submitFeedback(input: FeedbackSubmission): Promise<SubmitFeedbackResult>;
  onOpenFeedbackDialog(cb: () => void): void;
}

/**
 * Opt-in crash reporting (#473). reportRendererError is the IPC-facing
 * validator's entry point — never trust the renderer, so main revalidates
 * from scratch (see electron/crash-reporting.ts's handleRendererErrorReport).
 * recordAppEvent pushes a safe event *name* (never free text) onto the
 * bounded breadcrumb ring buffer a crash payload later includes.
 */
export interface CrashReportingApi {
  reportRendererError(input: { message: string; stack?: string }): Promise<void>;
  recordAppEvent(name: string): Promise<void>;
}

// Cross-cutting: not tied to any one domain (used by every `on*` listener).
export interface ListenerApi {
  removeAllListeners(ch: string): void;
}

// The full contract exposed on window.soundBuddy by electron/preload.ts.
export interface SoundBuddyApi
  extends AppInfoApi,
    SettingsApi,
    StorageApi,
    RigApi,
    LlmApi,
    LicenseApi,
    AnalysisApi,
    LiveApi,
    PlaybackApi,
    DialogApi,
    UpdateApi,
    FeedbackApi,
    CrashReportingApi,
    ListenerApi {}
