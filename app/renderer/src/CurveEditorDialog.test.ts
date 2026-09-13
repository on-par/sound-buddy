// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import CurveEditorDialog, { EDITOR_MAX_ABS_DB } from './CurveEditorDialog';
import { useIdealProfilesStore } from './stores/idealProfilesStore';
import { useLiveCaptureStore } from './stores/liveCaptureStore';

function renderMarkup(): string {
  return renderToString(createElement(CurveEditorDialog));
}

const CLOSED_EDITOR = {
  open: false,
  editingId: null as string | null,
  title: '',
  name: '',
  bands: [0, 0, 0, 0, 0, 0, 0],
  status: { text: '', kind: '' as '' | 'err' },
  canCapture: false,
  canDelete: false,
};

const INITIAL_LIVE_CAPTURE_STATE = useLiveCaptureStore.getInitialState();

function installIdealCurvesMock() {
  const root = globalThis as unknown as { window?: { idealCurves?: unknown } };
  root.window ??= {};
  root.window.idealCurves = {
    clampDb: (value: number) => value,
    profileFromBands: (bands: number[], freqs: number[], meta: { label: string }) => ({
      id: 'editor-live-target',
      label: meta.label,
      dbOffsets: freqs.map((_, i) => bands[i % bands.length] ?? 0),
    }),
  };
}

