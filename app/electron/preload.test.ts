// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi } from 'vitest';

// Importing './preload' below executes its module-level
// `contextBridge.exposeInMainWorld` call. In plain Node (no Electron
// sandbox) the real `electron` package resolves to a path string, so that
// call would throw — mock it before the import.
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), removeAllListeners: vi.fn() },
}));

import { createBridge, type IpcRendererLike } from './preload';
import type {
  UpdateSettingsPatch,
  LlmConfigPatch,
  TestLlmProviderOpts,
  AnalyzeFileOpts,
  AnalysisSummaryInput,
  StartLiveOpts,
  StartPlaybackOpts,
} from './ipc/api';

function mockIpc(): IpcRendererLike & {
  invoke: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  removeAllListeners: ReturnType<typeof vi.fn>;
} {
  return {
    invoke: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    removeAllListeners: vi.fn(),
  };
}

type BridgeKey = keyof ReturnType<typeof createBridge>;

// Every method backed by `ipc.invoke`, paired with its real channel name and
// a sample argument list. Kept exhaustive by the completeness guard below.
const INVOKE_TABLE: Array<{ method: BridgeKey; channel: string; args: unknown[] }> = [
  { method: 'getAppVersion', channel: 'get-app-version', args: [] },
  { method: 'getSettings', channel: 'get-settings', args: [] },
  { method: 'toFileUrl', channel: 'to-file-url', args: ['/tmp/a.wav'] },
  {
    method: 'updateSettings',
    channel: 'update-settings',
    args: [{ storageDir: '/tmp/rec' } satisfies UpdateSettingsPatch],
  },
  { method: 'getStorageUsage', channel: 'get-storage-usage', args: [] },
  { method: 'getLlmConfig', channel: 'llm-get-config', args: [] },
  {
    method: 'saveLlmConfig',
    channel: 'llm-save-config',
    args: [{ provider: 'ollama' } satisfies LlmConfigPatch],
  },
  { method: 'detectOllama', channel: 'llm-detect-ollama', args: ['http://localhost:11434'] },
  {
    method: 'testLlmProvider',
    channel: 'llm-test-provider',
    args: [{ provider: 'ollama' } satisfies TestLlmProviderOpts],
  },
  { method: 'listLlmModels', channel: 'llm-list-models', args: [] },
  { method: 'getLicense', channel: 'get-license', args: [] },
  { method: 'activateLicense', channel: 'activate-license', args: ['SB-TEST-KEY'] },
  { method: 'removeLicense', channel: 'remove-license', args: [] },
  { method: 'refreshLicense', channel: 'refresh-license', args: [] },
  { method: 'openCheckout', channel: 'open-checkout', args: ['monthly'] },
  { method: 'openFeedback', channel: 'open-feedback', args: [] },
  { method: 'openCaptureGuide', channel: 'open-capture-guide', args: [] },
  { method: 'revealDiagnostics', channel: 'reveal-diagnostics', args: [] },
  { method: 'listRigs', channel: 'list-rigs', args: [] },
  { method: 'saveRig', channel: 'save-rig', args: [{ id: 'r1' }] },
  { method: 'deleteRig', channel: 'delete-rig', args: ['r1'] },
  { method: 'setActiveRig', channel: 'set-active-rig', args: [null] },
  {
    method: 'analyzeFile',
    channel: 'analyze-file',
    args: [{ filePath: '/tmp/a.wav' } satisfies AnalyzeFileOpts],
  },
  {
    method: 'saveAnalysisSummary',
    channel: 'save-analysis-summary',
    args: [
      {
        sourceFilename: 'a.wav',
        gradeLetter: 'B',
        score: 80,
        recordingType: 'live',
        topFixes: [],
      } satisfies AnalysisSummaryInput,
    ],
  },
  { method: 'listAnalysisSummaries', channel: 'list-analysis-summaries', args: [] },
  { method: 'cancelAnalysis', channel: 'cancel-analysis', args: [] },
  { method: 'getDemoAudio', channel: 'get-demo-audio', args: [] },
  { method: 'isOnboardingDisabled', channel: 'onboarding-disabled', args: [] },
  { method: 'listDevices', channel: 'list-devices', args: [] },
  { method: 'listOutputDevices', channel: 'list-output-devices', args: [] },
  { method: 'openFileDialog', channel: 'open-file-dialog', args: [] },
  { method: 'openDirDialog', channel: 'open-dir-dialog', args: [] },
  {
    method: 'saveReportImage',
    channel: 'save-report-image',
    args: [new Uint8Array([1, 2]), 'card.png'],
  },
  {
    method: 'startLive',
    channel: 'start-live',
    args: [{ windowSecs: 5, llmIntervalSecs: 10 } satisfies StartLiveOpts],
  },
  { method: 'stopLive', channel: 'stop-live', args: [] },
  { method: 'revealPath', channel: 'reveal-path', args: ['/tmp/session'] },
  {
    method: 'startPlayback',
    channel: 'start-playback',
    args: [{ sessionDir: '/tmp/session' } satisfies StartPlaybackOpts],
  },
  { method: 'stopPlayback', channel: 'stop-playback', args: [] },
  { method: 'readSession', channel: 'read-session', args: ['/tmp/session'] },
  { method: 'triggerLlmAnalysis', channel: 'trigger-llm-analysis', args: [{ summary: 'x' }] },
  { method: 'checkForUpdates', channel: 'check-for-updates', args: [] },
  { method: 'openReleasePage', channel: 'open-release-page', args: ['https://example.com'] },
];

