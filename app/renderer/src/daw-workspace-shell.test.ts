// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  dawPlayheadX,
  dawTimelineX,
  dawRulerTicks,
  dawLaneGridlines,
  DAW_TIMELINE_SPAN_SECS,
  DAW_TIMELINE_INSET_PX,
  DAW_TIMELINE_ORIGIN_PX,
  DAW_TIMELINE_PX_PER_SECOND,
} from './daw-shell-runtime';

// DAW-style Session shell (#517): the Live tab's center pane renders the
// timeline-oriented shell. The shell's MARKUP moved out of inline-app.js
// (renderDawShell) into the pure live-workspace-view.ts dawShellHTML builder
// + the React LiveCapturePanel island (TD-001 slice 6g, #710) — those markup
// acceptance criteria are enforced by live-workspace-view.test.ts and
// LiveCapturePanel.test.ts. TD-001 slice 6j (#713) moved the playhead/waveform
// painters + tickers off inline-app.js entirely, onto daw-shell-runtime.ts
// (unit-tested in daw-shell-runtime.test.ts) — this gate now pins their
// absence from inline-app.js, their presence in the new homes, and that the
// unchanged seam consumers (capture-lifecycle.ts, LiveCapturePanel.tsx,
// live-workspace-view.ts) still reach them the same way, plus the App.tsx
// boot-order assertions and the #757/#517 absence rules.

const inlineApp = fs.readFileSync(fileURLToPath(new URL('./inline-app.js', import.meta.url)), 'utf8');
const markup = fs.readFileSync(fileURLToPath(new URL('./root-markup.html', import.meta.url)), 'utf8');
const css = fs.readFileSync(fileURLToPath(new URL('./styles/app.css', import.meta.url)), 'utf8');
const appTsx = fs.readFileSync(fileURLToPath(new URL('./App.tsx', import.meta.url)), 'utf8');
const workspaceViewTs = fs.readFileSync(fileURLToPath(new URL('./live-workspace-view.ts', import.meta.url)), 'utf8');
const recordTransportTs = fs.readFileSync(fileURLToPath(new URL('./record-transport.ts', import.meta.url)), 'utf8');
const liveCapturePanelTsx = fs.readFileSync(fileURLToPath(new URL('./LiveCapturePanel.tsx', import.meta.url)), 'utf8');
// TD-001 slice 6i (#712): the capture lifecycle moved here — its start/stop
// drives the daw-shell-runtime.ts painters through the window.dawShellRuntime
// seam (unchanged by 6j — see the "DAW shell seam consumers" describe below).
const lifecycleTs = fs.readFileSync(fileURLToPath(new URL('./capture-lifecycle.ts', import.meta.url)), 'utf8');
// TD-001 slice 6j (#713): the new home for the playhead/waveform painters.
const dawShellRuntimeTs = fs.readFileSync(fileURLToPath(new URL('./daw-shell-runtime.ts', import.meta.url)), 'utf8');
const dawPlayheadStateJs = fs.readFileSync(fileURLToPath(new URL('../daw-playhead-state.js', import.meta.url)), 'utf8');
// #1277 / ADR-0104: BPM/real-seconds isolation guard — the coordinate owners below.
const timelineScaleTs = fs.readFileSync(fileURLToPath(new URL('./timeline-scale.ts', import.meta.url)), 'utf8');
const sessionTabWaveformsTs = fs.readFileSync(fileURLToPath(new URL('./session-tab-waveforms.ts', import.meta.url)), 'utf8');
const soundcheckWaveformTs = fs.readFileSync(fileURLToPath(new URL('./soundcheck-waveform.ts', import.meta.url)), 'utf8');
const soundcheckPlayheadTs = fs.readFileSync(fileURLToPath(new URL('./soundcheck-playhead.ts', import.meta.url)), 'utf8');
const sessionTimelineScrubTs = fs.readFileSync(fileURLToPath(new URL('./session-timeline-scrub.ts', import.meta.url)), 'utf8');
const sessionRulerScrubTs = fs.readFileSync(fileURLToPath(new URL('./session-ruler-scrub.ts', import.meta.url)), 'utf8');
const sessionTabPlaybackTs = fs.readFileSync(fileURLToPath(new URL('./session-tab-playback.ts', import.meta.url)), 'utf8');
const timelineFollowScrollTs = fs.readFileSync(fileURLToPath(new URL('./timeline-follow-scroll.ts', import.meta.url)), 'utf8');
const timelineVisibleRangeTs = fs.readFileSync(fileURLToPath(new URL('./timeline-visible-range.ts', import.meta.url)), 'utf8');
const timelineRulerLabelsTs = fs.readFileSync(fileURLToPath(new URL('./timeline-ruler-labels.ts', import.meta.url)), 'utf8');
const timelineScrollGestureTs = fs.readFileSync(fileURLToPath(new URL('./timeline-scroll-gesture.ts', import.meta.url)), 'utf8');
const timelineZoomGestureTs = fs.readFileSync(fileURLToPath(new URL('./timeline-zoom-gesture.ts', import.meta.url)), 'utf8');
// #1303: the clip-press routing gates below.
const clipClickTs = fs.readFileSync(fileURLToPath(new URL('./clip-click.ts', import.meta.url)), 'utf8');
const clipSelectionTs = fs.readFileSync(fileURLToPath(new URL('./clip-selection.ts', import.meta.url)), 'utf8');
const timeSelectionTs = fs.readFileSync(fileURLToPath(new URL('./time-selection.ts', import.meta.url)), 'utf8');
const timeSelectionDragTs = fs.readFileSync(fileURLToPath(new URL('./time-selection-drag.ts', import.meta.url)), 'utf8');
// #1313: the arrangement loop region.
const loopBraceRenderTs = fs.readFileSync(fileURLToPath(new URL('./loopBrace.render.ts', import.meta.url)), 'utf8');
// #1314: the Loop toggle's pure policy.
const loopToggleTs = fs.readFileSync(fileURLToPath(new URL('./loopToggle.ts', import.meta.url)), 'utf8');
// #1315: the loop brace body drag gesture.
const loopBraceBodyDragTs = fs.readFileSync(fileURLToPath(new URL('./loopBrace.bodyDrag.ts', import.meta.url)), 'utf8');
const loopBraceEdgeDragTs = fs.readFileSync(fileURLToPath(new URL('./loopBrace.edgeDrag.ts', import.meta.url)), 'utf8');
// #1317: promoting a time selection to the loop range.
const loopFromSelectionTs = fs.readFileSync(fileURLToPath(new URL('./loopFromSelection.ts', import.meta.url)), 'utf8');
// #1306: the arrangement's accessible state labels.
const timelineAccessibilityLabelsTs = fs.readFileSync(fileURLToPath(new URL('./timeline-accessibility-labels.ts', import.meta.url)), 'utf8');
// #1318: return-to-start must stay position-only — it may not reach the loop model.
const soundcheckStoreTs = fs.readFileSync(fileURLToPath(new URL('./stores/soundcheckStore.ts', import.meta.url)), 'utf8');

function functionBody(src: string, name: string): string {
  const marker = `function ${name}(`;
  const start = src.indexOf(marker);
  if (start === -1) throw new Error(`function ${name} not found`);
  const openBrace = src.indexOf('{', start);
  let depth = 0;
  for (let i = openBrace; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(openBrace, i + 1);
    }
  }
  throw new Error(`unbalanced braces in function ${name}`);
}

// Extracts the innermost {...} block enclosing `marker`, e.g. an anonymous
// callback body — for code that (unlike functionBody's targets) isn't a named
// `function foo() {}` declaration.
function enclosingBlock(src: string, marker: string): string {
  const markerIdx = src.indexOf(marker);
  if (markerIdx === -1) throw new Error(`marker ${JSON.stringify(marker)} not found`);
  let depth = 0;
  let openBrace = -1;
  for (let i = markerIdx; i >= 0; i--) {
    if (src[i] === '}') depth++;
    else if (src[i] === '{') {
      if (depth === 0) { openBrace = i; break; }
      depth--;
    }
  }
  if (openBrace === -1) throw new Error(`no enclosing block found for marker ${JSON.stringify(marker)}`);
  depth = 0;
  for (let i = openBrace; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(openBrace, i + 1);
    }
  }
  throw new Error(`unbalanced braces around marker ${JSON.stringify(marker)}`);
}

