// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Second production React island of the strangler migration (#395 slice 3,
// #421): replaces inline-app.js's imperative #ai-dialog and #storage-dialog
// wiring. Markup is ported byte-for-byte from index.html (same ids/classes/
// roles/the style.display visibility mechanism) so every existing
// Playwright locator and CSS rule keeps working unchanged; each dialog
// carries `data-react-island="settings"` as the e2e proof that React now
// owns these DOM nodes. View/connected split mirrors LicensePanel.tsx: the
// View is a pure function of props (renderToString-testable across every
// tab/probe/provider state — there is no jsdom in this repo); ephemeral form
// state (active tab, text inputs, provider select) lives as local state in
// the default wrapper, re-seeded from the store whenever a dialog opens.

import { useEffect, useState } from 'react';
import { iconSvg } from './report-card';
import { useElectron } from './useElectron';
import { useStoreShallow } from './stores/useStoreShallow';
import {
  useSettingsStore,
  AI_MODEL_HINTS,
  type OllamaProbe,
  type AiTestResult,
} from './stores/settingsStore';
import type { PublicLlmConfig } from '../../electron/ipc/api';

const KNOWN_PROVIDERS: Array<{ value: string; label: string }> = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google', label: 'Google' },
  { value: 'custom', label: 'Custom (OpenAI-compatible)' },
];

// Port of inline-app.js's syncHostedFields() key-placeholder logic: a stored
// key only counts for the provider it was pasted for.
export function apiKeyPlaceholder(llmConfig: PublicLlmConfig | null, provider: string): string {
  const keySaved = !!(llmConfig && llmConfig.hasApiKey && llmConfig.apiKeyProvider === provider);
  return keySaved ? '••••••••••  (saved — paste to replace)' : 'Paste your API key';
}

// Port of inline-app.js's syncHostedFields() model-placeholder logic.
export function modelPlaceholder(provider: string): string {
  return AI_MODEL_HINTS[provider] || 'model-name';
}

export interface SettingsPanelViewProps {
  aiOpen: boolean;
  tab: 'ollama' | 'hosted';
  ollamaHost: string;
  ollamaModel: string;
  ollamaProbe: OllamaProbe;
  providerOptions: Array<{ value: string; label: string }>;
  provider: string;
  hostedModel: string;
  apiBaseUrl: string;
  apiKey: string;
  apiKeyPlaceholderText: string;
  modelPlaceholderText: string;
  aiEnabledChecked: boolean;
  testResult: AiTestResult;
  appVersion: string | null;
  onTabChange(tab: 'ollama' | 'hosted'): void;
  onOllamaHostChange(value: string): void;
  onOllamaHostBlur(): void;
  onOllamaModelChange(value: string): void;
  onProviderChange(value: string): void;
  onHostedModelChange(value: string): void;
  onApiBaseUrlChange(value: string): void;
  onApiKeyChange(value: string): void;
  onAiEnabledChange(checked: boolean): void;
  onTest(): void;
  onSaveAi(): void;
  onCloseAi(): void;
  onOpenReleasePage(url: string): void;

  storageOpen: boolean;
  storagePath: string;
  showStorageReset: boolean;
  storageUsageText: string;
  usageSignalChecked: boolean;
  onChooseFolder(): void;
  onResetStorageDir(): void;
  onUsageSignalChange(checked: boolean): void;
  onSaveStorage(): void;
  onCloseStorage(): void;
}

function ollamaStatusKind(probe: OllamaProbe): '' | 'ok' | 'err' {
  if (probe.status === 'probing') return '';
  if (probe.status === 'ok') return 'ok';
  return 'err';
}

