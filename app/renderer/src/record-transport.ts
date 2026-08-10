// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure phase/view/action derivation for the top-bar RecordButton (#729). A
// fresh module rather than a reuse of live-transition-state.js's
// capturePhase/recordButtonView — that classic-script model has no
// "stopping" phase and a different state vocabulary; see the #729 plan's
// rejected alternatives for the full reasoning. live-transition-state.js
// stays untouched and still drives inline-app.js's header REC/LIVE
// indicator.

export type RecordButtonPhase = 'idle' | 'starting' | 'recording' | 'stopping';
export type RecordButtonAction = 'promote' | 'stop' | null;

export interface RecordButtonInput {
  liveRunning: boolean;
  liveMode: 'monitor' | 'record';
  promoting: boolean;
  stopping: boolean;
}

export interface RecordButtonViewModel {
  phase: RecordButtonPhase;
  disabled: boolean;
  label: string;
  ariaLabel: string;
}

export function recordButtonPhase(input: RecordButtonInput): RecordButtonPhase {
  if (input.stopping) return 'stopping';
  if (input.promoting) return 'starting';
  if (input.liveRunning && input.liveMode === 'record') return 'recording';
  return 'idle';
}

export function recordButtonView(input: RecordButtonInput): RecordButtonViewModel {
  const phase = recordButtonPhase(input);
  if (phase === 'starting') {
    return { phase, disabled: true, label: 'Starting…', ariaLabel: 'Starting recording' };
  }
  if (phase === 'recording') {
    return { phase, disabled: false, label: 'Recording', ariaLabel: 'Recording — press to stop' };
  }
  if (phase === 'stopping') {
    return { phase, disabled: true, label: 'Stopping…', ariaLabel: 'Stopping recording' };
  }
  return {
    phase: 'idle',
    disabled: !input.liveRunning,
    label: 'Record',
    ariaLabel: input.liveRunning ? 'Start recording' : 'Recording unavailable — monitoring is not active',
  };
}

export function recordButtonAction(phase: RecordButtonPhase, disabled: boolean): RecordButtonAction {
  if (disabled) return null;
  if (phase === 'idle') return 'promote';
  if (phase === 'recording') return 'stop';
  return null;
}
