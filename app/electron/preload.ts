// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { contextBridge, ipcRenderer } from 'electron';
import type {
  SoundBuddyApi,
  AnalyzeFileOpts,
  StartLiveOpts,
  StartPlaybackOpts,
  UpdateSettingsPatch,
  LlmConfigPatch,
  TestLlmProviderOpts,
  AnalysisSummaryInput,
  AnalysisProgress,
  UpdateInfo,
  UpdateStatus,
  UpdateDownloadStatus,
  FeedbackSubmission,
} from './ipc/api';

// The slice of Electron's IpcRenderer the bridge actually uses. Injected so
// the bridge can be built and exercised in unit tests without an Electron
// sandbox (#332).
export interface IpcRendererLike {
  // `any` mirrors Electron's own IpcRenderer.invoke signature; the concrete
  // per-channel return types are asserted by `satisfies SoundBuddyApi` below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invoke(channel: string, ...args: unknown[]): Promise<any>;
  // `any` mirrors Electron's own IpcRenderer.on listener payload; the
  // concrete per-channel argument types are asserted by `satisfies
  // SoundBuddyApi` below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(channel: string, listener: (event: unknown, ...args: any[]) => void): unknown;
  removeAllListeners(channel: string): unknown;
}

export function createBridge(ipc: IpcRendererLike) {
  return {
    getAppVersion: () => ipc.invoke('get-app-version'),

    getSettings: () => ipc.invoke('get-settings'),

    // Playback transport (#180) — a file:// URL an <audio> element can load
    // directly. Computed in the main process: the sandboxed preload's `url`
    // polyfill lacks pathToFileURL.
    toFileUrl: (filePath: string) => ipc.invoke('to-file-url', filePath),

    updateSettings: (patch: UpdateSettingsPatch) =>
      ipc.invoke('update-settings', patch),

    // Storage location + disk usage (#91). Informational only — Sound Buddy caps
    // nothing; this reports where recordings live and how much disk they use.
    getStorageUsage: () => ipc.invoke('get-storage-usage'),

    // AI provider settings (#76). getLlmConfig never returns key material — just
    // a hasApiKey flag; saveLlmConfig takes the pasted key one way (to main).
    getLlmConfig: () => ipc.invoke('llm-get-config'),
    saveLlmConfig: (patch: LlmConfigPatch) => ipc.invoke('llm-save-config', patch),
    detectOllama: (host?: string) => ipc.invoke('llm-detect-ollama', host),
    testLlmProvider: (opts: TestLlmProviderOpts) =>
      ipc.invoke('llm-test-provider', opts),
    listLlmModels: () => ipc.invoke('llm-list-models'),

    // License (#54) — offline key validation + feature gating. Free/Pro state
    // drives the renderer's lock icons, badge, and grace banner.
    getLicense: () => ipc.invoke('get-license'),
    activateLicense: (key: string) => ipc.invoke('activate-license', key),
    removeLicense: () => ipc.invoke('remove-license'),
    // Automatic license refresh (#117) — the manual "Refresh license" button and
    // the paywall-evaluation trigger both call this; the launch trigger fires
    // from the main process directly.
    refreshLicense: () => ipc.invoke('refresh-license'),
    onOpenLicenseDialog: (cb: () => void) =>
      ipc.on('open-license-dialog', () => cb()),

    // Upgrade checkout (#58) — open the hosted Stripe checkout for a plan
    // ('monthly' | 'annual') in the user's browser. No card data touches the app.
    openCheckout: (plan: 'monthly' | 'annual') => ipc.invoke('open-checkout', plan),

    // Feedback mailto (#143) — opens the user's mail client; the app sends nothing.
    openFeedback: () => ipc.invoke('open-feedback'),
    // Capture guidance (#142) — opens the hosted "record your service" docs page in
    // the user's browser. The app sends nothing; fixed URL resolved in main.
    openCaptureGuide: () => ipc.invoke('open-capture-guide'),
    // Attach diagnostics (#144) — reveals the log file in Finder so the user can
    // drag it into the feedback email themselves. Never attached automatically.
    revealDiagnostics: () => ipc.invoke('reveal-diagnostics'),
    // In-app feedback submission (#472) — POSTs a strictly-allowlisted payload
    // to the worker ingestion endpoint; the main process attaches the safe
    // diagnostic summary itself. onOpenFeedbackDialog mirrors
    // onOpenLicenseDialog: the Help menu pushes the renderer open instead of
    // firing a mailto directly.
    submitFeedback: (input: FeedbackSubmission) => ipc.invoke('submit-feedback', input),
    onOpenFeedbackDialog: (cb: () => void) => ipc.on('open-feedback-dialog', () => cb()),

    // Capture rigs (#36) — backend only for now; the Live-tab UI arrives in #37.
    listRigs: () => ipc.invoke('list-rigs'),
    saveRig: (rig: unknown) => ipc.invoke('save-rig', rig),
    deleteRig: (id: string) => ipc.invoke('delete-rig', id),
    setActiveRig: (id: string | null) => ipc.invoke('set-active-rig', id),

    analyzeFile: (opts: AnalyzeFileOpts) =>
      ipc.invoke('analyze-file', opts),

    // Persist a report-card summary after a successful analysis (#146). Fire-and-
    // forget from the renderer's perspective; failures are logged in main.
    saveAnalysisSummary: (summary: AnalysisSummaryInput) =>
      ipc.invoke('save-analysis-summary', summary),

    // Last 10 persisted report-card summaries, newest-first, for the Recent
    // Services list (#147).
    listAnalysisSummaries: () => ipc.invoke('list-analysis-summaries'),

    // Cancel (#125) — aborts the in-flight analyze-file run for this renderer.
    cancelAnalysis: () => ipc.invoke('cancel-analysis'),
    onAnalysisProgress: (cb: (data: AnalysisProgress) => void) =>
      ipc.on('analysis-progress', (_event, d) => cb(d)),

    // Path to the bundled demo recording for the first-run onboarding flow (#69).
    // Resolves to null when the asset is absent so the renderer can fall back.
    getDemoAudio: () => ipc.invoke('get-demo-audio'),

    // Dev/e2e switch (SOUND_BUDDY_DISABLE_ONBOARDING) for the first-run overlay (#69).
    isOnboardingDisabled: () => ipc.invoke('onboarding-disabled'),

    listDevices: () => ipc.invoke('list-devices'),

    // Playback (output) devices for virtual-soundcheck (#44). No micAccess field —
    // choosing an output interface doesn't require the microphone grant.
    listOutputDevices: () => ipc.invoke('list-output-devices'),

    openFileDialog: () => ipc.invoke('open-file-dialog'),

    openDirDialog: () => ipc.invoke('open-dir-dialog'),

    // Local-only save of the Export PNG button's rasterized report card (#368).
    saveReportImage: (bytes: Uint8Array, suggestedName: string) =>
      ipc.invoke('save-report-image', bytes, suggestedName),

    startLive: (opts: StartLiveOpts) => ipc.invoke('start-live', opts),

    stopLive: () => ipc.invoke('stop-live'),

    // Reveal a captured session folder in the OS file manager (#43). Paves the way
    // for "Open in Virtual Soundcheck" (epic #35); for now it opens the folder.
    revealPath: (targetPath: string) => ipc.invoke('reveal-path', targetPath),

    // Virtual-soundcheck playback (#45). Play a captured session's stems through
    // an output device with per-track routing (or a stereo master fold). Events
    // (mixdown/progress/level/ended) arrive on the `playback-event` channel.
    startPlayback: (opts: StartPlaybackOpts) => ipc.invoke('start-playback', opts),

    stopPlayback: () => ipc.invoke('stop-playback'),

    // Read a captured session's session.json manifest for the Soundcheck UI (#46).
    readSession: (sessionDir: string) => ipc.invoke('read-session', sessionDir),

    onPlaybackEvent: (cb: (data: unknown) => void) =>
      ipc.on('playback-event', (_event, d) => cb(d)),

    triggerLlmAnalysis: (data: unknown) => ipc.invoke('trigger-llm-analysis', data),

    onLiveEvent: (cb: (data: unknown) => void) =>
      ipc.on('live-event', (_event, d) => cb(d)),

    onLlmDelta: (cb: (text: string) => void) =>
      ipc.on('llm-delta', (_event, t) => cb(t)),

    onLlmDone: (cb: () => void) =>
      ipc.on('llm-done', () => cb()),

    onAnalysisResult: (cb: (data: unknown) => void) =>
      ipc.on('analysis-result', (_event, d) => cb(d)),

    onMenuOpenFile: (cb: (filePath: string) => void) =>
      ipc.on('menu-open-file', (_event, fp) => cb(fp)),

    // Updates
    checkForUpdates: () => ipc.invoke('check-for-updates'),
    openReleasePage: (url?: string) => ipc.invoke('open-release-page', url),
    onUpdateAvailable: (cb: (info: UpdateInfo) => void) =>
      ipc.on('update-available', (_event, info) => cb(info)),
    onUpdateStatus: (cb: (status: UpdateStatus) => void) =>
      ipc.on('update-status', (_event, s) => cb(s)),
    downloadUpdate: () => ipc.invoke('download-update'),
    cancelUpdateDownload: () => ipc.invoke('cancel-update-download'),
    revealUpdateDownload: () => ipc.invoke('reveal-update-download'),
    onUpdateDownloadStatus: (cb: (s: UpdateDownloadStatus) => void) =>
      ipc.on('update-download-status', (_event, s) => cb(s)),

    // Opt-in crash reporting (#473) — reportRendererError is validated fresh
    // in main (never trusted from the renderer); recordAppEvent pushes a
    // safe event name onto the breadcrumb ring buffer a crash payload later
    // includes.
    reportRendererError: (input: { message: string; stack?: string }) =>
      ipc.invoke('report-renderer-error', input),
    recordAppEvent: (name: string) => ipc.invoke('record-app-event', name),

    removeAllListeners: (ch: string) => ipc.removeAllListeners(ch),
  } satisfies SoundBuddyApi;
}

/* c8 ignore start -- Electron framework wiring: contextBridge only exists in
   a real sandboxed preload context; the bridge it exposes is fully covered
   via createBridge() in preload.test.ts. */
contextBridge.exposeInMainWorld('soundBuddy', createBridge(ipcRenderer));
/* c8 ignore stop */
