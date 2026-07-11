// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('soundBuddy', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  getSettings: () => ipcRenderer.invoke('get-settings'),

  // Playback transport (#180) — a file:// URL an <audio> element can load
  // directly. Computed in the main process: the sandboxed preload's `url`
  // polyfill lacks pathToFileURL.
  toFileUrl: (filePath: string) => ipcRenderer.invoke('to-file-url', filePath),

  updateSettings: (patch: {
    aiEnabled?: boolean;
    idealProfile?: string;
    customIdealProfiles?: unknown[];
    storageDir?: string;
  }) =>
    ipcRenderer.invoke('update-settings', patch),

  // Storage location + disk usage (#91). Informational only — Sound Buddy caps
  // nothing; this reports where recordings live and how much disk they use.
  getStorageUsage: () => ipcRenderer.invoke('get-storage-usage'),

  // AI provider settings (#76). getLlmConfig never returns key material — just
  // a hasApiKey flag; saveLlmConfig takes the pasted key one way (to main).
  getLlmConfig: () => ipcRenderer.invoke('llm-get-config'),
  saveLlmConfig: (patch: {
    provider?: string;
    model?: string;
    ollamaHost?: string;
    apiBaseUrl?: string;
    apiKey?: string;
  }) => ipcRenderer.invoke('llm-save-config', patch),
  detectOllama: (host?: string) => ipcRenderer.invoke('llm-detect-ollama', host),
  testLlmProvider: (opts: { provider: string; apiKey?: string; apiBaseUrl?: string }) =>
    ipcRenderer.invoke('llm-test-provider', opts),

  // License (#54) — offline key validation + feature gating. Free/Pro state
  // drives the renderer's lock icons, badge, and grace banner.
  getLicense: () => ipcRenderer.invoke('get-license'),
  activateLicense: (key: string) => ipcRenderer.invoke('activate-license', key),
  removeLicense: () => ipcRenderer.invoke('remove-license'),
  // Automatic license refresh (#117) — the manual "Refresh license" button and
  // the paywall-evaluation trigger both call this; the launch trigger fires
  // from the main process directly.
  refreshLicense: () => ipcRenderer.invoke('refresh-license'),
  onOpenLicenseDialog: (cb: () => void) =>
    ipcRenderer.on('open-license-dialog', () => cb()),

  // Upgrade checkout (#58) — open the hosted Stripe checkout for a plan
  // ('monthly' | 'annual') in the user's browser. No card data touches the app.
  openCheckout: (plan: 'monthly' | 'annual') => ipcRenderer.invoke('open-checkout', plan),

  // Feedback mailto (#143) — opens the user's mail client; the app sends nothing.
  openFeedback: () => ipcRenderer.invoke('open-feedback'),
  // Attach diagnostics (#144) — reveals the log file in Finder so the user can
  // drag it into the feedback email themselves. Never attached automatically.
  revealDiagnostics: () => ipcRenderer.invoke('reveal-diagnostics'),

  // Capture rigs (#36) — backend only for now; the Live-tab UI arrives in #37.
  listRigs: () => ipcRenderer.invoke('list-rigs'),
  saveRig: (rig: unknown) => ipcRenderer.invoke('save-rig', rig),
  deleteRig: (id: string) => ipcRenderer.invoke('delete-rig', id),
  setActiveRig: (id: string | null) => ipcRenderer.invoke('set-active-rig', id),

  analyzeFile: (opts: { filePath: string; noSpectrum?: boolean }) =>
    ipcRenderer.invoke('analyze-file', opts),

  // Persist a report-card summary after a successful analysis (#146). Fire-and-
  // forget from the renderer's perspective; failures are logged in main.
  saveAnalysisSummary: (summary: {
    sourceFilename: string;
    gradeLetter: string;
    score: number;
    recordingType: string;
    topFixes: string[];
  }) => ipcRenderer.invoke('save-analysis-summary', summary),

  // Last 10 persisted report-card summaries, newest-first, for the Recent
  // Services list (#147).
  listAnalysisSummaries: () => ipcRenderer.invoke('list-analysis-summaries'),

  // Cancel (#125) — aborts the in-flight analyze-file run for this renderer.
  cancelAnalysis: () => ipcRenderer.invoke('cancel-analysis'),
  onAnalysisProgress: (cb: (data: { stage?: string; status: string }) => void) =>
    ipcRenderer.on('analysis-progress', (_event, d) => cb(d)),

  // Path to the bundled demo recording for the first-run onboarding flow (#69).
  // Resolves to null when the asset is absent so the renderer can fall back.
  getDemoAudio: () => ipcRenderer.invoke('get-demo-audio'),

  // Dev/e2e switch (SOUND_BUDDY_DISABLE_ONBOARDING) for the first-run overlay (#69).
  isOnboardingDisabled: () => ipcRenderer.invoke('onboarding-disabled'),

  listDevices: () => ipcRenderer.invoke('list-devices'),

  // Playback (output) devices for virtual-soundcheck (#44). No micAccess field —
  // choosing an output interface doesn't require the microphone grant.
  listOutputDevices: () => ipcRenderer.invoke('list-output-devices'),

  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),

  openDirDialog: () => ipcRenderer.invoke('open-dir-dialog'),

  startLive: (opts: {
    device?: string;
    channels?: string[];
    windowSecs: number;
    intervalSecs?: number;
    llmIntervalSecs: number;
    mode?: 'monitor' | 'record';
    recordDir?: string;
    // Record mode: which strips to arm as session stems, as channel-config
    // tokens (e.g. ['0', '2-3']). Omitted ⇒ all configured strips are armed.
    arm?: string[];
  }) => ipcRenderer.invoke('start-live', opts),

  stopLive: () => ipcRenderer.invoke('stop-live'),

  // Reveal a captured session folder in the OS file manager (#43). Paves the way
  // for "Open in Virtual Soundcheck" (epic #35); for now it opens the folder.
  revealPath: (targetPath: string) => ipcRenderer.invoke('reveal-path', targetPath),

  // Virtual-soundcheck playback (#45). Play a captured session's stems through
  // an output device with per-track routing (or a stereo master fold). Events
  // (mixdown/progress/level/ended) arrive on the `playback-event` channel.
  startPlayback: (opts: {
    sessionDir: string;
    device?: string;
    // Routing spec mapping track → output channel(s), e.g. "0:0,1:2-3".
    route?: string;
    intervalSecs?: number;
    master?: boolean;
  }) => ipcRenderer.invoke('start-playback', opts),

  stopPlayback: () => ipcRenderer.invoke('stop-playback'),

  // Read a captured session's session.json manifest for the Soundcheck UI (#46).
  readSession: (sessionDir: string) => ipcRenderer.invoke('read-session', sessionDir),

  onPlaybackEvent: (cb: (data: unknown) => void) =>
    ipcRenderer.on('playback-event', (_event, d) => cb(d)),

  triggerLlmAnalysis: (data: unknown) => ipcRenderer.invoke('trigger-llm-analysis', data),

  onLiveEvent: (cb: (data: unknown) => void) =>
    ipcRenderer.on('live-event', (_event, d) => cb(d)),

  onLlmDelta: (cb: (text: string) => void) =>
    ipcRenderer.on('llm-delta', (_event, t) => cb(t)),

  onLlmDone: (cb: () => void) =>
    ipcRenderer.on('llm-done', () => cb()),

  onAnalysisResult: (cb: (data: unknown) => void) =>
    ipcRenderer.on('analysis-result', (_event, d) => cb(d)),

  onMenuOpenFile: (cb: (filePath: string) => void) =>
    ipcRenderer.on('menu-open-file', (_event, fp) => cb(fp)),

  // Updates
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  openReleasePage: (url?: string) => ipcRenderer.invoke('open-release-page', url),
  onUpdateAvailable: (cb: (info: { version: string; url: string; notes: string }) => void) =>
    ipcRenderer.on('update-available', (_event, info) => cb(info)),
  onUpdateStatus: (cb: (status: { state: string; version?: string }) => void) =>
    ipcRenderer.on('update-status', (_event, s) => cb(s)),

  removeAllListeners: (ch: string) => ipcRenderer.removeAllListeners(ch),
});
