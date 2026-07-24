// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// React island for the unified Settings dialog (#76, #91, TD-001 slice 3,
// #421, combined into one tabbed modal by #204; AI Engineer tab removed by
// #657 — the renderer no longer advertises a feature that can't run in a
// packaged build, see #658/#659 for the IPC/main-process follow-up) —
// replaces the static #storage-dialog markup + openStorageSettings()/
// saveStorageSettings() in inline-app.js with a component backed by
// settingsStore. Renders the same inner ids/classes the static markup had
// (index.html) so the existing e2e suite (app/tests/e2e/settings.spec.ts)
// keeps driving the same selectors. The dialog stays permanently in the DOM —
// `display` toggles via `dialogOpen`.

import { useEffect, useState } from 'react';
import type { StoreApi, UseBoundStore } from 'zustand';
import { useElectron } from './useElectron';
import { useStoreShallow } from './stores/useStoreShallow';
import { useSettingsStore, type SettingsState } from './stores/settingsStore';
import { DEFAULT_STORAGE_PATH, effectiveStoragePath, loadStorageSeed, buildStoragePatch } from './storage-settings';
import type { UpdateSettingsPatch } from '../../electron/ipc/api';
import { MAX_CHURCH_NAME_LEN } from './share-card';

export type SettingsSection = 'storage' | 'about';

// Day-of-week options for the weekly reminder's service-day <select> (#268),
// index-aligned with Date.prototype.getDay() (0 = Sunday … 6 = Saturday).
const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type SettingsStoreHandle = UseBoundStore<StoreApi<SettingsState>>;

export interface SaveAllFields {
  storagePatch: UpdateSettingsPatch | null;
}

// Port of the storage half of inline-app.js's old saveStorageSettings()
// (#91, #204) — applies the storage patch (if any) and closes the dialog.
// The AI/LLM save half (hosted-model validation, saveLlmConfig, the
// aiEnabled fold-in) was removed by #657 along with the rest of the AI
// Engineer tab; there is no failure path left to gate the close on, so
// unlike the old combined saveAll this always closes.
export async function saveAll(fields: SaveAllFields, store: SettingsStoreHandle): Promise<void> {
  const { storagePatch } = fields;
  if (storagePatch) {
    await store.getState().updateSettings(storagePatch);
  }
  store.getState().closeDialog();
}

// Persists the Share Image church-name field (#265) straight through
// settingsStore — a plain string setting, not gated behind the Save button
// like the AI provider fields (there's no separate "test" step for it).
export async function commitShareChurchName(store: SettingsStoreHandle, value: string): Promise<void> {
  await store.getState().updateSettings({ shareChurchName: value });
}

