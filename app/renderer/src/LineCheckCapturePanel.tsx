// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The line-check "Capture this channel" control (lc-04, #1467, epic #1462) —
// a leaf under LiveCapturePanel's delegating .live-board-root div, the same
// split LiveAdjustmentsPanel.tsx uses (ADR-0135), so starting/stopping a
// capture never rebuilds the DAW board shell. Enablement routes through the
// exact same soleSoloedChannelIndex signal the "Currently checking"
// status-line indicator reads (line-check-capture-control.ts's
// lineCheckCaptureTarget), so the two can never disagree about which channel
// is the line-check subject (ADR-0139). Capture start/stop is the ONLY
// trigger — there is no solo-transition listener (ADR-0140).

import { type JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useSettingsStore } from './stores/settingsStore';
import { useLineCheckCaptureStore } from './stores/lineCheckCaptureStore';
import { lineCheckCaptureTarget, lineCheckCaptureControlView } from './line-check-capture-control';
import { getRigReconcile } from './live-workspace-view';

export default function LineCheckCapturePanel(): JSX.Element | null {
  const s = useStoreShallow(useLiveCaptureStore, (st) => ({
    appMode: st.appMode,
    soloedChannels: st.soloedChannels,
    channelConfig: st.channelConfig,
  }));
  const enabled = useStoreShallow(useSettingsStore, (st) => !!st.settings?.lineCheckCalibrationEnabled);
  const { capturing } = useStoreShallow(useLineCheckCaptureStore, (st) => ({ capturing: st.capturing }));

  if (s.appMode !== 'live' || !enabled) return null;

  const target = lineCheckCaptureTarget(enabled, s.soloedChannels);
  // lastLiveChannels is animation-rate — read imperatively at render time
  // (ADR-0005), like every other Live surface, rather than subscribed.
  const labelAt = (index: number): string => {
    const strip = s.channelConfig[index] ?? null;
    const lastLiveChannels = useLiveCaptureStore.getState().lastLiveChannels;
    const ch = lastLiveChannels ? lastLiveChannels[index] ?? null : null;
    return getRigReconcile().resolveStripLabel(strip, ch, index);
  };
  const view = lineCheckCaptureControlView(target, capturing, labelAt);

  /* c8 ignore start -- click dispatch, no jsdom in this harness (RingoutPanel.tsx's convention). */
  function onClick(): void {
    const store = useLineCheckCaptureStore.getState();
    if (store.capturing) {
      void store.stop();
    } else if (target !== null) {
      store.start(target);
    }
  }
  /* c8 ignore stop */

  return (
    <div className="line-check-capture-root">
      <button
        type="button"
        className="btn btn-secondary sm"
        disabled={!view.enabled}
        onClick={onClick}
      >
        {view.buttonLabel}
      </button>
      <span className="dz-hint">{view.hint}</span>
    </div>
  );
}
