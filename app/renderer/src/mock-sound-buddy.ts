// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Test double for the soundBuddy IPC bridge (#308). Lets components that call
// useElectron() be unit-tested without Electron: no window.soundBuddy stub,
// no preload, no main process.

import type { SoundBuddyApi, AnalysisProgress, UpdateInfo, UpdateStatus } from '../../electron/ipc/api';

export interface RecordedCall {
  method: keyof SoundBuddyApi;
  args: unknown[];
}

export interface MockSoundBuddy {
  api: SoundBuddyApi;
  calls: RecordedCall[];
  // Fires every callback registered via the on* method named `event`.
  emit(event: keyof SoundBuddyApi, ...args: unknown[]): void;
}

export function createMockSoundBuddy(overrides: Partial<SoundBuddyApi> = {}): MockSoundBuddy {
  const calls: RecordedCall[] = [];
  const listeners = new Map<keyof SoundBuddyApi, Array<(...args: unknown[]) => void>>();

  function record(method: keyof SoundBuddyApi, args: unknown[]): void {
    calls.push({ method, args });
  }

  function invoke<T>(method: keyof SoundBuddyApi, value: T) {
    return (...args: unknown[]) => {
      record(method, args);
      return Promise.resolve(value);
    };
  }

  function listen<Args extends unknown[]>(method: keyof SoundBuddyApi) {
    return (cb: (...args: Args) => void) => {
      record(method, [cb]);
      const existing = listeners.get(method) ?? [];
      existing.push(cb as (...args: unknown[]) => void);
      listeners.set(method, existing);
    };
  }

  const defaults = {
    getAppVersion: invoke('getAppVersion', ''),
    getSettings: invoke('getSettings', undefined),
    toFileUrl: invoke('toFileUrl', ''),
    updateSettings: invoke('updateSettings', undefined),
    getStorageUsage: invoke('getStorageUsage', undefined),
    getLlmConfig: invoke('getLlmConfig', undefined),
    saveLlmConfig: invoke('saveLlmConfig', undefined),
    detectOllama: invoke('detectOllama', undefined),
    testLlmProvider: invoke('testLlmProvider', undefined),
    getLicense: invoke('getLicense', undefined),
    activateLicense: invoke('activateLicense', undefined),
    removeLicense: invoke('removeLicense', undefined),
    refreshLicense: invoke('refreshLicense', undefined),
    onOpenLicenseDialog: listen<[]>('onOpenLicenseDialog'),
    openCheckout: invoke('openCheckout', undefined),
    openFeedback: invoke('openFeedback', undefined),
    openCaptureGuide: invoke('openCaptureGuide', undefined),
    revealDiagnostics: invoke('revealDiagnostics', undefined),
    listRigs: invoke('listRigs', undefined),
    saveRig: invoke('saveRig', undefined),
    deleteRig: invoke('deleteRig', undefined),
    setActiveRig: invoke('setActiveRig', undefined),
    analyzeFile: invoke('analyzeFile', undefined),
    saveAnalysisSummary: invoke('saveAnalysisSummary', undefined),
    listAnalysisSummaries: invoke('listAnalysisSummaries', undefined),
    cancelAnalysis: invoke('cancelAnalysis', undefined),
    onAnalysisProgress: listen<[AnalysisProgress]>('onAnalysisProgress'),
    getDemoAudio: invoke('getDemoAudio', null),
    isOnboardingDisabled: invoke('isOnboardingDisabled', false),
    listDevices: invoke('listDevices', undefined),
    listOutputDevices: invoke('listOutputDevices', undefined),
    openFileDialog: invoke('openFileDialog', null),
    openDirDialog: invoke('openDirDialog', null),
    startLive: invoke('startLive', undefined),
    stopLive: invoke('stopLive', undefined),
    revealPath: invoke('revealPath', undefined),
    startPlayback: invoke('startPlayback', undefined),
    stopPlayback: invoke('stopPlayback', undefined),
    readSession: invoke('readSession', undefined),
    onPlaybackEvent: listen<[unknown]>('onPlaybackEvent'),
    triggerLlmAnalysis: invoke('triggerLlmAnalysis', undefined),
    onLiveEvent: listen<[unknown]>('onLiveEvent'),
    onLlmDelta: listen<[string]>('onLlmDelta'),
    onLlmDone: listen<[]>('onLlmDone'),
    onAnalysisResult: listen<[unknown]>('onAnalysisResult'),
    onMenuOpenFile: listen<[string]>('onMenuOpenFile'),
    checkForUpdates: invoke('checkForUpdates', undefined),
    openReleasePage: invoke('openReleasePage', undefined),
    onUpdateAvailable: listen<[UpdateInfo]>('onUpdateAvailable'),
    onUpdateStatus: listen<[UpdateStatus]>('onUpdateStatus'),
    removeAllListeners: (ch: string) => record('removeAllListeners', [ch]),
  } satisfies SoundBuddyApi;

  const api: SoundBuddyApi = { ...defaults, ...overrides };

  function emit(event: keyof SoundBuddyApi, ...args: unknown[]): void {
    for (const cb of listeners.get(event) ?? []) cb(...args);
  }

  return { api, calls, emit };
}
