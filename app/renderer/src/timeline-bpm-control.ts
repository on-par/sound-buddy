// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The Session transport's compact BPM control (#1276): a pure sibling of
// timeline-bpm.ts, following the session-tab-playback.ts precedent — view
// state + commit rule + HTML builder, no DOM/store/React import. The shell is
// raw markup under dangerouslySetInnerHTML, so committing happens once on the
// board's native 'change' delegate (blur/Enter), never per keystroke; see
// LiveCapturePanel.tsx's onBoardChange BPM branch. BPM stays display-only
// (ADR-0104) — this module never reaches a coordinate.

import { TIMELINE_MIN_BPM, TIMELINE_MAX_BPM, withTimelineBpm, type TimelineTempo } from './timeline-bpm';

/** The id of the BPM input. Exported so the LiveCapturePanel change delegate
 *  and the tests match on one constant, not a repeated string literal. */
export const TIMELINE_BPM_INPUT_ID = 'daw-session-bpm';
export const TIMELINE_BPM_HINT_ID = 'daw-session-bpm-hint';

/** Feedback copy. Both messages name the bounds and what to do (constitution:
 *  error messages must be actionable) and are built from the #1278 constants so
 *  copy and bounds can never drift. */
export const TIMELINE_BPM_REJECTED_MESSAGE =
  `Enter a number between ${TIMELINE_MIN_BPM} and ${TIMELINE_MAX_BPM} BPM.`;
export function timelineBpmClampedMessage(bpm: number): string {
  return `BPM must be between ${TIMELINE_MIN_BPM} and ${TIMELINE_MAX_BPM} — set to ${bpm}.`;
}

/** What the toolbar renders: the stored tempo the input displays, the validation
 *  feedback for the last entry ('' when accepted as typed), and whether that
 *  feedback is a validation failure. */
export interface TimelineBpmControlView {
  tempo: TimelineTempo;
  message: string;
  invalid: boolean;
}

/** The result of committing one raw entry: the tempo to store (UNCHANGED when
 *  the entry is rejected — an invalid BPM is never stored) plus the feedback to
 *  show and which of the three outcomes occurred. */
export interface TimelineBpmEntry {
  tempo: TimelineTempo;
  message: string;
  status: 'accepted' | 'clamped' | 'rejected';
}

export function timelineBpmControlView(tempo: TimelineTempo, message = ''): TimelineBpmControlView {
  return { tempo, message, invalid: message !== '' };
}

export function commitTimelineBpmEntry(raw: string, tempo: TimelineTempo): TimelineBpmEntry {
  const trimmed = raw.trim();
  // Number('') is 0, so an empty entry is rejected explicitly rather than
  // silently clamping to TIMELINE_MIN_BPM.
  const parsed = trimmed === '' ? Number.NaN : Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return { tempo, message: TIMELINE_BPM_REJECTED_MESSAGE, status: 'rejected' };
  }
  const next = withTimelineBpm(tempo, parsed);
  // Not a tolerance question, so no epsilon: clampTimelineBpm returns one of
  // Math.min/Math.max's exact inputs, so next.bpm is bit-identical to parsed
  // whenever the entry was in range (same rationale as withTimelineBpm's own
  // identity check).
  if (next.bpm !== parsed) {
    return { tempo: next, message: timelineBpmClampedMessage(next.bpm), status: 'clamped' };
  }
  return { tempo: next, message: '', status: 'accepted' };
}

/** Raw toolbar markup consumed by LiveCapturePanel's delegated change handler.
 *  No escaping is applied — view.tempo.bpm is `String(number)` off a clamped
 *  finite tempo and view.message is always one of this module's own constants,
 *  never user-supplied text. */
export function timelineBpmControlHTML(view: TimelineBpmControlView): string {
  return `<span class="daw-transport-bpm${view.invalid ? ' invalid' : ''}">`
    + `<label class="daw-transport-bpm-label" for="${TIMELINE_BPM_INPUT_ID}">BPM</label>`
    + `<input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" `
    + `class="daw-transport-bpm-input" id="${TIMELINE_BPM_INPUT_ID}" `
    + `value="${view.tempo.bpm}" size="4" `
    + `aria-label="Tempo in beats per minute" `
    + `aria-invalid="${view.invalid}" `
    + `aria-describedby="${TIMELINE_BPM_HINT_ID}">`
    + `<span class="daw-transport-bpm-hint" id="${TIMELINE_BPM_HINT_ID}" role="status">${view.message}</span>`
    + `</span>`;
}
