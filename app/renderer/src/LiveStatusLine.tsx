// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The shared #live-status line (TD-001 slice 6i, #712) — the capture-lifecycle
// module writes capture status ('Connecting…', phase text) and rigStore writes
// rig-apply notices, both to liveCaptureStore.liveStatusText, and this island
// renders the node reactively. Single-owned now: the last imperative DOM
// writer (rig-panel.ts's setLiveStatusText) is gone. Portaled by App.tsx onto
// #live-status-island (in #tab-live); the div keeps the id + inline styles of
// the deleted static root-markup node.

import type { JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useLiveCaptureStore } from './stores/liveCaptureStore';

export default function LiveStatusLine(): JSX.Element {
  const text = useStoreShallow(useLiveCaptureStore, (s) => s.liveStatusText);
  return (
    <div
      id="live-status"
      style={{ display: text ? 'block' : 'none', font: 'var(--fw-regular) var(--fs-label)/1.3 var(--font-sans)', color: 'var(--text-muted)', textAlign: 'center' }}
    >
      {text}
    </div>
  );
}
