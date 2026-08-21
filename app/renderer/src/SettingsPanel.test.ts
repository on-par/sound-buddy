// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import SettingsPanel, {
  SETTINGS_SECTIONS,
  saveAll,
  type SettingsSection,
  commitShareChurchName,
  settingsSectionFor,
  type SettingsControl,
} from './SettingsPanel';
import { SETTINGS_HELP_ENTRIES, SETTINGS_SECTION_HELP } from './settings-help';
import { ElectronContext } from './useElectron';
import { createSettingsStore, useSettingsStore } from './stores/settingsStore';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useLicensingStore } from './stores/licensingStore';
import { createMockSoundBuddy } from './mock-sound-buddy';
import type { AppSettings } from '../../electron/ipc/api';

// PreflightSettings (composed into the Audio pane, #757) reads the pure
// classic scripts window.rigReconcile/window.preflight — real modules, same
// convention as PreflightSettings.test.ts.
const rigReconcile = require('../rig-reconcile.js');
const preflight = require('../preflight.js');

beforeEach(() => {
  (globalThis as { window?: unknown }).window = { rigReconcile, preflight };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  useSettingsStore.setState({ settings: null, settingsError: null, dialogOpen: false });
  useLiveCaptureStore.setState({ isCapturing: false });
  useLicensingStore.setState({ licenseStatus: null });
});

function renderMarkup(booted = false): string {
  const mock = createMockSoundBuddy();
  return renderToString(createElement(ElectronContext.Provider, { value: mock.api }, createElement(SettingsPanel, { booted })));
}

describe('saveAll', () => {
  it('applies the storage patch, then closes the dialog', async () => {
    const mock = createMockSoundBuddy({
      updateSettings: async (patch) => {
        mock.calls.push({ method: 'updateSettings', args: [patch] });
        return {
          idealProfile: '', customIdealProfiles: [], storageDir: '', rigs: [], activeRigId: null,
          usageSignalEnabled: false, channelLabels: {}, channelGroups: {}, inputInstrumentProfiles: {},
          crashReportingEnabled: false, dawWorkspaceEnabled: false, liveAdjustmentsEnabled: false,
          reportFirstUxEnabled: false, shareChurchName: '', weeklyReminderEnabled: false, weeklyReminderServiceDay: 0,
          liveEqPaneWidth: 360, measurementDeviceName: '', gradingProfile: 'casual', consoleNetworkConsentGranted: false,
          soundcheckBuses: [],
        };
      },
    });
    const store = createSettingsStore(() => mock.api);
    store.getState().openDialog();

    await saveAll({ storagePatch: { storageDir: '/custom/folder' } }, store);

    expect(store.getState().dialogOpen).toBe(false);
    expect(mock.calls).toContainEqual({ method: 'updateSettings', args: [{ storageDir: '/custom/folder' }] });
  });

  it('skips the storage patch call when it is null, but still closes', async () => {
    const mock = createMockSoundBuddy();
    const store = createSettingsStore(() => mock.api);
    store.getState().openDialog();

    await saveAll({ storagePatch: null }, store);

    expect(mock.calls.some((c) => c.method === 'updateSettings')).toBe(false);
    expect(store.getState().dialogOpen).toBe(false);
  });
});