describe('DAW workspace shell (#517)', () => {
  it('dawShellHTML is the shell builder the React island renders unconditionally', () => {
    expect(workspaceViewTs).toContain('export function dawShellHTML(');
    expect(liveCapturePanelTsx).toContain('dawShellHTML(state)');
  });

  it('inline-app.js no longer owns the shell markup or the board render path (6g acceptance)', () => {
    expect(inlineApp).not.toMatch(/function renderDawShell\(/);
    expect(inlineApp).not.toMatch(/function renderLiveMeters\(/);
    expect(inlineApp).not.toMatch(/function renderLiveWorkspace\(/);
    expect(inlineApp).not.toMatch(/window\.liveWorkspaceRuntime\s*=/);
  });

  it('the shell lane names resolve from the latest tick channels via dawShellPatchView', () => {
    // live-workspace-view.test.ts asserts the fallback resolution; pin the home.
    expect(workspaceViewTs).toContain('export function dawShellPatchView(');
  });
});

describe('DAW workspace timeline shell markup (#517)', () => {
  it('dawShellHTML renders the transport/header, ruler, mix lane, and channel lanes', () => {
    // live-workspace-view.test.ts asserts each piece of markup.
    expect(workspaceViewTs).toContain('daw-shell');
    expect(workspaceViewTs).toContain('daw-transport');
    expect(workspaceViewTs).toContain('daw-ruler');
    expect(workspaceViewTs).toContain('daw-mix-lane');
    expect(workspaceViewTs).toContain('daw-channel-lane');
    expect(workspaceViewTs).toContain('transportLabel(');
  });

  it('maps channel lanes from channelConfig and escapes the lane name (stripLabel can return a user-entered string)', () => {
    expect(workspaceViewTs).toContain('channelConfig.map(');
    expect(workspaceViewTs).toMatch(/escapeHtml\(getRigReconcile\(\)\.resolveStripLabel\(/);
  });

  it('rebuilds when lane content changes even if the channel count does not (laneSignature)', () => {
    expect(workspaceViewTs).toContain('laneSignature');
  });

  it('the React island stamps the lane fingerprint on the rendered shell', () => {
    expect(liveCapturePanelTsx).toContain('data-lane-signature');
    expect(liveCapturePanelTsx).toContain('laneSignature');
  });

  it('renders a muted empty-state row when channelConfig is empty', () => {
    expect(workspaceViewTs).toContain('Add your first track');
  });

  it('composes the shared Session Record control into the transport (#1081)', () => {
    expect(workspaceViewTs).toContain('sessionTabCaptureHTML(recordButtonView(state.capturePhase))');
    expect(recordTransportTs).toContain('sessionTabCaptureHTML');
  });
});

describe('DAW shell and shared Record transport (#1081)', () => {
  it('root-markup.html no longer carries the retired in-tab capture-control islands while the Session control is shell-owned', () => {
    expect(markup).not.toContain('id="live-controls-island"');
    expect(markup).not.toContain('id="live-transport-island"');
    expect(markup).not.toContain('id="live-mode"');
    expect(markup).not.toContain('id="preflight-panel"');
    expect(markup).toContain('id="record-button-island"');
  });

  it('the board island does not duplicate the capture controls', () => {
    expect(liveCapturePanelTsx).not.toContain('id="live-mode"');
    expect(liveCapturePanelTsx).not.toContain('id="live-start-btn"');
    expect(liveCapturePanelTsx).not.toContain('id="live-stop-btn"');
  });

  it('the workspace arm cluster renders always (not record-mode gated) — armHTML drops the render gate', () => {
    const toolbar = functionBody(liveCapturePanelTsx === '' ? '' : workspaceViewTs, 'liveWorkspaceToolbarHTML');
    expect(toolbar).toContain('live-ws-arm-count');
    expect(toolbar).not.toContain("advanced && liveMode === 'record'");
  });

  it('arm controls stay usable while monitoring and freeze only while recording (#757)', () => {
    const toolbar = functionBody(workspaceViewTs, 'liveWorkspaceToolbarHTML');
    expect(toolbar).toContain("state.isCapturing && state.liveMode === 'record'");
    // TD-001 slice 6h (#711): the per-strip arm stamp derives from workspace
    // state (isCapturing && liveMode === 'record') in dawTrackHeaderHTML — the
    // inline setCaptureControlsLocked armLocked sweep is gone. The behavior is
    // unit-pinned in live-capture-panel.test.ts.
    expect(workspaceViewTs).toContain('state.isCapturing && state.liveMode === \'record\'');
    expect(inlineApp).not.toContain('function setCaptureControlsLocked');
  });
});

describe('DAW shell is not settings-gated (#517)', () => {
  it('inline-app.js has no workspace body-class or Live-pane resync subscriber', () => {
    expect(inlineApp).not.toContain('daw-workspace');
    expect(inlineApp).not.toContain('dawWorkspaceState');
  });
});

describe('DAW shell styles (#517)', () => {
  it('app.css styles the shell and its lanes', () => {
    expect(css).toContain('.daw-shell');
    expect(css).toContain('.daw-lane');
  });
});

describe('Session BPM control wiring (#1276)', () => {
  it('dawShellHTML sources the ruler tempo from the control, not an unconditional createTimelineTempo() call', () => {
    expect(workspaceViewTs).toContain('timelineBpmControlHTML(');
    expect(workspaceViewTs).not.toContain('createTimelineTempo();');
  });

  it('LiveCapturePanel commits BPM entries through the pure commit rule', () => {
    expect(liveCapturePanelTsx).toContain('commitTimelineBpmEntry(');
  });

  it('app.css styles the BPM control', () => {
    expect(css).toContain('.daw-transport-bpm-input');
  });
});

describe('Session zoom/fit control wiring (#1284)', () => {
  it('dawShellHTML emits the compact zoom/fit cluster', () => {
    expect(workspaceViewTs).toContain('timelineZoomControlsHTML(');
  });

  it('LiveCapturePanel dispatches clicks through the pure id lookup and reducer', () => {
    expect(liveCapturePanelTsx).toContain('applyTimelineZoom(');
    expect(liveCapturePanelTsx).toContain('timelineZoomActionForId(');
  });

  it("fit-full shares the overview strip's duration rule, not a second one", () => {
    expect(liveCapturePanelTsx).toContain('timelineOverviewDurationSecs(');
  });

  it('app.css styles the zoom/fit cluster', () => {
    expect(css).toContain('.daw-transport-zoom');
  });

  it('the visible-range model never imports the shell runtime or computes a pixel value (ADR)', () => {
    const zoomControlsTs = fs.readFileSync(fileURLToPath(new URL('./timeline-zoom-controls.ts', import.meta.url)), 'utf8');
    expect(zoomControlsTs).not.toMatch(/from '\.\/daw-shell-runtime'/);
    expect(zoomControlsTs).not.toContain("'px'");
  });

  it('the shared visible-range model (#1290) never imports the shell runtime, the tempo model, the store, or computes a pixel value (ADR)', () => {
    expect(timelineVisibleRangeTs).not.toMatch(/from '\.\/daw-shell-runtime'/);
    expect(timelineVisibleRangeTs).not.toContain("'px'");
    expect(timelineVisibleRangeTs).not.toMatch(/from '\.\/timeline-bpm'/);
    expect(timelineVisibleRangeTs).not.toMatch(/from '\.\/stores\//);
  });
});

describe('Session follow-scroll toggle wiring (#1286)', () => {
  it('dawShellHTML emits the Follow toggle', () => {
    expect(workspaceViewTs).toContain('timelineFollowButtonHTML(');
  });

  it('LiveCapturePanel pauses on a manual timeline wheel and resumes from play/seek/navigate', () => {
    expect(liveCapturePanelTsx).toContain('timelineFollowEventForWheel(');
    expect(liveCapturePanelTsx).toContain("applyTimelineFollowEvent(m, 'play')");
    expect(liveCapturePanelTsx).toContain("applyTimelineFollowEvent(m, 'seek')");
    expect(liveCapturePanelTsx).toContain("applyTimelineFollowEvent(m, 'navigate')");
    expect(liveCapturePanelTsx).toContain("applyTimelineFollowEvent(m, 'toggle')");
  });

  it('app.css styles the follow toggle', () => {
    expect(css).toContain('.daw-follow-btn');
  });

  it('the follow model never imports the shell runtime, the store, or the tempo model (ADR-0104/0107)', () => {
    expect(timelineFollowScrollTs).not.toMatch(/from '\.\/daw-shell-runtime'/);
    expect(timelineFollowScrollTs).not.toMatch(/from '\.\/timeline-bpm'/);
    expect(timelineFollowScrollTs).not.toMatch(/from '\.\/stores\//);
  });

  it('LiveCapturePanel pages the visible range from the playback frame (#1343)', () => {
    expect(liveCapturePanelTsx).toContain('timelineFollowPage(');
    expect(liveCapturePanelTsx).toContain('followTickRef.current(tick.elapsed)');
  });
});

describe('Session horizontal scroll gestures (#1292)', () => {
  it('LiveCapturePanel applies the scroll gesture, patches the offset, and resolves it from the range', () => {
    expect(liveCapturePanelTsx).toContain('applyTimelineScroll(');
    expect(liveCapturePanelTsx).toContain('patchTimelineScrollOffset(');
    expect(liveCapturePanelTsx).toContain('timelineScrollOffsetPx(');
  });

  it('app.css gives --daw-scroll-x a 0px default and the shared re-basing translate applies both terms', () => {
    expect(css).toContain('--daw-scroll-x:0px');
    expect(css).toMatch(/translateX\(calc\(-1 \* \(var\(--daw-head-w\) \+ var\(--daw-scroll-x, 0px\)\)\)\)/);
  });

  it('the gesture module owns no clamp and no scale of its own (ADR)', () => {
    expect(timelineScrollGestureTs).toMatch(/from '\.\/timeline-visible-range'/);
    expect(timelineScrollGestureTs).toMatch(/from '\.\/timeline-scale'/);
    expect(timelineScrollGestureTs).not.toMatch(/from '\.\/daw-shell-runtime'/);
    expect(timelineScrollGestureTs).not.toMatch(/from '\.\/stores\//);
  });
});

describe('Session zoom gestures (#1291)', () => {
  it('LiveCapturePanel applies the zoom gesture on the timeline wheel', () => {
    expect(liveCapturePanelTsx).toContain('applyTimelineZoomGesture(');
  });

  it('the gesture module owns no clamp, no scale and no second unit conversion of its own (ADR)', () => {
    expect(timelineZoomGestureTs).toMatch(/from '\.\/timeline-visible-range'/);
    expect(timelineZoomGestureTs).toMatch(/from '\.\/timeline-scroll-gesture'/);
    expect(timelineZoomGestureTs).not.toMatch(/from '\.\/daw-shell-runtime'/);
    expect(timelineZoomGestureTs).not.toMatch(/from '\.\/timeline-bpm'/);
    expect(timelineZoomGestureTs).not.toMatch(/from '\.\/stores\//);
  });

  it('the buttons and the gesture share ONE anchor rule', () => {
    const zoomControlsTs = fs.readFileSync(fileURLToPath(new URL('./timeline-zoom-controls.ts', import.meta.url)), 'utf8');
    expect(zoomControlsTs).toContain('visibleRangeAnchorSecs(');
    expect(zoomControlsTs).not.toMatch(/function anchorSecs\(/);
  });
});

describe('Session routing drawer layout (#1089)', () => {
  it('uses a named fixed drawer height while preserving the flexible arrangement timeline', () => {
    expect(css).toContain('--daw-routing-drawer-h');
    const drawerRule = css.match(/\.daw-session-routing-drawer\s*\{[^}]*\}/);
    const arrangementRule = css.match(/\.daw-arrangement\s*\{[^}]*\}/);

    expect(drawerRule).not.toBeNull();
    expect(drawerRule![0]).toMatch(/flex:\s*0 0 var\(--daw-routing-drawer-h\)/);
    expect(drawerRule![0]).toMatch(/width:\s*100%/);
    expect(drawerRule![0]).toMatch(/box-sizing:\s*border-box/);
    expect(arrangementRule).not.toBeNull();
    expect(arrangementRule![0]).toMatch(/flex:\s*1/);
    expect(arrangementRule![0]).toMatch(/min-height:\s*0/);
  });
});

describe('DAW playhead/waveform painters moved off inline-app.js (TD-001 slice 6j, #713)', () => {
  it('inline-app.js no longer owns any part of the playhead/waveform painting surface', () => {
    expect(inlineApp).not.toMatch(/function renderDawPlayhead\(/);
    expect(inlineApp).not.toMatch(/function renderDawWaveform\(/);
    expect(inlineApp).not.toMatch(/function drawWaveformLane\(/);
    expect(inlineApp).not.toMatch(/function scheduleDawWaveformRender\(/);
    expect(inlineApp).not.toMatch(/startPlayheadTicker/);
    expect(inlineApp).not.toMatch(/stopPlayheadTicker/);
    expect(inlineApp).not.toMatch(/window\.dawShellRuntime\s*=/);
    expect(inlineApp).not.toMatch(/PLAYHEAD_TICK_MS/);
    expect(inlineApp).not.toMatch(/WAVEFORM_COLORS/);
  });

  it('inline-app.js no longer has a peaks branch or the playhead-state module var seed', () => {
    expect(inlineApp).not.toMatch(/data\.type === 'peaks'/);
    expect(inlineApp).not.toMatch(/playheadState = window\.dawPlayheadState\.start/);
  });

  it('daw-shell-runtime.ts is the new home for the painters, scheduling, and the peaks-event bridge', () => {
    expect(dawShellRuntimeTs).toContain('export function createDawShellRuntime(');
    expect(dawShellRuntimeTs).toContain('WAVEFORM_COLORS');
    expect(dawShellRuntimeTs).toContain('DAW_TIMELINE_PX_PER_SECOND');
    expect(dawShellRuntimeTs).toContain('DAW_TIMELINE_INSET_PX');
    expect(dawShellRuntimeTs).toContain('export function drawDawWaveformLane(');
    expect(dawShellRuntimeTs).toContain('function scheduleWaveformRender(');
    expect(dawShellRuntimeTs).toContain('function bindLiveEvents(');
    expect(dawShellRuntimeTs).toContain('function ingestPeaks(');
  });

  it('App.tsx installs the runtime onto window.dawShellRuntime and binds its live-event listener', () => {
    expect(appTsx).toContain('createDawShellRuntime({');
    expect(appTsx).toContain('.dawShellRuntime = dawShellRuntime;');
    expect(appTsx).toContain('dawShellRuntime.bindLiveEvents()');
    expect(appTsx).toContain('getTimelineScale:');
  });

  it('LiveCapturePanel.tsx drives the playhead with a requestAnimationFrame loop', () => {
    expect(liveCapturePanelTsx).toContain('requestAnimationFrame(tick)');
  });
});

describe('shared DAW timeline geometry contract (#1031)', () => {
  it('exports exactly one pixels-per-second scale, the shared time origin, and the pure coordinate function', () => {
    expect(dawShellRuntimeTs).toContain('export const DAW_TIMELINE_PX_PER_SECOND');
    expect(dawShellRuntimeTs).toContain('export const DAW_TIMELINE_ORIGIN_PX');
    expect(dawShellRuntimeTs).toContain('export function dawTimelineX(timeSecs: number): number');
  });

  it('no longer exports the playhead-scoped PLAYHEAD_PX_PER_SECOND name', () => {
    expect(dawShellRuntimeTs).not.toMatch(/PLAYHEAD_PX_PER_SECOND/);
  });

  it("dawTimelineX's body derives its result from the shared constants, not a hardcoded numeric literal", () => {
    const body = enclosingBlock(dawShellRuntimeTs, 'DAW_TIMELINE_ORIGIN_PX + timeSecs * DAW_TIMELINE_PX_PER_SECOND');
    expect(body).not.toMatch(/\d/);
  });
});

describe('ruler ticks derive from the shared timeline geometry (#1032)', () => {
  it('dawShellHTML renders ruler ticks built from dawRulerTicks', () => {
    expect(workspaceViewTs).toContain('dawRulerTicks(');
    expect(workspaceViewTs).toContain('daw-ruler-tick');
  });

  it('the ruler tick markup is imported from the shared geometry module, not reimplemented', () => {
    expect(workspaceViewTs).toMatch(/import \{[^}]*dawRulerTicks[^}]*\} from '\.\/daw-shell-runtime'/s);
  });

  it('daw-shell-runtime.ts exports the ruler tick geometry', () => {
    expect(dawShellRuntimeTs).toContain('export function dawRulerTicks(spanSecs: number, scale?: TimelineScale): DawRulerTick[]');
    expect(dawShellRuntimeTs).toContain('export const DAW_RULER_TICK_INTERVAL_SECS');
  });

  it('no ruler-local pixels-per-second value survives in the ruler tick builder or the CSS', () => {
    const rulerRule = css.match(/\.daw-ruler\s*\{[^}]*\}/);
    expect(rulerRule).not.toBeNull();
    expect(rulerRule![0]).not.toContain('repeating-linear-gradient');
    expect(css).toContain('.daw-ruler-tick');
    const builderBody = functionBody(workspaceViewTs, 'dawShellHTML');
    expect(builderBody).toContain('dawRulerTicks');
    expect(workspaceViewTs).not.toMatch(/PX_PER_SECOND\s*=/);
  });

  it("dawRulerTicks' body computes each tick's x through the resolved shared time-to-x function", () => {
    expect(functionBody(dawShellRuntimeTs, 'dawRulerTicks')).toContain('timeToX(timeSecs)');
  });
});

describe('lane gridlines derive from the shared timeline geometry (#1033)', () => {
  it('dawShellHTML renders lane gridlines built from dawLaneGridlines', () => {
    expect(workspaceViewTs).toContain('dawLaneGridlines(');
    expect(workspaceViewTs).toContain('daw-gridline');
  });

  it('the lane gridline markup is imported from the shared geometry module, not reimplemented', () => {
    expect(workspaceViewTs).toMatch(/import \{[^}]*dawLaneGridlines[^}]*\} from '\.\/daw-shell-runtime'/s);
  });

  it('daw-shell-runtime.ts exports the lane gridline geometry', () => {
    expect(dawShellRuntimeTs).toContain('export function dawLaneGridlines(spanSecs: number, scale?: TimelineScale): DawLaneGridline[]');
    expect(dawShellRuntimeTs).toContain('export const DAW_LANE_GRID_MINOR_SECS');
    expect(dawShellRuntimeTs).toContain('export const DAW_LANE_GRID_MAJOR_SECS');
  });

  it('no lane-local pixels-per-second value survives in the lane gridline builder or the CSS', () => {
    expect(css).toContain('.daw-gridline');
    const laneRule = css.match(/\.daw-lane\s*\{[^}]*\}/);
    expect(laneRule).not.toBeNull();
    expect(laneRule![0]).not.toContain('repeating-linear-gradient');
    const builderBody = functionBody(workspaceViewTs, 'dawShellHTML');
    expect(builderBody).toContain('dawLaneGridlines');
    expect(workspaceViewTs).not.toMatch(/PX_PER_SECOND\s*=/);
  });

  it("dawLaneGridlines' body computes each line's x through the resolved shared time-to-x function", () => {
    expect(functionBody(dawShellRuntimeTs, 'dawLaneGridlines')).toContain('timeToX(timeSecs)');
  });

  it('dawShellHTML injects the shared timeline scale into both builders (#1263)', () => {
    expect(workspaceViewTs).toMatch(/import \{[^}]*createTimelineScale[^}]*\} from '\.\/timeline-scale'/s);
    // #1282 hoists the resolved scale to a module-level SESSION_TIMELINE_SCALE
    // (exported so LiveCapturePanel's overview patch reads the same value the
    // builder used) instead of calling createTimelineScale('default') inline.
    expect(workspaceViewTs).toContain("export const SESSION_TIMELINE_SCALE = createTimelineScale('default');");
    const builderBody = functionBody(workspaceViewTs, 'dawShellHTML');
    expect(builderBody).toContain('const timelineScale = SESSION_TIMELINE_SCALE;');
    expect(builderBody).toContain('dawRulerTicks(DAW_TIMELINE_SPAN_SECS, timelineScale)');
    expect(builderBody).toContain('dawLaneGridlines(DAW_TIMELINE_SPAN_SECS, timelineScale)');
  });

  it('daw-shell-runtime.ts imports the scale type-only, keeping the module graph acyclic (#1263)', () => {
    expect(dawShellRuntimeTs).toContain("import type { TimelineScale } from './timeline-scale'");
    expect(dawShellRuntimeTs).not.toMatch(/^import \{[^}]*\} from '\.\/timeline-scale'/m);
  });
});

describe('semantic arrangement frame (#1042)', () => {
  it('dawShellHTML emits the arrangement container, head column, timeline column and lane column', () => {
    const builderBody = functionBody(workspaceViewTs, 'dawShellHTML');
    expect(builderBody).toContain('daw-arrangement');
    expect(builderBody).toContain('daw-track-heads');
    expect(builderBody).toContain('daw-timeline');
    expect(builderBody).toContain('daw-lane-column');
  });

  it('the ruler is emitted inside the timeline column, ahead of the lane column', () => {
    const builderBody = functionBody(workspaceViewTs, 'dawShellHTML');
    const timeline = builderBody.indexOf('daw-timeline');
    const ruler = builderBody.indexOf('daw-ruler">');
    const laneColumn = builderBody.indexOf('daw-lane-column');
    expect(builderBody.indexOf('daw-track-heads')).toBeLessThan(timeline);
    expect(ruler).toBeGreaterThan(timeline);
    expect(laneColumn).toBeGreaterThan(ruler);
  });

  it('the head width is emitted from the shared timeline origin, never hardcoded in the CSS (ADR-0086)', () => {
    expect(functionBody(workspaceViewTs, 'dawShellHTML')).toContain('--daw-head-w:${DAW_TIMELINE_ORIGIN_PX}px');
    expect(workspaceViewTs).toMatch(/import \{[^}]*DAW_TIMELINE_ORIGIN_PX[^}]*\} from '\.\/daw-shell-runtime'/s);
    expect(css).toContain('var(--daw-head-w)');
    expect(css).not.toMatch(/--daw-head-w:\s*208px/);
  });

  it('app.css styles the arrangement frame', () => {
    expect(css).toContain('.daw-arrangement');
    expect(css).toContain('.daw-track-heads');
    expect(css).toContain('.daw-timeline');
    expect(css).toContain('.daw-lane-column');
  });
});

describe('configured track rows render from one shared list (#1043)', () => {
  it('live-workspace-view.ts exports the shared per-track row list', () => {
    expect(workspaceViewTs).toContain('export function dawTrackRows(');
  });

  it('dawShellHTML derives both columns from that one list, not a second channelConfig map', () => {
    const body = functionBody(workspaceViewTs, 'dawShellHTML');
    expect(body).toContain('dawTrackRows(state)');
    expect(body).toContain('daw-track-head');
    expect(body).toContain('daw-channel-lane');
    expect(body).not.toContain('state.channelConfig.map(');
  });

  it('dawShellPatchView fingerprints the same shared list', () => {
    expect(functionBody(workspaceViewTs, 'dawShellPatchView')).toContain('dawTrackRows(');
  });

  it('the head rows stay inside the head column', () => {
    const body = functionBody(workspaceViewTs, 'dawShellHTML');
    expect(body.indexOf('daw-track-heads')).toBeLessThan(body.indexOf('daw-timeline'));
  });

  it('app.css styles the head row', () => {
    expect(css).toContain('.daw-track-head');
    expect(css).toContain('.daw-track-head-index');
    expect(css).toContain('.daw-track-head-name');
  });

  it('de-crowds the fixed-height channel strip into a compact input/title row and control/meter row (#1125)', () => {
    const headRule = css.match(/\.daw-track-head\s*\{[^}]*\}/);
    const controlsRule = css.match(/\.daw-track-head-controls\s*\{[^}]*\}/);
    const levelRule = css.match(/\.daw-track-head-level\s*\{[^}]*\}/);
    const nameRule = css.match(/\.daw-track-head \.daw-track-head-name\s*\{[^}]*\}/);
    const armIconRule = css.match(/\.daw-track-head-arm::before\s*\{[^}]*\}/);

    expect(headRule).not.toBeNull();
    expect(controlsRule).not.toBeNull();
    expect(levelRule).not.toBeNull();
    expect(nameRule).not.toBeNull();
    expect(armIconRule).not.toBeNull();
    expect(headRule![0]).toContain("grid-template-areas:'drag name name remove' 'index controls meter meta'");
    expect(headRule![0]).toMatch(/grid-template-columns:\s*auto auto minmax\(0,\s*1fr\) auto/);
    expect(armIconRule![0]).toMatch(/border-radius:\s*50%/);
    expect(controlsRule![0]).toMatch(/gap:\s*4px/);
    expect(levelRule![0]).toMatch(/justify-self:\s*stretch/);
    expect(nameRule![0]).toMatch(/max-width:\s*100%/);
  });

  it('allows DAW header select hit targets to still select the strip row', () => {
    const body = functionBody(liveCapturePanelTsx, 'onBoardClick');
    expect(body).toContain("!target.closest('button, [contenteditable], input')");
    expect(body).not.toContain("!target.closest('button, select, [contenteditable], input')");
  });

  it('keeps per-channel setting controls out of the head row (#849)', () => {
    expect(functionBody(workspaceViewTs, 'dawTrackHeaderHTML')).not.toContain('<select');
    expect(liveCapturePanelTsx).not.toContain('.daw-track-head-input');
    expect(liveCapturePanelTsx).not.toContain("closest('.daw-track-head select')");
  });

  it('head and lane rows share one height source, and neither hardcodes a height literal', () => {
    expect(css).toContain('--daw-track-row-h');
    const headRule = css.match(/\.daw-track-head\s*\{[^}]*\}/);
    const laneRule = css.match(/\.daw-channel-lane\s*\{[^}]*\}/);
    expect(headRule).not.toBeNull();
    expect(laneRule).not.toBeNull();
    expect(headRule![0]).toMatch(/height:\s*var\(--daw-track-row-h\)/);
    expect(laneRule![0]).toMatch(/height:\s*var\(--daw-track-row-h\)/);
    expect(headRule![0]).not.toMatch(/height:\s*\d/);
    expect(laneRule![0]).not.toMatch(/height:\s*\d/);
  });
});

