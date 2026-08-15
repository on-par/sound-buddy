// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The header #window-badge span inside the static #live-indicator pill
// (TD-001 slice 6i, #712) — the latest live window number, derived from
// liveCaptureStore's capped liveWindows buffer + isCapturing. Portaled by
// App.tsx onto the static #window-badge-island span inside #live-indicator;
// replaces inline-app.js's imperative `#window-badge` write in the onLiveEvent
// window-tick branch.

import type { JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useLiveCaptureStore } from './stores/liveCaptureStore';

export default function WindowBadge(): JSX.Element {
  const { liveWindows, isCapturing } = useStoreShallow(useLiveCaptureStore, (s) => ({
    liveWindows: s.liveWindows,
    isCapturing: s.isCapturing,
  }));
  const last = isCapturing && liveWindows.length > 0 ? liveWindows[liveWindows.length - 1] : null;
  // liveWindows only ever accumulates window ticks (bindIpcEvents appends them
  // on the window-tick branch), so every entry carries `.window`.
  const text = last ? `Window #${(last as { window: number }).window}` : '';
  return <span id="window-badge">{text}</span>;
}
