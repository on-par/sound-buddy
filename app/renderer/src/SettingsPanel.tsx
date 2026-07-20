// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// React island for the unified Settings dialog (#76, #91, TD-001 slice 3,
// #421, combined into one tabbed modal by #204) — replaces the static
// #ai-dialog and #storage-dialog markup + openAiSettings()/saveAiSettings()/
// openStorageSettings()/saveStorageSettings() in inline-app.js with a
// component backed by settingsStore. Renders the same inner ids/classes the
// static markup had (index.html) so the existing e2e suite
// (app/tests/e2e/settings.spec.ts) keeps driving the same selectors. The
// dialog stays permanently in the DOM — `display` toggles via `dialogOpen`.

import { useEffect, useRef, useState } from 'react';
import type { StoreApi, UseBoundStore } from 'zustand';
import { useElectron } from './useElectron';
import { useStoreShallow } from './stores/useStoreShallow';
import { useSettingsStore, type SettingsState } from './stores/settingsStore';
import { DEFAULT_STORAGE_PATH, effectiveStoragePath, loadStorageSeed, buildStoragePatch } from './storage-settings';
import type { LlmApi, LlmConfigPatch, LlmModelInfo, PublicLlmConfig, UpdateSettingsPatch } from '../../electron/ipc/api';

export type SettingsSection = 'storage' | 'ai' | 'about';

// Direct hosted providers hard-require a model (no server-side default);
// ollama and pi pass-through providers supply their own (TD-004 slice 3,
// #427). Mirrors electron/llm-config.ts's HOSTED_PROVIDER_IDS — duplicated
// rather than shared since this file runs in the renderer process, across
// the IPC boundary (same reasoning as inline-app.js's own copy).
const HOSTED_PROVIDER_IDS = new Set(['openai', 'anthropic', 'google', 'custom']);

type SettingsStoreHandle = UseBoundStore<StoreApi<SettingsState>>;

interface OllamaProbeResult {
  ok?: boolean;
  models?: string[];
  reason?: string;
}

export interface OllamaStatus {
  text: string;
  kind: '' | 'ok' | 'err';
  showInstallLink?: boolean;
}

export interface LlmPatchFields {
  ollamaModel: string;
  ollamaHost: string;
  provider: string;
  hostedModel: string;
  baseUrl: string;
  apiKey: string;
}

export interface SettingsSeed {
  tab: 'ollama' | 'hosted';
  ollamaHost: string;
  baseUrl: string;
  provider: string;
  hostedModel: string;
  passthroughOption: { value: string; label: string } | null;
  savedCfg: PublicLlmConfig;
  modelsCache: LlmModelInfo[];
  enableAi: boolean;
}

const EMPTY_LLM_CONFIG: PublicLlmConfig = {
  provider: '',
  model: '',
  ollamaHost: '',
  apiBaseUrl: '',
  hasApiKey: false,
  apiKeyProvider: '',
};

// Model ids the Pi ModelRegistry reports for `provider` (#427) — port of
// inline-app.js:3508–3510.
export function modelsForProvider(cache: LlmModelInfo[], provider: string): string[] {
  return cache.filter((m) => m.provider === provider).map((m) => m.id);
}

// Port of inline-app.js:3529–3530: a stored key only counts for the provider
// it was pasted for.
export function keyPlaceholder(savedCfg: PublicLlmConfig | null, provider: string): string {
  const keySaved = !!(savedCfg && savedCfg.hasApiKey && savedCfg.apiKeyProvider === provider);
  return keySaved ? '••••••••••  (saved — paste to replace)' : 'Paste your API key';
}

// Port of inline-app.js:3626–3633.
export function hostedModelValidation(provider: string, model: string, cache: LlmModelInfo[]): string | null {
  if (!model && HOSTED_PROVIDER_IDS.has(provider)) {
    const example = modelsForProvider(cache, provider)[0] || 'model-name';
    return `Enter a model name first (e.g. ${example}).`;
  }
  return null;
}

