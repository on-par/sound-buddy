// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The Live-adjustments panel (#522), split out of LiveCapturePanel for #1411.
// This is the ONLY Live-tab component that subscribes to liveWindows /
// lapCoaching — liveCaptureStore replaces both on every analysis-window frame,
// and keeping that subscription on LiveCapturePanel rebuilt the whole DAW board
// (and every waveform canvas) at window rate. Rendered as a child of
// LiveCapturePanel's delegating .live-board-root div, so the [data-lap-action]
// click branch and the .lap-focus-select native 'change' listener still reach
// this markup by bubbling.

import { type JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useSettingsStore } from './stores/settingsStore';
import { liveAdjustmentsPanelHTML, liveWorkspaceViewState } from './live-workspace-view';

export default function LiveAdjustmentsPanel(): JSX.Element | null {
  const s = useStoreShallow(useLiveCaptureStore, (st) => ({
    appMode: st.appMode,
    liveWindows: st.liveWindows,
    lapCoaching: st.lapCoaching,
    measurementSource: st.measurementSource,
    channelConfig: st.channelConfig,
    focusedInputIndex: st.focusedInputIndex,
    selectedDevice: st.selectedDevice,
    devices: st.devices,
    boardShapeVersion: st.boardShapeVersion,
  }));
  const settings = useStoreShallow(useSettingsStore, (st) => st.settings);
  if (s.appMode !== 'live') return null;
  // lastLiveChannels is animation-rate — read imperatively at render time, like
  // LiveCapturePanel and LiveEqPane do (ADR-0005). boardShapeVersion above is
  // what re-renders this when a tick's channel count changes.
  const html = liveAdjustmentsPanelHTML(liveWorkspaceViewState(useLiveCaptureStore.getState(), settings));
  return <div className="live-adjustments-root" dangerouslySetInnerHTML={{ __html: html }} />;
}
