// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import CurveEditorDialog from './CurveEditorDialog';
import { useIdealProfilesStore } from './stores/idealProfilesStore';

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

describe('CurveEditorDialog', () => {
  afterEach(() => {
    useIdealProfilesStore.setState({ editor: CLOSED_EDITOR });
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

  it('disables Use current analysis when canCapture is false, and Delete when canDelete is false', () => {
    useIdealProfilesStore.setState({
      editor: { ...CLOSED_EDITOR, open: true, canCapture: false, canDelete: false },
    });

    const html = renderMarkup();

    expect(html).toMatch(/id="curve-capture-btn"[^>]*disabled=""/);
    expect(html).toMatch(/id="curve-delete-btn"[^>]*disabled=""/);
  });

  it('enables Use current analysis and Delete when the editor allows it', () => {
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
});
