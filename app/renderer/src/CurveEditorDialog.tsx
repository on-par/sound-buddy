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
import { useIdealProfilesStore } from './stores/idealProfilesStore';
import { BAND_META } from './spectrum-display';

export default function CurveEditorDialog() {
  const { editor } = useStoreShallow(useIdealProfilesStore, (s) => ({ editor: s.editor }));

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
