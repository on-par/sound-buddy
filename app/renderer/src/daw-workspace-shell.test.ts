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

// DAW-style live workspace shell (#517): when the experimental toggle (#516)
// is on, the Live tab's center pane renders a timeline-oriented shell instead
// of the existing meter workspace. The shell's MARKUP moved out of inline-app.js
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
const liveCapturePanelTsx = fs.readFileSync(fileURLToPath(new URL('./LiveCapturePanel.tsx', import.meta.url)), 'utf8');
const liveCapturePanelTs = fs.readFileSync(fileURLToPath(new URL('./live-capture-panel.ts', import.meta.url)), 'utf8');
// TD-001 slice 6i (#712): the capture lifecycle moved here — its start/stop
// drives the daw-shell-runtime.ts painters through the window.dawShellRuntime
// seam (unchanged by 6j — see the "DAW shell seam consumers" describe below).
const lifecycleTs = fs.readFileSync(fileURLToPath(new URL('./capture-lifecycle.ts', import.meta.url)), 'utf8');
// TD-001 slice 6j (#713): the new home for the playhead/waveform painters.
const dawShellRuntimeTs = fs.readFileSync(fileURLToPath(new URL('./daw-shell-runtime.ts', import.meta.url)), 'utf8');
const dawPlayheadStateJs = fs.readFileSync(fileURLToPath(new URL('../daw-playhead-state.js', import.meta.url)), 'utf8');

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

describe('DAW workspace shell gating (#517)', () => {
  it('dawShellHTML is the shell builder the React island renders (showShell gate covered by LiveCapturePanel.test.ts)', () => {
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
    expect(workspaceViewTs).toContain('Add tracks to see channel lanes');
  });

  it('points users at the top-bar Record button for capture controls (#757)', () => {
    expect(workspaceViewTs).toContain('Start and stop recording from the top-bar Record button');
  });
});

describe('DAW shell and the sole top-bar Record transport (#757)', () => {
  it('root-markup.html no longer carries the in-tab capture-control islands; the top-bar Record button is the sole surface', () => {
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
    // TD-001 slice 6h (#711): the per-strip arm stamp derives from the panel
    // state (liveRunning && liveMode === 'record') in veqChannelHTML — the
    // inline setCaptureControlsLocked armLocked sweep is gone. The behavior is
    // unit-pinned in live-capture-panel.test.ts.
    expect(liveCapturePanelTs).toContain('panel.liveRunning && panel.liveMode === \'record\'');
    expect(inlineApp).not.toContain('function setCaptureControlsLocked');
  });
});

describe('DAW shell re-renders on toggle flip (#517)', () => {
  it('the settingsStore subscriber re-syncs the Live pane on an actual flip', () => {
    const subscriberBlock = enclosingBlock(inlineApp, "classList.toggle('daw-workspace'");
    expect(subscriberBlock).toContain("window.modeSwitch.applySpectrumForMode('live')");
  });

  it('only re-syncs on an actual flip, not on every settings save', () => {
    const subscriberBlock = enclosingBlock(inlineApp, "classList.toggle('daw-workspace'");
    expect(subscriberBlock).toMatch(/nowEnabled !== dawWorkspaceWasEnabled/);
  });
});

describe('DAW shell styles (#517)', () => {
  it('app.css styles the shell and its lanes', () => {
    expect(css).toContain('.daw-shell');
    expect(css).toContain('.daw-lane');
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
    expect(dawShellRuntimeTs).toContain('export function dawRulerTicks(spanSecs: number): DawRulerTick[]');
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

  it("dawRulerTicks' body computes each tick's x through the shared dawTimelineX function", () => {
    expect(functionBody(dawShellRuntimeTs, 'dawRulerTicks')).toContain('dawTimelineX(timeSecs)');
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
    expect(dawShellRuntimeTs).toContain('export function dawLaneGridlines(spanSecs: number): DawLaneGridline[]');
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

  it("dawLaneGridlines' body computes each line's x through the shared dawTimelineX function", () => {
    expect(functionBody(dawShellRuntimeTs, 'dawLaneGridlines')).toContain('dawTimelineX(timeSecs)');
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
    const rebase = css.match(/\.daw-ruler-tick\s*,\s*\.daw-gridline\s*\{[^}]*\}/);
    expect(rebase).not.toBeNull();
    expect(rebase![0]).toMatch(/transform:\s*translateX\(calc\(-1 \* var\(--daw-head-w\)\)\)/);
    const tickRule = css.match(/\.daw-ruler-tick\s*\{[^}]*\}/);
    const gridlineRule = css.match(/\.daw-gridline\s*\{[^}]*\}/);
    expect(tickRule).not.toBeNull();
    expect(gridlineRule).not.toBeNull();
    expect(tickRule![0]).not.toMatch(/transform|left:\s*\d/);
    expect(gridlineRule![0]).not.toMatch(/transform|left:\s*\d/);
  });

  it('the playhead is not re-based — its frame is already the shell', () => {
    const rebase = css.match(/\.daw-ruler-tick\s*,\s*\.daw-gridline\s*\{[^}]*\}/);
    expect(rebase).not.toBeNull();
    expect(rebase![0]).not.toContain('daw-playhead');
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
