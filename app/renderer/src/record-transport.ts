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

// The Record control is a no-text red-circle toggle (#777): no visible label
// is rendered in any phase — the ariaLabel carries the state for screen
// readers and the recording phase's pressed state comes from the
// record-btn--recording CSS class (RecordButton.tsx) plus aria-pressed.
export interface RecordButtonViewModel {
  phase: RecordButtonPhase;
  disabled: boolean;
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
    return { phase, disabled: true, ariaLabel: 'Starting recording' };
  }
  if (phase === 'recording') {
    return { phase, disabled: false, ariaLabel: 'Recording — press to stop' };
  }
  if (phase === 'stopping') {
    return { phase, disabled: true, ariaLabel: 'Stopping recording' };
  }
  return {
    phase: 'idle',
    disabled: false,
    ariaLabel: 'Record — press to start recording',
  };
}

export function recordButtonAction(phase: RecordButtonPhase, disabled: boolean): RecordButtonAction {
  if (disabled) return null;
  if (phase === 'idle') return 'promote';
  if (phase === 'recording') return 'stop';
  return null;
}
