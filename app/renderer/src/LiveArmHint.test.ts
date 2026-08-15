// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import LiveArmHint from './LiveArmHint';
import { useLiveCaptureStore } from './stores/liveCaptureStore';

afterEach(() => {
  useLiveCaptureStore.setState({ armHint: { visible: false, text: '' } });
});

function renderMarkup(): string {
  return renderToString(createElement(LiveArmHint));
}

describe('LiveArmHint (TD-001 slice 6h, #711)', () => {
  it('keeps the #arm-hint id and .arm-hint class so e2e locators and styles still apply', () => {
    expect(renderMarkup()).toContain('id="arm-hint"');
    expect(renderMarkup()).toContain('class="arm-hint"');
    expect(renderMarkup()).toContain('role="alert"');
  });

  it('is hidden (display:none) with no text while the hint is closed', () => {
    const html = renderMarkup();
    expect(html).toMatch(/id="arm-hint"[^>]*display:none/);
    expect(html).toContain('></div>');
  });

  it('is visible with the hint text once showArmHint ran', () => {
    useLiveCaptureStore.getState().showArmHint('Arm at least one strip to record.');
    const html = renderMarkup();
    expect(html).toMatch(/id="arm-hint"[^>]*display:block/);
    expect(html).toContain('Arm at least one strip to record.');
  });
});
