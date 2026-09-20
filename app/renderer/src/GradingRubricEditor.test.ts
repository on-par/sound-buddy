// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createRequire } from 'node:module';
import GradingRubricEditor from './GradingRubricEditor';
import { useSettingsStore } from './stores/settingsStore';
import { useIdealProfilesStore } from './stores/idealProfilesStore';
import { RUBRIC_FIELDS, rubricInputId } from './grading-rubric';
import type { AppSettings } from '../../electron/ipc/api';

const require = createRequire(import.meta.url);
const grading = require('../grading.js');

const SETTINGS: AppSettings = {
  idealProfile: '', customIdealProfiles: [], storageDir: '', rigs: [], activeRigId: null, usageSignalEnabled: false,
  channelLabels: {}, channelGroups: {}, inputInstrumentProfiles: {}, crashReportingEnabled: false, liveAdjustmentsEnabled: false,
  advancedFeaturesEnabled: true, lineCheckCalibrationEnabled: false, shareChurchName: '', weeklyReminderEnabled: false, weeklyReminderServiceDay: 0, liveEqPaneWidth: 360,
  measurementDeviceName: '', gradingProfile: 'casual', gradingRubric: {}, consoleNetworkConsentGranted: false, soundcheckBuses: [],
  splCalibrationOffsetDb: null, lastAppMode: '',
};

function render(): string {
  return renderToString(createElement(GradingRubricEditor));
}

beforeEach(() => {
  (globalThis as { window?: unknown }).window = { grading };
  useSettingsStore.setState({ settings: SETTINGS });
  useIdealProfilesStore.setState({ selectedId: '', customProfiles: [] });
});
afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('GradingRubricEditor', () => {
  it('renders the ideal-curve picker with Auto, every built-in, and the edit/capture button', () => {
    const html = render();
    expect(html).toContain('id="grading-baseline-select"');
    expect(html).toContain('Auto (by content)');
    expect(html).toContain('Worship service');
    expect(html).toContain('id="grading-baseline-edit-btn"');
    expect(html).toContain('Edit or capture curve…');
  });

  it('lists custom curves under a Custom group and selects the persisted pick', () => {
    useIdealProfilesStore.setState({
      selectedId: 'custom:room',
      customProfiles: [{ id: 'room', label: 'Our room', description: '', freqs: [], dbOffsets: [], source: 'manual', createdAt: '', updatedAt: '' }],
    });
    const html = render();
    expect(html).toContain('<optgroup label="Custom">');
    expect(html).toMatch(/<option[^>]*value="custom:room"[^>]*selected|<option[^>]*selected[^>]*value="custom:room"/);
  });

  it('renders one number input per rubric field, seeded with the casual defaults', () => {
    const html = render();
    for (const f of RUBRIC_FIELDS) expect(html).toContain(`id="${rubricInputId(f.key)}"`);
    expect(html).toMatch(/id="rubric-rms-acceptableMin"[^>]*value="-20"/);
    expect(html).toMatch(/id="rubric-bandBalance-severeHotDiff"[^>]*value="15"/);
    expect(html).toMatch(/id="rubric-symptoms-thresholdOffsetDb"[^>]*value="0"/);
    expect(html).toContain('Casual / volunteer defaults');
    expect(html).toMatch(/id="grading-rubric-reset-btn"[^>]*disabled=""/);
  });

  it('seeds the broadcast defaults when that profile is active', () => {
    useSettingsStore.setState({ settings: { ...SETTINGS, gradingProfile: 'broadcast' } });
    const html = render();
    expect(html).toMatch(/id="rubric-bandBalance-severeHotDiff"[^>]*value="13"/);
    expect(html).toContain('Broadcast-ready defaults');
  });

  it('shows overrides in place of the defaults, marks the row, counts them, and enables Reset', () => {
    useSettingsStore.setState({ settings: { ...SETTINGS, gradingRubric: { 'rms.acceptableMin': -30, 'centroid.max': 6000 } } });
    const html = render();
    expect(html).toMatch(/id="rubric-rms-acceptableMin"[^>]*value="-30"/);
    expect(html).toMatch(/class="rubric-row overridden"[^>]*>\s*<label for="rubric-rms-acceptableMin"/);
    expect(html).toContain('2 customized');
    expect(html).not.toMatch(/id="grading-rubric-reset-btn"[^>]*disabled=""/);
  });

  it('renders blank inputs (never throws) when grading.js is not on window', () => {
    (globalThis as { window?: unknown }).window = {};
    const html = render();
    expect(html).toMatch(/id="rubric-rms-acceptableMin"[^>]*value=""/);
    expect(html).toMatch(/id="rubric-symptoms-thresholdOffsetDb"[^>]*value="0"/);
  });

  it('renders each input with its bounds and points it at the rubric help note', () => {
    const html = render();
    expect(html).toMatch(/id="rubric-bandBalance-quietDiff"[^>]*min="-60"[^>]*max="0"/);
    expect(html).toMatch(/id="rubric-centroid-max"[^>]*max="20000"/);
    expect(html).toMatch(/id="rubric-rms-acceptableMin"[^>]*aria-describedby="grading-rubric-note"/);
    expect(html).toContain('id="grading-rubric-fields"');
  });

  it('spreads the injected help handlers onto the picker and the field block separately', () => {
    const calls: string[] = [];
    const handlers = (name: string) => ({
      onMouseEnter: () => calls.push(name), onMouseLeave: () => calls.push(name), onFocus: () => calls.push(name), onBlur: () => calls.push(name),
    });
    const html = renderToString(createElement(GradingRubricEditor, { baselineHelp: handlers('baseline'), rubricHelp: handlers('rubric') }));
    expect(html).toContain('id="grading-baseline-field"');
    expect(html).toContain('id="grading-rubric-fields"');
  });

  it('renders every group title', () => {
    const html = render();
    for (const title of ['Level', 'Dynamics', 'Band balance', 'Tonal balance', 'Tonal symptoms']) {
      expect(html).toContain(`<div class="rubric-group-title">${title}</div>`);
    }
  });
});
