// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The spectrum-header stats row (RMS/Peak/DR/Clip/Centroid), portaled onto
// #stats-row by App.tsx (slice 6g, #710), replacing ReportCardToolbar's
// window.updateStatsRow call + inline-app.js's updateLiveStatsRow/setStat.
// Renders the same .stat cell structure root-markup.html used to carry
// statically (that static markup is now empty — React owns the cells).
// File mode (panelState 'populated') renders fileStatsRowView values from
// analysisStore; live mode renders liveStatsRowView(roomChannel) from a
// lastTick/lastMeasurementChannels snapshot. Per-tick live numbers are
// patched at meter cadence by live-board.ts's patchStatsRow (ADR-0005), so
// this component only re-renders on the discrete fields it subscribes to.
// Visibility: file mode follows spectrumChromeView.showStats (SpectrumPanel's
// existing effect owns #stats-row display there); live mode is 'flex' while
// the meter board is showing, else 'none'.

import { useLayoutEffect, type JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useSpectrumStore } from './stores/spectrumStore';
import { useAnalysisStore } from './stores/analysisStore';
import { measurementChannel } from './live-capture-panel';
import { fileStatsRowView, liveStatsRowView, liveBoardShowing, liveBoardState, type LiveStatsRowView } from './live-board';

function statCell(
  label: string,
  id: string,
  unit: string | undefined,
  value: { text: string; tone: string } | string | undefined,
): JSX.Element {
  const num = typeof value === 'string' ? value : (value?.text ?? '—');
  const tone = typeof value === 'string' ? '' : (value?.tone ?? '');
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-val">
        <span className={'stat-num' + (tone ? ' ' + tone : '')} id={id}>{num}</span>
        {unit ? <span className="stat-unit">{unit}</span> : null}
      </span>
    </div>
  );
}

const DEFAULT_VIEW: LiveStatsRowView = {
  rms: { text: '—', tone: '' },
  peak: { text: '—', tone: '' },
  dr: { text: '—', tone: '' },
  clip: { text: '—', tone: '' },
  centroid: '—',
};

export default function LiveStatsRow(): JSX.Element {
  const panelState = useStoreShallow(useSpectrumStore, (s) => s.panelState);
  const { appMode, isCapturing, hasTick } = useStoreShallow(useLiveCaptureStore, (s) => ({
    appMode: s.appMode,
    isCapturing: s.isCapturing,
    hasTick: s.lastTick !== null,
  }));

  let view: LiveStatsRowView | null = null;
  if (panelState === 'populated') {
    const analysis = useAnalysisStore.getState().currentAnalysis;
    if (analysis && analysis.sox) view = fileStatsRowView(analysis.sox, analysis.spectrum);
  } else if (appMode === 'live') {
    const s = useLiveCaptureStore.getState();
    const secondaryActive = s.secondaryMeasurement.status === 'active' && s.secondaryWindows.length > 0;
    const ch = secondaryActive
      ? measurementChannel(s.lastMeasurementChannels ?? undefined, 0)
      : measurementChannel(s.lastTick?.channels ?? undefined, s.measurementSource);
    if (ch) view = liveStatsRowView(ch);
  }

  // Live-mode visibility: 'flex' while the meter board is showing, else
  // 'none'; also hide the ideal-profile wrap (no whole-file curve in live
  // mode). File mode leaves #stats-row/#ideal-profile-wrap to SpectrumPanel's
  // chrome effect. Reading liveBoardState() at effect time (rather than
  // subscribing to settings) lets a DAW/adjustments toggle flip, which
  // re-runs applySpectrumForMode -> panelState 'meters', take effect here too.
  /* c8 ignore start -- DOM effect wiring, no jsdom in this harness
     (renderToString doesn't run effects); exercised by
     tests/e2e/live-capture.spec.ts. */
  useLayoutEffect(() => {
    if (appMode !== 'live') return;
    const row = document.getElementById('stats-row');
    if (row) row.style.display = liveBoardShowing(liveBoardState()) ? 'flex' : 'none';
    const ipWrap = document.getElementById('ideal-profile-wrap');
    if (ipWrap) ipWrap.style.display = 'none';
  }, [appMode, isCapturing, hasTick, panelState]);
  /* c8 ignore stop */

  const v = view ?? DEFAULT_VIEW;
  return (
    <>
      {statCell('RMS', 'stat-rms', 'dBFS', v.rms)}
      {statCell('Peak', 'stat-peak', 'dBFS', v.peak)}
      {statCell('DR', 'stat-dr', 'dB', v.dr)}
      {statCell('Clip', 'stat-clip', undefined, v.clip)}
      {statCell('Centroid', 'stat-centroid', 'Hz', v.centroid)}
    </>
  );
}