describe('overall-mix row and arrangement status (#1044)', () => {
  it('live-workspace-view.ts exports the status-line view', () => {
    expect(workspaceViewTs).toContain('export function dawStatusLineView(');
  });

  it('dawShellHTML emits the master head and status line, derived from dawStatusLineView', () => {
    const body = functionBody(workspaceViewTs, 'dawShellHTML');
    expect(body).toContain('daw-master-head');
    expect(body).toContain('daw-status-line');
    expect(body).toContain('dawStatusLineView(state)');
  });

  it('the master head closes the head column and the status line follows the arrangement', () => {
    const body = functionBody(workspaceViewTs, 'dawShellHTML');
    // headRowsHTML is per-track, or the paired empty head (#1043/#1048);
    // masterHeadHTML is the overall-mix row's head cell (#1044) — this literal
    // interpolation order is what puts the master head last inside
    // .daw-track-heads, after the ruler gutter that opens it (#1048).
    expect(body).toContain('${rulerGutterHTML}${headRowsHTML}${masterHeadHTML}');
    expect(body.indexOf('daw-status-line')).toBeGreaterThan(body.indexOf('daw-arrangement'));
  });

  it('dawStatusLineView derives from the shared track list and the patch view, never a second transportLabel call', () => {
    const body = functionBody(workspaceViewTs, 'dawStatusLineView');
    expect(body).toContain('dawTrackRows(');
    expect(body).toContain('dawShellPatchView(');
    expect(body).not.toContain('transportLabel(');
  });

  it('app.css styles the master head and status line', () => {
    expect(css).toContain('.daw-master-head');
    expect(css).toContain('.daw-status-line');
    expect(css).toContain('--daw-master-row-h');
    expect(css).toContain('--daw-status-line-h');
  });

  it('the master head and mix lane share one height source, and neither hardcodes a height literal', () => {
    const masterHeadRule = css.match(/\.daw-master-head\s*\{[^}]*\}/);
    const mixLaneRule = css.match(/\.daw-mix-lane\s*\{[^}]*\}/);
    expect(masterHeadRule).not.toBeNull();
    expect(mixLaneRule).not.toBeNull();
    expect(masterHeadRule![0]).toMatch(/height:\s*var\(--daw-master-row-h\)/);
    expect(mixLaneRule![0]).toMatch(/height:\s*var\(--daw-master-row-h\)/);
    expect(masterHeadRule![0]).not.toMatch(/height:\s*\d/);
    expect(mixLaneRule![0]).not.toMatch(/height:\s*\d/);
  });

  it('the status line reads its height from the shared custom property', () => {
    const statusLineRule = css.match(/\.daw-status-line\s*\{[^}]*\}/);
    expect(statusLineRule).not.toBeNull();
    expect(statusLineRule![0]).toMatch(/height:\s*var\(--daw-status-line-h\)/);
  });
});

