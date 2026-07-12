// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The typed IPC contract shared between the Electron preload bridge
// (electron/preload.ts), the main-process handlers (electron/ipc/*.ts), and
// the renderer's useElectron() hook (renderer/src/useElectron.ts). This file
// is pulled into BOTH tsc programs (app/tsconfig.json's CommonJS/node
// program and app/renderer/tsconfig.json's Bundler/DOM program), so it MUST
// stay dependency-free — no imports of `electron`, node builtins, or any
// main-process module.

export interface UpdateSettingsPatch {
  aiEnabled?: boolean;
  idealProfile?: string;
  customIdealProfiles?: unknown[];
  storageDir?: string;
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

export interface AnalysisSummaryInput {
  sourceFilename: string;
  gradeLetter: string;
  score: number;
  recordingType: string;
  topFixes: string[];
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
}

export interface UpdateStatus {
  state: string;
  version?: string;
}

// The full contract exposed on window.soundBuddy by electron/preload.ts.
// Return types are Promise<unknown> for anything whose payload isn't listed
// above — sharpening them would require importing main-process domain types
// (CaptureRig, AnalysisSummary, settings), which would drag node-typed
// modules into the renderer program.
export interface SoundBuddyApi {
  getAppVersion(): Promise<string>;
  getSettings(): Promise<unknown>;
  toFileUrl(filePath: string): Promise<string>;
  updateSettings(patch: UpdateSettingsPatch): Promise<unknown>;
  getStorageUsage(): Promise<unknown>;
  getLlmConfig(): Promise<unknown>;
  saveLlmConfig(patch: LlmConfigPatch): Promise<unknown>;
  detectOllama(host?: string): Promise<unknown>;
  testLlmProvider(opts: TestLlmProviderOpts): Promise<unknown>;
  getLicense(): Promise<unknown>;
  activateLicense(key: string): Promise<unknown>;
  removeLicense(): Promise<unknown>;
  refreshLicense(): Promise<unknown>;
  onOpenLicenseDialog(cb: () => void): void;
  openCheckout(plan: 'monthly' | 'annual'): Promise<unknown>;
  openFeedback(): Promise<unknown>;
  openCaptureGuide(): Promise<unknown>;
  revealDiagnostics(): Promise<unknown>;
  listRigs(): Promise<unknown>;
  saveRig(rig: unknown): Promise<unknown>;
  deleteRig(id: string): Promise<unknown>;
  setActiveRig(id: string | null): Promise<unknown>;
  analyzeFile(opts: AnalyzeFileOpts): Promise<unknown>;
  saveAnalysisSummary(summary: AnalysisSummaryInput): Promise<unknown>;
  listAnalysisSummaries(): Promise<unknown>;
  cancelAnalysis(): Promise<unknown>;
  onAnalysisProgress(cb: (data: AnalysisProgress) => void): void;
  getDemoAudio(): Promise<string | null>;
  isOnboardingDisabled(): Promise<boolean>;
  listDevices(): Promise<unknown>;
  listOutputDevices(): Promise<unknown>;
  openFileDialog(): Promise<string | null>;
  openDirDialog(): Promise<string | null>;
  startLive(opts: StartLiveOpts): Promise<unknown>;
  stopLive(): Promise<unknown>;
  revealPath(targetPath: string): Promise<unknown>;
  startPlayback(opts: StartPlaybackOpts): Promise<unknown>;
  stopPlayback(): Promise<unknown>;
  readSession(sessionDir: string): Promise<unknown>;
  onPlaybackEvent(cb: (data: unknown) => void): void;
  triggerLlmAnalysis(data: unknown): Promise<unknown>;
  onLiveEvent(cb: (data: unknown) => void): void;
  onLlmDelta(cb: (text: string) => void): void;
  onLlmDone(cb: () => void): void;
  onAnalysisResult(cb: (data: unknown) => void): void;
  onMenuOpenFile(cb: (filePath: string) => void): void;
  checkForUpdates(): Promise<unknown>;
  openReleasePage(url?: string): Promise<unknown>;
  onUpdateAvailable(cb: (info: UpdateInfo) => void): void;
  onUpdateStatus(cb: (status: UpdateStatus) => void): void;
  removeAllListeners(ch: string): void;
}
