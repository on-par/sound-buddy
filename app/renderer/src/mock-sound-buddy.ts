// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Test double for the soundBuddy IPC bridge (#308). Lets components that call
// useElectron() be unit-tested without Electron: no window.soundBuddy stub,
// no preload, no main process.

import type {
  SoundBuddyApi,
  AnalysisProgress,
  UpdateInfo,
  UpdateStatus,
  UpdateDownloadStatus,
  AppSettings,
  LicenseState,
  StorageUsage,
} from '../../electron/ipc/api';

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

// Valid defaults for the sharpened (no-longer-`unknown`) return types (TD-011,
// #405) — the renderer program must compile against real shapes, not `undefined`.
const DEFAULT_APP_SETTINGS: AppSettings = {
  aiEnabled: false,
  idealProfile: '',
  customIdealProfiles: [],
  storageDir: '',
  rigs: [],
  activeRigId: null,
  usageSignalEnabled: false,
  channelLabels: {},
  channelGroups: {},
  inputInstrumentProfiles: {},
  crashReportingEnabled: false,
  dawWorkspaceEnabled: false,
  liveAdjustmentsEnabled: false,
  reportFirstUxEnabled: false,
  shareChurchName: '',
  weeklyReminderEnabled: false,
  weeklyReminderServiceDay: 0,
};

const DEFAULT_LICENSE_STATE: LicenseState = { tier: 'free', status: 'none' };

const DEFAULT_STORAGE_USAGE: StorageUsage = {
  path: '',
  isDefault: true,
  defaultPath: '',
  bytes: 0,
  human: '0 B',
  exists: false,
};

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
    getSettings: invoke('getSettings', DEFAULT_APP_SETTINGS),
    toFileUrl: invoke('toFileUrl', ''),
    updateSettings: invoke('updateSettings', DEFAULT_APP_SETTINGS),
    getStorageUsage: invoke('getStorageUsage', DEFAULT_STORAGE_USAGE),
    getLicense: invoke('getLicense', DEFAULT_LICENSE_STATE),
    activateLicense: invoke('activateLicense', DEFAULT_LICENSE_STATE),
    removeLicense: invoke('removeLicense', DEFAULT_LICENSE_STATE),
    refreshLicense: invoke('refreshLicense', DEFAULT_LICENSE_STATE),
    onOpenLicenseDialog: listen<[]>('onOpenLicenseDialog'),
    openCheckout: invoke('openCheckout', undefined),
    openFeedback: invoke('openFeedback', undefined),
    openCaptureGuide: invoke('openCaptureGuide', undefined),
    revealDiagnostics: invoke('revealDiagnostics', { revealed: true }),
    submitFeedback: invoke('submitFeedback', { ok: true as const }),
    onOpenFeedbackDialog: listen<[]>('onOpenFeedbackDialog'),
    listRigs: invoke('listRigs', []),
    saveRig: invoke('saveRig', DEFAULT_APP_SETTINGS),
    deleteRig: invoke('deleteRig', DEFAULT_APP_SETTINGS),
    setActiveRig: invoke('setActiveRig', DEFAULT_APP_SETTINGS),
    analyzeFile: invoke('analyzeFile', { success: true, data: undefined }),
    saveAnalysisSummary: invoke('saveAnalysisSummary', { success: true, file: 'mock-summary.json' }),
    setAnalysisSummaryNote: invoke('setAnalysisSummaryNote', { success: true }),
    listAnalysisSummaries: invoke('listAnalysisSummaries', { success: true, summaries: [] }),
    cancelAnalysis: invoke('cancelAnalysis', { success: false }),
    onAnalysisProgress: listen<[AnalysisProgress]>('onAnalysisProgress'),
    getDemoAudio: invoke('getDemoAudio', null),
    getWhatsNew: invoke('getWhatsNew', null),
    diffScenes: invoke('diffScenes', { ok: false as const, error: '' }),
    isOnboardingDisabled: invoke('isOnboardingDisabled', false),
    listDevices: invoke('listDevices', undefined),
    listOutputDevices: invoke('listOutputDevices', undefined),
    openFileDialog: invoke('openFileDialog', null),
    openDirDialog: invoke('openDirDialog', null),
    startLive: invoke('startLive', undefined),
    stopLive: invoke('stopLive', { success: true, sessionDir: null }),
    revealPath: invoke('revealPath', { success: true }),
    startPlayback: invoke('startPlayback', undefined),
    stopPlayback: invoke('stopPlayback', { success: true }),
    readSession: invoke('readSession', undefined),
    onPlaybackEvent: listen<[unknown]>('onPlaybackEvent'),
    onLiveEvent: listen<[unknown]>('onLiveEvent'),
    onAnalysisResult: listen<[unknown]>('onAnalysisResult'),
    onMenuOpenFile: listen<[string]>('onMenuOpenFile'),
    checkForUpdates: invoke('checkForUpdates', undefined),
    openReleasePage: invoke('openReleasePage', undefined),
    onUpdateAvailable: listen<[UpdateInfo]>('onUpdateAvailable'),
    onUpdateStatus: listen<[UpdateStatus]>('onUpdateStatus'),
    downloadUpdate: invoke('downloadUpdate', { success: true }),
    installUpdate: invoke('installUpdate', undefined),
    onUpdateDownloadStatus: listen<[UpdateDownloadStatus]>('onUpdateDownloadStatus'),
    reportRendererError: invoke('reportRendererError', undefined),
    recordAppEvent: invoke('recordAppEvent', undefined),
    removeAllListeners: (ch: string) => record('removeAllListeners', [ch]),
    saveReportImage: invoke('saveReportImage', { saved: false }),
  } satisfies SoundBuddyApi;

  const api: SoundBuddyApi = { ...defaults, ...overrides };

  function emit(event: keyof SoundBuddyApi, ...args: unknown[]): void {
    for (const cb of listeners.get(event) ?? []) cb(...args);
  }

  return { api, calls, emit };
}
