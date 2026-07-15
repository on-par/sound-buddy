// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { create } from 'zustand';
import { getSoundBuddy } from '../useElectron';
import type {
  SettingsApi,
  LlmApi,
  AppInfoApi,
  StorageApi,
  DialogApi,
  AppSettings,
  UpdateSettingsPatch,
  PublicLlmConfig,
  LlmConfigPatch,
  TestLlmProviderOpts,
} from '../../../electron/ipc/api';

export type SettingsStoreApi = SettingsApi &
  Pick<LlmApi, 'getLlmConfig' | 'saveLlmConfig' | 'detectOllama' | 'testLlmProvider'> &
  Pick<AppInfoApi, 'getAppVersion'> &
  StorageApi &
  Pick<DialogApi, 'openDirDialog'>;

// Model-name hints shown as the hosted-model field's placeholder, and used to
// decide whether a direct hosted provider hard-requires a model name (pi
// pass-through providers supply their own default server-side).
export const AI_MODEL_HINTS: Record<string, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-sonnet-4-6',
  google: 'gemini-2.0-flash',
  custom: 'model-name',
};

const EMPTY_LLM_CONFIG: PublicLlmConfig = {
  provider: '',
  model: '',
  ollamaHost: '',
  apiBaseUrl: '',
  hasApiKey: false,
  apiKeyProvider: '',
};

const DEFAULT_STORAGE_PATH = '~/Music/Sound Buddy';

export interface OllamaProbe {
  status: 'probing' | 'ok' | 'none' | 'not-running' | 'error';
  models: string[];
  reason?: string;
}

const INITIAL_OLLAMA_PROBE: OllamaProbe = { status: 'probing', models: [] };

export interface AiTestResult {
  text: string;
  kind: '' | 'ok' | 'err';
}

const EMPTY_AI_TEST_RESULT: AiTestResult = { text: '', kind: '' };

// detectOllama's return shape stays `unknown` at the IPC boundary (its probe
// result isn't part of the stable contract yet) — this is the shape the
// renderer has always assumed, ported from inline-app.js's usage.
interface OllamaDetectResult {
  ok: boolean;
  models?: string[];
  reason?: string;
}

interface TestProviderResult {
  ok: boolean;
  reason?: string;
}

export interface AiSettingsForm {
  tab: 'ollama' | 'hosted';
  ollamaModel: string;
  ollamaHost: string;
  provider: string;
  hostedModel: string;
  apiBaseUrl: string;
  apiKey: string;
  aiEnabled: boolean;
}

// Port of inline-app.js's detectOllamaInto()/testAiConnection() ok/reason
// mapping into the structured probe state the View renders from.
function projectOllamaProbe(res: OllamaDetectResult): OllamaProbe {
  if (res.ok) {
    const models = res.models ?? [];
    return { status: models.length ? 'ok' : 'none', models };
  }
  if (res.reason === 'not-running') return { status: 'not-running', models: [] };
  return { status: 'error', models: [], reason: res.reason || 'unknown error' };
}

// Port of inline-app.js's saveAiSettings() patch construction.
export function buildLlmPatch(form: AiSettingsForm): LlmConfigPatch {
  if (form.tab === 'ollama') {
    return {
      provider: 'ollama',
      model: form.ollamaModel || '',
      ollamaHost: form.ollamaHost.trim(),
    };
  }
  return {
    provider: form.provider,
    model: form.hostedModel.trim(),
    // The base URL only means something for "custom" — never persist a stale
    // one against a known provider.
    apiBaseUrl: form.provider === 'custom' ? form.apiBaseUrl.trim() : '',
    // Empty field = keep the already-saved key (never an implicit clear).
    ...(form.apiKey ? { apiKey: form.apiKey } : {}),
  };
}

// Port of inline-app.js's saveAiSettings() hosted-model guard. Direct hosted
// providers hard-require a model (there is no server-side default); pi
// pass-through providers supply their own, so an unrecognized provider passes.
export function validateAiSave(form: AiSettingsForm): string | null {
  if (form.tab === 'hosted') {
    const model = form.hostedModel.trim();
    if (!model && form.provider in AI_MODEL_HINTS) {
      return `Enter a model name first (e.g. ${AI_MODEL_HINTS[form.provider]}).`;
    }
  }
  return null;
}

// Port of inline-app.js's effectiveStoragePath(): null = unchanged (use the
// loaded path), '' = reset to the platform default, a path = a chosen folder.
export function effectiveStoragePath(pending: string | null, loaded: string, defaultPath: string): string {
  if (pending === '') return defaultPath;
  if (pending) return pending;
  return loaded;
}

export interface SettingsState {
  settings: AppSettings | null;
  llmConfig: PublicLlmConfig | null;
  settingsError: string | null;
  loadSettings(): Promise<void>;
  updateSettings(patch: UpdateSettingsPatch): Promise<void>;

  appVersion: string | null;
  aiDialogOpen: boolean;
  ollamaProbe: OllamaProbe;
  aiTestResult: AiTestResult;
  openAiDialog(): Promise<void>;
  closeAiDialog(): void;
  probeOllama(host?: string): Promise<void>;
  testProvider(opts: TestLlmProviderOpts): Promise<void>;
  testOllamaConnection(host?: string): Promise<void>;
  saveAiSettings(form: AiSettingsForm): Promise<void>;

  storageDialogOpen: boolean;
  storageDefaultPath: string;
  storageLoadedPath: string;
  storagePendingDir: string | null;
  storageUsageText: string;
  openStorageDialog(): Promise<void>;
  closeStorageDialog(): void;
  chooseStorageFolder(): Promise<void>;
  resetStorageDir(): void;
  saveStorageSettings(usageSignalChecked: boolean): Promise<void>;
}

