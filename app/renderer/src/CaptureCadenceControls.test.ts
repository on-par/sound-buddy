// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import CaptureCadenceControls from './CaptureCadenceControls';
import { useLiveCaptureStore } from './stores/liveCaptureStore';

const INITIAL_LIVE_CAPTURE_STATE = useLiveCaptureStore.getInitialState();

afterEach(() => {
  useLiveCaptureStore.setState({
    meterIntervalMs: INITIAL_LIVE_CAPTURE_STATE.meterIntervalMs,
    windowSecs: INITIAL_LIVE_CAPTURE_STATE.windowSecs,
    isCapturing: INITIAL_LIVE_CAPTURE_STATE.isCapturing,
  });
});

function renderMarkup(): string {
  return renderToString(createElement(CaptureCadenceControls));
}

describe('CaptureCadenceControls (#725)', () => {
  it('renders both sliders with the default store state', () => {
    const html = renderMarkup();

    expect(html).toMatch(/id="meter-interval"[^>]*value="100"/);
    expect(html).toContain('min="50"');
    expect(html).toContain('max="500"');
    expect(html).toContain('step="10"');
    expect(html).not.toMatch(/id="meter-interval"[^>]*disabled=""/);
    expect(html).toMatch(/id="interval-label">100 ms · 10\/s</);

    expect(html).toMatch(/id="window-secs"[^>]*value="3"/);
    expect(html).toContain('min="1"');
    expect(html).toContain('max="10"');
    expect(html).toContain('step="0.5"');
    expect(html).toMatch(/id="window-secs-label">3\.0s</);
  });

  it('reflects updated store state in the rendered values and labels', () => {
    useLiveCaptureStore.setState({ meterIntervalMs: 200, windowSecs: 5 });

    const html = renderMarkup();

    expect(html).toMatch(/id="meter-interval"[^>]*value="200"/);
    expect(html).toMatch(/id="interval-label">200 ms · 5\/s</);
    expect(html).toMatch(/id="window-secs"[^>]*value="5"/);
    expect(html).toMatch(/id="window-secs-label">5\.0s</);
  });

  it('renders disabled + aria-disabled="true" while capturing, and re-enables when it stops', () => {
    useLiveCaptureStore.setState({ isCapturing: true });
    const locked = renderMarkup();
    expect(locked).toMatch(/id="meter-interval"[^>]*disabled=""/);
    expect(locked).toMatch(/id="meter-interval"[^>]*aria-disabled="true"/);
    expect(locked).toMatch(/id="window-secs"[^>]*disabled=""/);
    expect(locked).toMatch(/id="window-secs"[^>]*aria-disabled="true"/);

    useLiveCaptureStore.setState({ isCapturing: false });
    const idle = renderMarkup();
    expect(idle).not.toMatch(/id="meter-interval"[^>]*disabled=""/);
    expect(idle).toMatch(/id="meter-interval"[^>]*aria-disabled="false"/);
    expect(idle).not.toMatch(/id="window-secs"[^>]*disabled=""/);
    expect(idle).toMatch(/id="window-secs"[^>]*aria-disabled="false"/);
  });
});