describe('arrangement header and lane-column boundary (#1048)', () => {
  it('the arrangement lays its two columns out side by side', () => {
    const rule = css.match(/\.daw-arrangement\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toMatch(/flex-direction:\s*row/);
    expect(rule![0]).not.toMatch(/flex-direction:\s*column/);
  });

  it('the track-head column is fixed at the shared head width and never hardcodes 208px', () => {
    const rule = css.match(/\.daw-track-heads\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toMatch(/flex:\s*0 0 var\(--daw-head-w\)/);
    expect(rule![0]).not.toMatch(/width:\s*\d/);
    expect(css).not.toMatch(/--daw-head-w:\s*208px/);
  });

  it('the timeline column takes the remaining width and cannot squeeze the head column', () => {
    const rule = css.match(/\.daw-timeline\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toMatch(/flex:\s*1/);
    expect(rule![0]).toMatch(/min-width:\s*0/);
  });

  it('one shared rule re-bases every timeline child by exactly one head width, with no numeric offset', () => {
    const rebase = css.match(/\.daw-ruler-tick\s*,[^{]*\{[^}]*\}/);
    expect(rebase).not.toBeNull();
    expect(rebase![0]).toMatch(/transform:\s*translateX\(calc\(-1 \* \(var\(--daw-head-w\) \+ var\(--daw-scroll-x, 0px\)\)\)\)/);
    for (const cls of ['.daw-ruler-tick', '.daw-ruler-label', '.daw-gridline', '.daw-playhead', '.daw-insert-marker', '.daw-take-clip']) {
      expect(rebase![0]).toContain(cls);
    }
    const tickRule = css.match(/\.daw-ruler-tick\s*\{[^}]*\}/);
    const gridlineRule = css.match(/\.daw-gridline\s*\{[^}]*\}/);
    const takeClipRule = css.match(/\.daw-take-clip\s*\{[^}]*\}/);
    expect(tickRule).not.toBeNull();
    expect(gridlineRule).not.toBeNull();
    expect(takeClipRule).not.toBeNull();
    expect(tickRule![0]).not.toMatch(/transform|left:\s*\d/);
    expect(gridlineRule![0]).not.toMatch(/transform|left:\s*\d/);
    expect(takeClipRule![0]).not.toMatch(/left:\s*\d/);
    expect(css).toMatch(/\.daw-take-clip\s*\{[^}]*overflow:\s*hidden[^}]*pointer-events:\s*none/);
    const labelRule = css.match(/\.daw-ruler-label\s*\{[^}]*\}/);
    expect(labelRule).not.toBeNull();
    expect(labelRule![0]).not.toMatch(/transform|left:\s*\d/);
  });

  it('the ruler label re-bases through the shared rule and carries no numeric offset (#1275)', () => {
    const rebase = css.match(/\.daw-ruler-tick\s*,[^{]*\{[^}]*\}/);
    expect(rebase).not.toBeNull();
    const labelRule = css.match(/\.daw-ruler-label\s*\{[^}]*\}/);
    expect(labelRule).not.toBeNull();
    expect(labelRule![0]).toMatch(/position:\s*absolute/);
    expect(labelRule![0]).toMatch(/pointer-events:\s*none/);
    expect(labelRule![0]).not.toMatch(/transform|left:\s*\d/);
    const barsRule = css.match(/\.daw-ruler-label-bars\s*\{[^}]*\}/);
    const timeRule = css.match(/\.daw-ruler-label-time\s*\{[^}]*\}/);
    expect(barsRule).not.toBeNull();
    expect(timeRule).not.toBeNull();
  });

  it('the head column opens with a ruler gutter that shares the ruler row height', () => {
    const body = functionBody(workspaceViewTs, 'dawShellHTML');
    expect(body).toContain('daw-ruler-gutter');
    expect(body.indexOf('daw-ruler-gutter')).toBeLessThan(body.indexOf('daw-track-head'));
    expect(body.indexOf('daw-ruler-gutter')).toBeLessThan(body.indexOf('masterHeadHTML'));
    const gutterRule = css.match(/\.daw-ruler-gutter\s*\{[^}]*\}/);
    const rulerRule = css.match(/\.daw-ruler\s*\{[^}]*\}/);
    expect(gutterRule).not.toBeNull();
    expect(rulerRule).not.toBeNull();
    expect(gutterRule![0]).toMatch(/height:\s*var\(--daw-ruler-row-h\)/);
    expect(rulerRule![0]).toMatch(/height:\s*var\(--daw-ruler-row-h\)/);
    expect(gutterRule![0]).not.toMatch(/height:\s*\d/);
    expect(rulerRule![0]).not.toMatch(/height:\s*\d/);
    expect(css).toMatch(/\.daw-shell\s*\{[^}]*--daw-ruler-row-h:/);
  });

  it('the zero-track empty state is emitted as a paired head row', () => {
    const body = functionBody(workspaceViewTs, 'dawShellHTML');
    expect(body).toContain('daw-empty-head');
    const rule = css.match(/\.daw-empty-head\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toMatch(/height:\s*var\(--daw-track-row-h\)/);
  });

  it('every ruler tick and lane gridline sits at or right of the lane-column left edge', () => {
    for (const t of dawRulerTicks(DAW_TIMELINE_SPAN_SECS)) {
      expect(t.xPx - DAW_TIMELINE_ORIGIN_PX).toBe(t.timeSecs * DAW_TIMELINE_PX_PER_SECOND);
      expect(t.xPx).toBeGreaterThanOrEqual(DAW_TIMELINE_ORIGIN_PX);
    }
    for (const g of dawLaneGridlines(DAW_TIMELINE_SPAN_SECS)) {
      expect(g.xPx - DAW_TIMELINE_ORIGIN_PX).toBe(g.timeSecs * DAW_TIMELINE_PX_PER_SECOND);
      expect(g.xPx).toBeGreaterThanOrEqual(DAW_TIMELINE_ORIGIN_PX);
    }
  });

  it('the ruler origin and the first gridline of every lane are the same edge', () => {
    expect(dawRulerTicks(DAW_TIMELINE_SPAN_SECS)[0].xPx).toBe(DAW_TIMELINE_ORIGIN_PX);
    expect(dawLaneGridlines(DAW_TIMELINE_SPAN_SECS)[0].xPx).toBe(DAW_TIMELINE_ORIGIN_PX);
  });
});

