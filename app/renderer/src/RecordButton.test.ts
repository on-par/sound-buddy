// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import RecordButton from './RecordButton';
import { useLiveCaptureStore } from './stores/liveCaptureStore';

const INITIAL_LIVE_CAPTURE_STATE = useLiveCaptureStore.getInitialState();

afterEach(() => {
  useLiveCaptureStore.setState({
    appMode: INITIAL_LIVE_CAPTURE_STATE.appMode,
    liveMode: INITIAL_LIVE_CAPTURE_STATE.liveMode,
    isCapturing: INITIAL_LIVE_CAPTURE_STATE.isCapturing,
    promoting: INITIAL_LIVE_CAPTURE_STATE.promoting,
    stopping: INITIAL_LIVE_CAPTURE_STATE.stopping,
  });
});

function renderMarkup(): string {
  return renderToString(createElement(RecordButton));
}

// The record button is a no-text red-circle toggle (#777): the circle icon is
// the only visible content in every phase; the aria-label carries the state.
// `>…<` (text-node delimiters) is how the no-visible-text assertions avoid
// matching the aria-label/aria-pressed attribute values.
function expectNoVisibleText(html: string) {
  expect(html).not.toContain('>Record<');
  expect(html).not.toContain('>Recording<');
  expect(html).not.toContain('>Starting…<');
  expect(html).not.toContain('>Stopping…<');
}

function expectCircleIcon(html: string) {
  expect(html).toMatch(/id="record-button"[^>]*>\s*<svg/);
}

describe('RecordButton (#729)', () => {
  it('renders nothing when appMode is not live', () => {
    useLiveCaptureStore.setState({ appMode: 'reportcard' });
    expect(renderMarkup()).toBe('');
  });

  it('renders an enabled Record button when idle with no monitor session running (press starts capture) (#757)', () => {
    useLiveCaptureStore.setState({ appMode: 'live', isCapturing: false });
    const html = renderMarkup();
    expect(html).toContain('id="record-button"');
    expect(html).not.toMatch(/id="record-button"[^>]*disabled=""/);
    expectNoVisibleText(html);
    expectCircleIcon(html);
    expect(html).toContain('aria-label="Record — press to start recording"');
  });

  it('renders an enabled Record button while monitoring', () => {
    useLiveCaptureStore.setState({ appMode: 'live', isCapturing: true, liveMode: 'monitor' });
    const html = renderMarkup();
    expect(html).toContain('id="record-button"');
    expect(html).not.toMatch(/id="record-button"[^>]*disabled=""/);
    expectNoVisibleText(html);
    expectCircleIcon(html);
    expect(html).toContain('aria-label="Record — press to start recording"');
  });

  it('renders a disabled button while promoting, with no visible text', () => {
    useLiveCaptureStore.setState({ appMode: 'live', isCapturing: true, liveMode: 'monitor', promoting: true });
    const html = renderMarkup();
    expect(html).toMatch(/id="record-button"[^>]*disabled=""/);
    expectNoVisibleText(html);
    expectCircleIcon(html);
    expect(html).toContain('aria-label="Starting recording"');
  });

  it('renders an enabled Recording button with aria-pressed=true and the persisted record-btn--recording pressed state while recording', () => {
    useLiveCaptureStore.setState({ appMode: 'live', isCapturing: true, liveMode: 'record' });
    const html = renderMarkup();
    expect(html).not.toMatch(/id="record-button"[^>]*disabled=""/);
    expect(html).toMatch(/class="record-btn record-btn--recording"/);
    expectNoVisibleText(html);
    expectCircleIcon(html);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="Recording — press to stop"');
  });

  it('renders a disabled Stopping… button while stopping, with no visible text', () => {
    useLiveCaptureStore.setState({ appMode: 'live', isCapturing: true, liveMode: 'record', stopping: true });
    const html = renderMarkup();
    expect(html).toMatch(/id="record-button"[^>]*disabled=""/);
    expectNoVisibleText(html);
    expectCircleIcon(html);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="Stopping recording"');
  });
});

// #record-button-island (#header-right) sits outside #tab-live/
// #tab-soundcheck/#settings-pane-audio — the only three containers the
// shared body.not-pro CSS rule covered before this ticket. Without its own
// entry in that rule, a free-tier user gets a working Record button in the
// header with no Pro gate, repeating the exact #727 paywall-bypass bug
// SettingsPanel.test.ts's "gates the Audio pane..." test already guards
// against (see that file, and the #729 plan's ADR).
describe('Pro gating (#729)', () => {
  it('gates the top-bar Record button via the shared body.not-pro CSS rule, not its own license check', () => {
    const src = fs.readFileSync(fileURLToPath(new URL('./RecordButton.tsx', import.meta.url)), 'utf8');
    expect(src).not.toContain('badge(');
    expect(src).not.toContain('licenseStatus');
    const css = fs.readFileSync(fileURLToPath(new URL('./styles/app.css', import.meta.url)), 'utf8');
    expect(css).toContain('body.not-pro #record-button-island { display:none !important; }');
  });
});