// Port of inline-app.js:3615–3643 — the exact save-patch shape, incl. the
// apiBaseUrl-only-for-custom and empty-key-means-keep rules.
export function buildLlmPatch(tab: 'ollama' | 'hosted', fields: LlmPatchFields): LlmConfigPatch {
  if (tab === 'ollama') {
    return {
      provider: 'ollama',
      model: fields.ollamaModel || '',
      ollamaHost: fields.ollamaHost.trim(),
    };
  }
  const patch: LlmConfigPatch = {
    provider: fields.provider,
    model: fields.hostedModel.trim(),
    apiBaseUrl: fields.provider === 'custom' ? fields.baseUrl.trim() : '',
  };
  if (fields.apiKey) patch.apiKey = fields.apiKey;
  return patch;
}

// Port of inline-app.js:3481–3502 — maps a detectOllama() probe result to the
// status line + tone. The zero-models/not-running copy stays text-only (no
// markup) here; the install link is rendered separately by the component so
// dynamic reasons can never be interpolated into HTML (see setOllamaStatus's
// old html/text split).
export function ollamaStatusFor(res: OllamaProbeResult | null): OllamaStatus {
  if (res && res.ok) {
    const models = res.models || [];
    if (models.length) {
      return { text: `Ollama detected — ${models.length} model${models.length === 1 ? '' : 's'} available.`, kind: 'ok' };
    }
    return { text: 'Ollama is running but has no models — run "ollama pull llama3.2" first.', kind: 'err' };
  }
  if (res && res.reason === 'not-running') {
    return { text: 'Ollama not detected — ', kind: 'err', showInstallLink: true };
  }
  return { text: `Could not reach Ollama: ${res && res.reason ? res.reason : 'unknown error'}`, kind: 'err' };
}

// Injectable: the detectOllama() round-trip + never-throw normalization
// (inline-app.js:3477–3478). The caller owns the stale-probe sequence guard
// (a mutable ref can't live in a pure function) and the resulting state
// writes.
export async function probeOllama(api: Pick<LlmApi, 'detectOllama'>, host: string): Promise<OllamaProbeResult> {
  try {
    return (await api.detectOllama(host || undefined)) as OllamaProbeResult;
  } catch (err) {
    return { ok: false, reason: String(err) };
  }
}

// Port of inline-app.js:3533–3572 (minus the DOM writes) — the config +
// model-list fetch and the field seeding it drives, incl. the pass-through
// provider option for a pre-#76 provider (3548–3563) and the enable-toggle
// seed rule (3572).
export async function loadSettingsSeed(
  api: Pick<LlmApi, 'getLlmConfig' | 'listLlmModels'>,
  currentAiEnabled: boolean
): Promise<SettingsSeed> {
  const [cfgResult, modelsResult] = await Promise.allSettled([api.getLlmConfig(), api.listLlmModels()]);
  const savedCfg = cfgResult.status === 'fulfilled' ? cfgResult.value : EMPTY_LLM_CONFIG;
  const modelsCache = modelsResult.status === 'fulfilled' ? modelsResult.value : [];

  const hosted = !!(savedCfg.provider && savedCfg.provider !== 'ollama');
  let provider = 'openai';
  let hostedModel = '';
  let passthroughOption: { value: string; label: string } | null = null;
  if (hosted) {
    provider = savedCfg.provider;
    hostedModel = savedCfg.model || '';
    if (!HOSTED_PROVIDER_IDS.has(savedCfg.provider)) {
      passthroughOption = { value: savedCfg.provider, label: `${savedCfg.provider} (via pi login)` };
    }
  }

  return {
    tab: hosted ? 'hosted' : 'ollama',
    ollamaHost: savedCfg.ollamaHost || '',
    baseUrl: savedCfg.apiBaseUrl || '',
    provider,
    hostedModel,
    passthroughOption,
    savedCfg,
    modelsCache,
    enableAi: savedCfg.provider ? currentAiEnabled : true,
  };
}

