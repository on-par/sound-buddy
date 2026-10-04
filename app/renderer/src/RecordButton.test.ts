// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import RecordButton from './RecordButton';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useRecordTakeStore } from './stores/recordTakeStore';
import { iconSvg } from './report-card';

const liveTransitionState = require('../live-transition-state.js');

const INITIAL_LIVE_CAPTURE_STATE = useLiveCaptureStore.getInitialState();
const INITIAL_RECORD_TAKE_STATE = useRecordTakeStore.getInitialState();

afterEach(() => {
  useLiveCaptureStore.setState({
    appMode: INITIAL_LIVE_CAPTURE_STATE.appMode,
    liveMode: INITIAL_LIVE_CAPTURE_STATE.liveMode,
    isCapturing: INITIAL_LIVE_CAPTURE_STATE.isCapturing,
    promoting: INITIAL_LIVE_CAPTURE_STATE.promoting,
    stopping: INITIAL_LIVE_CAPTURE_STATE.stopping,
    demoting: INITIAL_LIVE_CAPTURE_STATE.demoting,
  });
  useRecordTakeStore.setState(INITIAL_RECORD_TAKE_STATE);
});

beforeEach(() => {
  (globalThis as { window?: unknown }).window = { liveTransitionState };
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
  expect(html).toContain(iconSvg('circle', 16));
  expect(html).not.toContain(iconSvg('square', 16));
}

// #1650: while recording the inner circle becomes a square (stop glyph).
function expectStopIcon(html: string) {
  expect(html).toContain(iconSvg('square', 16));
  expect(html).not.toContain(iconSvg('circle', 16));
}

// Record/stop only: the header button never grows a status line, a saved-take
// name, an error, or Show in Finder.
function expectRecordStopOnly(html: string) {
  expect(html).not.toContain('record-meta');
  expect(html).not.toContain('record-status');
  expect(html).not.toContain('record-saved');
  expect(html).not.toContain('record-reveal');
  expect(html).not.toContain('record-error');
  expect(html).not.toContain('Show in Finder');
  expect(html).not.toContain('Recording ·');
  expect(html).not.toContain('Saving');
  expect(html).not.toContain('Starting…');
}

describe('RecordButton — Main + Measurement take (#1648)', () => {
  it('renders an enabled idle Record on the Analyze-first shell with no Session capture', () => {
    useLiveCaptureStore.setState({ appMode: 'analyze', isCapturing: false });
    const html = renderMarkup();
    expect(html).toContain('id="record-button"');
    expect(html).toContain('record-btn--idle');
    expect(html).not.toMatch(/id="record-button"[^>]*disabled=""/);
    expect(html).toContain('aria-label="Record Main + Measurement — press to start"');
    expect(html).toContain('aria-pressed="false"');
    expectNoVisibleText(html);
    expectCircleIcon(html);
    expectRecordStopOnly(html);
  });

  it('stays the take Record while a Session monitor runs in the background (never promotes Session)', () => {
    useLiveCaptureStore.setState({ appMode: 'console', isCapturing: true, liveMode: 'monitor' });
    const html = renderMarkup();
    expect(html).toContain('record-btn--idle');
    expect(html).not.toContain('record-btn--monitoring');
    expect(html).toContain('aria-label="Record Main + Measurement — press to start"');
  });

  it('is a disabled Starting state with no status text', () => {
    useRecordTakeStore.setState({ phase: 'starting' });
    const html = renderMarkup();
    expect(html).toMatch(/id="record-button"[^>]*disabled=""/);
    expectCircleIcon(html);
    expectRecordStopOnly(html);
  });

  it('shows the pressed recording state as a square and nothing else', () => {
    useRecordTakeStore.setState({
      phase: 'recording',
      startedAt: Date.now(),
      sources: { main: 'X32 USB · Ch 17–18 (stereo)', measurement: 'UMIK-1 · Ch 1 (mono)' },
    });
    const html = renderMarkup();
    expect(html).toMatch(/class="record-btn record-btn--recording"/);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="Recording Main + Measurement — press to stop"');
    expect(html).not.toMatch(/id="record-button"[^>]*disabled=""/);
    expectStopIcon(html);
    expectRecordStopOnly(html);
  });

  it('is a disabled Stopping state with no Saving text', () => {
    useRecordTakeStore.setState({ phase: 'stopping' });
    const html = renderMarkup();
    expect(html).toMatch(/record-btn--stopping[^>]*disabled=""/);
    expectStopIcon(html);
    expectRecordStopOnly(html);
  });

  it('returns to the idle circle after a take, with no saved name and no Show in Finder', () => {
    const dir = '/Music/Sound Buddy/sound-buddy-20261004-101500-000';
    useRecordTakeStore.setState({
      lastTake: { dir, files: { main: `${dir}/main/01-main.wav`, measurement: `${dir}/measurement/01-measurement.wav` } },
    });
    const html = renderMarkup();
    expectCircleIcon(html);
    expect(html).toContain('aria-label="Record Main + Measurement — press to start"');
    expectRecordStopOnly(html);
  });

  it('does not render an error or Show in Finder when a source is missing', () => {
    const dir = '/Music/Sound Buddy/sound-buddy-20261004-101500-000';
    useRecordTakeStore.setState({
      lastTake: { dir, files: { main: `${dir}/main/01-main.wav`, measurement: null } },
      error: 'Measurement file was not written — check the room mic in Settings ▸ Audio, then record again.',
    });
    const html = renderMarkup();
    expectCircleIcon(html);
    expectRecordStopOnly(html);
    expect(html).not.toContain('Measurement file was not written');
  });
});

describe('RecordButton — a running Session recording keeps its Stop reachable (#729)', () => {
  it('shows the Session Recording/Stop control across tabs', () => {
    useLiveCaptureStore.setState({ appMode: 'console', isCapturing: true, liveMode: 'record' });
    const html = renderMarkup();
    expect(html).toMatch(/class="record-btn record-btn--recording"/);
    expect(html).toContain('aria-label="Recording — press to stop"');
    expect(html).not.toContain('record-status');
    expectStopIcon(html);
  });

  it('keeps starting and stopping Session transitions visible and disabled', () => {
    useLiveCaptureStore.setState({ appMode: 'console', isCapturing: true, liveMode: 'monitor', promoting: true });
    const starting = renderMarkup();
    expect(starting).toMatch(/record-btn--starting-record[^>]*disabled=""/);
    expectCircleIcon(starting);

    useLiveCaptureStore.setState({ appMode: 'console', isCapturing: false, liveMode: 'record', promoting: false, stopping: true });
    const html = renderMarkup();
    expect(html).toMatch(/record-btn--stopping[^>]*disabled=""/);
    expect(html).toContain('aria-pressed="true"');
    expectStopIcon(html);
  });

  it('returns to the take Record across the post-stop demote (#1384)', () => {
    useLiveCaptureStore.setState({ appMode: 'console', isCapturing: false, liveMode: 'record', demoting: true });
    const html = renderMarkup();
    expect(html).toContain('record-btn--idle');
    expect(html).not.toContain('record-btn--recording');
  });

  it('lets a running take keep the button even if a Session capture is also recording', () => {
    useLiveCaptureStore.setState({ appMode: 'console', isCapturing: true, liveMode: 'record' });
    useRecordTakeStore.setState({ phase: 'recording', startedAt: Date.now() });
    expect(renderMarkup()).toContain('aria-label="Recording Main + Measurement — press to stop"');
  });
});

// #record-button-island (#header-center, #1650) sits outside #tab-live/
// #settings-pane-audio — the two containers the
// shared body.not-pro CSS rule covered before this ticket. Without its own
// entry in that rule, a free-tier user gets a working Record button in the
// header with no Pro gate, repeating the exact #727 paywall-bypass bug
// SettingsPanel.test.ts's "gates the Audio pane..." test already guards
// against (see that file, and the #729 plan's ADR).
describe('Pro gating (#729)', () => {
  it('gates the top-bar Record button via CSS, not its own license check', () => {
    const src = fs.readFileSync(fileURLToPath(new URL('./RecordButton.tsx', import.meta.url)), 'utf8');
    expect(src).not.toContain('badge(');
    expect(src).not.toContain('licenseStatus');
    const css = fs.readFileSync(fileURLToPath(new URL('./styles/app.css', import.meta.url)), 'utf8');
    expect(css).toContain('body.not-pro #record-button-island { display:none !important; }');
    expect(css).toContain('body.live-active #record-button-island { display:none !important; }');
  });
});
