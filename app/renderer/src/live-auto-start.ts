// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure decision helper for #728 — landing on the Live tab auto-starts board
// monitoring, mirroring GarageBand/Ableton's "open the project, it's already
// running" workflow. "Last-used device + rig + measurement source" resolves
// to rigStore.activeRigId because a saved CaptureRig is the only persisted
// primary-device concept in this codebase (see the #728 ADR) — there is no
// separate persisted device-name preference to fall back on.
// deviceHint.isError reuses the exact signal LiveSourceSettings.tsx already
// renders as the blocked-device hint (mic denied/restricted, enumeration
// failed, or no devices found) — no new hint text is introduced here.
// rigApplyNotice is a SEPARATE signal from deviceHint: it's liveCaptureStore's
// copy of the notice rig-panel.ts's applyRigPatch returns when hydrating the
// active rig — non-null when that rig's saved device wasn't found, OR when
// its channel config had to be clamped to fit the resolved device. deviceHint
// can be perfectly fine (other devices enumerate, no permission issue) while
// the rig just applied surfaced its own notice — that's the gap this input
// closes. Without it: (1) a rig pointing at an absent device auto-started
// monitoring against whatever selectedDevice happened to resolve to instead
// of showing the fallback and staying idle; (2) a rig whose channels needed
// clamping auto-started immediately, and the reactive #live-status renderer
// (inline-app.js's syncCaptureControls, driven by isCapturing/meterRate)
// overwrote the clamp notice with "Monitoring…" before it was ever visible.
// Both are the same underlying problem: a fresh rig-apply notice deserves to
// actually be seen, not silently raced over by capture starting instantly.
// This module takes plain data in and returns plain data out; the glue that
// reads the stores and calls startLiveCapture lives in mode-switch.ts.

import type { DeviceHint } from './live-capture-panel';

export interface LiveAutoStartInput {
  isCapturing: boolean;
  activeRigId: string | null;
  deviceHint: DeviceHint | null;
  rigApplyNotice: string | null;
}

export type LiveAutoStartDecision =
  | { type: 'start' }
  | { type: 'skip'; reason: 'already-monitoring' | 'device-blocked' | 'no-last-used-device' | 'rig-apply-notice' };

export function decideLiveAutoStart(input: LiveAutoStartInput): LiveAutoStartDecision {
  if (input.isCapturing) return { type: 'skip', reason: 'already-monitoring' };
  if (input.deviceHint?.isError) return { type: 'skip', reason: 'device-blocked' };
  if (!input.activeRigId) return { type: 'skip', reason: 'no-last-used-device' };
  if (input.rigApplyNotice) return { type: 'skip', reason: 'rig-apply-notice' };
  return { type: 'start' };
}