export default function SettingsPanel() {
  const api = useElectron();
  const { settings, dialogOpen } = useStoreShallow(useSettingsStore, (s) => ({
    settings: s.settings,
    dialogOpen: s.dialogOpen,
  }));

  const [version, setVersion] = useState('');
  // Seeded eagerly from the store's current settings (not just the
  // dialog-open effect below) so a server-rendered/initial pass already shows
  // the persisted value — the effect below only re-syncs it on reopen.
  const [shareChurchName, setShareChurchName] = useState(() => settings?.shareChurchName ?? '');

  const [section, setSection] = useState<SettingsSection>('storage');
  const [pendingDir, setPendingDir] = useState<string | null>(null);
  const [defaultPath, setDefaultPath] = useState(DEFAULT_STORAGE_PATH);
  const [loadedPath, setLoadedPath] = useState(DEFAULT_STORAGE_PATH);
  const [usageText, setUsageText] = useState('Calculating disk usage…');
  const [usageSignalEnabled, setUsageSignalEnabled] = useState(false);
  const [crashReportingEnabled, setCrashReportingEnabled] = useState(false);
  const [dawWorkspaceEnabled, setDawWorkspaceEnabled] = useState(false);
  const [liveAdjustmentsEnabled, setLiveAdjustmentsEnabled] = useState(false);
  const [weeklyReminderEnabled, setWeeklyReminderEnabled] = useState(false);
  const [weeklyReminderServiceDay, setWeeklyReminderServiceDay] = useState(0);

  /* c8 ignore start -- fetches the storage seed and app version on open;
     needs a real Electron bridge round-trip, exercised by settings.spec.ts.
     No jsdom in this harness (constitution forbids adding a new framework),
     so effects never run under renderToString. */
  useEffect(() => {
    if (!dialogOpen) return;
    setSection('storage');
    setPendingDir(null);
    setUsageText('Calculating disk usage…');
    setUsageSignalEnabled(!!settings?.usageSignalEnabled);
    setCrashReportingEnabled(!!settings?.crashReportingEnabled);
    setDawWorkspaceEnabled(!!settings?.dawWorkspaceEnabled);
    setLiveAdjustmentsEnabled(!!settings?.liveAdjustmentsEnabled);
    setWeeklyReminderEnabled(!!settings?.weeklyReminderEnabled);
    setWeeklyReminderServiceDay(settings?.weeklyReminderServiceDay ?? 0);
    let cancelled = false;
    void (async () => {
      const storageSeed = await loadStorageSeed(api);
      if (cancelled) return;
      setShareChurchName(settings?.shareChurchName ?? '');
      setDefaultPath(storageSeed.defaultPath);
      setLoadedPath(storageSeed.loadedPath);
      setUsageText(storageSeed.usageText);
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

  async function handleChooseStorageFolder() {
    const dir = await api.openDirDialog();
    if (!dir) return;
    setPendingDir(dir);
  }

  function handleSave() {
    // The church-name field commits on blur, but a click straight from the
    // field to this Save button can beat that blur — flush it explicitly so
    // Save always captures whatever is currently typed.
    void commitShareChurchName(useSettingsStore, shareChurchName);
    const storagePatch = buildStoragePatch(
      pendingDir,
      {
        usageSignalEnabled,
        crashReportingEnabled,
        dawWorkspaceEnabled,
        liveAdjustmentsEnabled,
        weeklyReminderEnabled,
        weeklyReminderServiceDay,
      },
      settings
    );
    void saveAll({ storagePatch }, useSettingsStore);
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
          <label className="ai-enable-row">
            <input
              type="checkbox"
              id="weekly-reminder-toggle"
              checked={weeklyReminderEnabled}
              onChange={(e) => setWeeklyReminderEnabled(e.target.checked)}
            />
            Remind me to grade my weekly service
          </label>
          <label className="ai-field">
            <span className="ai-field-label">Service day</span>
            <div className="select-wrap">
              <select
                id="weekly-reminder-day"
                aria-label="Service day"
                value={weeklyReminderServiceDay}
                onChange={(e) => setWeeklyReminderServiceDay(Number(e.target.value))}
              >
                {DAY_LABELS.map((label, i) => (
                  <option key={label} value={i}>
                    {label}
                  </option>
                ))}
              </select>
              <span className="select-caret" data-icon="chevron-down" />
            </div>
          </label>
          <p className="ai-dialog-note" id="weekly-reminder-note">
            Off unless you turn it on. Sound Buddy shows a local notification on this Mac the evening before your
            service day, reminding you to record and grade it. Nothing leaves your machine — no account, no email, no
            server.
          </p>
          <label className="ai-field" id="share-church-name-field">
            <span className="ai-field-label">Church name (for shared images)</span>
            <input
              type="text"
              id="share-church-name-input"
              className="rig-dialog-input"
              placeholder="Leave blank to keep shared images anonymous"
              autoComplete="off"
              spellCheck={false}
              maxLength={MAX_CHURCH_NAME_LEN}
              value={shareChurchName}
              onChange={(e) => setShareChurchName(e.target.value)}
              onBlur={() => void commitShareChurchName(useSettingsStore, shareChurchName)}
            />
          </label>
          <p className="ai-dialog-note" id="share-church-name-note">
            Optional. Leave blank (default) and shared images contain no identifying information.
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
