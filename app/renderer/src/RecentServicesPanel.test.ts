// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import RecentServicesPanel, { RecentServicesList, loadHistoryEntry, exportTrendPdf } from './RecentServicesPanel';
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
  return { style: { display: '' } as Record<string, string>, textContent: '', innerHTML: '', classList: makeClassList() };
}

let elements: Record<string, ReturnType<typeof makeFakeElement>>;
let liveIsRunning: ReturnType<typeof vi.fn>;
let fakeBody: { classList: ReturnType<typeof makeClassList> };
let printSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  elements = {
    'rc-offer': makeFakeElement(),
    'rc-not-enough': makeFakeElement(),
    'reportcard-view': makeFakeElement(),
    'spectrum-title': makeFakeElement(),
    'live-eq-pane': makeFakeElement(),
    'trend-report': makeFakeElement(),
  };
  liveIsRunning = vi.fn(() => false);
  fakeBody = { classList: makeClassList() };
  (globalThis as { document?: unknown }).document = {
    getElementById: (id: string) => elements[id] ?? null,
    querySelectorAll: () => [],
    body: fakeBody,
  };
  printSpy = vi.fn();
  (globalThis as { window?: unknown }).window = {
    liveCapture: { isRunning: liveIsRunning },
    soundBuddy: createMockSoundBuddy().api,
    singleColumnState: { isSingleColumn: () => false },
    reportFirstUxState: { isEnabled: () => false },
    print: printSpy,
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

  it('disables the trend export button and shows a 1-more hint with exactly 1 summary', () => {
    const html = renderList([SUMMARY_A]);
    expect(html).toMatch(/id="recent-trend-export-btn"[^>]*disabled=""/);
    expect(html).toContain('id="trend-export-hint"');
    expect(html).toContain('analyze one more');
  });

  it('disables the trend export button and shows a 2-more hint with zero summaries', () => {
    const html = renderList([]);
    expect(html).toMatch(/id="recent-trend-export-btn"[^>]*disabled=""/);
    expect(html).toContain('id="trend-export-hint"');
    expect(html).not.toContain('analyze one more');
    expect(html).toContain('analyze 2 services');
  });

  it('enables the trend export button and hides the hint with 2+ summaries', () => {
    const html = renderList([SUMMARY_A, SUMMARY_B]);
    expect(html).toMatch(/id="recent-trend-export-btn"(?![^>]*disabled)[^>]*>/);
    expect(html).not.toContain('id="trend-export-hint"');
  });
});

describe('exportTrendPdf', () => {
  it('writes the trend table into #trend-report and toggles print-trend around window.print()', () => {
    printSpy.mockImplementation(() => {
      expect(fakeBody.classList.contains('print-trend')).toBe(true);
    });
    exportTrendPdf([SUMMARY_A, SUMMARY_B]);
    expect(elements['trend-report'].innerHTML).toContain('<table');
    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(fakeBody.classList.contains('print-trend')).toBe(false);
  });

  it('still writes the "not enough history" message and prints without crashing with fewer than 2 summaries', () => {
    exportTrendPdf([SUMMARY_A]);
    expect(elements['trend-report'].innerHTML).toContain('Not enough history yet');
    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it('does nothing when #trend-report is missing from the DOM', () => {
    delete elements['trend-report'];
    expect(() => exportTrendPdf([SUMMARY_A, SUMMARY_B])).not.toThrow();
    expect(printSpy).not.toHaveBeenCalled();
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

