// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import AnalyzeRecordControl from './AnalyzeRecordControl';
import { useAnalyzeRecordStore } from './stores/analyzeRecordStore';
import { useAnalyzeEntryStore } from './stores/analyzeEntryStore';

const INITIAL_RECORD_STATE = useAnalyzeRecordStore.getInitialState();

afterEach(() => {
  useAnalyzeRecordStore.setState({
    phase: INITIAL_RECORD_STATE.phase,
    startedAt: INITIAL_RECORD_STATE.startedAt,
    channel: INITIAL_RECORD_STATE.channel,
    lastSessionDir: INITIAL_RECORD_STATE.lastSessionDir,
    error: INITIAL_RECORD_STATE.error,
  });
  useAnalyzeEntryStore.setState({ listening: false, listenChannel: 0 });
});

function renderMarkup(): string {
  return renderToString(createElement(AnalyzeRecordControl));
}

describe('AnalyzeRecordControl (#1636)', () => {
  it('renders nothing when not listening, idle, and no finished recording', () => {
    useAnalyzeEntryStore.setState({ listening: false });
    useAnalyzeRecordStore.setState({ phase: 'idle', lastSessionDir: null });

    expect(renderMarkup()).toBe('');
  });

  it('renders an enabled Record button while listening', () => {
    useAnalyzeEntryStore.setState({ listening: true });
    useAnalyzeRecordStore.setState({ phase: 'idle' });

    const html = renderMarkup();

    expect(html).toContain('id="analyze-record"');
    expect(html).toContain('Record');
    expect(html).not.toMatch(/id="analyze-record"[^>]*disabled=""/);
    expect(html).toContain('aria-pressed="false"');
  });

  it('shows Stop recording, aria-pressed=true, and an elapsed status while recording', () => {
    useAnalyzeEntryStore.setState({ listening: true });
    useAnalyzeRecordStore.setState({ phase: 'recording', startedAt: Date.now() - 2000 });

    const html = renderMarkup();

    expect(html).toContain('id="analyze-record"');
    expect(html).toContain('Stop recording');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('id="analyze-record-status"');
    expect(html).toMatch(/Recording · 0:0/);
  });

  it('stays reachable (not hidden) while recording even if listening has gone false', () => {
    useAnalyzeEntryStore.setState({ listening: false });
    useAnalyzeRecordStore.setState({ phase: 'recording', startedAt: Date.now() });

    expect(renderMarkup()).toContain('id="analyze-record"');
  });

  it('shows a Show in Finder button and the saved path after a finished recording', () => {
    useAnalyzeEntryStore.setState({ listening: true });
    useAnalyzeRecordStore.setState({ phase: 'idle', lastSessionDir: '/Users/x/Music/Sound Buddy/sound-buddy-123' });

    const html = renderMarkup();

    expect(html).toContain('id="analyze-record-reveal"');
    expect(html).toContain('Show in Finder');
    expect(html).toContain('/Users/x/Music/Sound Buddy/sound-buddy-123');
  });

  it('renders an error alert when the store has an error', () => {
    useAnalyzeEntryStore.setState({ listening: true });
    useAnalyzeRecordStore.setState({ phase: 'idle', error: 'Room mic not found — reconnect it or pick it in Settings ▸ Audio, then press Record.' });

    const html = renderMarkup();

    expect(html).toContain('role="alert"');
    expect(html).toContain('Room mic not found');
  });
});