export function createSettingsStore(getApi: () => SettingsStoreApi) {
  let probeSeq = 0; // stale-response guard for overlapping Ollama probes

  return create<SettingsState>()((set, get) => {
    async function runOllamaProbe(host?: string): Promise<OllamaDetectResult | undefined> {
      const seq = ++probeSeq;
      set({ ollamaProbe: INITIAL_OLLAMA_PROBE });
      let res: OllamaDetectResult;
      try {
        res = ((await getApi().detectOllama(host || undefined)) as OllamaDetectResult | undefined) ?? {
          ok: false,
        };
      } catch (err) {
        res = { ok: false, reason: String(err) };
      }
      if (seq !== probeSeq) return undefined; // a newer probe superseded this one
      set({ ollamaProbe: projectOllamaProbe(res) });
      return res;
    }

    return {
      settings: null,
      llmConfig: null,
      settingsError: null,
      async loadSettings() {
        try {
          const [settings, llmConfig] = await Promise.all([getApi().getSettings(), getApi().getLlmConfig()]);
          set({ settings, llmConfig, settingsError: null });
        } catch (err) {
          set({ settingsError: err instanceof Error ? err.message : String(err) });
        }
      },
      async updateSettings(patch) {
        try {
          set({ settings: await getApi().updateSettings(patch) });
        } catch (err) {
          set({ settingsError: err instanceof Error ? err.message : String(err) });
        }
      },

      appVersion: null,
      aiDialogOpen: false,
      ollamaProbe: INITIAL_OLLAMA_PROBE,
      aiTestResult: EMPTY_AI_TEST_RESULT,
      async openAiDialog() {
        let cfg: PublicLlmConfig | null;
        try {
          cfg = await getApi().getLlmConfig();
        } catch {
          cfg = null;
        }
        cfg = cfg || EMPTY_LLM_CONFIG;
        let appVersion: string | null;
        try {
          appVersion = await getApi().getAppVersion();
        } catch {
          appVersion = null;
        }
        set({
          llmConfig: cfg,
          appVersion,
          aiDialogOpen: true,
          aiTestResult: EMPTY_AI_TEST_RESULT,
        });
        void runOllamaProbe(cfg.ollamaHost || undefined);
      },
      closeAiDialog() {
        set({ aiDialogOpen: false });
      },
      async probeOllama(host) {
        await runOllamaProbe(host);
      },
      async testProvider(opts) {
        let res: TestProviderResult;
        try {
          res = ((await getApi().testLlmProvider(opts)) as TestProviderResult | undefined) ?? { ok: false };
        } catch (err) {
          res = { ok: false, reason: String(err) };
        }
        set({
          aiTestResult: res.ok
            ? { text: 'Connected ✓', kind: 'ok' }
            : { text: res.reason || 'Connection failed', kind: 'err' },
        });
      },
      async testOllamaConnection(host) {
        const res = await runOllamaProbe(host);
        // res.ok = reachable — a running Ollama with zero models is still
        // connected (the probe status above already says to pull one).
        const ok = !!(res && res.ok);
        set({ aiTestResult: { text: ok ? 'Connected ✓' : 'Not connected', kind: ok ? 'ok' : 'err' } });
      },
      async saveAiSettings(form) {
        const validationError = validateAiSave(form);
        if (validationError) {
          set({ aiTestResult: { text: validationError, kind: 'err' } });
          return;
        }
        const patch = buildLlmPatch(form);
        let res;
        try {
          res = await getApi().saveLlmConfig(patch);
        } catch (err) {
          res = { ok: false as const, reason: String(err) };
        }
        if (!res.ok) {
          set({ aiTestResult: { text: res.reason || 'Could not save settings', kind: 'err' } });
          return;
        }
        set({ llmConfig: res.config });
        await get().updateSettings({ aiEnabled: form.aiEnabled });
        set({ aiDialogOpen: false });
      },

      storageDialogOpen: false,
      storageDefaultPath: DEFAULT_STORAGE_PATH,
      storageLoadedPath: DEFAULT_STORAGE_PATH,
      storagePendingDir: null,
      storageUsageText: '',
      async openStorageDialog() {
        set({
          storagePendingDir: null,
          storageLoadedPath: get().storageDefaultPath,
          storageUsageText: 'Calculating disk usage…',
          storageDialogOpen: true,
        });
        try {
          const u = await getApi().getStorageUsage();
          if (u) {
            const defaultPath = u.defaultPath || get().storageDefaultPath;
            set({
              storageDefaultPath: defaultPath,
              storageLoadedPath: u.path || defaultPath,
              storageUsageText: u.exists
                ? `Using ${u.human} on this Mac — no limit.`
                : 'Nothing recorded yet — no limit on how much you can store.',
            });
          } else {
            set({ storageUsageText: '' });
          }
        } catch {
          set({ storageUsageText: '' });
        }
      },
      closeStorageDialog() {
        set({ storageDialogOpen: false });
      },
      async chooseStorageFolder() {
        const dir = await getApi().openDirDialog();
        if (!dir) return;
        set({ storagePendingDir: dir });
      },
      resetStorageDir() {
        set({ storagePendingDir: '' });
      },
      async saveStorageSettings(usageSignalChecked) {
        const { storagePendingDir, settings } = get();
        if (storagePendingDir !== null) {
          await get().updateSettings({ storageDir: storagePendingDir });
        }
        if (usageSignalChecked !== (settings?.usageSignalEnabled ?? false)) {
          await get().updateSettings({ usageSignalEnabled: usageSignalChecked });
        }
        set({ storageDialogOpen: false });
      },
    };
  });
}

export const useSettingsStore = createSettingsStore(getSoundBuddy);
