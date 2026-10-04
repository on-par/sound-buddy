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

// #1650: everything beside the circle (elapsed / Saving / saved take /
// error) renders inside .record-meta, which app.css takes out of flow so it
// can never shove the pinned button.
function metaInner(html: string): string {
  const m = html.match(/<div class="record-meta">([\s\S]*)<\/div>$/);
  expect(m, 'status renders inside .record-meta after the button').not.toBeNull();
  return m![1];
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
  });

  it('stays the take Record while a Session monitor runs in the background (never promotes Session)', () => {
    useLiveCaptureStore.setState({ appMode: 'console', isCapturing: true, liveMode: 'monitor' });
    const html = renderMarkup();
    expect(html).toContain('record-btn--idle');
    expect(html).not.toContain('record-btn--monitoring');
    expect(html).toContain('aria-label="Record Main + Measurement — press to start"');
  });

  it('is a disabled Starting state with a status line', () => {
    useRecordTakeStore.setState({ phase: 'starting' });
    const html = renderMarkup();
    expect(html).toMatch(/id="record-button"[^>]*disabled=""/);
    expect(html).toMatch(/id="record-status"[^>]*>Starting…</);
  });

  it('shows the pressed recording state, elapsed time, and what each source records', () => {
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
    expect(html).toMatch(/id="record-status"[^>]*title="Main: X32 USB · Ch 17–18 \(stereo\)\nMeasurement: UMIK-1 · Ch 1 \(mono\)"[^>]*>Recording · 0:0\d</);
    expectStopIcon(html);
    expect(metaInner(html)).toContain('id="record-status"');
  });

  it('is a disabled Saving state while the files finalize', () => {
    useRecordTakeStore.setState({ phase: 'stopping' });
    const html = renderMarkup();
    expect(html).toMatch(/record-btn--stopping[^>]*disabled=""/);
    expect(html).toMatch(/id="record-status"[^>]*>Saving…</);
    expectStopIcon(html);
  });

  it('names the saved take and both stems, with a Show in Finder button', () => {
    const dir = '/Music/Sound Buddy/sound-buddy-20261004-101500-000';
    useRecordTakeStore.setState({
      lastTake: { dir, files: { main: `${dir}/main/01-main.wav`, measurement: `${dir}/measurement/01-measurement.wav` } },
    });
    const html = renderMarkup();
    expect(html).toMatch(/id="record-saved"[^>]*title="\/Music\/Sound Buddy\/sound-buddy-20261004-101500-000"[^>]*>Saved · sound-buddy-20261004-101500-000</);
    expect(html).toMatch(/id="record-saved-files"[^>]*>01-main\.wav · 01-measurement\.wav</);
    // Two stacked, width-capped lines so the header never overflows; the
    // full file list is also in the title.
    expect(html).toMatch(/class="record-take-info"><span id="record-saved"/);
    expect(html).toMatch(/id="record-saved-files"[^>]*title="\/Music\/Sound Buddy\/sound-buddy-20261004-101500-000\/main\/01-main\.wav\n\/Music\/Sound Buddy\/sound-buddy-20261004-101500-000\/measurement\/01-measurement\.wav"/);
    expect(html).toContain('id="record-reveal"');
    expect(html).not.toContain('id="record-status"');
    expectCircleIcon(html);
    const meta = metaInner(html);
    expect(meta).toContain('id="record-saved"');
    expect(meta).toContain('id="record-reveal"');
  });

  it('renders the actionable error as an alert', () => {
    useRecordTakeStore.setState({ error: 'Measurement input not found — pick it in Settings ▸ Audio, then press Record.' });
    const html = renderMarkup();
    expect(html).toMatch(/id="record-error"[^>]*role="alert"[^>]*>Measurement input not found/);
    expect(metaInner(html)).toContain('id="record-error"');
  });

  // #1650: the pinned button leaves half the header for the status, which
  // can't fit the two-line take name AND the error — the error wins, and Show
  // in Finder stays so a partial take (one stem missing) is still reachable.
  it('drops the take name lines in favour of the error, keeping Show in Finder', () => {
    const dir = '/Music/Sound Buddy/sound-buddy-20261004-101500-000';
    useRecordTakeStore.setState({
      lastTake: { dir, files: { main: `${dir}/main/01-main.wav`, measurement: null } },
      error: 'Measurement file was not written — check the room mic in Settings ▸ Audio, then record again.',
    });
    const meta = metaInner(renderMarkup());
    expect(meta).toContain('id="record-error"');
    expect(meta).toContain('id="record-reveal"');
    expect(meta).not.toContain('id="record-saved"');
    expect(meta).not.toContain('record-take-info');
  });

  it('renders no .record-meta when there is nothing to say beside the button', () => {
    expect(renderMarkup()).not.toContain('record-meta');
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
