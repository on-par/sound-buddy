// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  resolveReportCardChromeSource,
  getReportCardSource,
  reportCardChromeView,
  persistSummary,
} from './report-card-chrome';
import { useAnalysisStore } from './stores/analysisStore';
import { createMockSoundBuddy } from './mock-sound-buddy';

const ANALYSIS = {
  sox: { rmsDbfs: -18, peakDbfs: -3, dynamicRangeDb: 12, clipping: false },
  spectrum: { spectralCentroid: 1200, bands: { bass: -3 } },
  ffprobe: { format: { filename: '/tmp/service.wav' } },
};

const HISTORY_SUMMARY = { gradeLetter: 'B', score: 80, sourceFilename: 'service.wav' };

let computeGrade: ReturnType<typeof vi.fn>;
let computeScore: ReturnType<typeof vi.fn>;
let analyzeRecordingType: ReturnType<typeof vi.fn>;
let computeRecommendations: ReturnType<typeof vi.fn>;
let getGradingProfile: ReturnType<typeof vi.fn>;
let mock: ReturnType<typeof createMockSoundBuddy>;

beforeEach(() => {
  computeGrade = vi.fn(() => 'A');
  computeScore = vi.fn(() => 95);
  analyzeRecordingType = vi.fn(() => ({ label: 'Full Mix' }));
  computeRecommendations = vi.fn(() => ['Tighten low end', 'Tame 3kHz', 'Watch clipping', 'Extra']);
  getGradingProfile = vi.fn(() => ({ label: 'Casual / volunteer' }));
  mock = createMockSoundBuddy();
  (globalThis as { window?: unknown }).window = {
    soundBuddy: mock.api,
    grading: { computeGrade, computeScore, analyzeRecordingType, computeRecommendations, getGradingProfile },
  };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  useAnalysisStore.setState({
    currentAnalysis: null, liveSource: null, historySummary: null,
    prevSummary: null, lastSavedSummaryFile: null,
  });
});

describe('resolveReportCardChromeSource', () => {
  it('flags a history card only when historySummary is the sole source', () => {
    expect(resolveReportCardChromeSource({ currentAnalysis: null, liveSource: null, historySummary: HISTORY_SUMMARY }))
      .toEqual({ isHistoryCard: true, chromeSource: null });
  });

  it('prefers currentAnalysis, converting it to a ReportCardSource', () => {
    const { isHistoryCard, chromeSource } = resolveReportCardChromeSource({
      currentAnalysis: ANALYSIS, liveSource: null, historySummary: HISTORY_SUMMARY,
    });
    expect(isHistoryCard).toBe(false);
    expect(chromeSource).toMatchObject({ filename: 'service.wav', rms: -18 });
  });

  it('falls back to liveSource when there is no currentAnalysis', () => {
    const liveSource = { filename: 'Live capture' };
    expect(resolveReportCardChromeSource({ currentAnalysis: null, liveSource, historySummary: null }))
      .toEqual({ isHistoryCard: false, chromeSource: liveSource });
  });

  it('is neither a history card nor has a chrome source when everything is empty', () => {
    expect(resolveReportCardChromeSource({ currentAnalysis: null, liveSource: null, historySummary: null }))
      .toEqual({ isHistoryCard: false, chromeSource: null });
  });
});

describe('getReportCardSource', () => {
  it('converts a currentAnalysis into a ReportCardSource', () => {
    expect(getReportCardSource(ANALYSIS, null)).toMatchObject({ filename: 'service.wav' });
  });

  it('returns liveSource verbatim with no currentAnalysis', () => {
    const liveSource = { filename: 'Live capture' };
    expect(getReportCardSource(null, liveSource)).toBe(liveSource);
  });
});

describe('reportCardChromeView', () => {
  it('history card: grade comes from the stored summary, Load is visible, Clear disabled', () => {
    const view = reportCardChromeView({
      currentAnalysis: null, liveSource: null, historySummary: HISTORY_SUMMARY, status: 'idle',
    });
    expect(view).toMatchObject({
      isHistoryCard: true, isLiveCard: false, hasCard: true, lastReportGrade: 'B',
      printDisabled: false, shareDisabled: false, gradeOwnDisabled: false,
      loadDisabled: false, loadVisible: false, clearDisabled: true,
    });
  });

  it('live card: Load is visible, grade computed from the live source, Clear disabled (no file)', () => {
    const liveSource = { filename: 'Live capture' };
    const view = reportCardChromeView({ currentAnalysis: null, liveSource, historySummary: null, status: 'idle' });
    expect(computeGrade).toHaveBeenCalledWith(liveSource);
    expect(view).toMatchObject({ isLiveCard: true, hasCard: true, lastReportGrade: 'A', loadVisible: true, clearDisabled: true });
  });

  it('file card: Load hidden, Clear enabled once idle', () => {
    const view = reportCardChromeView({ currentAnalysis: ANALYSIS, liveSource: null, historySummary: null, status: 'done' });
    expect(view).toMatchObject({ hasCard: true, lastReportGrade: 'A', loadVisible: false, clearDisabled: false });
  });

  it('no card: every action disabled/hidden, grade null', () => {
    const view = reportCardChromeView({ currentAnalysis: null, liveSource: null, historySummary: null, status: 'idle' });
    expect(view).toMatchObject({
      hasCard: false, lastReportGrade: null,
      printDisabled: true, shareDisabled: true, gradeOwnDisabled: true, clearDisabled: true,
    });
  });

  it('disables Load/Clear while analyzing regardless of card state', () => {
    const view = reportCardChromeView({ currentAnalysis: ANALYSIS, liveSource: null, historySummary: null, status: 'analyzing' });
    expect(view.loadDisabled).toBe(true);
    expect(view.clearDisabled).toBe(true);
  });
});

