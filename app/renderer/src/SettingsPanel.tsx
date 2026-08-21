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
//
// Settings-only chrome (#1008, epic #999): the card is a fixed-size frame
// with a title bar, a left category rail in place of the old horizontal tab
// strip, and a footer holding #1007's help strip next to Cancel/Save. The
// section buttons keep their `settings-tab-btn-<name>` ids and `role="tab"`
// — ten e2e specs address them — only the presentation classes changed
// (`.settings-tabs` -> `.settings-rail`, `.settings-tab` ->
// `.settings-rail-item`). Every new CSS rule is scoped to
// `.settings-dialog-card` or a `.settings-*` class only this file renders, so
// the shared `.rig-dialog-card` used by nine other dialogs is untouched.
//
// The Audio pane (#726's scaffold) composes RigControls/LiveSourceSettings/
// SecondaryMeasurementPanel/CaptureCadenceControls directly as JSX (#727) —
// no createPortal, unlike the Live tab's static-markup islands, since this
// dialog is 100% React-owned already and has no static per-control DOM
// anchor to portal onto. The `booted` prop (passed from App.tsx) gates their
// mount timing in place of the {booted && createPortal(...)} guard those
// components previously got for free from App.tsx.
//
// These controls used to be children of #tab-live, gated for free by
// app.css's `body.not-pro #tab-live > :not(.pro-gate) { display:none
// !important; }`. Rather than re-deriving Pro status here (LicenseChrome.tsx
// keeps "every Pro surface keys off body.not-pro in CSS" as the single
// gating hook), this pane joins that same rule: the pro-gate div and the
// moved controls are both always rendered when booted, and app.css's
// `body.not-pro #settings-pane-audio > :not(.pro-gate)` rule (mirroring the
// #tab-live/#tab-soundcheck rule) hides/shows them exactly like the Live tab
// always did.

import { useEffect, useState, type ReactNode } from 'react';
import type { StoreApi, UseBoundStore } from 'zustand';
import { useElectron } from './useElectron';
import { useStoreShallow } from './stores/useStoreShallow';
import { useSettingsStore, type SettingsState } from './stores/settingsStore';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useLicensingStore } from './stores/licensingStore';
import { DEFAULT_STORAGE_PATH, effectiveStoragePath, loadStorageSeed, buildStoragePatch } from './storage-settings';
import type { UpdateSettingsPatch } from '../../electron/ipc/api';
import { MAX_CHURCH_NAME_LEN } from './share-card';
import { iconSvg } from './report-card';
import RigControls from './RigControls';
import LiveSourceSettings from './LiveSourceSettings';
import SecondaryMeasurementPanel from './SecondaryMeasurementPanel';
import CaptureCadenceControls from './CaptureCadenceControls';
import PreflightSettings from './PreflightSettings';
import { SETTINGS_HELP_ENTRIES, resolveSettingsHelp, settingsHelpHandlers, settingsHelpNoteId } from './settings-help';

export type SettingsSection = 'general' | 'audio' | 'console' | 'storage' | 'privacy' | 'labs' | 'about';

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  'general',
  'audio',
  'console',
  'storage',
  'privacy',
  'labs',
  'about',
];

const SECTION_LABELS: Record<SettingsSection, string> = {
  general: 'General',
  audio: 'Audio',
  console: 'Console',
  storage: 'Storage',
  privacy: 'Privacy',
  labs: 'Labs',
  about: 'About',
};

export type SettingsControl =
  | 'gradingProfile'
  | 'weeklyReminder'
  | 'weeklyReminderServiceDay'
  | 'shareChurchName'
  | 'rig'
  | 'inputDevice'
  | 'measurementSource'
  | 'secondaryMeasurementDevice'
  | 'meterRate'
  | 'meterWindow'
  | 'preflight'
  | 'consoleNetworkConsent'
  | 'storageDir'
  | 'diskUsage'
  | 'usageSignal'
  | 'crashReporting'
  | 'dawWorkspace'
  | 'liveAdjustments'
  | 'version'
  | 'license';

