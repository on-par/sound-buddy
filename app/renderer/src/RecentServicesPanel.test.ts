// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import RecentServicesPanel, { RecentServicesList, loadHistoryEntry } from './RecentServicesPanel';
import { useAnalysisStore } from './stores/analysisStore';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { spectrumTransport } from './spectrum-transport';
import { createMockSoundBuddy } from './mock-sound-buddy';
import type { AnalysisSummary } from '../../electron/ipc/api';

const SUMMARY_A: AnalysisSummary = {
  date: '2026-08-01T12:00:00Z', sourceFilename: 'sunday.wav', gradeLetter: 'A', score: 95,
  recordingType: 'Full Mix', topFixes: [],
};
const SUMMARY_B: AnalysisSummary = {
  date: '2026-07-25T12:00:00Z', sourceFilename: 'live-session', gradeLetter: 'C', score: 70,
  recordingType: 'Live Capture', topFixes: [], source: 'live', note: 'check bass',
};

function renderMarkup(): string {
  return renderToString(createElement(RecentServicesPanel));
}

function renderList(summaries: AnalysisSummary[]): string {
  return renderToString(createElement(RecentServicesList, { summaries }));
}

function makeClassList() {
  const classes = new Set<string>();
  return {
    add: (c: string) => { classes.add(c); },
    remove: (c: string) => { classes.delete(c); },
    toggle: (c: string, force?: boolean) => {
      const on = force === undefined ? !classes.has(c) : force;
      if (on) classes.add(c); else classes.delete(c);
      return on;
    },
    contains: (c: string) => classes.has(c),
  };
}
function makeFakeElement() {
  return { style: { display: '' } as Record<string, string>, textContent: '', classList: makeClassList() };
}

let elements: Record<string, ReturnType<typeof makeFakeElement>>;
let liveIsRunning: ReturnType<typeof vi.fn>;

beforeEach(() => {
  elements = {
    'rc-offer': makeFakeElement(),
    'rc-not-enough': makeFakeElement(),
    'reportcard-view': makeFakeElement(),
    'spectrum-title': makeFakeElement(),
    'live-eq-pane': makeFakeElement(),
  };
  liveIsRunning = vi.fn(() => false);
  (globalThis as { document?: unknown }).document = {
    getElementById: (id: string) => elements[id] ?? null,
    querySelectorAll: () => [],
    body: { classList: makeClassList() },
  };
  (globalThis as { window?: unknown }).window = {
    liveCapture: { isRunning: liveIsRunning },
    soundBuddy: createMockSoundBuddy().api,
    singleColumnState: { isSingleColumn: () => false },
    reportFirstUxState: { isEnabled: () => false },
  };
});

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
  delete (globalThis as { window?: unknown }).window;
  vi.restoreAllMocks();
  useLiveCaptureStore.setState({ appMode: 'reportcard' });
  useAnalysisStore.setState({
    currentAnalysis: null, liveSource: null, historySummary: null, prevSummary: null, status: 'idle',
  });
});

describe('RecentServicesPanel rendering', () => {
  it('shows the empty hint with no fetch triggered (renderToString never fires effects)', () => {
    const html = renderMarkup();
    expect(html).toContain('No analyses yet');
    expect(html).toMatch(/id="recent-empty"[^>]*style="display:block"/);
  });
});

describe('RecentServicesList', () => {
  it('shows the empty hint with no summaries', () => {
    const html = renderList([]);
    expect(html).toContain('No analyses yet');
    expect(html).toMatch(/id="recent-empty"[^>]*style="display:block"/);
  });

  it('renders a row per summary and hides the empty hint', () => {
    const html = renderList([SUMMARY_A, SUMMARY_B]);
    expect(html).toContain('sunday.wav');
    expect(html).toContain('live-session');
    expect(html).toMatch(/id="recent-empty"[^>]*style="display:none"/);
  });

  it('shows the grade letter colored by a sanitized CSS custom-property name', () => {
    const html = renderList([SUMMARY_A]);
    expect(html).toContain('style="color:var(--grade-a)"');
    expect(html).toContain('>A</span>');
  });

  it('badges a live-capture source but not a file source', () => {
    const html = renderList([SUMMARY_A, SUMMARY_B]);
    const liveRow = html.slice(html.indexOf('live-session') - 300, html.indexOf('live-session'));
    expect(liveRow).toContain('recent-source-live');
    const fileRow = html.slice(0, html.indexOf('sunday.wav'));
    expect(fileRow).not.toContain('recent-source-live');
  });

  it('renders the handoff note only when present', () => {
    const html = renderList([SUMMARY_A, SUMMARY_B]);
    expect(html).toContain('recent-note');
    expect(html).toContain('check bass');
  });
});

describe('loadHistoryEntry', () => {
  it('freezes the summary onto the report card and clears any current analysis', () => {
    const pauseSpy = vi.spyOn(spectrumTransport, 'pauseIfPlaying');
    loadHistoryEntry(SUMMARY_A, null);
    expect(pauseSpy).toHaveBeenCalled();
    expect(useAnalysisStore.getState().historySummary).toEqual(SUMMARY_A);
    expect(useAnalysisStore.getState().currentAnalysis).toBeNull();
  });

  it('sets prevSummary only when one is passed (the newest history entry)', () => {
    loadHistoryEntry(SUMMARY_A, SUMMARY_B);
    expect(useAnalysisStore.getState().prevSummary).toEqual(SUMMARY_B);
  });

  it('defaults prevSummary to null with none passed', () => {
    loadHistoryEntry(SUMMARY_A, null);
    expect(useAnalysisStore.getState().prevSummary).toBeNull();
  });

  it('clears live windows and hides the rc-offer/rc-not-enough rows when no capture is running', () => {
    useLiveCaptureStore.setState({ liveWindows: [{ type: 'window', window: 1, ts: 0, masking: [], channels: [] }] });
    loadHistoryEntry(SUMMARY_A, null);
    expect(useLiveCaptureStore.getState().liveWindows).toEqual([]);
    expect(elements['rc-offer'].style.display).toBe('none');
    expect(elements['rc-not-enough'].style.display).toBe('none');
  });

  it('leaves an actively-running capture session untouched', () => {
    liveIsRunning.mockReturnValue(true);
    useLiveCaptureStore.setState({ liveWindows: [{ type: 'window', window: 1, ts: 0, masking: [], channels: [] }] });
    loadHistoryEntry(SUMMARY_A, null);
    expect(useLiveCaptureStore.getState().liveWindows).toHaveLength(1);
    expect(elements['rc-offer'].style.display).toBe('');
  });

  it('switches to the report card tab', () => {
    loadHistoryEntry(SUMMARY_A, null);
    expect(useLiveCaptureStore.getState().appMode).toBe('reportcard');
  });
});

