// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import DirectoryPanel from './DirectoryPanel';
import { useDirectoryStore, type BatchRow } from './stores/directoryStore';

// The row HTML comes from window.batchAnalysis (a real classic script) —
// same convention as the other classic-script requires in this suite.
const batchAnalysis = require('../batch-analysis.js');

beforeEach(() => {
  (globalThis as { window?: unknown }).window = { batchAnalysis };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  useDirectoryStore.setState({
    path: '', files: [], rows: [], progress: '', emptyMessage: '', running: false,
  });
});

function renderMarkup(): string {
  return renderToString(createElement(DirectoryPanel));
}

describe('DirectoryPanel (TD-001 slice 6h, #711)', () => {
  it('renders the initial state: choose enabled, analyze disabled, empty results', () => {
    const html = renderMarkup();
    expect(html).toContain('id="dir-choose-btn"');
    expect(html).toContain('id="dir-analyze-btn"');
    expect(html).toMatch(/id="dir-analyze-btn"[^>]*disabled/);
    expect(html).toContain('id="dir-path"');
    expect(html).toContain('id="dir-progress"');
    expect(html).toContain('id="dir-results"');
    expect(html).toContain('id="dir-empty"');
    // Before the first folder choice the empty state stays hidden (path '').
    expect(html).toMatch(/id="dir-empty"[^>]*display:none/);
  });

  it('renders the populated state: path, progress, and one row per batch result', () => {
    useDirectoryStore.setState({
      path: '/tapes',
      files: ['/tapes/01.wav'],
      progress: 'Analyzed 1 of 1',
      rows: [{ filePath: '/tapes/01.wav', filename: '01.wav', status: 'ok', gradeLetter: 'A' } as BatchRow],
      emptyMessage: 'No audio files in that folder — pick a folder containing your service recordings.',
    });
    const html = renderMarkup();
    expect(html).toContain('/tapes');
    expect(html).toContain('Analyzed 1 of 1');
    expect(html).toContain('01.wav');
    expect(html).toContain('recent-grade');
    expect(html).toContain('>A</span>');
    expect(html).not.toMatch(/id="dir-analyze-btn"[^>]*disabled/);
  });

  it('shows the empty message once a folder with no audio files is chosen', () => {
    useDirectoryStore.setState({
      path: '/tapes',
      files: [],
      emptyMessage: 'No audio files in that folder — pick a folder containing your service recordings.',
    });
    const html = renderMarkup();
    expect(html).toMatch(/id="dir-empty"[^>]*display:block/);
    expect(html).toContain('No audio files in that folder');
  });

  it('disables both buttons while a batch is running', () => {
    useDirectoryStore.setState({ path: '/tapes', files: ['/tapes/01.wav'], running: true });
    const html = renderMarkup();
    expect(html).toMatch(/id="dir-choose-btn"[^>]*disabled/);
    expect(html).toMatch(/id="dir-analyze-btn"[^>]*disabled/);
  });
});