// Methods backed by `ipc.on` rather than `ipc.invoke` — excluded from the
// completeness guard's "every non-listener key is in the table" check.
const LISTENERS: BridgeKey[] = [
  'onOpenLicenseDialog',
  'onAnalysisProgress',
  'onPlaybackEvent',
  'onLiveEvent',
  'onLlmDelta',
  'onLlmDone',
  'onAnalysisResult',
  'onMenuOpenFile',
  'onUpdateAvailable',
  'onUpdateStatus',
  'removeAllListeners',
];

describe('createBridge — invoke-backed methods', () => {
  it.each(INVOKE_TABLE)('$method forwards to ipc.invoke($channel, ...args)', ({ method, channel, args }) => {
    const ipc = mockIpc();
    const bridge = createBridge(ipc);
    (bridge[method] as (...a: unknown[]) => unknown)(...args);

    expect(ipc.invoke).toHaveBeenCalledTimes(1);
    expect(ipc.invoke).toHaveBeenCalledWith(channel, ...args);
  });

  it('forwards object arguments by reference, unmodified', () => {
    const ipc = mockIpc();
    const bridge = createBridge(ipc);
    const patch = { storageDir: '/tmp/rec' } satisfies UpdateSettingsPatch;

    bridge.updateSettings(patch);

    expect(ipc.invoke.mock.calls[0][1]).toBe(patch);
  });

  it('is exhaustive: every non-listener bridge key has a table row', () => {
    const bridge = createBridge(mockIpc());
    const nonListenerKeys = Object.keys(bridge).filter(
      (k) => !LISTENERS.includes(k as BridgeKey)
    );

    expect(new Set(INVOKE_TABLE.map((r) => r.method))).toEqual(new Set(nonListenerKeys));
  });
});

describe('createBridge — event listeners', () => {
  const LISTENER_TABLE: Array<{
    method: BridgeKey;
    channel: string;
    payload: unknown;
    expectsPayload: boolean;
  }> = [
    { method: 'onOpenLicenseDialog', channel: 'open-license-dialog', payload: undefined, expectsPayload: false },
    { method: 'onAnalysisProgress', channel: 'analysis-progress', payload: { status: 'running' }, expectsPayload: true },
    { method: 'onPlaybackEvent', channel: 'playback-event', payload: { kind: 'level' }, expectsPayload: true },
    { method: 'onLiveEvent', channel: 'live-event', payload: { kind: 'meter' }, expectsPayload: true },
    { method: 'onLlmDelta', channel: 'llm-delta', payload: 'chunk', expectsPayload: true },
    { method: 'onLlmDone', channel: 'llm-done', payload: undefined, expectsPayload: false },
    { method: 'onAnalysisResult', channel: 'analysis-result', payload: { grade: 'B' }, expectsPayload: true },
    { method: 'onMenuOpenFile', channel: 'menu-open-file', payload: '/tmp/file.wav', expectsPayload: true },
    {
      method: 'onUpdateAvailable',
      channel: 'update-available',
      payload: { version: '1.2.3', url: 'https://example.com', notes: 'notes' },
      expectsPayload: true,
    },
    { method: 'onUpdateStatus', channel: 'update-status', payload: { state: 'downloading' }, expectsPayload: true },
  ];

  it.each(LISTENER_TABLE)(
    '$method registers ipc.on($channel, ...) and forwards the payload',
    ({ method, channel, payload, expectsPayload }) => {
      const ipc = mockIpc();
      const bridge = createBridge(ipc);
      const cb = vi.fn();

      (bridge[method] as (cb: (...a: unknown[]) => void) => void)(cb);

      expect(ipc.on).toHaveBeenCalledTimes(1);
      expect(ipc.on).toHaveBeenCalledWith(channel, expect.any(Function));

      const wrapper = ipc.on.mock.calls[0][1];
      wrapper({}, payload);

      if (expectsPayload) {
        expect(cb).toHaveBeenCalledWith(payload);
      } else {
        expect(cb).toHaveBeenCalledWith();
      }
    }
  );

  it('removeAllListeners forwards the channel to ipc.removeAllListeners', () => {
    const ipc = mockIpc();
    const bridge = createBridge(ipc);

    bridge.removeAllListeners('live-event');

    expect(ipc.removeAllListeners).toHaveBeenCalledTimes(1);
    expect(ipc.removeAllListeners).toHaveBeenCalledWith('live-event');
  });
});

describe('createBridge — no key material', () => {
  it('exposes no key-material getters on the bridge surface', () => {
    const bridge = createBridge(mockIpc());

    expect(Object.keys(bridge).filter((k) => /key/i.test(k))).toEqual([]);
    expect(bridge).not.toHaveProperty('getApiKey');
  });
});

describe('preload module wiring', () => {
  it('exposes the bridge on window.soundBuddy via contextBridge', async () => {
    const { contextBridge } = await import('electron');

    expect(contextBridge.exposeInMainWorld).toHaveBeenCalledWith(
      'soundBuddy',
      expect.objectContaining({ getAppVersion: expect.any(Function) })
    );
  });
});
