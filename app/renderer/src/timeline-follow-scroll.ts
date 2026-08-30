// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The Session timeline's follow-scroll pause/resume policy (#1286): a pure
// sibling of timeline-zoom-controls.ts — the ONE owner of "should the view
// keep chasing the playhead right now". Pointer/wheel gestures over the
// timeline pause it, every explicit playback/navigation control resumes it.
// This module is pure: no DOM, no store, no React import. It MUST NOT import
// './timeline-bpm' (ADR-0104/0107 - no coordinate is computed through the
// tempo model) and models time in seconds only (ADR-0109). Moving the
// viewport itself is #1283's job; this module only decides state and derives
// the paged-follow range #1283's viewport wiring will call.

import type { TimelineVisibleRange } from './timeline-zoom-controls';

/** Why follow is paused, so the toggle can explain itself and #1283 can log it. */
export type TimelineFollowPause = 'scroll' | 'zoom' | 'manual';

/** Every input the follow policy accepts. Named by SOURCE, not by view change:
 *  gestures pause, controls resume (see this story's ADR). */
export type TimelineFollowEvent =
  | 'manual-scroll'
  | 'manual-zoom'
  | 'play'
  | 'seek'
  | 'navigate'
  | 'toggle';

export interface TimelineFollowModel {
  readonly following: boolean;
  /** null exactly when following is true. */
  readonly pausedBy: TimelineFollowPause | null;
}

export interface TimelineFollowContext {
  playheadSecs: number;
  durationSecs: number;
}

/** Structural shape so a plain object (and a React WheelEvent) both satisfy it —
 *  same convention as session-ruler-scrub.ts's classList shape. */
export interface TimelineFollowWheelLike {
  deltaX: number;
  deltaY: number;
  ctrlKey: boolean;
  metaKey: boolean;
}

export interface TimelineFollowView {
  following: boolean;
  label: string;
  title: string;
}

export const TIMELINE_FOLLOW_BUTTON_ID = 'daw-follow-toggle';
/** The one selector LiveCapturePanel's wheel handler uses to decide whether a
 *  wheel happened over the timeline column at all. */
export const TIMELINE_FOLLOW_SURFACE_SELECTOR = '.daw-timeline';

const TIMELINE_FOLLOW_LABEL = 'Follow';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function createTimelineFollowModel(): TimelineFollowModel {
  return Object.freeze({ following: true, pausedBy: null });
}

function settle(model: TimelineFollowModel, following: boolean, pausedBy: TimelineFollowPause | null): TimelineFollowModel {
  if (model.following === following && model.pausedBy === pausedBy) return model;
  return { following, pausedBy };
}

export function applyTimelineFollowEvent(model: TimelineFollowModel, event: TimelineFollowEvent): TimelineFollowModel {
  switch (event) {
    case 'manual-scroll':
      return settle(model, false, 'scroll');
    case 'manual-zoom':
      return settle(model, false, 'zoom');
    case 'play':
    case 'seek':
    case 'navigate':
      return settle(model, true, null);
    case 'toggle':
      return model.following ? settle(model, false, 'manual') : settle(model, true, null);
    /* c8 ignore next 2 -- TimelineFollowEvent is exhaustively handled above; this
       arm exists only to satisfy tsc's non-exhaustive-switch check. */
    default:
      return model;
  }
}

export function timelineFollowEventForWheel(wheel: TimelineFollowWheelLike): TimelineFollowEvent | null {
  if (!Number.isFinite(wheel.deltaX) || !Number.isFinite(wheel.deltaY)) return null;
  if (wheel.ctrlKey || wheel.metaKey) return 'manual-zoom';
  if (Math.abs(wheel.deltaX) > 0) return 'manual-scroll';
  return null;
}

export function timelineFollowRange(model: TimelineFollowModel, range: TimelineVisibleRange, ctx: TimelineFollowContext): TimelineVisibleRange {
  if (!model.following) return range;
  const span = range.endSecs - range.startSecs;
  if (!Number.isFinite(ctx.playheadSecs) || !Number.isFinite(ctx.durationSecs) || ctx.durationSecs <= 0 || !Number.isFinite(span) || span <= 0) {
    return range;
  }
  if (ctx.playheadSecs >= range.startSecs && ctx.playheadSecs <= range.endSecs) return range;
  const startSecs = clamp(ctx.playheadSecs, 0, Math.max(0, ctx.durationSecs - span));
  return { startSecs, endSecs: startSecs + span };
}

export function timelineFollowView(model: TimelineFollowModel): TimelineFollowView {
  return {
    following: model.following,
    label: TIMELINE_FOLLOW_LABEL,
    title: model.following
      ? 'Following the playhead - click to pause'
      : 'Follow paused - click to follow the playhead again',
  };
}

/** Raw toolbar markup consumed by LiveCapturePanel's delegated click handler.
 *  No escaping is applied — every interpolation is one of this module's own
 *  literals. Deliberately does NOT carry the daw-zoom-btn class - see the
 *  click-order note in the #1286 spec. */
export function timelineFollowButtonHTML(view: TimelineFollowView): string {
  return `<button type="button" class="daw-follow-btn${view.following ? ' active' : ''}" `
    + `id="${TIMELINE_FOLLOW_BUTTON_ID}" aria-pressed="${view.following}" `
    + `title="${view.title}" aria-label="${view.title}">${view.label}</button>`;
}
