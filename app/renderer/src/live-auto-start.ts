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
// This module takes plain data in and returns plain data out; the glue that
// reads the stores and calls startLiveCapture lives in mode-switch.ts.

import type { DeviceHint } from './live-capture-panel';

export interface LiveAutoStartInput {
  isCapturing: boolean;
  activeRigId: string | null;
  deviceHint: DeviceHint | null;
}

export type LiveAutoStartDecision =
  | { type: 'start' }
  | { type: 'skip'; reason: 'already-monitoring' | 'device-blocked' | 'no-last-used-device' };

export function decideLiveAutoStart(input: LiveAutoStartInput): LiveAutoStartDecision {
  if (input.isCapturing) return { type: 'skip', reason: 'already-monitoring' };
  if (input.deviceHint?.isError) return { type: 'skip', reason: 'device-blocked' };
  if (!input.activeRigId) return { type: 'skip', reason: 'no-last-used-device' };
  return { type: 'start' };
}
