// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure phase/view/action derivation shared by the top-bar RecordButton and
// the Session toolbar Record control. CapturePhase remains owned by the
// classic live-transition-state model; neither render target reads raw store
// flags or derives capture eligibility itself.

import type { CapturePhase } from './LiveControls';

export type RecordButtonPhase = CapturePhase;
export type RecordButtonAction = 'record' | 'stop' | null;

// The Record control is a no-text red-circle toggle (#777): no visible label
// is rendered in any phase — the ariaLabel carries the state for screen
// readers and the recording phase's pressed state comes from the
// record-btn--recording CSS class (RecordButton.tsx) plus aria-pressed.
export interface RecordButtonViewModel {
  phase: RecordButtonPhase;
  disabled: boolean;
  ariaLabel: string;
}

export function recordButtonView(phase: CapturePhase): RecordButtonViewModel {
  if (phase === 'starting-record') {
    return { phase, disabled: true, ariaLabel: 'Starting recording' };
  }
  if (phase === 'recording') {
    return { phase, disabled: false, ariaLabel: 'Recording — press to stop' };
  }
  if (phase === 'stopping') {
    return { phase, disabled: true, ariaLabel: 'Stopping recording' };
  }
  return {
    phase,
    disabled: false,
    ariaLabel: 'Record — press to start recording',
  };
}

export function recordButtonAction(phase: RecordButtonPhase): RecordButtonAction {
  if (phase === 'idle' || phase === 'monitoring') return 'record';
  if (phase === 'recording') return 'stop';
  return null;
}

/** Raw Session-toolbar adapter over the shared record-control view. */
export function sessionTabCaptureHTML(view: RecordButtonViewModel): string {
  const pressed = view.phase === 'recording' || view.phase === 'stopping';
  const label = view.phase === 'recording' ? 'Stop' : 'Record';
  return `<button type="button" class="daw-session-record daw-session-record--${view.phase}" id="daw-session-record" aria-label="${view.ariaLabel}" aria-pressed="${pressed}"${view.disabled ? ' disabled' : ''}>${label}</button>`;
}
