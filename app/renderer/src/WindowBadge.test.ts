// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import WindowBadge from './WindowBadge';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import type { WindowData } from './live-capture-panel';

// WindowBadge (TD-001 slice 6i, #712) — the header #window-badge span inside
// the static #live-indicator pill, derived from liveWindows + isCapturing.
describe('WindowBadge (TD-001 slice 6i, #712)', () => {
  afterEach(() => {
    useLiveCaptureStore.setState({ liveWindows: [], isCapturing: false });
  });

  function windowTick(n: number): WindowData {
    return { type: 'window', window: n, ts: n * 1000, channels: [], masking: [] };
  }

  it('renders empty while idle, even with stale windows buffered', () => {
    useLiveCaptureStore.setState({ liveWindows: [windowTick(3)], isCapturing: false });
    const html = renderToString(createElement(WindowBadge));
    expect(html).toBe('<span id="window-badge"></span>');
  });

  it('renders the latest window number while capturing', () => {
    useLiveCaptureStore.setState({ liveWindows: [windowTick(1), windowTick(2), windowTick(3)], isCapturing: true });
    const html = renderToString(createElement(WindowBadge));
    expect(html).toBe('<span id="window-badge">Window #3</span>');
  });
});
