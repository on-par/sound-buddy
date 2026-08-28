// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import SplCalibrationPanel from './SplCalibrationPanel';
import { useSettingsStore } from './stores/settingsStore';
import { SPL_METER_MIN_DB, SPL_METER_MAX_DB } from './spl-calibration';
import type { AppSettings } from '../../electron/ipc/api';

afterEach(() => {
  useSettingsStore.setState({ settings: null, settingsError: null, dialogOpen: false });
});

function renderMarkup(): string {
  return renderToString(createElement(SplCalibrationPanel));
}

describe('SplCalibrationPanel (#846)', () => {
  it('renders the live-level readout, meter input, and Calibrate button', () => {
    const html = renderMarkup();
    expect(html).toContain('id="spl-cal-live-level"');
    expect(html).toContain('id="spl-cal-meter-input"');
    expect(html).toContain('id="spl-cal-apply"');
  });

  it('shows "Not calibrated" and no Reset button when splCalibrationOffsetDb is null', () => {
    useSettingsStore.setState({ settings: { splCalibrationOffsetDb: null } as unknown as AppSettings });
    const html = renderMarkup();
    expect(html).toContain('Not calibrated');
    expect(html).not.toContain('id="spl-cal-reset"');
  });

  it('shows the signed offset text and a Reset button when calibrated', () => {
    useSettingsStore.setState({ settings: { splCalibrationOffsetDb: 111.4 } as unknown as AppSettings });
    const html = renderMarkup();
    expect(html).toContain('+111.4 dB');
    expect(html).toContain('id="spl-cal-reset"');
  });

  it('carries the meter input min/max matching SPL_METER_MIN_DB/MAX_DB and the help aria-describedby', () => {
    const html = renderMarkup();
    expect(html).toContain(`min="${SPL_METER_MIN_DB}"`);
    expect(html).toContain(`max="${SPL_METER_MAX_DB}"`);
    expect(html).toMatch(/id="spl-cal-meter-input"[^>]*aria-describedby="spl-calibration-note"/);
  });

  it('renders no settings loaded (null settings) without crashing, defaulting to uncalibrated', () => {
    useSettingsStore.setState({ settings: null });
    const html = renderMarkup();
    expect(html).toContain('Not calibrated');
  });
});