describe('the arrangement playhead spans both timeline regions (#1049)', () => {
  it('dawShellHTML emits one segment per region and none at the shell level', () => {
    const body = functionBody(workspaceViewTs, 'dawShellHTML');
    expect(body).toContain('daw-playhead daw-playhead-ruler');
    expect(body).toContain('daw-playhead daw-playhead-lanes');
    expect(body).not.toContain('<div class="daw-playhead"></div>');
  });

  it('the playhead re-bases through the same shared rule as the ticks and gridlines', () => {
    const rebase = css.match(/\.daw-ruler-tick\s*,[^{]*\{[^}]*\}/);
    expect(rebase).not.toBeNull();
    expect(rebase![0]).toMatch(/transform:\s*translateX\(calc\(-1 \* \(var\(--daw-head-w\) \+ var\(--daw-scroll-x, 0px\)\)\)\)/);
    // A playhead-local transform would shadow the shared re-base.
    const rule = css.match(/\.daw-playhead\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).not.toContain('transform');
    expect(rule![0]).not.toMatch(/left:\s*[1-9]/);
    expect(rule![0]).toMatch(/z-index:\s*2/);
  });

  it('each segment spans its own region, not a shell-relative offset', () => {
    const rule = css.match(/\.daw-playhead\s*\{[^}]*\}/);
    expect(rule![0]).toMatch(/top:\s*0/);
    expect(rule![0]).toMatch(/bottom:\s*0/);
    const laneColumn = css.match(/\.daw-lane-column\s*\{[^}]*\}/);
    expect(laneColumn).not.toBeNull();
    expect(laneColumn![0]).toMatch(/position:\s*relative/);
  });

  it('monitoring mode does not paint the mix lane with the gold timeline accent', () => {
    expect(css).not.toMatch(/\.daw-mix-lane\[data-capture-mode="monitoring"\]\s*\{[^}]*border-left/);
    expect(css).not.toMatch(/\.daw-mix-lane\[data-capture-mode="monitoring"\]\s+\.daw-lane-name\s*\{[^}]*gold/);
  });

  it('renderPlayhead computes one x and writes it to every segment', () => {
    const body = functionBody(dawShellRuntimeTs, 'renderPlayhead');
    expect(body).toContain("querySelectorAll('.daw-playhead')");
    expect(body).toContain('style.left');
    expect(body).not.toContain('style.transform');
    expect((body.match(/dawPlayheadX\(/g) ?? []).length).toBe(1);
  });

  it('the one shared x lands on the ruler tick and the lane gridline for the same instant', () => {
    const MS = 1000;
    const wide = dawTimelineX(DAW_TIMELINE_SPAN_SECS) + DAW_TIMELINE_INSET_PX;
    for (const tick of dawRulerTicks(DAW_TIMELINE_SPAN_SECS)) {
      expect(dawPlayheadX(tick.timeSecs * MS, wide)).toBe(tick.xPx);
    }
    for (const line of dawLaneGridlines(DAW_TIMELINE_SPAN_SECS)) {
      expect(dawPlayheadX(line.timeSecs * MS, wide)).toBe(line.xPx);
    }
  });
});

describe('the arrangement insert marker is distinct from the playhead (#1301)', () => {
  it('dawShellHTML emits the two insert-marker region segments', () => {
    const body = functionBody(workspaceViewTs, 'dawShellHTML');
    expect(body).toContain('daw-insert-marker daw-insert-marker-ruler');
    expect(body).toContain('daw-insert-marker daw-insert-marker-lanes');
  });

  it('both marker segments are emitted before their region\'s playhead segment', () => {
    const body = functionBody(workspaceViewTs, 'dawShellHTML');
    expect(body.indexOf('daw-insert-marker-ruler')).toBeLessThan(body.indexOf('daw-playhead-ruler'));
    expect(body.indexOf('daw-insert-marker-lanes')).toBeLessThan(body.indexOf('daw-playhead-lanes'));
  });

  it('the marker renders unconditionally, unlike the playhead', () => {
    const body = functionBody(workspaceViewTs, 'dawShellHTML');
    expect(body).not.toContain('playheadVisible ? `<span class="daw-insert-marker');
  });

  it('the .daw-insert-marker rule exists and carries no offset of its own', () => {
    const rule = css.match(/\.daw-insert-marker\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toMatch(/position:\s*absolute/);
    expect(rule![0]).toMatch(/pointer-events:\s*none/);
    expect(rule![0]).not.toContain('transform');
    expect(rule![0]).not.toMatch(/left:\s*[1-9]/);
  });

  it('is distinguished from the playhead by width and background (AC #2)', () => {
    const markerRule = css.match(/\.daw-insert-marker\s*\{[^}]*\}/);
    const playheadRule = css.match(/\.daw-playhead\s*\{[^}]*\}/);
    expect(markerRule).not.toBeNull();
    expect(playheadRule).not.toBeNull();
    const markerWidth = markerRule![0].match(/width:\s*([^;]+);/)?.[1];
    const playheadWidth = playheadRule![0].match(/width:\s*([^;]+);/)?.[1];
    const markerBg = markerRule![0].match(/background:\s*([^;]+);/)?.[1];
    const playheadBg = playheadRule![0].match(/background:\s*([^;]+);/)?.[1];
    expect(markerWidth).not.toBe(playheadWidth);
    expect(markerBg).not.toBe(playheadBg);
    expect(css).toMatch(/\.daw-insert-marker-ruler::after\s*\{[^}]*\}/);
  });

  it('renderInsertMarker computes its x through the shared geometry', () => {
    const body = functionBody(dawShellRuntimeTs, 'renderInsertMarker');
    expect(body).toContain('dawPlayheadX(');
    expect(body).toContain("querySelectorAll('.daw-insert-marker')");
    expect(body).toContain('style.left');
    expect(body).not.toContain('style.transform');
  });

  it('renderPlayhead still contains exactly one dawPlayheadX( call', () => {
    const body = functionBody(dawShellRuntimeTs, 'renderPlayhead');
    expect((body.match(/dawPlayheadX\(/g) ?? []).length).toBe(1);
  });
});

