// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import MeasurementBadge from './MeasurementBadge';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import type { StripConfig } from './live-capture-panel';

afterEach(() => {
  useLiveCaptureStore.setState({
    isCapturing: false,
    measurementSource: null,
    channelConfig: [],
    secondaryMeasurement: { status: 'off', deviceName: '' },
    secondaryWindows: [],
  });
});

const CONFIG: StripConfig[] = [
  { kind: 'mono', a: 0, b: 1, label: 'Kick' },
  { kind: 'mono', a: 1, b: 2, label: 'Vox' },
];

function renderMarkup(): string {
  return renderToString(createElement(MeasurementBadge));
}

describe('MeasurementBadge (TD-001 slice 6h, #711)', () => {
  it('renders an empty #measurement-badge while idle', () => {
    const html = renderMarkup();
    expect(html).toContain('id="measurement-badge"');
    expect(html).toMatch(/id="measurement-badge"><\/span>/);
  });

  it('names the measurement-source strip while capturing', () => {
    useLiveCaptureStore.setState({
      isCapturing: true,
      measurementSource: 1,
      channelConfig: CONFIG,
    });
    expect(renderMarkup()).toContain('Measuring: Vox');
  });

  it('flags the secondary device when the secondary source is active with windows', () => {
    useLiveCaptureStore.setState({
      isCapturing: true,
      measurementSource: 1,
      channelConfig: CONFIG,
      secondaryMeasurement: { status: 'active', deviceName: 'USB Mic' },
      secondaryWindows: [{ window: 1 } as never],
    });
    expect(renderMarkup()).toContain('Measuring: USB Mic (secondary — not time-aligned)');
  });

  it('stays on the board strip while the secondary source is active but has no windows', () => {
    useLiveCaptureStore.setState({
      isCapturing: true,
      measurementSource: 0,
      channelConfig: CONFIG,
      secondaryMeasurement: { status: 'active', deviceName: 'USB Mic' },
    });
    expect(renderMarkup()).toContain('Measuring: Kick');
  });
});