describe('persistSummary', () => {
  it('no-ops for a falsy source', () => {
    const spy = vi.spyOn(mock.api, 'listAnalysisSummaries');
    persistSummary(null, 'file');
    expect(spy).not.toHaveBeenCalled();
  });

  it('saves a summary built from the source and grading, tagged with its source', async () => {
    mock.api.saveAnalysisSummary = vi.fn().mockResolvedValue({ success: true, file: 'abc.json' });
    mock.api.listAnalysisSummaries = vi.fn().mockResolvedValue({ success: true, summaries: [] });

    persistSummary(getReportCardSource(ANALYSIS, null), 'file');
    await vi.waitFor(() => expect(useAnalysisStore.getState().lastSavedSummaryFile).toBe('abc.json'));

    expect(mock.api.saveAnalysisSummary).toHaveBeenCalledWith(expect.objectContaining({
      sourceFilename: 'service.wav', gradeLetter: 'A', score: 95, source: 'file',
      topFixes: ['Tighten low end', 'Tame 3kHz', 'Watch clipping'],
    }));
  });

  it('sets prevSummary from the newest existing entry before saving', async () => {
    const prev = { gradeLetter: 'C', sourceFilename: 'last-week.wav' };
    mock.api.listAnalysisSummaries = vi.fn().mockResolvedValue({ success: true, summaries: [prev] });
    mock.api.saveAnalysisSummary = vi.fn().mockResolvedValue({ success: true, file: 'x.json' });

    persistSummary(getReportCardSource(ANALYSIS, null), 'live');
    await vi.waitFor(() => expect(useAnalysisStore.getState().prevSummary).toEqual(prev));
  });

  it('a superseded (older) call never stomps prevSummary/lastSavedSummaryFile once a newer call has resolved', async () => {
    // Generation 1's listAnalysisSummaries stalls, so generation 2 races
    // ahead and finishes its whole chain (list -> save) first — it's the one
    // that actually reaches saveAnalysisSummary first, so it gets the first
    // queued response. When generation 1 finally unstalls and reaches
    // saveAnalysisSummary itself (the second queued response), its result
    // must be discarded — it's no longer the newest generation.
    let resolveFirst!: (v: { success: boolean; summaries: unknown[] }) => void;
    mock.api.listAnalysisSummaries = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ success: true, summaries: [{ gradeLetter: 'D', sourceFilename: 'second.wav' }] });
    mock.api.saveAnalysisSummary = vi.fn()
      .mockResolvedValueOnce({ success: true, file: 'gen2.json' })
      .mockResolvedValueOnce({ success: true, file: 'gen1-stale.json' });

    persistSummary(getReportCardSource(ANALYSIS, null), 'file'); // generation 1 (stalls on listAnalysisSummaries)
    persistSummary(getReportCardSource(ANALYSIS, null), 'file'); // generation 2 (resolves fully first)

    await vi.waitFor(() => expect(useAnalysisStore.getState().lastSavedSummaryFile).toBe('gen2.json'));
    expect(useAnalysisStore.getState().prevSummary).toEqual({ gradeLetter: 'D', sourceFilename: 'second.wav' });

    resolveFirst({ success: true, summaries: [] }); // generation 1 finally resolves — must not overwrite gen 2's state
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(useAnalysisStore.getState().lastSavedSummaryFile).toBe('gen2.json');
    expect(useAnalysisStore.getState().prevSummary).toEqual({ gradeLetter: 'D', sourceFilename: 'second.wav' });
  });

  it('swallows a listAnalysisSummaries rejection and clears prevSummary', async () => {
    mock.api.listAnalysisSummaries = vi.fn().mockRejectedValue(new Error('disk error'));
    mock.api.saveAnalysisSummary = vi.fn().mockResolvedValue({ success: true, file: 'x.json' });
    useAnalysisStore.setState({ prevSummary: { gradeLetter: 'Z', sourceFilename: 'stale.wav' } });

    persistSummary(getReportCardSource(ANALYSIS, null), 'file');
    await vi.waitFor(() => expect(useAnalysisStore.getState().prevSummary).toBeNull());
  });

  it('swallows a saveAnalysisSummary rejection without throwing', async () => {
    mock.api.listAnalysisSummaries = vi.fn().mockResolvedValue({ success: true, summaries: [] });
    mock.api.saveAnalysisSummary = vi.fn().mockRejectedValue(new Error('write failed'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    persistSummary(getReportCardSource(ANALYSIS, null), 'file');
    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalledWith('persistSummary failed', expect.any(Error)));
    warnSpy.mockRestore();
  });

  it('a failed save (success:false) leaves lastSavedSummaryFile null', async () => {
    mock.api.listAnalysisSummaries = vi.fn().mockResolvedValue({ success: true, summaries: [] });
    mock.api.saveAnalysisSummary = vi.fn().mockResolvedValue({ success: false });
    useAnalysisStore.setState({ lastSavedSummaryFile: 'stale.json' });

    persistSummary(getReportCardSource(ANALYSIS, null), 'file');
    await vi.waitFor(() => expect(useAnalysisStore.getState().lastSavedSummaryFile).toBeNull());
  });

  it('catches a synchronous throw building the summary (missing grading module)', () => {
    (globalThis as { window: { grading?: unknown } }).window.grading = undefined;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => persistSummary(getReportCardSource(ANALYSIS, null), 'file')).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith('persistSummary failed', expect.any(Error));
    warnSpy.mockRestore();
  });
});
