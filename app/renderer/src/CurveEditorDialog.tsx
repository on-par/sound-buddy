// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The #curve-dialog ideal-curve editor, portaled onto #curve-editor-island
// (TD-001 slice 6b, #700) — replaces inline-app.js's openCurveEditor/
// closeCurveEditor/renderCurveEditorRows/saveCurveEditor/
// captureCurrentCurveAsIdeal/deleteCurveEditor and the curve-dialog wiring
// IIFE. Markup is copied verbatim from the old static index.html (every id
// preserved) so report-card-grading.spec.ts's curve-editor flow keeps
// driving the same selectors. Icons render inline (dangerouslySetInnerHTML)
// rather than via `data-icon` — see IdealProfileSelect.tsx's note.

import { useEffect } from 'react';
import { iconSvg } from './report-card';
import { useStoreShallow } from './stores/useStoreShallow';
import { useIdealProfilesStore, type CurveEditorState } from './stores/idealProfilesStore';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import {
  liveAnalyzerCurve,
  liveBandCurve,
  measurementChannel,
  type LiveMeterChannel,
} from './live-capture-panel';
import {
  analyzerStyleHTML,
  bandCurveFromDb,
  BAND_META,
  liveCurveComparisonModel,
  type IdealProfileLike,
  type SpectrumCurve,
} from './spectrum-display';
import type { IdealCurvesApi } from './ideal-profiles';

function getIdealCurves(): Pick<IdealCurvesApi, 'profileFromBands'> | null {
  if (typeof window === 'undefined') return null;
  const curves = (window as unknown as { idealCurves?: Pick<IdealCurvesApi, 'profileFromBands'> }).idealCurves;
  return typeof curves?.profileFromBands === 'function' ? curves : null;
}

function hasFiniteLiveBand(ch: LiveMeterChannel): boolean {
  return Object.values(ch.bands ?? {}).some((v) => Number.isFinite(v));
}

function curveFromRoomChannel(ch: LiveMeterChannel | null): SpectrumCurve | null {
  if (!ch) return null;
  return liveAnalyzerCurve(ch) ?? (hasFiniteLiveBand(ch) ? liveBandCurve(ch.bands) : null);
}

