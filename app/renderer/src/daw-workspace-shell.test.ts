// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

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
