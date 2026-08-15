// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The docked live EQ pane (#668, slice 6g #710) — portaled onto
// #live-eq-pane-body by App.tsx, replacing inline-app.js's imperative
// renderEqPane(). Renders eqPaneHTML(eqPaneView(...)) through
// dangerouslySetInnerHTML keyed on eqPaneSignature, so React only rebuilds
// the pane's DOM on a discrete signature flip (which channel/label/curve
// mode); per-tick section patching is live-board.ts's patchEqPane (driven by
// LiveWorkspace's live-meter-controller, ADR-0005 — the same split
// liveLevelReadout uses). Both writers compute the same signature from the
// same store snapshot, so they stay convergent: React rebuilds on the flips
// it can see (boardShapeVersion/selectedChannel/…), patchEqPane handles
// tick-driven signature flips (7-band <-> 48-grid curve mode) on the same
// DOM. Per-tick data (lastTick/lastLiveChannels/lastMeasurementChannels) is
// read as one-time getState() snapshots at render time, never subscribed.

import { useLayoutEffect, type JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import {
  eqPaneHTML,
  eqPaneView,
  eqPaneSignature,
  type LiveMeterChannel,
} from './live-capture-panel';
import { currentPaneChannels } from './live-board';
import { roomPaneOverride } from './measurement-device-state';

export default function LiveEqPane(): JSX.Element {
  const { measurementSource, selectedChannel, channelConfig, secondaryMeasurement, secondaryWindowsCount, boardShapeVersion, isCapturing } =
    useStoreShallow(useLiveCaptureStore, (s) => ({
      measurementSource: s.measurementSource,
      selectedChannel: s.selectedChannel,
      channelConfig: s.channelConfig,
      secondaryMeasurement: s.secondaryMeasurement,
      secondaryWindowsCount: s.secondaryWindows.length,
      boardShapeVersion: s.boardShapeVersion,
      isCapturing: s.isCapturing,
    }));

  // Per-tick snapshots (ADR-0005): read at render time, never subscribed.
  const snap = useLiveCaptureStore.getState();
  const secondaryActive = secondaryMeasurement.status === 'active' && secondaryWindowsCount > 0;
  // Mirrors the board's own channel resolution (tick channels while
  // capturing, idle placeholders otherwise) so the pane and board agree, and
  // matches patchEqPane's eqPaneChannelsFor exactly.
  const channels: LiveMeterChannel[] = isCapturing
    ? currentPaneChannels(snap.lastTick?.channels ?? snap.lastLiveChannels, channelConfig)
    : currentPaneChannels(null, channelConfig);
  const roomOverride = secondaryActive
    ? roomPaneOverride(secondaryActive, snap.secondaryWindows, snap.lastMeasurementChannels, secondaryMeasurement.deviceName)
    : null;
  const view = eqPaneView(channels, channelConfig, measurementSource, selectedChannel, roomOverride);
  const signature = eqPaneSignature(view);
  const html = eqPaneHTML(view);

  // Keep the pane container's dataset.signature in sync so patchEqPane's
  // patch-vs-rebuild decision (the same signature from the same snapshot)
  // converges with React's own render. The signature-keyed effect re-runs
  // only on a discrete flip.
  /* c8 ignore start -- DOM effect wiring, no jsdom in this harness
     (renderToString doesn't run effects); exercised by
     tests/e2e/live-capture.spec.ts. */
  useLayoutEffect(() => {
    const el = document.getElementById('live-eq-pane-body');
    if (el) el.dataset.signature = signature;
  }, [signature]);
  /* c8 ignore stop */

  // The pane's display/width stay owned by mode-switch.applySpectrumForMode
  // and the #live-eq-resize init (inline-app.js) — this component only owns
  // the body's content.
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