function CurveEditorLiveComparison({ editor }: { editor: CurveEditorState }) {
  const { isCapturing, lastLiveChannels, measurementSource } = useStoreShallow(useLiveCaptureStore, (s) => ({
    isCapturing: s.isCapturing,
    lastLiveChannels: s.lastLiveChannels,
    measurementSource: s.measurementSource,
  }));
  const room = isCapturing ? measurementChannel(lastLiveChannels ?? undefined, measurementSource) : null;
  const curve = curveFromRoomChannel(room);
  const curves = curve ? getIdealCurves() : null;
  const targetProfile: IdealProfileLike | null = curve && curves
    ? curves.profileFromBands(editor.bands, curve.freqs, {
      id: 'curve-editor-live-target',
      label: editor.name.trim() || 'Edited target',
      description: 'Unsaved curve editor target',
    })
    : null;
  const model = curve && targetProfile ? liveCurveComparisonModel({ curve, targetProfile }) : null;
  const message = isCapturing
    ? 'Waiting for live room measurements.'
    : 'Start live monitoring to compare this curve against the room.';

  return (
    <div className={'curve-live-compare' + (model ? '' : ' muted')} id="curve-live-compare">
      <div className="curve-live-head">
        <span className="curve-live-title">Live room vs edited target</span>
        <span className="curve-live-state">{model ? (model.kind === 'curve' ? 'Analyzer' : '7-band') : 'No live data'}</span>
      </div>
      {model ? (
        <>
          <div className="curve-live-chart" dangerouslySetInnerHTML={{ __html: model.chartHTML }} />
          <div dangerouslySetInnerHTML={{ __html: model.legendHTML }} />
          {model.note ? <div className="curve-live-note">{model.note}</div> : null}
        </>
      ) : (
        <div className="curve-live-empty">{message}</div>
      )}
    </div>
  );
}
export default function CurveEditorDialog() {
  const { editor } = useStoreShallow(useIdealProfilesStore, (s) => ({ editor: s.editor }));
  const previewDb = editor.bands.map((db) => -36 + (Number.isFinite(db) ? db : 0));
  const previewHTML = analyzerStyleHTML({
    curve: bandCurveFromDb(previewDb),
    bandDb: previewDb,
    targetDb: BAND_META.map(() => -36),
    compact: true,
    uid: 'curve-editor',
    className: 'sb-analyzer-curve-editor',
  });

  /* c8 ignore start -- document-level Escape close + name-field autofocus, same
     pattern as SettingsPanel.tsx; no jsdom in this harness to exercise DOM
     effects — covered by report-card-grading.spec.ts's curve-editor flow. */
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && useIdealProfilesStore.getState().editor.open) {
        useIdealProfilesStore.getState().closeEditor();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!editor.open) return;
    const input = document.getElementById('curve-name') as HTMLInputElement | null;
    input?.focus();
    input?.select();
  }, [editor.open]);
  /* c8 ignore stop */

  return (
    <div
      id="curve-dialog"
      className="rig-dialog"
      style={{ display: editor.open ? 'flex' : 'none' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="curve-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) useIdealProfilesStore.getState().closeEditor();
      }}
    >
      <div className="rig-dialog-card curve-dialog-card">
        <div className="rig-dialog-title" id="curve-dialog-title">{editor.title}</div>
        <div className="ai-dialog-sub">Shape the target Sound Buddy compares this file against. Values are relative dB offsets, not loudness.</div>
        <label className="ai-field">
          <span className="ai-field-label">Name</span>
          <input
            type="text"
            id="curve-name"
            className="rig-dialog-input"
            placeholder="Sunday morning target"
            autoComplete="off"
            spellCheck={false}
            maxLength={60}
            value={editor.name}
            onChange={(e) => useIdealProfilesStore.getState().setEditorName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void useIdealProfilesStore.getState().save();
            }}
          />
        </label>
        <div
          className="curve-editor-preview"
          id="curve-editor-preview"
          dangerouslySetInnerHTML={{ __html: previewHTML }}
        />
        <div className="curve-editor-grid" id="curve-editor-grid">
          {BAND_META.map((b, i) => (
            <div className="curve-row" key={b.key}>
              <label htmlFor={`curve-band-${i}`}>{b.label}</label>
              <input
                id={`curve-band-${i}`}
                className="sb-slider curve-band-range"
                data-i={i}
                type="range"
                min={-12}
                max={12}
                step={0.5}
                value={editor.bands[i] ?? 0}
                onChange={(e) => useIdealProfilesStore.getState().setEditorBand(i, Number(e.target.value))}
              />
              <input
                className="curve-band-num"
                data-i={i}
                type="number"
                min={-12}
                max={12}
                step={0.5}
                aria-label={`${b.label} offset dB`}
                value={(editor.bands[i] ?? 0).toFixed(1)}
                onChange={(e) => useIdealProfilesStore.getState().setEditorBand(i, Number(e.target.value))}
              />
            </div>
          ))}
        </div>
        {editor.open ? <CurveEditorLiveComparison editor={editor} /> : null}
        <div className="ai-test-row">
          <button
            type="button"
            id="curve-capture-btn"
            className="btn btn-secondary sm"
            disabled={!editor.canCapture}
            onClick={() => void useIdealProfilesStore.getState().capture()}
          >
            <span dangerouslySetInnerHTML={{ __html: iconSvg('waveform', 16) }} />
            Use current analysis
          </button>
          <span className={'ai-status' + (editor.status.kind ? ` ${editor.status.kind}` : '')} id="curve-status" role="status">
            {editor.status.text}
          </span>
        </div>
        <div className="curve-dialog-actions">
          <button
            type="button"
            id="curve-delete-btn"
            className="btn btn-secondary sm"
            disabled={!editor.canDelete}
            onClick={() => void useIdealProfilesStore.getState().remove()}
          >
            <span dangerouslySetInnerHTML={{ __html: iconSvg('x', 16) }} />
            Delete
          </button>
          <div className="right">
            <button type="button" id="curve-reset-btn" className="btn btn-secondary sm" onClick={() => useIdealProfilesStore.getState().resetFlat()}>
              Reset flat
            </button>
            <button type="button" id="curve-cancel-btn" className="btn btn-secondary sm" onClick={() => useIdealProfilesStore.getState().closeEditor()}>
              Cancel
            </button>
            <button type="button" id="curve-save-btn" className="btn btn-primary sm" onClick={() => void useIdealProfilesStore.getState().save()}>
              Save curve
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