const SETTING_SECTION_TARGETS: readonly { setting: SettingsControl; section: SettingsSection }[] = [
  { setting: 'gradingProfile', section: 'general' },
  { setting: 'weeklyReminder', section: 'general' },
  { setting: 'weeklyReminderServiceDay', section: 'general' },
  { setting: 'shareChurchName', section: 'general' },
  { setting: 'rig', section: 'audio' },
  { setting: 'inputDevice', section: 'audio' },
  { setting: 'measurementSource', section: 'audio' },
  { setting: 'secondaryMeasurementDevice', section: 'audio' },
  { setting: 'meterRate', section: 'audio' },
  { setting: 'meterWindow', section: 'audio' },
  { setting: 'preflight', section: 'audio' },
  { setting: 'consoleNetworkConsent', section: 'console' },
  { setting: 'storageDir', section: 'storage' },
  { setting: 'diskUsage', section: 'storage' },
  { setting: 'usageSignal', section: 'privacy' },
  { setting: 'crashReporting', section: 'privacy' },
  { setting: 'dawWorkspace', section: 'labs' },
  { setting: 'liveAdjustments', section: 'labs' },
  { setting: 'version', section: 'about' },
  { setting: 'license', section: 'about' },
];

export function settingsSectionFor(setting: SettingsControl): SettingsSection {
  const target = SETTING_SECTION_TARGETS.find((entry) => entry.setting === setting);
  if (!target) throw new Error(`No Settings section mapped for ${setting}`);
  return target.section;
}

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

// Renders a single row's help note from SETTINGS_HELP_ENTRIES (#1007) — the
// same table backs both this always-in-DOM, visually-hidden paragraph and
// the footer help strip, so the two copies of this prose can never drift.
// `className` defaults to the shared `.ai-dialog-note` styling, but the
// storage note keeps its own `storage-note` class (#storage-note) instead.
function SettingsNote({ control, className = 'ai-dialog-note' }: { control: SettingsControl; className?: string }) {
  const entry = SETTINGS_HELP_ENTRIES.find((e) => e.control === control);
  if (!entry) return null;
  return (
    <p className={`${className} settings-note-hidden`} id={entry.noteId}>
      {entry.text}
    </p>
  );
}

// Small-caps group header + hairline divider (#1009) — the wrapper the
// Settings row grid keys off. Related rows go inside one of these; the
// two-column layout itself comes from app.css's .settings-pane block, so no
// row markup (including the five composed Audio components) has to change.
function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-group">
      <h3 className="settings-group-title">{title}</h3>
      {children}
    </section>
  );
}