describe('playhead placement derives from the shared timeline geometry (#1034)', () => {
  // Wide enough that no clamp applies anywhere in the default span.
  const UNCLAMPED_WIDTH_PX = dawTimelineX(DAW_TIMELINE_SPAN_SECS) + DAW_TIMELINE_INSET_PX;
  const MS_PER_SECOND = 1000;

  it('daw-shell-runtime.ts exports the playhead coordinate', () => {
    expect(dawShellRuntimeTs).toContain('export function dawPlayheadX(elapsedMs: number, shellWidthPx: number): number');
  });

  it("dawPlayheadX's body computes its x through the shared dawTimelineX function", () => {
    expect(functionBody(dawShellRuntimeTs, 'dawPlayheadX')).toContain('dawTimelineX(');
  });

  it('renderPlayhead writes the transform from dawPlayheadX, not a playhead-local offset', () => {
    const body = functionBody(dawShellRuntimeTs, 'renderPlayhead');
    expect(body).toContain('dawPlayheadX(elapsed, shell.clientWidth)');
    expect(dawShellRuntimeTs).not.toMatch(/offsetPx/);
  });

  it('no playhead-local pixels-per-second value survives in the classic playhead-state script', () => {
    expect(dawPlayheadStateJs).not.toMatch(/pxPerSecond/);
    expect(dawPlayheadStateJs).not.toMatch(/offsetPx/);
  });

  it('the .daw-playhead rule carries no left offset of its own', () => {
    const rule = css.match(/\.daw-playhead\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).not.toMatch(/left:\s*[1-9]/);
  });

  it('the playhead coordinate equals the ruler tick coordinate for every tick time', () => {
    for (const tick of dawRulerTicks(DAW_TIMELINE_SPAN_SECS)) {
      expect(dawPlayheadX(tick.timeSecs * MS_PER_SECOND, UNCLAMPED_WIDTH_PX)).toBe(tick.xPx);
    }
  });

  it('the playhead coordinate equals the lane gridline coordinate for every gridline time', () => {
    for (const line of dawLaneGridlines(DAW_TIMELINE_SPAN_SECS)) {
      expect(dawPlayheadX(line.timeSecs * MS_PER_SECOND, UNCLAMPED_WIDTH_PX)).toBe(line.xPx);
    }
  });

  it('the playhead starts at the shared t=0 origin, the same x as the first tick and gridline', () => {
    expect(dawPlayheadX(0, UNCLAMPED_WIDTH_PX)).toBe(DAW_TIMELINE_ORIGIN_PX);
    expect(dawRulerTicks(DAW_TIMELINE_SPAN_SECS)[0].xPx).toBe(DAW_TIMELINE_ORIGIN_PX);
    expect(dawLaneGridlines(DAW_TIMELINE_SPAN_SECS)[0].xPx).toBe(DAW_TIMELINE_ORIGIN_PX);
  });
});

describe('DAW shell seam consumers unchanged by the 6j migration', () => {
  it('the capture lifecycle still starts the playhead and resets the waveform via the dawShell seam', () => {
    const block = enclosingBlock(lifecycleTs, 'shell?.startPlayhead(Date.now())');
    expect(block).toContain('shell?.startPlayhead(Date.now())');
    expect(block).toContain('shell?.resetWaveform(intervalSecs)');
  });

  it('the capture lifecycle still freezes the playhead through the dawShell seam on stop', () => {
    const stopBody = enclosingBlock(lifecycleTs, 'deps.dawShell()?.stopPlayhead()');
    expect(stopBody).toContain('deps.dawShell()?.stopPlayhead()');
  });

  it('LiveCapturePanel.tsx still re-paints the playhead/waveform after a shell rebuild', () => {
    expect(liveCapturePanelTsx).toContain('renderPlayhead');
    expect(liveCapturePanelTsx).toContain('renderWaveform');
  });

  it('live-workspace-view.ts still builds the shell markup and seeds the transport time from state', () => {
    expect(workspaceViewTs).toContain('export function dawShellHTML(');
    expect(workspaceViewTs).toContain('export function dawShellPatchView(');
    expect(workspaceViewTs).toMatch(/formatElapsed\(seededElapsed\)/);
  });

  it('the shell markup includes the transport time readout, playhead line, and waveform canvases', () => {
    expect(workspaceViewTs).toContain('daw-transport-time');
    expect(workspaceViewTs).toContain('daw-playhead');
    expect(workspaceViewTs).toContain('daw-mix-waveform');
    expect(workspaceViewTs).toContain('daw-channel-waveform');
    expect(workspaceViewTs).toContain('data-capture-mode');
  });

  it('app.css styles the playhead, transport time, and waveform canvases', () => {
    expect(css).toContain('.daw-playhead');
    expect(css).toContain('.daw-transport-time');
    expect(css).toContain('.daw-mix-waveform');
    expect(css).toContain('.daw-channel-waveform');
    expect(css).toContain('.daw-channel-lane .daw-lane-body');
  });

  it('App.tsx still boots the daw-playhead-state.js/daw-waveform-state.js classic scripts before the inline app script', () => {
    expect(appTsx).toContain('daw-playhead-state.js?raw');
    expect(appTsx).toContain('daw-waveform-state.js?raw');
    const playheadIdx = appTsx.indexOf('dawPlayheadStateSrc,');
    const waveformIdx = appTsx.indexOf('dawWaveformStateSrc,');
    const inlineIdx = appTsx.indexOf('inlineAppSrc,');
    expect(playheadIdx).toBeGreaterThan(-1);
    expect(waveformIdx).toBeGreaterThan(-1);
    expect(inlineIdx).toBeGreaterThan(-1);
    expect(playheadIdx).toBeLessThan(inlineIdx);
    expect(waveformIdx).toBeLessThan(inlineIdx);
  });
});

describe('BPM stays out of every coordinate owner (#1277, ADR-0104)', () => {
  // ADR-0104: the Session timeline's BPM is display-only — it labels the
  // bars/beats ruler and never participates in a coordinate, a transport
  // position, a scrub seek target, a clip duration, or a waveform bucket.
  // A future quantize/snap/warp feature must land in a new module with its
  // own ADR amending this list — it may not arrive by importing the tempo
  // model into one of the modules below.
  const coordinateOwners: [name: string, src: string][] = [
    ['timeline-scale.ts', timelineScaleTs],
    ['daw-shell-runtime.ts', dawShellRuntimeTs],
    ['session-tab-waveforms.ts', sessionTabWaveformsTs],
    ['soundcheck-waveform.ts', soundcheckWaveformTs],
    ['soundcheck-playhead.ts', soundcheckPlayheadTs],
    ['session-timeline-scrub.ts', sessionTimelineScrubTs],
    ['session-ruler-scrub.ts', sessionRulerScrubTs],
    ['session-tab-playback.ts', sessionTabPlaybackTs],
    ['timeline-follow-scroll.ts', timelineFollowScrollTs],
    ['timeline-scroll-gesture.ts', timelineScrollGestureTs],
  ];

  it.each(coordinateOwners)('%s does not import ./timeline-bpm', (_name, src) => {
    expect(src).not.toMatch(/from '\.\/timeline-bpm'/);
  });

  it('the ban is a live constraint, not a vacuous grep: timeline-ruler-labels.ts really does import both models', () => {
    expect(timelineRulerLabelsTs).toMatch(/from '\.\/timeline-bpm'/);
    expect(timelineRulerLabelsTs).toMatch(/from '\.\/timeline-scale'/);
  });
});

describe('lane-background click routing (#1302)', () => {
  it('LiveCapturePanel.tsx wires the lane-background route into onBoardPointerDown', () => {
    expect(liveCapturePanelTsx).toContain('applyLaneBackgroundClick(');
  });

  it('onBoardClick\'s only setSelectedChannel call sits inside its .daw-track-head branch', () => {
    const body = functionBody(liveCapturePanelTsx, 'onBoardClick');
    const occurrences = body.match(/setSelectedChannel/g);
    expect(occurrences).not.toBeNull();
    expect(occurrences!.length).toBe(1);
    const stripBranchIdx = body.indexOf("const stripEl = target.closest('.daw-track-head')");
    const callIdx = body.indexOf('setSelectedChannel');
    expect(stripBranchIdx).toBeGreaterThan(-1);
    expect(stripBranchIdx).toBeLessThan(callIdx);
  });

  it('the lane-background pointerdown route cannot reach setSelectedChannel — its entire effect surface is applyLaneBackgroundClick', () => {
    const body = functionBody(liveCapturePanelTsx, 'onBoardPointerDown');
    expect(body).toContain('applyLaneBackgroundClick(');
    expect(body).not.toContain('setSelectedChannel');
  });

  it('live-workspace-view.ts paints the take-clip class from the shared constant, not a duplicated literal', () => {
    expect(workspaceViewTs).toContain('LANE_TAKE_CLIP_CLASS');
    expect(workspaceViewTs).not.toContain('class="daw-take-clip"');
  });
});

describe('clip click routing (#1303)', () => {
  it("onBoardPointerDown wires applyClipClick before an early return, and it runs BEFORE applyLaneBackgroundClick", () => {
    const body = functionBody(liveCapturePanelTsx, 'onBoardPointerDown');
    expect(body).toContain('applyClipClick(');
    expect(body).toContain("if (clipDecision.kind !== 'none') return;");
    const clipIdx = body.indexOf('applyClipClick(');
    const backgroundIdx = body.indexOf('applyLaneBackgroundClick(');
    expect(clipIdx).toBeGreaterThan(-1);
    expect(backgroundIdx).toBeGreaterThan(-1);
    expect(clipIdx).toBeLessThan(backgroundIdx);
  });

  it('onBoardPointerDown still contains no setSelectedChannel (#1302 gate stays green)', () => {
    const body = functionBody(liveCapturePanelTsx, 'onBoardPointerDown');
    expect(body).not.toContain('setSelectedChannel');
  });

  it('the panel passes the real Option/Alt modifier as the seek override', () => {
    const body = functionBody(liveCapturePanelTsx, 'onBoardPointerDown');
    expect(body).toContain('overrideHeld: e.altKey');
  });

  it('clip-click.ts cannot reach the insert marker — no setInsertMarkerSecs, no timeline-state import', () => {
    expect(clipClickTs).not.toContain('setInsertMarkerSecs');
    expect(clipClickTs).not.toMatch(/from '\.\/timeline-state'/);
  });

  it("clip-click.ts reuses ADR-0115's hit-test rather than re-implementing it", () => {
    expect(clipClickTs).toMatch(/laneClipHitAt.*from '\.\/lane-background-click'/);
  });

  it('clip-selection.ts is a leaf module with no relative imports', () => {
    expect(clipSelectionTs).not.toMatch(/from '\.\//);
  });

  it('the selected clip is painted with an inset shadow, and the base take-clip rule is unchanged', () => {
    expect(css).toMatch(/\.daw-channel-lane\.clip-selected \.daw-take-clip\s*\{[^}]*box-shadow:\s*inset[^}]*var\(--gold-500\)/);
    expect(css).toMatch(/\.daw-take-clip\s*\{[^}]*overflow:\s*hidden[^}]*pointer-events:\s*none/);
  });
});