describe('CurveEditorDialog', () => {
  afterEach(() => {
    useIdealProfilesStore.setState({ editor: CLOSED_EDITOR });
    useLiveCaptureStore.setState(INITIAL_LIVE_CAPTURE_STATE, true);
  });

  it('is hidden (display:none) when the editor is closed', () => {
    useIdealProfilesStore.setState({ editor: { ...CLOSED_EDITOR, open: false } });

    const html = renderMarkup();

    expect(html).toContain('id="curve-dialog"');
    expect(html).toContain('display:none');
  });

  it('is visible (display:flex) and shows the title/name for a new curve', () => {
    useIdealProfilesStore.setState({
      editor: { ...CLOSED_EDITOR, open: true, title: 'Create Ideal Curve', name: 'Copy of Flat / neutral' },
    });

    const html = renderMarkup();

    expect(html).toContain('display:flex');
    expect(html).toContain('Create Ideal Curve');
    expect(html).toContain('value="Copy of Flat / neutral"');
  });

  it('shows the Edit title for an existing custom profile', () => {
    useIdealProfilesStore.setState({
      editor: { ...CLOSED_EDITOR, open: true, editingId: 'sanctuary-ref', title: 'Edit Ideal Curve', name: 'Sanctuary reference' },
    });

    const html = renderMarkup();

    expect(html).toContain('Edit Ideal Curve');
    expect(html).toContain('value="Sanctuary reference"');
  });

  it('renders one row per BAND_META entry, with the current bands reflected in both inputs', () => {
    useIdealProfilesStore.setState({
      editor: { ...CLOSED_EDITOR, open: true, bands: [-3, -1, 0, 2, 3, 1, -2] },
    });

    const html = renderMarkup();

    expect(html).toContain('id="curve-band-0"');
    expect(html).toContain('id="curve-band-6"');
    expect(html).toContain('value="-3"');
    expect(html).toContain('value="-3.0"');
    expect(html).toContain('aria-label="Sub Bass offset dB"');
  });

  it('disables Use current mix when canCapture is false, and Delete when canDelete is false', () => {
    useIdealProfilesStore.setState({
      editor: { ...CLOSED_EDITOR, open: true, canCapture: false, canDelete: false },
    });

    const html = renderMarkup();

    expect(html).toMatch(/id="curve-capture-btn"[^>]*disabled=""/);
    expect(html).toMatch(/id="curve-delete-btn"[^>]*disabled=""/);
  });

  it('enables Use current mix and Delete when the editor allows it', () => {
    useIdealProfilesStore.setState({
      editor: { ...CLOSED_EDITOR, open: true, canCapture: true, canDelete: true },
    });

    const html = renderMarkup();

    expect(html).not.toMatch(/id="curve-capture-btn"[^>]*disabled=""/);
    expect(html).not.toMatch(/id="curve-delete-btn"[^>]*disabled=""/);
  });

  it('shows the status text and error class when set', () => {
    useIdealProfilesStore.setState({
      editor: { ...CLOSED_EDITOR, open: true, status: { text: 'Name the curve first.', kind: 'err' } },
    });

    const html = renderMarkup();

    expect(html).toContain('Name the curve first.');
    expect(html).toContain('class="ai-status err"');
  });

  it('renders no error class when status is unset', () => {
    useIdealProfilesStore.setState({ editor: { ...CLOSED_EDITOR, open: true } });

    const html = renderMarkup();

    expect(html).toContain('class="ai-status"');
  });

  it('renders icons inline rather than via data-icon', () => {
    useIdealProfilesStore.setState({ editor: { ...CLOSED_EDITOR, open: true } });

    const html = renderMarkup();

    expect(html).not.toContain('data-icon="waveform"');
    expect(html).not.toContain('data-icon="x"');
  });

  it('shows a non-blocking live comparison degraded state when no room data is available', () => {
    useIdealProfilesStore.setState({ editor: { ...CLOSED_EDITOR, open: true } });
    useLiveCaptureStore.setState({ isCapturing: true, lastLiveChannels: null });

    const html = renderMarkup();

    expect(html).toContain('id="curve-live-compare"');
    expect(html).toContain('Waiting for live room measurements');
    expect(html).not.toContain('eq-target-svg');
  });

  it('compares live room measurements against the unsaved editor bands', () => {
    installIdealCurvesMock();
    const curve = Array.from({ length: 48 }, (_, i) => -42 + i * 0.1);
    useLiveCaptureStore.setState({
      isCapturing: true,
      measurementSource: 1,
      lastLiveChannels: [
        { rms: -50, peak: -30, bands: {}, curve: curve.map(() => -90) },
        { rms: -24, peak: -12, bands: {}, curve },
      ] as never,
    });
    useIdealProfilesStore.setState({
      editor: { ...CLOSED_EDITOR, open: true, name: 'Unsaved curve', bands: [-3, -1, 0, 2, 3, 1, -2] },
    });

    const initial = renderMarkup();
    useIdealProfilesStore.getState().setEditorBand(3, 6);
    const edited = renderMarkup();

    expect(initial).toContain('Live room vs edited target');
    expect(initial).toContain('Target · Unsaved curve');
    expect(initial).toContain('Match');
    expect(initial).toContain('data-eq-style="live-analyzer"');
    expect(initial).toContain('sb-target-line');
    expect(edited).toContain('sb-target-line');
    expect(edited).not.toBe(initial);
  });

  it('renders a 7-band live comparison without a match score when analyzer data is absent', () => {
    installIdealCurvesMock();
    useLiveCaptureStore.setState({
      isCapturing: true,
      measurementSource: null,
      lastLiveChannels: [{
        rms: -24,
        peak: -12,
        bands: { sub_bass: -45, bass: -40, low_mid: -32, mid: -24, high_mid: -28, presence: -35, brilliance: -42 },
      }] as never,
    });
    useIdealProfilesStore.setState({
      editor: { ...CLOSED_EDITOR, open: true, name: 'Band-only target', bands: [0, 0, 0, 0, 0, 0, 0] },
    });

    const html = renderMarkup();

    expect(html).toContain('data-eq-style="live-analyzer"');
    expect(html).toContain('sb-target-line');
    expect(html).toContain('7-band live meters');
    expect(html).not.toContain('Match');
  });
});

describe('editor range', () => {
  it('matches ideal-curves.js clampDb so the sliders can never clip a value the store accepts', () => {
    const curves = require('../ideal-curves.js') as { MAX_ABS_DB: number };
    expect(EDITOR_MAX_ABS_DB).toBe(curves.MAX_ABS_DB);
  });
});