export default function SettingsPanel({ booted = false }: { booted?: boolean }) {
  const api = useElectron();
  const { settings, dialogOpen } = useStoreShallow(useSettingsStore, (s) => ({
    settings: s.settings,
    dialogOpen: s.dialogOpen,
  }));
  const isCapturing = useStoreShallow(useLiveCaptureStore, (s) => s.isCapturing);

  const [version, setVersion] = useState('');
  // Seeded eagerly from the store's current settings (not just the
  // dialog-open effect below) so a server-rendered/initial pass already shows
  // the persisted value — the effect below only re-syncs it on reopen.
  const [shareChurchName, setShareChurchName] = useState(() => settings?.shareChurchName ?? '');

  const [section, setSection] = useState<SettingsSection>('general');
  // The row currently hovered or keyboard-focused (#1007) — drives the
  // footer help strip via resolveSettingsHelp; null means "nothing active",
  // which falls back to the current section's one-line description.
  const [activeHelp, setActiveHelp] = useState<SettingsControl | null>(null);
  const helpFor = (control: SettingsControl) => settingsHelpHandlers(control, setActiveHelp);
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
  const [gradingProfile, setGradingProfile] = useState<'casual' | 'broadcast'>('casual');
  // Eagerly seeded from the store (like shareChurchName) rather than
  // useState(false) — this is a status display + immediate-commit Revoke
  // button, not a Save-gated form field, so it must reflect the persisted
  // value on first render, not just after the dialog-open effect re-syncs it.
  const [consoleNetworkConsentGranted, setConsoleNetworkConsentGranted] = useState(
    () => !!settings?.consoleNetworkConsentGranted
  );

  /* c8 ignore start -- fetches the storage seed and app version on open;
     needs a real Electron bridge round-trip, exercised by settings.spec.ts.
     No jsdom in this harness (constitution forbids adding a new framework),
     so effects never run under renderToString. */
  useEffect(() => {
    if (!dialogOpen) return;
    setSection('general');
    setActiveHelp(null);
    setPendingDir(null);
    setUsageText('Calculating disk usage…');
    setUsageSignalEnabled(!!settings?.usageSignalEnabled);
    setCrashReportingEnabled(!!settings?.crashReportingEnabled);
    setDawWorkspaceEnabled(!!settings?.dawWorkspaceEnabled);
    setLiveAdjustmentsEnabled(!!settings?.liveAdjustmentsEnabled);
    setWeeklyReminderEnabled(!!settings?.weeklyReminderEnabled);
    setWeeklyReminderServiceDay(settings?.weeklyReminderServiceDay ?? 0);
    setGradingProfile(settings?.gradingProfile === 'broadcast' ? 'broadcast' : 'casual');
    setConsoleNetworkConsentGranted(!!settings?.consoleNetworkConsentGranted);
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

  // Backdrop click, the title-bar close control (#1008) and Cancel all close
  // without saving — one handler so the three can't drift.
  const closeSettingsDialog = () => useSettingsStore.getState().closeDialog();

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
        gradingProfile,
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
        if (e.target === e.currentTarget) closeSettingsDialog();
      }}
    >
      <div className="rig-dialog-card settings-dialog-card">
        <div className="settings-titlebar">
          <div className="rig-dialog-title" id="settings-dialog-title">
            Settings
          </div>
          <button
            type="button"
            id="settings-dialog-close"
            className="settings-close-btn"
            aria-label="Close settings"
            onClick={closeSettingsDialog}
          >
            ✕
          </button>
        </div>
        <div className="settings-body">
          <div className="settings-rail" role="tablist" aria-orientation="vertical">
            {SETTINGS_SECTIONS.map((name) => (
              <button
                key={name}
                type="button"
                className={'settings-rail-item' + (section === name ? ' active' : '')}
                id={`settings-tab-btn-${name}`}
                role="tab"
                aria-selected={section === name}
                onClick={() => {
                  setSection(name);
                  setActiveHelp(null);
                }}
              >
                {SECTION_LABELS[name]}
              </button>
            ))}
          </div>
          <div className="settings-panes">
        <div className="settings-pane" id="settings-pane-general" style={{ display: section === 'general' ? 'flex' : 'none' }}>
          <SettingsGroup title="Grading">
            <label className="ai-field" id="grading-profile-field" {...helpFor('gradingProfile')}>
              <span className="ai-field-label">Grading strictness</span>
              <div className="select-wrap">
                <select
                  id="grading-profile-select"
                  aria-label="Grading strictness"
                  aria-describedby={settingsHelpNoteId('gradingProfile')}
                  value={gradingProfile}
                  onChange={(e) => setGradingProfile(e.target.value as 'casual' | 'broadcast')}
                >
                  <option value="casual">Casual / volunteer</option>
                  <option value="broadcast">Broadcast-ready</option>
                </select>
                <span className="select-caret" data-icon="chevron-down" />
              </div>
            </label>
            <SettingsNote control="gradingProfile" />
          </SettingsGroup>
          <SettingsGroup title="Reminders">
            <label className="ai-enable-row" {...helpFor('weeklyReminder')}>
              <span className="settings-row-label">Remind me to grade my weekly service</span>
              <input
                type="checkbox"
                id="weekly-reminder-toggle"
                aria-describedby={settingsHelpNoteId('weeklyReminder')}
                checked={weeklyReminderEnabled}
                onChange={(e) => setWeeklyReminderEnabled(e.target.checked)}
              />
            </label>
            <label className="ai-field" {...helpFor('weeklyReminder')}>
              <span className="ai-field-label">Service day</span>
              <div className="select-wrap">
                <select
                  id="weekly-reminder-day"
                  aria-label="Service day"
                  aria-describedby={settingsHelpNoteId('weeklyReminder')}
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
            <SettingsNote control="weeklyReminder" />
          </SettingsGroup>
          <SettingsGroup title="Sharing">
            <label className="ai-field" id="share-church-name-field" {...helpFor('shareChurchName')}>
              <span className="ai-field-label">Church name (for shared images)</span>
              <input
                type="text"
                id="share-church-name-input"
                className="rig-dialog-input"
                placeholder="Leave blank to keep shared images anonymous"
                autoComplete="off"
                spellCheck={false}
                maxLength={MAX_CHURCH_NAME_LEN}
                aria-describedby={settingsHelpNoteId('shareChurchName')}
                value={shareChurchName}
                onChange={(e) => setShareChurchName(e.target.value)}
                onBlur={() => void commitShareChurchName(useSettingsStore, shareChurchName)}
              />
            </label>
            <SettingsNote control="shareChurchName" />
          </SettingsGroup>
        </div>
        <div className="settings-pane" id="settings-pane-storage" style={{ display: section === 'storage' ? 'flex' : 'none' }}>
          <SettingsGroup title="Location">
            <label className="ai-field" {...helpFor('storageDir')}>
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
                  aria-describedby={settingsHelpNoteId('storageDir')}
                  onClick={() => void handleChooseStorageFolder()}
                >
                  Change…
                </button>
              </div>
            </label>
            <p className="storage-usage" id="storage-usage">
              {usageText}
            </p>
            <p className="storage-unlimited">Unlimited recordings. Stored on your machine.</p>
            <SettingsNote control="storageDir" className="storage-note" />
            <button
              type="button"
              id="storage-reset-btn"
              className="btn btn-secondary sm"
              style={{ display: storagePath === defaultPath ? 'none' : undefined }}
              onClick={() => setPendingDir('')}
            >
              Use default
            </button>
          </SettingsGroup>
        </div>
        <div className="settings-pane" id="settings-pane-privacy" style={{ display: section === 'privacy' ? 'flex' : 'none' }}>
          <SettingsGroup title="Diagnostics">
            <label className="ai-enable-row" {...helpFor('usageSignal')}>
              <span className="settings-row-label">Share anonymous usage counts</span>
              <input
                type="checkbox"
                id="usage-signal-toggle"
                aria-describedby={settingsHelpNoteId('usageSignal')}
                checked={usageSignalEnabled}
                onChange={(e) => setUsageSignalEnabled(e.target.checked)}
              />
            </label>
            <SettingsNote control="usageSignal" />
            <label className="ai-enable-row" {...helpFor('crashReporting')}>
              <span className="settings-row-label">Send crash reports</span>
              <input
                type="checkbox"
                id="crash-reporting-toggle"
                aria-describedby={settingsHelpNoteId('crashReporting')}
                checked={crashReportingEnabled}
                onChange={(e) => setCrashReportingEnabled(e.target.checked)}
              />
            </label>
            <SettingsNote control="crashReporting" />
          </SettingsGroup>
        </div>
        <div className="settings-pane" id="settings-pane-labs" style={{ display: section === 'labs' ? 'flex' : 'none' }}>
          <SettingsGroup title="Experiments">
            <label className="ai-enable-row" {...helpFor('dawWorkspace')}>
              <span className="settings-row-label">Try the experimental DAW-style Live workspace</span>
              <input
                type="checkbox"
                id="daw-workspace-toggle"
                aria-describedby={settingsHelpNoteId('dawWorkspace')}
                checked={dawWorkspaceEnabled}
                onChange={(e) => setDawWorkspaceEnabled(e.target.checked)}
              />
            </label>
            <SettingsNote control="dawWorkspace" />
            <label className="ai-enable-row" {...helpFor('liveAdjustments')}>
              <span className="settings-row-label">Try experimental live adjustments</span>
              <input
                type="checkbox"
                id="live-adjustments-toggle"
                aria-describedby={settingsHelpNoteId('liveAdjustments')}
                checked={liveAdjustmentsEnabled}
                onChange={(e) => setLiveAdjustmentsEnabled(e.target.checked)}
              />
            </label>
            <SettingsNote control="liveAdjustments" />
          </SettingsGroup>
        </div>
        <div className="settings-pane" id="settings-pane-audio" style={{ display: section === 'audio' ? 'flex' : 'none' }}>
          <div className="pro-gate" id="settings-audio-pro-gate">
            <span className="pg-icon" dangerouslySetInnerHTML={{ __html: iconSvg('lock', 22) }} />
            <span className="pg-title">Live monitoring is a Pro feature</span>
            <span className="pg-msg">Capture and monitor multi-channel audio in real time, with saved rigs.</span>
            <button
              type="button"
              className="pg-link"
              onClick={() => useLicensingStore.getState().openDialog()}
            >
              Upgrade — enter a license key
            </button>
          </div>
          {isCapturing && (
            <p className="ai-dialog-note" id="settings-audio-capture-lock-note">
              A capture is running — the rig, record folder, and meter cadence sliders are
              locked until it stops. Input device changes restart capture on the selected
              device. Measurement source and the secondary measurement device can still be
              changed.
            </p>
          )}
          {booted && (
            <SettingsGroup title="Rig">
              <RigControls />
            </SettingsGroup>
          )}
          {booted && (
            <SettingsGroup title="Input">
              <LiveSourceSettings />
            </SettingsGroup>
          )}
          {booted && (
            <SettingsGroup title="Measurement">
              <SecondaryMeasurementPanel />
            </SettingsGroup>
          )}
          {booted && (
            <SettingsGroup title="Metering">
              <CaptureCadenceControls />
            </SettingsGroup>
          )}
          {/* Preflight checklist + Save baseline (#757): relocated here from the
              Live tab's PreflightPanel — same view-model the old panel used. */}
          {booted && <PreflightSettings />}
        </div>
        <div className="settings-pane" id="settings-pane-console" style={{ display: section === 'console' ? 'flex' : 'none' }}>
          <SettingsGroup title="Network access">
            <div
              className="ai-enable-row"
              id="console-network-consent-row"
              aria-describedby={settingsHelpNoteId('consoleNetworkConsent')}
              {...helpFor('consoleNetworkConsent')}
            >
              <span className="settings-row-label">
                Console network access: {consoleNetworkConsentGranted ? 'Granted' : 'Not granted'}
              </span>
              {consoleNetworkConsentGranted && (
                <button
                  type="button"
                  id="console-network-consent-revoke-btn"
                  className="btn btn-secondary sm"
                  aria-describedby={settingsHelpNoteId('consoleNetworkConsent')}
                  onClick={() => {
                    setConsoleNetworkConsentGranted(false);
                    void useSettingsStore.getState().updateSettings({ consoleNetworkConsentGranted: false });
                  }}
                >
                  Revoke access
                </button>
              )}
            </div>
            <SettingsNote control="consoleNetworkConsent" />
          </SettingsGroup>
        </div>
        <div className="settings-pane" id="settings-pane-about" style={{ display: section === 'about' ? 'flex' : 'none' }}>
          <SettingsGroup title="Application">
            <p className="ai-dialog-version" id="ai-dialog-version">
              {version}
            </p>
            <p className="ai-dialog-note">Licensed under the Sound Buddy Desktop Application License.</p>
          </SettingsGroup>
        </div>
          </div>
        </div>
        <div className="settings-footer">
          {/* Visual-only affordance (#1007) — screen readers already get this
              copy through each control's aria-describedby, so an announced
              strip would double-read it on every hover. */}
          <p className="settings-help-strip" id="settings-help-strip" aria-hidden="true">
            {resolveSettingsHelp(activeHelp, section)}
          </p>
          <div className="rig-dialog-actions">
          <button
            type="button"
            id="settings-dialog-cancel"
            className="btn btn-secondary sm"
            onClick={closeSettingsDialog}
          >
            Cancel
          </button>
          <button type="button" id="settings-dialog-save" className="btn btn-primary sm" onClick={handleSave}>
            Save
          </button>
          </div>
        </div>
      </div>
    </div>
  );
}