describe('time-selection drag routing (#1304)', () => {
  it('time-selection.ts is a leaf module with no relative imports', () => {
    expect(timeSelectionTs).not.toMatch(/from '\.\//);
  });

  it('time-selection-drag.ts cannot select a clip', () => {
    expect(timeSelectionDragTs).not.toContain('selectClip');
    expect(timeSelectionDragTs).not.toMatch(/from '\.\/clip-selection'/);
  });

  it('time-selection-drag.ts does not import the painter or the BPM module', () => {
    expect(timeSelectionDragTs).not.toMatch(/from '\.\/daw-shell-runtime'/);
    expect(timeSelectionDragTs).not.toMatch(/from '\.\/timeline-bpm'/);
  });

  it('onBoardPointerDown wires the drag, and does so BEFORE the scrub gate', () => {
    const body = functionBody(liveCapturePanelTsx, 'onBoardPointerDown');
    const dragIdx = body.indexOf('beginTimeSelectionDrag(');
    const gateIdx = body.indexOf('canBeginSessionScrub(kind, gate())');
    expect(dragIdx).toBeGreaterThanOrEqual(0);
    expect(dragIdx).toBeLessThan(gateIdx);
  });

  it("the scrub's commit is suppressed by a drag", () => {
    const body = functionBody(liveCapturePanelTsx, 'onBoardPointerDown');
    expect(body).toContain('!(timeDrag?.hasDragged() ?? false)');
  });

  it('onBoardPointerDown still contains no setSelectedChannel (#1302 gate stays green)', () => {
    const body = functionBody(liveCapturePanelTsx, 'onBoardPointerDown');
    expect(body).not.toContain('setSelectedChannel');
  });

  it('live-workspace-view.ts emits both band segments from the shared constant', () => {
    expect(workspaceViewTs).toContain('TIME_SELECTION_CLASS');
    expect(workspaceViewTs).toContain('daw-time-selection-ruler');
    expect(workspaceViewTs).toContain('daw-time-selection-lanes');
  });

  it('the band CSS rule is non-interactive, and the shared re-base translate lists it', () => {
    expect(css).toMatch(/\.daw-time-selection\s*\{[^}]*pointer-events:\s*none[^}]*\}/);
    expect(css).toMatch(/\.daw-ruler-tick,[^{]*\.daw-time-selection,[^{]*\{/);
  });

  it('App.tsx injects the shared time-selection model', () => {
    expect(appTsx).toContain('timeSelection: sessionTimeSelection');
  });
});

describe('scrub/seek selection preservation (#1305)', () => {
  it('session-timeline-scrub.ts is structurally incapable of touching selection state', () => {
    expect(sessionTimelineScrubTs).not.toMatch(/from '\.\/clip-selection'/);
    expect(sessionTimelineScrubTs).not.toMatch(/from '\.\/time-selection'/);
    expect(sessionTimelineScrubTs).not.toContain('selectClip');
    expect(sessionTimelineScrubTs).not.toContain('clearSelection');
  });
});

describe('arrangement accessibility labels (#1306)', () => {
  it('timeline-accessibility-labels.ts is a leaf module with no relative imports', () => {
    expect(timelineAccessibilityLabelsTs).not.toMatch(/from '\.\//);
  });

  it('dawShellHTML emits the hidden region and its four state spans, sourced from the shared constants', () => {
    const body = functionBody(workspaceViewTs, 'dawShellHTML');
    expect(body).toContain('${TIMELINE_A11Y_REGION_CLASS}');
    expect(body).toContain('role="group"');
    expect(body).toContain('aria-label="${TIMELINE_A11Y_REGION_LABEL}"');
    expect(body).toContain('${TIMELINE_A11Y_INSERT_MARKER_CLASS}');
    expect(body).toContain('${TIMELINE_A11Y_PLAYHEAD_CLASS}');
    expect(body).toContain('${TIMELINE_A11Y_CLIP_SELECTION_CLASS}');
    expect(body).toContain('${TIMELINE_A11Y_TIME_SELECTION_CLASS}');
    // The class/id constants live in timeline-accessibility-labels.ts, so markup and
    // painter read the same values and cannot drift.
    expect(timelineAccessibilityLabelsTs).toContain("TIMELINE_A11Y_REGION_CLASS = 'daw-arrangement-a11y'");
    expect(timelineAccessibilityLabelsTs).toContain("TIMELINE_A11Y_INSERT_MARKER_CLASS = 'daw-a11y-insert-marker'");
    expect(timelineAccessibilityLabelsTs).toContain("TIMELINE_A11Y_PLAYHEAD_CLASS = 'daw-a11y-playhead'");
    expect(timelineAccessibilityLabelsTs).toContain("TIMELINE_A11Y_CLIP_SELECTION_CLASS = 'daw-a11y-clip-selection'");
    expect(timelineAccessibilityLabelsTs).toContain("TIMELINE_A11Y_TIME_SELECTION_CLASS = 'daw-a11y-time-selection'");
  });

  it('the region sits inside .daw-arrangement, after the lane column and before the status line', () => {
    const body = functionBody(workspaceViewTs, 'dawShellHTML');
    expect(body.lastIndexOf('arrangementA11yHTML')).toBeGreaterThan(body.indexOf('daw-lane-column'));
    expect(body.lastIndexOf('arrangementA11yHTML')).toBeLessThan(body.indexOf('daw-status-line'));
  });

  it('adds no visible copy: the region is visually hidden, not display:none', () => {
    const rule = css.match(/\.daw-arrangement-a11y\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toMatch(/width:\s*1px/);
    expect(rule![0]).toMatch(/clip-path:\s*inset\(50%\)/);
    expect(rule![0]).not.toMatch(/display:\s*none/);
  });

  it('adds no visible copy: the label strings appear only in timeline-accessibility-labels.ts', () => {
    for (const phrase of [
      'Insert marker at', 'Playhead at', 'Clip selected on channel',
      'Time selection from', 'No clip selected', 'No time selection',
    ]) {
      expect(timelineAccessibilityLabelsTs).toContain(phrase);
      expect(workspaceViewTs).not.toContain(phrase);
    }
  });

  it('the six decorative segments are hidden from assistive tech', () => {
    expect(workspaceViewTs).toMatch(/daw-insert-marker daw-insert-marker-ruler"[^>]*aria-hidden="true"/);
    expect(workspaceViewTs).toMatch(/daw-insert-marker daw-insert-marker-lanes"[^>]*aria-hidden="true"/);
    expect(workspaceViewTs).toMatch(/daw-time-selection-ruler"[^>]*aria-hidden="true"/);
    expect(workspaceViewTs).toMatch(/daw-time-selection-lanes"[^>]*aria-hidden="true"/);
    expect(workspaceViewTs).toMatch(/daw-playhead daw-playhead-ruler"[^>]*aria-hidden="true"/);
    expect(workspaceViewTs).toMatch(/daw-playhead daw-playhead-lanes"[^>]*aria-hidden="true"/);
  });

  it('the shell runtime is the region\'s single writer, and the region is never an aria-live region', () => {
    expect(dawShellRuntimeTs).toContain('querySelector(`.${TIMELINE_A11Y_REGION_CLASS}`)');
    expect(dawShellRuntimeTs).toContain('renderAccessibilityLabels');
    expect(dawShellRuntimeTs).not.toContain('aria-live');
    const body = functionBody(workspaceViewTs, 'dawShellHTML');
    expect(body).not.toContain('aria-live');
    expect(body).not.toContain('role="status"');
    expect(body).not.toContain('role="alert"');
  });
});

describe('loop brace rendering (#1313)', () => {
  it('loopBrace.render.ts is a leaf module with no relative imports', () => {
    expect(loopBraceRenderTs).not.toMatch(/from '\.\//);
  });

  it('the brace CSS rule accepts pointer events for the body drag (#1315), and the shared re-base translate lists it', () => {
    expect(css).toMatch(/\.daw-loop-brace\s*\{[^}]*pointer-events:\s*auto[^}]*\}/);
    expect(css).toMatch(/\.daw-ruler-tick,[^{]*\.daw-loop-brace,[^{]*\{/);
  });

  it('.daw-loop-handle is not itself listed in the shared re-base translate (it is a child of the brace)', () => {
    const translateRule = css.match(/\.daw-ruler-tick,[^{]*\{[^}]*\}/)?.[0] ?? '';
    expect(translateRule).not.toContain('.daw-loop-handle');
  });

  it('App.tsx injects the shared loop-region model', () => {
    expect(appTsx).toContain('loopRegion: sessionLoopRegion');
  });

  it('live-workspace-view.ts emits the brace and its handles from the shared constants, gated on availability', () => {
    expect(workspaceViewTs).toContain('LOOP_BRACE_CLASS');
    expect(workspaceViewTs).toContain('daw-loop-brace-ruler');
    expect(workspaceViewTs).toContain('LOOP_HANDLE_START_CLASS');
    expect(workspaceViewTs).toContain('LOOP_HANDLE_END_CLASS');
    expect(workspaceViewTs).toContain('loopBraceVisible(state.sessionPlayback)');
  });

  it('the brace carries aria-hidden, like every other decorative segment', () => {
    expect(workspaceViewTs).toMatch(/daw-loop-brace-ruler"[^>]*aria-hidden="true"/);
  });

  it("renderPlayhead's body does not call renderLoopBrace — the brace stays off the per-frame path", () => {
    const body = functionBody(dawShellRuntimeTs, 'renderPlayhead');
    expect(body).not.toContain('renderLoopBrace');
  });

  it('daw-shell-runtime.ts exposes renderLoopBrace on the runtime it returns', () => {
    expect(dawShellRuntimeTs).toContain('renderLoopBrace,');
  });
});

describe('Loop toggle wiring (#1314)', () => {
  it('loopToggle.ts imports only from ./loopBrace.render', () => {
    expect(loopToggleTs.match(/from '\.\/[^']+'/g)).toEqual(["from './loopBrace.render'"]);
  });

  it('the delegated click handler seeds the default range before flipping looping', () => {
    expect(liveCapturePanelTsx).toContain('seedLoopRegionOnToggle(sessionLoopRegion');
    const seedIndex = liveCapturePanelTsx.indexOf('seedLoopRegionOnToggle(sessionLoopRegion');
    const toggleIndex = liveCapturePanelTsx.indexOf('toggleLoop()');
    expect(seedIndex).toBeGreaterThan(-1);
    expect(toggleIndex).toBeGreaterThan(-1);
    expect(seedIndex).toBeLessThan(toggleIndex);
  });

  it('loopBrace.render.ts carries no enablement concept (ADR guard)', () => {
    expect(loopBraceRenderTs).not.toMatch(/setEnabled|\benabled\b/);
  });
});

describe('loop brace body drag routing (#1315)', () => {
  it('loopBrace.bodyDrag.ts is a leaf module importing only loopBrace.render (type) and timeline-scale', () => {
    expect(loopBraceBodyDragTs.match(/from '\.\/[^']+'/g)).toEqual([
      "from './loopBrace.render'",
      "from './timeline-scale'",
    ]);
  });

  it('loopBrace.bodyDrag.ts does not import the shell runtime or the BPM module', () => {
    expect(loopBraceBodyDragTs).not.toMatch(/from '\.\/daw-shell-runtime'/);
    expect(loopBraceBodyDragTs).not.toMatch(/from '\.\/timeline-bpm'/);
  });

  it('onBoardPointerDown wires the loop body drag BEFORE it resolves SESSION_SCRUB_SURFACE_SELECTOR', () => {
    const body = functionBody(liveCapturePanelTsx, 'onBoardPointerDown');
    const braceIdx = body.indexOf('beginLoopBodyDrag(');
    const surfaceIdx = body.indexOf('e.target.closest(SESSION_SCRUB_SURFACE_SELECTOR)');
    expect(braceIdx).toBeGreaterThanOrEqual(0);
    expect(surfaceIdx).toBeGreaterThan(-1);
    expect(braceIdx).toBeLessThan(surfaceIdx);
  });

  it('the loop body drag branch returns before falling through to the scrub/time-selection routes', () => {
    const body = functionBody(liveCapturePanelTsx, 'onBoardPointerDown');
    const braceBranchIdx = body.indexOf('closest(LOOP_BRACE_BODY_SELECTOR)');
    const returnIdx = body.indexOf('return;', braceBranchIdx);
    const surfaceIdx = body.indexOf('e.target.closest(SESSION_SCRUB_SURFACE_SELECTOR)');
    expect(braceBranchIdx).toBeGreaterThanOrEqual(0);
    expect(returnIdx).toBeGreaterThan(braceBranchIdx);
    expect(returnIdx).toBeLessThan(surfaceIdx);
  });

  it('the loop body drag previews through previewLoopBrace and commits through sessionLoopRegion.setRegion', () => {
    const body = functionBody(liveCapturePanelTsx, 'onBoardPointerDown');
    expect(body).toContain('previewLoopBrace?.(region)');
    expect(body).toContain('sessionLoopRegion.setRegion(region.startSecs, region.endSecs)');
  });

  it('daw-shell-runtime.ts exposes previewLoopBrace on the runtime it returns', () => {
    expect(dawShellRuntimeTs).toContain('previewLoopBrace,');
  });
});

describe('loop brace edge drag routing (#1316)', () => {
  it('loopBrace.edgeDrag.ts is a leaf module importing only loopBrace.render (type) and timeline-scale', () => {
    expect(loopBraceEdgeDragTs.match(/from '\.\/[^']+'/g)).toEqual([
      "from './loopBrace.render'",
      "from './timeline-scale'",
    ]);
  });

  it('loopBrace.edgeDrag.ts does not import the shell runtime or the BPM module', () => {
    expect(loopBraceEdgeDragTs).not.toMatch(/from '\.\/daw-shell-runtime'/);
    expect(loopBraceEdgeDragTs).not.toMatch(/from '\.\/timeline-bpm'/);
  });

  it('onBoardPointerDown wires the loop edge drag BEFORE the body drag and the scrub surface lookup', () => {
    const body = functionBody(liveCapturePanelTsx, 'onBoardPointerDown');
    const edgeIdx = body.indexOf('beginLoopEdgeDrag(');
    const bodyIdx = body.indexOf('beginLoopBodyDrag(');
    const surfaceIdx = body.indexOf('e.target.closest(SESSION_SCRUB_SURFACE_SELECTOR)');
    expect(edgeIdx).toBeGreaterThanOrEqual(0);
    expect(bodyIdx).toBeGreaterThan(-1);
    expect(surfaceIdx).toBeGreaterThan(-1);
    expect(edgeIdx).toBeLessThan(bodyIdx);
    expect(bodyIdx).toBeLessThan(surfaceIdx);
  });

  it('the loop edge drag branch returns before falling through to the body drag or the scrub/time-selection routes', () => {
    const body = functionBody(liveCapturePanelTsx, 'onBoardPointerDown');
    const edgeBranchIdx = body.indexOf('LOOP_HANDLE_START_SELECTOR');
    const returnIdx = body.indexOf('return;', edgeBranchIdx);
    const bodyIdx = body.indexOf('beginLoopBodyDrag(');
    expect(edgeBranchIdx).toBeGreaterThanOrEqual(0);
    expect(returnIdx).toBeGreaterThan(edgeBranchIdx);
    expect(returnIdx).toBeLessThan(bodyIdx);
  });

  it('the loop edge drag previews through previewLoopBrace and commits through sessionLoopRegion.setRegion', () => {
    const body = functionBody(liveCapturePanelTsx, 'onBoardPointerDown');
    const edgeBranchIdx = body.indexOf('const loopHandleEl');
    const bodyBranchIdx = body.indexOf('if (e.target.closest(LOOP_BRACE_BODY_SELECTOR))');
    const edgeBody = body.slice(edgeBranchIdx, bodyBranchIdx);
    expect(edgeBody).toContain('previewLoopBrace?.(region)');
    expect(edgeBody).toContain('sessionLoopRegion.setRegion(region.startSecs, region.endSecs)');
  });

  it('the CSS gives the loop handles a resize cursor', () => {
    expect(css).toMatch(/\.daw-loop-handle\s*\{[^}]*cursor:\s*ew-resize[^}]*\}/);
  });
});

describe('loop-from-selection wiring (#1317)', () => {
  it('loopFromSelection.ts imports only from ./loopBrace.render and ./time-selection', () => {
    expect(loopFromSelectionTs.match(/from '\.\/[^']+'/g)).toEqual([
      "from './loopBrace.render'",
      "from './time-selection'",
    ]);
  });

  it('loopFromSelection.ts does not import the shell runtime or a store', () => {
    expect(loopFromSelectionTs).not.toMatch(/from '\.\/daw-shell-runtime'|from '\.\/stores\//);
  });

  it('the delegated click handler routes the button through the pure policy and repaints', () => {
    expect(liveCapturePanelTsx).toContain('promoteSelectionToLoop(');
    expect(liveCapturePanelTsx).toContain('LOOP_FROM_SELECTION_BUTTON_ID');
  });

  it('the promotion branch sits after the Loop-toggle branch', () => {
    expect(liveCapturePanelTsx.indexOf("closest('#daw-session-loop')")).toBeLessThan(
      liveCapturePanelTsx.indexOf('promoteSelectionToLoop('),
    );
  });

  it('session-tab-playback.ts renders the Loop Selection button', () => {
    expect(sessionTabPlaybackTs).toContain("id: 'daw-session-loop-selection'");
  });
});

describe('return-to-start preserves the loop range (#1318)', () => {
  it('the #daw-session-return branch writes nothing to the loop region', () => {
    const start = liveCapturePanelTsx.indexOf("closest('#daw-session-return')");
    expect(start).toBeGreaterThan(-1);
    const next = liveCapturePanelTsx.indexOf('target.closest(', start + 1);
    const branch = liveCapturePanelTsx.slice(start, next > -1 ? next : undefined);
    expect(branch).toContain('returnToStart()');
    expect(branch).not.toContain('sessionLoopRegion');
    expect(branch).not.toContain('resetForSession');
    expect(branch).not.toContain('toggleLoop');
  });

  it('soundcheckStore.ts does not import the loop-region model (ADR guard)', () => {
    expect(soundcheckStoreTs).not.toContain("from '../loopBrace.render'");
    expect(soundcheckStoreTs).not.toContain('sessionLoopRegion');
  });
});

describe('Session toolbar grouping (#1347)', () => {
  it('dawShellHTML wraps every transport cluster in a named group', () => {
    const body = functionBody(workspaceViewTs, 'dawShellHTML');
    for (const key of ['transport', 'tempo', 'view', 'tracks', 'session', 'capture']) {
      expect(body).toContain(`sessionToolbarGroupHTML('${key}',`);
    }
  });

  it('app.css styles the group container and its divider', () => {
    expect(css).toContain('.daw-transport-group');
    expect(css).toContain('.daw-transport-group + .daw-transport-group');
  });

  it('app.css styles the icon-only Session playback buttons', () => {
    expect(css).toContain('.daw-session-playback-btn--icon');
  });
});