describe('SettingsPanel markup', () => {
  it('renders hidden by default with all top-level rail rows and panes present', () => {
    const html = renderMarkup();
    expect(html).toContain('id="settings-dialog"');
    expect(html).toContain('style="display:none"');
    for (const section of SETTINGS_SECTIONS) {
      expect(html).toContain(`id="settings-tab-btn-${section}"`);
      expect(html).toContain(`id="settings-pane-${section}"`);
    }
  });

  it('shows flex display when the dialog is open', () => {
    useSettingsStore.setState({ dialogOpen: true });
    const html = renderMarkup();
    expect(html).toContain('style="display:flex"');
  });

  it('defaults to the General tab active and the About pane hidden', () => {
    const html = renderMarkup();
    expect(html).toContain('id="settings-tab-btn-general" role="tab" aria-selected="true"');
    expect(html).toMatch(/id="settings-pane-general" style="display:flex"/);
    expect(html).toMatch(/id="settings-pane-storage" style="display:none"/);
    expect(html).toMatch(/id="settings-pane-about" style="display:none"/);
  });

  it('defaults to the Audio tab inactive and its pane hidden', () => {
    const html = renderMarkup();
    expect(html).toContain('id="settings-tab-btn-audio" role="tab" aria-selected="false"');
    expect(html).toMatch(/id="settings-pane-audio" style="display:none"/);
  });

  it('defaults to the Console tab inactive and its pane hidden', () => {
    const html = renderMarkup();
    expect(html).toContain('id="settings-tab-btn-console" role="tab" aria-selected="false"');
    expect(html).toMatch(/id="settings-pane-console" style="display:none"/);
  });

  it('wires section tab buttons through the table-driven section list', () => {
    const src = fs.readFileSync(fileURLToPath(new URL('./SettingsPanel.tsx', import.meta.url)), 'utf8');
    expect(src).toContain('SETTINGS_SECTIONS.map((name)');
    expect(src).toContain('setSection(name);');
  });

  it('renders the storage pane copy verbatim, including the no-caps guardrail line', () => {
    const html = renderMarkup();
    expect(html).toContain('Unlimited recordings. Stored on your machine.');
    expect(html).toContain('id="storage-path"');
    expect(html).toContain('id="storage-usage"');
    expect(html).toContain('id="storage-change-btn"');
  });

  it('hides the storage reset button when the effective path is the default', () => {
    const html = renderMarkup();
    expect(html).toMatch(/id="storage-reset-btn"[^>]*style="display:none"/);
  });

  it('renders an empty version footer before the app-version fetch resolves', () => {
    const html = renderMarkup();
    expect(html).toMatch(/<p class="ai-dialog-version" id="ai-dialog-version"><\/p>/);
  });

  it('renders the church-name field blank by default (no persisted settings)', () => {
    const html = renderMarkup();
    expect(html).toContain('id="share-church-name-input"');
    expect(html).toMatch(/id="share-church-name-input"[^>]*value=""/);
  });

  it('shows a persisted church name on initial render', () => {
    useSettingsStore.setState({ settings: { shareChurchName: 'Grace Chapel' } as unknown as AppSettings });
    const html = renderMarkup();
    expect(html).toMatch(/id="share-church-name-input"[^>]*value="Grace Chapel"/);
  });
});

describe('Settings chrome (#1008)', () => {
  it('renders the section list as a vertical rail, not a horizontal tab strip', () => {
    const html = renderMarkup();
    expect(html).toContain('class="settings-rail" role="tablist" aria-orientation="vertical"');
    expect(html).not.toContain('class="settings-tabs"');
    expect(html).not.toContain('class="settings-tab"');
  });

  it('gives every section a rail row that keeps its tab id, role and selected state', () => {
    const html = renderMarkup();
    for (const section of SETTINGS_SECTIONS) {
      const re = new RegExp(
        `class="settings-rail-item[^"]*" id="settings-tab-btn-${section}" role="tab" aria-selected="(true|false)"`
      );
      expect(html).toMatch(re);
    }
  });

  it('marks only the default General row active', () => {
    const html = renderMarkup();
    expect(html).toContain('class="settings-rail-item active" id="settings-tab-btn-general"');
    expect(html).toContain('class="settings-rail-item" id="settings-tab-btn-audio"');
  });

  it('renders a title bar holding the dialog title and a labelled close control', () => {
    const html = renderMarkup();
    const bar = html.match(/<div class="settings-titlebar">[\s\S]*?<\/div><\/div>/)?.[0] ?? '';
    expect(bar).toContain('id="settings-dialog-title"');
    expect(bar).toContain('id="settings-dialog-close"');
    expect(bar).toContain('aria-label="Close settings"');
  });

  it('wraps the rail and panes in the fixed-height body, and the help strip + actions in the footer', () => {
    const html = renderMarkup();
    expect(html).toContain('class="settings-body"');
    expect(html).toContain('class="settings-panes"');
    const footer = html.match(/<div class="settings-footer">[\s\S]*$/)?.[0] ?? '';
    expect(footer).toContain('id="settings-help-strip"');
    expect(footer).toContain('id="settings-dialog-cancel"');
    expect(footer).toContain('id="settings-dialog-save"');
  });

  // Click dispatch needs jsdom (absent from this harness by convention — see
  // the console-consent Revoke test above), so the close control's wiring is
  // asserted in source here and driven for real by settings.spec.ts.
  it('closes without saving from the backdrop, the title-bar control and Cancel via one handler', () => {
    const src = fs.readFileSync(fileURLToPath(new URL('./SettingsPanel.tsx', import.meta.url)), 'utf8');
    expect(src).toContain('const closeSettingsDialog = () => useSettingsStore.getState().closeDialog();');
    expect((src.match(/onClick={closeSettingsDialog}/g) ?? []).length).toBe(2);
  });
});