// Port of inline-app.js:3590–3613.
export async function testConnection(
  api: Pick<LlmApi, 'testLlmProvider'>,
  opts: { provider: string; apiKey: string; apiBaseUrl: string }
): Promise<{ text: string; kind: 'ok' | 'err' }> {
  const res = (await api.testLlmProvider({
    provider: opts.provider,
    apiKey: opts.apiKey || undefined,
    apiBaseUrl: opts.apiBaseUrl.trim() || undefined,
  })) as { ok?: boolean; reason?: string } | undefined;
  if (res && res.ok) return { text: 'Connected ✓', kind: 'ok' };
  return { text: res && res.reason ? res.reason : 'Connection failed', kind: 'err' };
}

export interface SaveAllFields {
  tab: 'ollama' | 'hosted';
  llm: LlmPatchFields;
  modelsCache: LlmModelInfo[];
  storagePatch: UpdateSettingsPatch | null;
  enableAi: boolean;
}

// Port of inline-app.js:3615–3661 (AI save) merged with saveStorageSettings()
// (storage save) behind the single Settings footer Save button (#204). One
// Save now covers both sections atomically: the hosted-model validation and
// the LLM save must both succeed — on either failure, jump back to the AI
// section, report the error, and do NOT close or persist anything, including
// the storage patch — before the storage patch and the enable-toggle
// fold-in are applied and the dialog closes. This intentionally differs from
// the two-independent-dialogs precursor: a single shared Save button means a
// failed AI save must not silently leave an unrelated storage change
// persisted with no way to tell the user it happened.
export async function saveAll(
  fields: SaveAllFields,
  store: SettingsStoreHandle,
  setSection: (s: SettingsSection) => void,
  setTestResult: (r: { text: string; kind: '' | 'ok' | 'err' }) => void,
  focusModelInput: () => void
): Promise<void> {
  const { tab, llm, modelsCache, storagePatch, enableAi } = fields;
  if (tab === 'hosted') {
    const validation = hostedModelValidation(llm.provider, llm.hostedModel.trim(), modelsCache);
    if (validation) {
      setSection('ai');
      setTestResult({ text: validation, kind: 'err' });
      focusModelInput();
      return;
    }
  }
  const patch = buildLlmPatch(tab, llm);
  const res = await store.getState().saveLlmConfig(patch);
  if (!res.ok) {
    setSection('ai');
    setTestResult({ text: res.reason || 'Could not save settings', kind: 'err' });
    return;
  }
  if (storagePatch) {
    await store.getState().updateSettings(storagePatch);
  }
  await store.getState().updateSettings({ aiEnabled: enableAi });
  store.getState().closeDialog();
}

