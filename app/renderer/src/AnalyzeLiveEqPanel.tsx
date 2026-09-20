// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Analyze's room-mic EQ (#1469, lc-06) — the primary, central element of
// Analyze's live-listening state (#1468, lc-05), never a re-parented copy of
// the Session tab's docked LiveEqPane (which this component never imports or
// touches — AC2 holds by construction). Portaled by App.tsx onto the new
// #analyze-live-island root-markup node, a sibling of #spectrum-imperative/
// #spectrum-island/#live-island inside #spectrum-body; app.css's
// body.analyze-listening block hides those three and gives this island
// flex:1, mirroring body.live-active's existing precedent for #live-island.
//
// secondaryWindows (window-rate, appended once per analysis window) is the
// only tick-ish field in the useStoreShallow selector below — it re-renders
// this leaf on a cadence slow enough to safely rebuild its small markup.
// lastMeasurementChannels (true meter-rate, ~10/s) is read imperatively at
// render time instead, exactly like LiveAdjustmentsPanel.tsx's
// lastLiveChannels read and LiveEqPane.tsx's board-channel read
// (ADR-0005/ADR-0135): the room curve reflects the newest tick whenever
// something else causes this component to re-render, without itself forcing
// a re-render at meter rate.

import { useEffect, type JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useAnalyzeEntryStore } from './stores/analyzeEntryStore';
import { roomPaneOverride } from './measurement-device-state';
import { eqPaneRoomSectionHTML } from './live-capture-panel';
import { analyzeLiveEqView } from './analyze-live-eq';

export default function AnalyzeLiveEqPanel(): JSX.Element | null {
  const listening = useStoreShallow(useAnalyzeEntryStore, (s) => s.listening);
  const s = useStoreShallow(useLiveCaptureStore, (st) => ({
    appMode: st.appMode,
    secondaryMeasurement: st.secondaryMeasurement,
    secondaryWindows: st.secondaryWindows,
  }));
  const override = roomPaneOverride(
    s.secondaryMeasurement.status === 'active',
    s.secondaryWindows,
    useLiveCaptureStore.getState().lastMeasurementChannels,
    s.secondaryMeasurement.deviceName,
  );
  const view = analyzeLiveEqView({ listening, appMode: s.appMode, secondary: s.secondaryMeasurement, override });

  /* c8 ignore start -- document.body class toggle, no jsdom in this harness
     (renderToString doesn't run effects) — exercised by an e2e spec driving
     the Analyze "Listen live" flow end to end. */
  useEffect(() => {
    document.body.classList.toggle('analyze-listening', view.kind !== 'hidden');
    return () => document.body.classList.remove('analyze-listening');
  }, [view.kind]);
  /* c8 ignore stop */

  if (view.kind === 'hidden') return null;

  return (
    <div className="analyze-live-eq" aria-label="Room-mic EQ">
      {view.kind === 'room'
        ? <div
          className="eq-pane-section eq-pane-primary"
          dangerouslySetInnerHTML={{ __html: eqPaneRoomSectionHTML(view.override) }}
        />
        : <div className="eq-pane-section eq-pane-primary eq-pane-empty">
          <div className="eq-pane-header">Room</div>
          <div className="eq-pane-empty-hint">{view.text}</div>
        </div>}
      <div className="analyze-live-eq-actions">
        <button
          type="button"
          id="analyze-live-eq-stop"
          className="btn btn-secondary sm"
          /* c8 ignore next -- click dispatch, no jsdom */
          onClick={() => { void useAnalyzeEntryStore.getState().stopListening(); }}
        >
          Stop listening
        </button>
        <button
          type="button"
          id="analyze-live-eq-choose-file"
          className="btn btn-secondary sm"
          /* c8 ignore next -- click dispatch, no jsdom */
          onClick={() => { void useAnalyzeEntryStore.getState().chooseFile(); }}
        >
          Load file…
        </button>
      </div>
    </div>
  );
}