describe('contextual help strip (#1007)', () => {
  it('renders every help-table entry as a visually-hidden note with a matching id', () => {
    const html = renderMarkup();
    for (const entry of SETTINGS_HELP_ENTRIES) {
      const re = new RegExp(`class="[^"]*settings-note-hidden[^"]*" id="${entry.noteId}"`);
      expect(html).toMatch(re);
    }
  });

  it('keeps all nine note ids present in the markup', () => {
    const html = renderMarkup();
    const noteIds = [
      'grading-profile-note',
      'weekly-reminder-note',
      'share-church-name-note',
      'storage-note',
      'usage-signal-note',
      'crash-reporting-note',
      'daw-workspace-note',
      'live-adjustments-note',
      'console-network-consent-note',
    ];
    for (const id of noteIds) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it('preserves the exact note copy byte-for-byte', () => {
    const html = renderMarkup();
    expect(html).toContain('Broadcast-ready tightens');
    expect(html).toContain('never audio, recordings, church or file names');
    expect(html).toContain('reduced to their base name');
    expect(html).toContain('no limits on any tier');
    expect(html).toContain('Revoking takes effect immediately');
  });

  it('wires aria-describedby from each control to its note element', () => {
    const html = renderMarkup();
    const pairs: [string, string][] = [
      ['usage-signal-toggle', 'usage-signal-note'],
      ['crash-reporting-toggle', 'crash-reporting-note'],
      ['daw-workspace-toggle', 'daw-workspace-note'],
      ['live-adjustments-toggle', 'live-adjustments-note'],
      ['grading-profile-select', 'grading-profile-note'],
      ['weekly-reminder-toggle', 'weekly-reminder-note'],
      ['weekly-reminder-day', 'weekly-reminder-note'],
      ['share-church-name-input', 'share-church-name-note'],
      ['storage-change-btn', 'storage-note'],
    ];
    for (const [controlId, noteId] of pairs) {
      const re = new RegExp(
        `(id="${controlId}"[^>]*aria-describedby="${noteId}"|aria-describedby="${noteId}"[^>]*id="${controlId}")`
      );
      expect(html).toMatch(re);
    }
  });

  it('shows the General section description in the strip by default', () => {
    const html = renderMarkup();
    expect(html).toContain('id="settings-help-strip"');
    expect(html).toContain(SETTINGS_SECTION_HELP.general);
  });

  it('marks the strip aria-hidden', () => {
    const html = renderMarkup();
    const re = /(id="settings-help-strip"[^>]*aria-hidden="true"|aria-hidden="true"[^>]*id="settings-help-strip")/;
    expect(html).toMatch(re);
  });

  it('wires the row handlers and resolver in source', () => {
    const src = fs.readFileSync(fileURLToPath(new URL('./SettingsPanel.tsx', import.meta.url)), 'utf8');
    expect(src).toContain('settingsHelpHandlers(control, setActiveHelp)');
    expect(src).toContain('resolveSettingsHelp(activeHelp, section)');
    expect(src).toContain('setActiveHelp(null)');
  });
});

// The Audio pane composes RigControls/LiveSourceSettings/
// SecondaryMeasurementPanel/CaptureCadenceControls directly as JSX (no
// createPortal — see this file's header and the #727 plan for why), gated by
// the `booted` prop App.tsx now passes through so they don't mount before
// the boot scripts these subcomponents transitively depend on
// (window.liveCaptureRuntime et al.) have run.
//
// These controls used to be children of #tab-live, gated for free by the CSS
// rule `body.not-pro #tab-live > :not(.pro-gate) { display:none !important; }`
// (app.css). Rather than re-deriving Pro status in JS, the Audio pane joins
// that same rule (`body.not-pro #settings-pane-audio > :not(.pro-gate)`) —
// the pro-gate card and the moved controls are both always rendered here
// when booted, and CSS alone decides which is visible. Since this harness
// renders via `renderToString` with no CSS engine, the pro/free visibility
// split itself is covered live by app/tests/license.spec.ts and
// app/tests/entitlement-matrix.spec.ts, not here.
describe('Audio pane composition (#727)', () => {
  it('renders the moved controls when booted', () => {
    const html = renderMarkup(true);
    expect(html).toContain('id="rig-select"');
    expect(html).toContain('id="device-select"');
    expect(html).toContain('id="measurement-source"');
    expect(html).toContain('id="secondary-measurement-device"');
    expect(html).toContain('id="meter-interval"');
    expect(html).toContain('id="window-secs"');
  });

  it('renders the secondary-measurement device select even with no settings loaded, defaulted to None', () => {
    const html = renderMarkup(true);
    expect(html).toContain('id="secondary-measurement-device"');
    expect(html).not.toContain('id="secondary-measurement-toggle"');
  });

  it('shows no "experimental" copy next to the secondary measurement device', () => {
    const html = renderMarkup(true);
    expect(html).not.toContain('Secondary Measurement Device (experimental)');
    expect(html).not.toContain('secondary-measurement-toggle');
  });

  it('renders none of the moved controls when not booted', () => {
    const html = renderMarkup(false);
    expect(html).not.toContain('id="rig-select"');
    expect(html).not.toContain('id="device-select"');
    expect(html).not.toContain('id="measurement-source"');
    expect(html).not.toContain('id="meter-interval"');
    expect(html).not.toContain('id="window-secs"');
    expect(html).not.toContain('id="preflight-save-btn"');
    expect(html).not.toContain('id="preflight-list"');
  });

  it('composes the preflight checklist + Save baseline in the Audio pane when booted (#757)', () => {
    const html = renderMarkup(true);
    expect(html).toContain('id="preflight-save-btn"');
    expect(html).toContain('id="preflight-saved"');
    expect(html).toContain('id="preflight-banner"');
    expect(html).toContain('id="preflight-list"');
    expect(html).toContain('pf-row');
  });

  it('shows no capture-lock note while idle', () => {
    const html = renderMarkup(true);
    expect(html).not.toContain('id="settings-audio-capture-lock-note"');
  });

  it('shows the capture-lock note while capturing, without claiming measurement source or the secondary device are locked', () => {
    useLiveCaptureStore.setState({ isCapturing: true });
    const html = renderMarkup(true);
    expect(html).toContain('id="settings-audio-capture-lock-note"');
    const note = html.match(/<p class="ai-dialog-note" id="settings-audio-capture-lock-note">(.*?)<\/p>/)?.[1] ?? '';
    expect(note).not.toMatch(/input device[^.]*locked/i);
    expect(note).toMatch(/Input device changes restart capture/i);
    expect(note).not.toMatch(/measurement source[^.]*locked/i);
    expect(note).not.toMatch(/secondary measurement[^.]*locked/i);
  });

  // #727 follow-up fix: without a gate reaching this pane, a free-tier user
  // opening Settings → Audio could configure and save rigs, pick devices,
  // and tune capture cadence — a paywall bypass, since the Live tab's Pro
  // upgrade card no longer covers this surface once it moved outside
  // #tab-live. The pro-gate card renders alongside the controls (both always
  // present when booted); app.css's body.not-pro rule (asserted below)
  // is what actually decides which one is visible.
  it('always renders the Pro upgrade card next to the controls when booted', () => {
    const html = renderMarkup(true);
    expect(html).toContain('id="settings-audio-pro-gate"');
    expect(html).toContain('Live monitoring is a Pro feature');
    expect(html).toContain('id="rig-select"');
  });

  it('wires the Settings Audio-pane upgrade link to open the license dialog', () => {
    const src = fs.readFileSync(fileURLToPath(new URL('./SettingsPanel.tsx', import.meta.url)), 'utf8');
    expect(src).toContain('id="settings-audio-pro-gate"');
    expect(src).toContain('useLicensingStore.getState().openDialog()');
  });

  // Guards the boundary-violation fix: SettingsPanel must not re-derive Pro
  // status from licenseStatus/badge() — it must reuse the single body.not-pro
  // gating hook (LicenseChrome.tsx) via the same CSS rule #tab-live and
  // #tab-soundcheck already use.
  it('gates the Audio pane via the shared body.not-pro CSS rule, not its own license check', () => {
    const src = fs.readFileSync(fileURLToPath(new URL('./SettingsPanel.tsx', import.meta.url)), 'utf8');
    expect(src).not.toContain('badge(');
    expect(src).not.toContain('licenseStatus');
    const css = fs.readFileSync(fileURLToPath(new URL('./styles/app.css', import.meta.url)), 'utf8');
    expect(css).toContain('body.not-pro #settings-pane-audio > :not(.pro-gate)');
  });
});

describe('console network consent status (#378)', () => {
  it('renders console network consent inside the Console pane, not the Storage pane', () => {
    const html = renderMarkup();
    const storagePane = html.match(/id="settings-pane-storage"[\s\S]*?id="settings-pane-audio"/)?.[0] ?? '';
    const consolePane = html.match(/id="settings-pane-console"[\s\S]*?id="settings-pane-about"/)?.[0] ?? '';
    expect(storagePane).not.toContain('id="console-network-consent-row"');
    expect(consolePane).toContain('id="console-network-consent-row"');
  });

  it('renders "Not granted" and no Revoke button by default (no persisted settings)', () => {
    const html = renderMarkup();
    expect(html).toContain('id="console-network-consent-row"');
    expect(html).toContain('Not granted');
    expect(html).not.toContain('id="console-network-consent-revoke-btn"');
  });

  it('renders "Not granted" and no Revoke button when consent is not granted', () => {
    useSettingsStore.setState({ settings: { consoleNetworkConsentGranted: false } as unknown as AppSettings });
    const html = renderMarkup();
    expect(html).toContain('Not granted');
    expect(html).not.toContain('id="console-network-consent-revoke-btn"');
  });

  it('renders "Granted" and the Revoke button when consent is granted', () => {
    useSettingsStore.setState({ settings: { consoleNetworkConsentGranted: true } as unknown as AppSettings });
    const html = renderMarkup();
    expect(html).toContain('Granted');
    expect(html).toContain('id="console-network-consent-revoke-btn"');
    expect(html).toContain('Revoke access');
  });

  it('has no checkbox capable of granting access — only a revoke button', () => {
    useSettingsStore.setState({ settings: { consoleNetworkConsentGranted: true } as unknown as AppSettings });
    const html = renderMarkup();
    expect(html).not.toMatch(/id="console-network-consent[^"]*"[^>]*type="checkbox"/);
  });

  // Revoke commits immediately via updateSettings — not gated behind the
  // Save button — the same "not gated behind Save" discipline
  // commitShareChurchName uses, because a security revoke should never be
  // lost by a user who clicks it then closes the dialog with Cancel. Click
  // dispatch itself needs jsdom (not available in this harness, per the
  // file's existing convention for other buttons), so this asserts the
  // wiring exists in source, same pattern the storage-toggle-seeding test
  // below uses against SettingsPanel.tsx.
  it('the Revoke button commits consoleNetworkConsentGranted:false immediately via updateSettings', () => {
    const src = fs.readFileSync(fileURLToPath(new URL('./SettingsPanel.tsx', import.meta.url)), 'utf8');
    expect(src).toContain('id="console-network-consent-revoke-btn"');
    expect(src).toContain("updateSettings({ consoleNetworkConsentGranted: false })");
  });
});

describe('commitShareChurchName', () => {
  it('persists the church name via settingsStore.updateSettings', async () => {
    const mock = createMockSoundBuddy();
    const store = createSettingsStore(() => mock.api);

    await commitShareChurchName(store, 'Grace Chapel');

    expect(mock.calls).toContainEqual({ method: 'updateSettings', args: [{ shareChurchName: 'Grace Chapel' }] });
  });

  it('persists an empty string to clear a previously-saved name', async () => {
    const mock = createMockSoundBuddy();
    const store = createSettingsStore(() => mock.api);

    await commitShareChurchName(store, '');

    expect(mock.calls).toContainEqual({ method: 'updateSettings', args: [{ shareChurchName: '' }] });
  });
});

// Re-homed from inline-app.js's now-deleted openStorageSettings()/
// saveStorageSettings() (#91, #522) onto SettingsPanel.tsx + storage-settings.ts
// (#204). The seeding itself lives in the dialog-open effect, which is
// c8-ignored (no jsdom, exercised by settings.spec.ts) — this asserts the
// wiring exists in source, same pattern live-adjustments-gate.test.ts used
// against inline-app.js. buildStoragePatch's per-toggle diff behavior,
// including liveAdjustmentsEnabled, is covered directly in
// storage-settings.test.ts.
describe('storage toggle seeding on dialog open (#522, #204)', () => {
  const src = fs.readFileSync(fileURLToPath(new URL('./SettingsPanel.tsx', import.meta.url)), 'utf8');

  it('seeds every storage toggle from the loaded settings', () => {
    expect(src).toContain('setUsageSignalEnabled(!!settings?.usageSignalEnabled)');
    expect(src).toContain('setCrashReportingEnabled(!!settings?.crashReportingEnabled)');
    expect(src).toContain('setDawWorkspaceEnabled(!!settings?.dawWorkspaceEnabled)');
    expect(src).toContain('setLiveAdjustmentsEnabled(!!settings?.liveAdjustmentsEnabled)');
    expect(src).toContain("setGradingProfile(settings?.gradingProfile === 'broadcast' ? 'broadcast' : 'casual')");
    expect(src).toContain('setConsoleNetworkConsentGranted(!!settings?.consoleNetworkConsentGranted)');
  });
});

// SettingsSection type import is exercised for its type only — a runtime
// assertion would be redundant, but the import must resolve (compile-time
// proof the export still exists post-#657's AI-tab removal, now widened for
// the #726 Audio tab).
describe('SettingsSection', () => {
  it('includes all seven information-architecture sections', () => {
    const sections: readonly SettingsSection[] = SETTINGS_SECTIONS;
    expect(sections).toEqual(['general', 'audio', 'console', 'storage', 'privacy', 'labs', 'about']);
  });

  it('maps every current Settings control to its target section', () => {
    const expectations: Record<SettingsControl, SettingsSection> = {
      gradingProfile: 'general',
      weeklyReminder: 'general',
      weeklyReminderServiceDay: 'general',
      shareChurchName: 'general',
      rig: 'audio',
      inputDevice: 'audio',
      measurementSource: 'audio',
      secondaryMeasurementDevice: 'audio',
      meterRate: 'audio',
      meterWindow: 'audio',
      preflight: 'audio',
      consoleNetworkConsent: 'console',
      storageDir: 'storage',
      diskUsage: 'storage',
      usageSignal: 'privacy',
      crashReporting: 'privacy',
      dawWorkspace: 'labs',
      liveAdjustments: 'labs',
      version: 'about',
      license: 'about',
    };
    for (const [setting, section] of Object.entries(expectations) as [SettingsControl, SettingsSection][]) {
      expect(settingsSectionFor(setting)).toBe(section);
      expect(SETTINGS_SECTIONS).toContain(section);
    }
  });
});

describe('Settings row grid (#1009)', () => {
  it('renders a group header for every ungated group', () => {
    const html = renderMarkup();
    for (const title of ['Grading', 'Reminders', 'Sharing', 'Network access', 'Location', 'Diagnostics', 'Experiments', 'Application']) {
      expect(html).toContain(`<h3 class="settings-group-title">${title}</h3>`);
    }
  });

  it('renders a group header for every boot-gated Audio group once booted', () => {
    const html = renderMarkup(true);
    for (const title of ['Rig', 'Input', 'Measurement', 'Metering']) {
      expect(html).toContain(`<h3 class="settings-group-title">${title}</h3>`);
    }
  });

  it('wraps groups in a section.settings-group element', () => {
    const html = renderMarkup();
    expect(html).toContain('<section class="settings-group">');
  });

  it('does not render the boot-gated Audio groups before booted', () => {
    const html = renderMarkup(false);
    expect(html).not.toContain('<h3 class="settings-group-title">Rig</h3>');
  });

  it('puts each checkbox row caption before its control, in a settings-row-label span', () => {
    const html = renderMarkup();
    expect(html).toContain('<span class="settings-row-label">Share anonymous usage counts</span>');
    expect(html.indexOf('Share anonymous usage counts')).toBeLessThan(html.indexOf('id="usage-signal-toggle"'));
    expect(html.indexOf('Send crash reports')).toBeLessThan(html.indexOf('id="crash-reporting-toggle"'));
    expect(html.indexOf('Try the experimental DAW-style Live workspace')).toBeLessThan(html.indexOf('id="daw-workspace-toggle"'));
  });

  it('keeps every toggle a real checkbox input', () => {
    const html = renderMarkup();
    for (const id of ['weekly-reminder-toggle', 'usage-signal-toggle', 'crash-reporting-toggle', 'daw-workspace-toggle', 'live-adjustments-toggle']) {
      expect(html).toMatch(new RegExp(`type="checkbox" id="${id}"`));
    }
  });

  it('keeps the pro-gate a direct child of the Audio pane', () => {
    const html = renderMarkup(true);
    expect(html).toMatch(/id="settings-pane-audio"[^>]*>\s*<div class="pro-gate"/);
  });
});