export default function SettingsPanel() {
  const api = useElectron();
  const { settings, dialogOpen } = useStoreShallow(useSettingsStore, (s) => ({
    settings: s.settings,
    dialogOpen: s.dialogOpen,
  }));

  const [tab, setTab] = useState<'ollama' | 'hosted'>('ollama');
  const [ollamaHost, setOllamaHost] = useState('');
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaModel, setOllamaModel] = useState('');
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus>({ text: 'Looking for Ollama…', kind: '' });
  const [provider, setProvider] = useState('openai');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [hostedModel, setHostedModel] = useState('');
  const [testResult, setTestResult] = useState<{ text: string; kind: '' | 'ok' | 'err' }>({ text: '', kind: '' });
  const [enableAi, setEnableAi] = useState(true);
  const [version, setVersion] = useState('');
  const [modelsCache, setModelsCache] = useState<LlmModelInfo[]>([]);
  const [savedCfg, setSavedCfg] = useState<PublicLlmConfig | null>(null);
  const [passthroughOption, setPassthroughOption] = useState<{ value: string; label: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const [section, setSection] = useState<SettingsSection>('storage');
  const [pendingDir, setPendingDir] = useState<string | null>(null);
  const [defaultPath, setDefaultPath] = useState(DEFAULT_STORAGE_PATH);
  const [loadedPath, setLoadedPath] = useState(DEFAULT_STORAGE_PATH);
  const [usageText, setUsageText] = useState('Calculating disk usage…');
  const [usageSignalEnabled, setUsageSignalEnabled] = useState(false);
  const [crashReportingEnabled, setCrashReportingEnabled] = useState(false);
  const [dawWorkspaceEnabled, setDawWorkspaceEnabled] = useState(false);
  const [liveAdjustmentsEnabled, setLiveAdjustmentsEnabled] = useState(false);

  const hostedModelInputRef = useRef<HTMLInputElement>(null);
  const detectSeqRef = useRef(0);

  // Takes `host` explicitly rather than reading the `ollamaHost` state
  // closure — the dialog-open effect below seeds `ollamaHost` via
  // `setOllamaHost` and kicks the initial probe in the same tick, and a
  // state update from that same render isn't visible to a same-render
  // closure yet, which would probe the just-superseded (often empty) host.
  async function detectOllamaInto(host: string, preferModel?: string): Promise<OllamaProbeResult | null> {
    const seq = ++detectSeqRef.current;
    setOllamaStatus({ text: 'Looking for Ollama…', kind: '' });
    const res = await probeOllama(api, host);
    if (seq !== detectSeqRef.current) return null; // a newer probe superseded this one
    const models = res.ok ? res.models || [] : [];
    setOllamaModels(models);
    setOllamaStatus(ollamaStatusFor(res));
    if (res.ok && preferModel && models.includes(preferModel)) setOllamaModel(preferModel);
    return res;
  }

  /* c8 ignore start -- fetches config + model list and seeds every field on
     open; needs a real Electron bridge round-trip, exercised by
     settings.spec.ts. No jsdom in this harness (constitution forbids adding
     a new framework), so effects never run under renderToString. */
  useEffect(() => {
    if (!dialogOpen) return;
    setSection('storage');
    setPendingDir(null);
    setUsageText('Calculating disk usage…');
    setUsageSignalEnabled(!!settings?.usageSignalEnabled);
    setCrashReportingEnabled(!!settings?.crashReportingEnabled);
    setDawWorkspaceEnabled(!!settings?.dawWorkspaceEnabled);
    setLiveAdjustmentsEnabled(!!settings?.liveAdjustmentsEnabled);
    let cancelled = false;
    void (async () => {
      const [seed, storageSeed] = await Promise.all([loadSettingsSeed(api, settings?.aiEnabled ?? true), loadStorageSeed(api)]);
      if (cancelled) return;
      setSavedCfg(seed.savedCfg);
      setModelsCache(seed.modelsCache);
      setOllamaHost(seed.ollamaHost);
      setBaseUrl(seed.baseUrl);
      setApiKey('');
      setProvider(seed.provider);
      setHostedModel(seed.hostedModel);
      setPassthroughOption(seed.passthroughOption);
      setTab(seed.tab);
      setEnableAi(seed.enableAi);
      setTestResult({ text: '', kind: '' });
      setDefaultPath(storageSeed.defaultPath);
      setLoadedPath(storageSeed.loadedPath);
      setUsageText(storageSeed.usageText);
      void detectOllamaInto(seed.ollamaHost, seed.savedCfg.provider === 'ollama' ? seed.savedCfg.model : undefined);
      try {
        const v = await api.getAppVersion();
        if (!cancelled) setVersion(`Sound Buddy ${v}`);
      } catch {
        if (!cancelled) setVersion('');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dialogOpen]);
  /* c8 ignore stop */

  /* c8 ignore start -- document-level Escape close (inline-app.js:3671–3676, same pattern as LicensePanel). */
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') useSettingsStore.getState().closeDialog();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
  /* c8 ignore stop */

  const models = modelsForProvider(modelsCache, provider);

  async function handleTest() {
    setTesting(true);
    try {
      if (tab === 'ollama') {
        const res = await detectOllamaInto(ollamaHost, ollamaModel || undefined);
        const ok = !!(res && res.ok);
        setTestResult({ text: ok ? 'Connected ✓' : 'Not connected', kind: ok ? 'ok' : 'err' });
      } else {
        setTestResult(await testConnection(api, { provider, apiKey, apiBaseUrl: baseUrl }));
      }
    } finally {
      setTesting(false);
    }
  }

  async function handleChooseStorageFolder() {
    const dir = await api.openDirDialog();
    if (!dir) return;
    setPendingDir(dir);
  }

  function handleSave() {
    const storagePatch = buildStoragePatch(
      pendingDir,
      { usageSignalEnabled, crashReportingEnabled, dawWorkspaceEnabled, liveAdjustmentsEnabled },
      settings
    );
    void saveAll(
      { tab, llm: { ollamaModel, ollamaHost, provider, hostedModel, baseUrl, apiKey }, modelsCache, storagePatch, enableAi },
      useSettingsStore,
      setSection,
      setTestResult,
      () => hostedModelInputRef.current?.focus()
    );
  }

  const storagePath = effectiveStoragePath(pendingDir, defaultPath, loadedPath);

  return (
    <div
      id="settings-dialog"
      className="rig-dialog"
      style={{ display: dialogOpen ? 'flex' : 'none' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) useSettingsStore.getState().closeDialog();
      }}
    >
      <div className="rig-dialog-card settings-dialog-card">
        <div className="rig-dialog-title" id="settings-dialog-title">
          Settings
        </div>
        <div className="settings-tabs" role="tablist">
          <button
            type="button"
            className={'settings-tab' + (section === 'storage' ? ' active' : '')}
            id="settings-tab-btn-storage"
            role="tab"
            aria-selected={section === 'storage'}
            onClick={() => setSection('storage')}
          >
            Storage
          </button>
          <button
            type="button"
            className={'settings-tab' + (section === 'ai' ? ' active' : '')}
            id="settings-tab-btn-ai"
            role="tab"
            aria-selected={section === 'ai'}
            onClick={() => setSection('ai')}
          >
            AI Engineer
          </button>
          <button
            type="button"
            className={'settings-tab' + (section === 'about' ? ' active' : '')}
            id="settings-tab-btn-about"
            role="tab"
            aria-selected={section === 'about'}
            onClick={() => setSection('about')}
          >
            About
          </button>
        </div>
        <div className="settings-pane" id="settings-pane-storage" style={{ display: section === 'storage' ? 'flex' : 'none' }}>
          <label className="ai-field">
            <span>Storage folder</span>
            <div className="storage-path-row">
              <span className="storage-path" id="storage-path">
                {storagePath}
              </span>
              <button type="button" id="storage-change-btn" className="btn btn-secondary sm" data-icon="folder" onClick={() => void handleChooseStorageFolder()}>
                Change…
              </button>
            </div>
          </label>
          <p className="storage-usage" id="storage-usage">
            {usageText}
          </p>
          <p className="storage-unlimited">Unlimited recordings. Stored on your machine.</p>
          <p className="storage-note" id="storage-note">
            Record and analyze as much as you want — no limits on any tier. New recordings are saved here; anything
            you&apos;ve already recorded stays in its current folder.
          </p>
          <button
            type="button"
            id="storage-reset-btn"
            className="btn btn-secondary sm"
            style={{ display: storagePath === defaultPath ? 'none' : undefined }}
            onClick={() => setPendingDir('')}
          >
            Use default
          </button>
          <label className="ai-enable-row">
            <input type="checkbox" id="usage-signal-toggle" checked={usageSignalEnabled} onChange={(e) => setUsageSignalEnabled(e.target.checked)} />
            Share anonymous usage counts
          </label>
          <p className="ai-dialog-note" id="usage-signal-note">
            Off unless you turn it on. When enabled, Sound Buddy sends only anonymous usage counts — which features get
            used (app opened, analysis run, report viewed or exported, feedback sent) plus app version, macOS version,
            platform, an anonymous install/session id, and the hour it happened — never audio, recordings, church or
            file names, file paths, prompts, or report text. Your audio never leaves your machine.
          </p>
          <label className="ai-enable-row">
            <input type="checkbox" id="crash-reporting-toggle" checked={crashReportingEnabled} onChange={(e) => setCrashReportingEnabled(e.target.checked)} />
            Send crash reports
          </label>
          <p className="ai-dialog-note" id="crash-reporting-note">
            Off unless you turn it on. When enabled, a crash sends only: app version, macOS version, the error message
            and stack trace (emails, license keys, and folder paths removed — file names are reduced to their base
            name), which screen you were on, and the names of recent app actions. Never recordings, audio, full file
            paths, or anything you typed.
          </p>
          <label className="ai-enable-row">
            <input type="checkbox" id="daw-workspace-toggle" checked={dawWorkspaceEnabled} onChange={(e) => setDawWorkspaceEnabled(e.target.checked)} />
            Try the experimental DAW-style Live workspace
          </label>
          <p className="ai-dialog-note" id="daw-workspace-note">
            Off unless you turn it on. An early, experimental take on a DAW-style recording workspace for the Live tab.
            Your current Live Capture workflow stays the default — turn this off anytime to go back.
          </p>
          <label className="ai-enable-row">
            <input
              type="checkbox"
              id="live-adjustments-toggle"
              checked={liveAdjustmentsEnabled}
              onChange={(e) => setLiveAdjustmentsEnabled(e.target.checked)}
            />
            Try experimental live adjustments
          </label>
          <p className="ai-dialog-note" id="live-adjustments-note">
            Off unless you turn it on. An early, experimental area for mix suggestions while you monitor or record in
            Live Capture. Nothing is analyzed or sent anywhere — turn this off anytime to hide it.
          </p>
        </div>
        <div className="settings-pane" id="settings-pane-ai" style={{ display: section === 'ai' ? 'flex' : 'none' }}>
          <div className="ai-dialog-sub">
            Works with the AI you already have — use your local Ollama, or paste a key you already pay for.
          </div>
          <div className="ai-tabs" role="tablist">
            <button
              type="button"
              className={'ai-tab' + (tab === 'ollama' ? ' active' : '')}
              id="ai-tab-btn-ollama"
              role="tab"
              aria-selected={tab === 'ollama'}
              onClick={() => {
                setTab('ollama');
                setTestResult({ text: '', kind: '' });
              }}
            >
              I have Ollama
            </button>
            <button
              type="button"
              className={'ai-tab' + (tab === 'hosted' ? ' active' : '')}
              id="ai-tab-btn-hosted"
              role="tab"
              aria-selected={tab === 'hosted'}
              onClick={() => {
                setTab('hosted');
                setTestResult({ text: '', kind: '' });
              }}
            >
              I have an API key
            </button>
          </div>
          <div className="ai-tabpane" id="ai-tab-ollama" style={{ display: tab === 'ollama' ? 'flex' : 'none' }}>
            <label className="ai-field">
              <span className="ai-field-label">Endpoint</span>
              <input
                type="text"
                id="ai-ollama-host"
                className="rig-dialog-input"
                placeholder="http://localhost:11434"
                autoComplete="off"
                spellCheck={false}
                value={ollamaHost}
                onChange={(e) => setOllamaHost(e.target.value)}
                onBlur={() => void detectOllamaInto(ollamaHost, ollamaModel || undefined)}
              />
            </label>
            <div className={'ai-status' + (ollamaStatus.kind ? ` ${ollamaStatus.kind}` : '')} id="ai-ollama-status">
              {ollamaStatus.showInstallLink ? (
                <>
                  {ollamaStatus.text}
                  <a
                    href="https://ollama.com/download"
                    onClick={(e) => {
                      e.preventDefault();
                      void api.openReleasePage(e.currentTarget.href);
                    }}
                  >
                    install it from ollama.com
                  </a>
                  , then relaunch it.
                </>
              ) : (
                ollamaStatus.text
              )}
            </div>
            <label className="ai-field">
              <span className="ai-field-label">Model</span>
              <div className="select-wrap">
                <select
                  id="ai-ollama-model"
                  aria-label="Ollama model"
                  value={ollamaModel}
                  disabled={ollamaModels.length === 0}
                  onChange={(e) => setOllamaModel(e.target.value)}
                >
                  {ollamaModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <span className="select-caret" data-icon="chevron-down" />
              </div>
            </label>
          </div>
          <div className="ai-tabpane" id="ai-tab-hosted" style={{ display: tab === 'hosted' ? 'flex' : 'none' }}>
            <label className="ai-field">
              <span className="ai-field-label">Provider</span>
              <div className="select-wrap">
                <select id="ai-provider" aria-label="Provider" value={provider} onChange={(e) => setProvider(e.target.value)}>
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="google">Google</option>
                  <option value="custom">Custom (OpenAI-compatible)</option>
                  {passthroughOption && (
                    <option value={passthroughOption.value} data-passthrough="1">
                      {passthroughOption.label}
                    </option>
                  )}
                </select>
                <span className="select-caret" data-icon="chevron-down" />
              </div>
            </label>
            <label className="ai-field" id="ai-baseurl-field" style={{ display: provider === 'custom' ? 'flex' : 'none' }}>
              <span className="ai-field-label">Base URL</span>
              <input
                type="text"
                id="ai-base-url"
                className="rig-dialog-input"
                placeholder="https://my-endpoint.example.com"
                autoComplete="off"
                spellCheck={false}
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </label>
            <label className="ai-field">
              <span className="ai-field-label">API key</span>
              <input
                type="password"
                id="ai-api-key"
                className="rig-dialog-input"
                placeholder={keyPlaceholder(savedCfg, provider)}
                autoComplete="off"
                spellCheck={false}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </label>
            <label className="ai-field">
              <span className="ai-field-label">Model</span>
              <input
                ref={hostedModelInputRef}
                type="text"
                id="ai-hosted-model"
                className="rig-dialog-input"
                placeholder={models[0] || 'model-name'}
                autoComplete="off"
                spellCheck={false}
                list="ai-hosted-model-list"
                value={hostedModel}
                onChange={(e) => setHostedModel(e.target.value)}
              />
              <datalist id="ai-hosted-model-list">
                {models.map((id) => (
                  <option key={id} value={id} />
                ))}
              </datalist>
            </label>
          </div>
          <div className="ai-test-row">
            <button type="button" id="ai-test-btn" className="btn btn-secondary sm" disabled={testing} onClick={() => void handleTest()}>
              Test connection
            </button>
            <span className={'ai-status' + (testResult.kind ? ` ${testResult.kind}` : '')} id="ai-test-result" role="status">
              {testResult.text}
            </span>
          </div>
          <label className="ai-enable-row">
            <input type="checkbox" id="ai-enable-toggle" checked={enableAi} onChange={(e) => setEnableAi(e.target.checked)} />
            Enable AI analysis
          </label>
          <p className="ai-dialog-note">
            Your audio never leaves your machine — analysis runs on-device, and only the measurements go to the provider
            you choose.
          </p>
        </div>
        <div className="settings-pane" id="settings-pane-about" style={{ display: section === 'about' ? 'flex' : 'none' }}>
          <p className="ai-dialog-version" id="ai-dialog-version">
            {version}
          </p>
          <p className="ai-dialog-note">Licensed under the Sound Buddy Desktop Application License.</p>
        </div>
        <div className="rig-dialog-actions">
          <button
            type="button"
            id="settings-dialog-cancel"
            className="btn btn-secondary sm"
            onClick={() => useSettingsStore.getState().closeDialog()}
          >
            Cancel
          </button>
          <button type="button" id="settings-dialog-save" className="btn btn-primary sm" onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
