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
// activeRigDeviceFound is a SEPARATE signal from deviceHint: it's true when
// no rig is active, or when the active rig's saved device name resolves
// against the current device list (rig-panel.ts's reconcileRigDevice — the
// same check applyRigPatch already runs when hydrating the rig, whose
// "device not found" result today only reaches setLiveStatusText's DOM text,
// never any store field). deviceHint can be perfectly fine (other devices
// enumerate, no permission issue) while a SPECIFIC named device a saved rig
// references is gone — that's the gap this input closes; without it, a rig
// pointing at an absent device auto-started monitoring against whatever
// selectedDevice happened to resolve to instead of showing the existing
// "device not found" fallback and staying idle.
// This module takes plain data in and returns plain data out; the glue that
// reads the stores and calls startLiveCapture lives in mode-switch.ts.

import type { DeviceHint } from './live-capture-panel';

export interface LiveAutoStartInput {
  isCapturing: boolean;
  activeRigId: string | null;
  deviceHint: DeviceHint | null;
  activeRigDeviceFound: boolean;
}

export type LiveAutoStartDecision =
  | { type: 'start' }
  | { type: 'skip'; reason: 'already-monitoring' | 'device-blocked' | 'no-last-used-device' | 'rig-device-not-found' };

export function decideLiveAutoStart(input: LiveAutoStartInput): LiveAutoStartDecision {
  if (input.isCapturing) return { type: 'skip', reason: 'already-monitoring' };
  if (input.deviceHint?.isError) return { type: 'skip', reason: 'device-blocked' };
  if (!input.activeRigId) return { type: 'skip', reason: 'no-last-used-device' };
  if (!input.activeRigDeviceFound) return { type: 'skip', reason: 'rig-device-not-found' };
  return { type: 'start' };
}
