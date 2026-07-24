// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import SettingsPanel, { saveAll, type SettingsSection, commitShareChurchName } from './SettingsPanel';
import { ElectronContext } from './useElectron';
import { createSettingsStore, useSettingsStore } from './stores/settingsStore';
import { createMockSoundBuddy } from './mock-sound-buddy';
import type { AppSettings } from '../../electron/ipc/api';

afterEach(() => {
  useSettingsStore.setState({ settings: null, settingsError: null, dialogOpen: false });
});

function renderMarkup(): string {
  const mock = createMockSoundBuddy();
  return renderToString(createElement(ElectronContext.Provider, { value: mock.api }, createElement(SettingsPanel)));
}

describe('saveAll', () => {
  it('applies the storage patch, then closes the dialog', async () => {
    const mock = createMockSoundBuddy({
      updateSettings: async (patch) => {
        mock.calls.push({ method: 'updateSettings', args: [patch] });
        return {
          aiEnabled: true, idealProfile: '', customIdealProfiles: [], storageDir: '', rigs: [], activeRigId: null,
          usageSignalEnabled: false, channelLabels: {}, channelGroups: {}, inputInstrumentProfiles: {},
          crashReportingEnabled: false, dawWorkspaceEnabled: false, liveAdjustmentsEnabled: false,
          reportFirstUxEnabled: false, shareChurchName: '', weeklyReminderEnabled: false, weeklyReminderServiceDay: 0,
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
  it('renders hidden by default with both top-level tabs and panes present', () => {
    const html = renderMarkup();
    expect(html).toContain('id="settings-dialog"');
    expect(html).toContain('style="display:none"');
    expect(html).toContain('id="settings-tab-btn-storage"');
    expect(html).toContain('id="settings-tab-btn-about"');
    expect(html).toContain('id="settings-pane-storage"');
    expect(html).toContain('id="settings-pane-about"');
  });

  it('shows flex display when the dialog is open', () => {
    useSettingsStore.setState({ dialogOpen: true });
    const html = renderMarkup();
    expect(html).toContain('style="display:flex"');
  });

  it('defaults to the Storage tab active and the About pane hidden', () => {
    const html = renderMarkup();
    expect(html).toContain('id="settings-tab-btn-storage" role="tab" aria-selected="true"');
    expect(html).toMatch(/id="settings-pane-storage" style="display:flex"/);
    expect(html).toMatch(/id="settings-pane-about" style="display:none"/);
  });

  it('renders the storage pane copy verbatim, including the no-caps guardrail line', () => {
    const html = renderMarkup();
    expect(html).toContain('Unlimited recordings. Stored on your machine.');
    expect(html).toContain('id="storage-path"');
    expect(html).toContain('id="storage-usage"');
    expect(html).toContain('id="storage-change-btn"');
    expect(html).toContain('id="usage-signal-toggle"');
    expect(html).toContain('id="crash-reporting-toggle"');
    expect(html).toContain('id="daw-workspace-toggle"');
    expect(html).toContain('id="live-adjustments-toggle"');
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
  });
});

// SettingsSection type import is exercised for its type only — a runtime
// assertion would be redundant, but the import must resolve (compile-time
// proof the export still exists post-#657's AI-tab removal).
describe('SettingsSection', () => {
  it('excludes the removed ai section', () => {
    const sections: SettingsSection[] = ['storage', 'about'];
    expect(sections).toEqual(['storage', 'about']);
  });
});