function OllamaStatus({
  probe,
  onOpenReleasePage,
}: {
  probe: OllamaProbe;
  onOpenReleasePage: (url: string) => void;
}) {
  const kind = ollamaStatusKind(probe);
  const className = 'ai-status' + (kind ? ` ${kind}` : '');
  if (probe.status === 'probing') return <div className={className}>Looking for Ollama…</div>;
  if (probe.status === 'ok') {
    const n = probe.models.length;
    return <div className={className}>{`Ollama detected — ${n} model${n === 1 ? '' : 's'} available.`}</div>;
  }
  if (probe.status === 'none') {
    return (
      <div className={className}>
        Ollama is running but has no models — run <code>ollama pull llama3.2</code> first.
      </div>
    );
  }
  if (probe.status === 'not-running') {
    return (
      <div className={className}>
        Ollama not detected —{' '}
        <a
          href="https://ollama.com/download"
          onClick={(e) => {
            e.preventDefault();
            onOpenReleasePage('https://ollama.com/download');
          }}
        >
          install it from ollama.com
        </a>
        , then relaunch it.
      </div>
    );
  }
  return <div className={className}>{`Could not reach Ollama: ${probe.reason || 'unknown error'}`}</div>;
}

export function SettingsPanelView(props: SettingsPanelViewProps) {
  const {
    aiOpen,
    tab,
    ollamaHost,
    ollamaModel,
    ollamaProbe,
    providerOptions,
    provider,
    hostedModel,
    apiBaseUrl,
    apiKey,
    apiKeyPlaceholderText,
    modelPlaceholderText,
    aiEnabledChecked,
    testResult,
    appVersion,
    onTabChange,
    onOllamaHostChange,
    onOllamaHostBlur,
    onOllamaModelChange,
    onProviderChange,
    onHostedModelChange,
    onApiBaseUrlChange,
    onApiKeyChange,
    onAiEnabledChange,
    onTest,
    onSaveAi,
    onCloseAi,
    onOpenReleasePage,
    storageOpen,
    storagePath,
    showStorageReset,
    storageUsageText,
    usageSignalChecked,
    onChooseFolder,
    onResetStorageDir,
    onUsageSignalChange,
    onSaveStorage,
    onCloseStorage,
  } = props;

  const modelSelectValue = ollamaProbe.models.includes(ollamaModel)
    ? ollamaModel
    : (ollamaProbe.models[0] ?? '');

  // Escape closes whichever dialog is open — matches today's two independent
  // per-dialog document listeners in inline-app.js.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (aiOpen) onCloseAi();
      else if (storageOpen) onCloseStorage();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [aiOpen, storageOpen, onCloseAi, onCloseStorage]);

  return (
    <>
      <div
        id="ai-dialog"
        className="rig-dialog"
        style={{ display: aiOpen ? 'flex' : 'none' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-dialog-title"
        data-react-island="settings"
        onClick={(e) => {
          if (e.target === e.currentTarget) onCloseAi();
        }}
      >
        <div className="rig-dialog-card ai-dialog-card">
          <div className="rig-dialog-title" id="ai-dialog-title">
            AI Engineer
          </div>
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
              onClick={() => onTabChange('ollama')}
            >
              I have Ollama
            </button>
            <button
              type="button"
              className={'ai-tab' + (tab === 'hosted' ? ' active' : '')}
              id="ai-tab-btn-hosted"
              role="tab"
              aria-selected={tab === 'hosted'}
              onClick={() => onTabChange('hosted')}
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
                onChange={(e) => onOllamaHostChange(e.target.value)}
                onBlur={onOllamaHostBlur}
              />
            </label>
            <div id="ai-ollama-status">
              <OllamaStatus probe={ollamaProbe} onOpenReleasePage={onOpenReleasePage} />
            </div>
            <label className="ai-field">
              <span className="ai-field-label">Model</span>
              <div className="select-wrap">
                <select
                  id="ai-ollama-model"
                  aria-label="Ollama model"
                  value={modelSelectValue}
                  disabled={ollamaProbe.models.length === 0}
                  onChange={(e) => onOllamaModelChange(e.target.value)}
                >
                  {ollamaProbe.models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <span
                  className="select-caret"
                  data-icon="chevron-down"
                  data-icon-done="1"
                  dangerouslySetInnerHTML={{ __html: iconSvg('chevron-down', 16) }}
                />
              </div>
            </label>
          </div>
          <div className="ai-tabpane" id="ai-tab-hosted" style={{ display: tab === 'hosted' ? 'flex' : 'none' }}>
            <label className="ai-field">
              <span className="ai-field-label">Provider</span>
              <div className="select-wrap">
                <select
                  id="ai-provider"
                  aria-label="Provider"
                  value={provider}
                  onChange={(e) => onProviderChange(e.target.value)}
                >
                  {providerOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <span
                  className="select-caret"
                  data-icon="chevron-down"
                  data-icon-done="1"
                  dangerouslySetInnerHTML={{ __html: iconSvg('chevron-down', 16) }}
                />
              </div>
            </label>
            <label
              className="ai-field"
              id="ai-baseurl-field"
              style={{ display: provider === 'custom' ? 'flex' : 'none' }}
            >
              <span className="ai-field-label">Base URL</span>
              <input
                type="text"
                id="ai-base-url"
                className="rig-dialog-input"
                placeholder="https://my-endpoint.example.com"
                autoComplete="off"
                spellCheck={false}
                value={apiBaseUrl}
                onChange={(e) => onApiBaseUrlChange(e.target.value)}
              />
            </label>
            <label className="ai-field">
              <span className="ai-field-label">API key</span>
              <input
                type="password"
                id="ai-api-key"
                className="rig-dialog-input"
                placeholder={apiKeyPlaceholderText}
                autoComplete="off"
                spellCheck={false}
                value={apiKey}
                onChange={(e) => onApiKeyChange(e.target.value)}
              />
            </label>
            <label className="ai-field">
              <span className="ai-field-label">Model</span>
              <input
                type="text"
                id="ai-hosted-model"
                className="rig-dialog-input"
                placeholder={modelPlaceholderText}
                autoComplete="off"
                spellCheck={false}
                value={hostedModel}
                onChange={(e) => onHostedModelChange(e.target.value)}
              />
            </label>
          </div>
          <div className="ai-test-row">
            <button type="button" id="ai-test-btn" className="btn btn-secondary sm" onClick={onTest}>
              Test connection
            </button>
            <span className={'ai-status' + (testResult.kind ? ` ${testResult.kind}` : '')} id="ai-test-result" role="status">
              {testResult.text}
            </span>
          </div>
          <label className="ai-enable-row">
            <input
              type="checkbox"
              id="ai-enable-toggle"
              checked={aiEnabledChecked}
              onChange={(e) => onAiEnabledChange(e.target.checked)}
            />
            Enable AI analysis
          </label>
          <div className="rig-dialog-actions">
            <button type="button" id="ai-dialog-cancel" className="btn btn-secondary sm" onClick={onCloseAi}>
              Cancel
            </button>
            <button type="button" id="ai-dialog-save" className="btn btn-primary sm" onClick={onSaveAi}>
              Save
            </button>
          </div>
          <p className="ai-dialog-note">
            Your audio never leaves your machine — analysis runs on-device, and only the measurements go to the
            provider you choose.
          </p>
          <p className="ai-dialog-version" id="ai-dialog-version">
            {appVersion ? `Sound Buddy ${appVersion}` : ''}
          </p>
        </div>
      </div>

      <div
        id="storage-dialog"
        className="rig-dialog"
        style={{ display: storageOpen ? 'flex' : 'none' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="storage-dialog-title"
        data-react-island="settings"
        onClick={(e) => {
          if (e.target === e.currentTarget) onCloseStorage();
        }}
      >
        <div className="rig-dialog-card storage-dialog-card">
          <div className="rig-dialog-title" id="storage-dialog-title">
            Storage
          </div>
          <div className="ai-dialog-sub">Where Sound Buddy keeps your recordings, stems, and captured sessions.</div>
          <label className="ai-field">
            <span>Storage folder</span>
            <div className="storage-path-row">
              <span className="storage-path" id="storage-path">
                {storagePath}
              </span>
              <button
                type="button"
                id="storage-change-btn"
                className="btn btn-secondary sm"
                data-icon="folder"
                data-icon-done="1"
                onClick={onChooseFolder}
                dangerouslySetInnerHTML={{ __html: iconSvg('folder', 16) + 'Change…' }}
              />
            </div>
          </label>
          <p className="storage-usage" id="storage-usage">
            {storageUsageText}
          </p>
          <p className="storage-unlimited">Unlimited recordings. Stored on your machine.</p>
          <p className="storage-note" id="storage-note">
            Record and analyze as much as you want — no limits on any tier. New recordings are saved here; anything
            you've already recorded stays in its current folder.
          </p>
          <label className="ai-enable-row">
            <input
              type="checkbox"
              id="usage-signal-toggle"
              checked={usageSignalChecked}
              onChange={(e) => onUsageSignalChange(e.target.checked)}
            />
            Share anonymous usage counts
          </label>
          <p className="ai-dialog-note" id="usage-signal-note">
            Off unless you turn it on. Nothing is collected or sent today — Sound Buddy has no usage reporting at
            all. If a future update adds it, enabling this would share only anonymous counts of which features get
            used — never audio, recordings, file names, or file paths. Your audio never leaves your machine.
          </p>
          <div className="rig-dialog-actions">
            <button
              type="button"
              id="storage-reset-btn"
              className="btn btn-secondary sm"
              style={{ display: showStorageReset ? '' : 'none' }}
              onClick={onResetStorageDir}
            >
              Use default
            </button>
            <button type="button" id="storage-cancel-btn" className="btn btn-secondary sm" onClick={onCloseStorage}>
              Cancel
            </button>
            <button type="button" id="storage-save-btn" className="btn btn-primary sm" onClick={onSaveStorage}>
              Save
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default function SettingsPanel() {
  const sb = useElectron();
  const {
    aiDialogOpen,
    storageDialogOpen,
    llmConfig,
    settings,
    ollamaProbe,
    aiTestResult,
    appVersion,
    storageDefaultPath,
    storageLoadedPath,
    storagePendingDir,
    storageUsageText,
    closeAiDialog,
    probeOllama,
    testProvider,
    testOllamaConnection,
    saveAiSettings,
    closeStorageDialog,
    chooseStorageFolder,
    resetStorageDir,
    saveStorageSettings,
  } = useStoreShallow(useSettingsStore, (s) => ({
    aiDialogOpen: s.aiDialogOpen,
    storageDialogOpen: s.storageDialogOpen,
    llmConfig: s.llmConfig,
    settings: s.settings,
    ollamaProbe: s.ollamaProbe,
    aiTestResult: s.aiTestResult,
    appVersion: s.appVersion,
    storageDefaultPath: s.storageDefaultPath,
    storageLoadedPath: s.storageLoadedPath,
    storagePendingDir: s.storagePendingDir,
    storageUsageText: s.storageUsageText,
    closeAiDialog: s.closeAiDialog,
    probeOllama: s.probeOllama,
    testProvider: s.testProvider,
    testOllamaConnection: s.testOllamaConnection,
    saveAiSettings: s.saveAiSettings,
    closeStorageDialog: s.closeStorageDialog,
    chooseStorageFolder: s.chooseStorageFolder,
    resetStorageDir: s.resetStorageDir,
    saveStorageSettings: s.saveStorageSettings,
  }));

  const [tab, setTab] = useState<'ollama' | 'hosted'>('ollama');
  const [ollamaHost, setOllamaHost] = useState('');
  const [ollamaModel, setOllamaModel] = useState('');
  const [provider, setProvider] = useState('openai');
  const [passthroughProvider, setPassthroughProvider] = useState<{ value: string; label: string } | null>(null);
  const [hostedModel, setHostedModel] = useState('');
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [aiEnabledChecked, setAiEnabledChecked] = useState(false);
  const [usageSignalChecked, setUsageSignalChecked] = useState(false);

  // Re-seed every field from the freshly loaded config each time the AI
  // dialog opens — mirrors inline-app.js's openAiSettings().
  useEffect(() => {
    if (!aiDialogOpen) return;
    const cfg = llmConfig;
    const hosted = !!(cfg?.provider && cfg.provider !== 'ollama');
    setTab(hosted ? 'hosted' : 'ollama');
    setOllamaHost(cfg?.ollamaHost || '');
    setOllamaModel(!hosted ? cfg?.model || '' : '');
    setApiBaseUrl(cfg?.apiBaseUrl || '');
    setApiKey('');
    if (hosted && cfg) {
      setHostedModel(cfg.model || '');
      if (cfg.provider in AI_MODEL_HINTS) {
        setProvider(cfg.provider);
        setPassthroughProvider(null);
      } else {
        // A pre-#76 pi provider ("copilot", …) — keep it selectable as-is so
        // a no-change Save can never silently rewrite a working config.
        setProvider(cfg.provider);
        setPassthroughProvider({ value: cfg.provider, label: `${cfg.provider} (via pi login)` });
      }
    } else {
      setHostedModel('');
      setProvider('openai');
      setPassthroughProvider(null);
    }
    setAiEnabledChecked(cfg?.provider ? !!settings?.aiEnabled : true);
    // Deliberately keyed on aiDialogOpen alone: this re-seeds fields once per
    // open transition (matching openAiSettings()'s behavior), not on every
    // llmConfig/settings change while already open.
  }, [aiDialogOpen]);

  useEffect(() => {
    if (!storageDialogOpen) return;
    setUsageSignalChecked(!!settings?.usageSignalEnabled);
    // Deliberately keyed on storageDialogOpen alone — same re-seed-on-open
    // reasoning as the AI dialog effect above.
  }, [storageDialogOpen]);

  const providerOptions = passthroughProvider ? [...KNOWN_PROVIDERS, passthroughProvider] : KNOWN_PROVIDERS;
  const storagePath = storagePendingDir === '' ? storageDefaultPath : storagePendingDir || storageLoadedPath;

  return (
    <SettingsPanelView
      aiOpen={aiDialogOpen}
      tab={tab}
      ollamaHost={ollamaHost}
      ollamaModel={ollamaModel}
      ollamaProbe={ollamaProbe}
      providerOptions={providerOptions}
      provider={provider}
      hostedModel={hostedModel}
      apiBaseUrl={apiBaseUrl}
      apiKey={apiKey}
      apiKeyPlaceholderText={apiKeyPlaceholder(llmConfig, provider)}
      modelPlaceholderText={modelPlaceholder(provider)}
      aiEnabledChecked={aiEnabledChecked}
      testResult={aiTestResult}
      appVersion={appVersion}
      onTabChange={setTab}
      onOllamaHostChange={setOllamaHost}
      onOllamaHostBlur={() => void probeOllama(ollamaHost)}
      onOllamaModelChange={setOllamaModel}
      onProviderChange={setProvider}
      onHostedModelChange={setHostedModel}
      onApiBaseUrlChange={setApiBaseUrl}
      onApiKeyChange={setApiKey}
      onAiEnabledChange={setAiEnabledChecked}
      onTest={() => {
        if (tab === 'ollama') void testOllamaConnection(ollamaHost);
        else void testProvider({ provider, apiKey: apiKey || undefined, apiBaseUrl: apiBaseUrl.trim() || undefined });
      }}
      onSaveAi={() =>
        void saveAiSettings({
          tab,
          ollamaModel,
          ollamaHost,
          provider,
          hostedModel,
          apiBaseUrl,
          apiKey,
          aiEnabled: aiEnabledChecked,
        })
      }
      onCloseAi={closeAiDialog}
      onOpenReleasePage={(url) => {
        try {
          sb.openReleasePage(url)?.catch(() => {});
        } catch {
          /* preload missing */
        }
      }}
      storageOpen={storageDialogOpen}
      storagePath={storagePath}
      showStorageReset={storagePath !== storageDefaultPath}
      storageUsageText={storageUsageText}
      usageSignalChecked={usageSignalChecked}
      onChooseFolder={() => void chooseStorageFolder()}
      onResetStorageDir={resetStorageDir}
      onUsageSignalChange={setUsageSignalChecked}
      onSaveStorage={() => void saveStorageSettings(usageSignalChecked)}
      onCloseStorage={closeStorageDialog}
    />
  );
}
