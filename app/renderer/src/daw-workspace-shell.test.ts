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
// LiveCapturePanel.test.ts. This gate keeps the still-inline 6j wiring tests
// (playhead/waveform painters, tickers), the App.tsx boot-order assertions,
// and the #757/#517 absence rules against their new homes.

const inlineApp = fs.readFileSync(fileURLToPath(new URL('./inline-app.js', import.meta.url)), 'utf8');
const markup = fs.readFileSync(fileURLToPath(new URL('./root-markup.html', import.meta.url)), 'utf8');
const css = fs.readFileSync(fileURLToPath(new URL('./styles/app.css', import.meta.url)), 'utf8');
const appTsx = fs.readFileSync(fileURLToPath(new URL('./App.tsx', import.meta.url)), 'utf8');
const workspaceViewTs = fs.readFileSync(fileURLToPath(new URL('./live-workspace-view.ts', import.meta.url)), 'utf8');
const liveCapturePanelTsx = fs.readFileSync(fileURLToPath(new URL('./LiveCapturePanel.tsx', import.meta.url)), 'utf8');

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
    const lockBody = functionBody(inlineApp, 'setCaptureControlsLocked');
    expect(lockBody).toContain("const armLocked = locked && liveMode === 'record'");
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

describe('DAW playhead (#518)', () => {
  it('the shell markup includes the transport time readout and playhead line', () => {
    // live-workspace-view.test.ts asserts dawShellHTML renders both.
    expect(workspaceViewTs).toContain('daw-transport-time');
    expect(workspaceViewTs).toContain('daw-playhead');
  });

  it('the 6j bridge re-paints the playhead after a shell render, and the meter tick path refreshes it', () => {
    expect(inlineApp).toContain('renderPlayhead: renderDawPlayhead');
    expect(liveCapturePanelTsx).toContain('renderPlayhead');
    expect(functionBody(inlineApp, 'renderDawPlayhead')).toContain('dawPlayheadState');
  });

  it('the shell seeds the transport time from state so a mid-capture rebuild never flashes 0:00', () => {
    expect(workspaceViewTs).toMatch(/formatElapsed\(seededElapsed\)/);
    expect(inlineApp).toMatch(/playheadElapsedMs: \(\) =>/);
  });

  it('the Start handler starts the playhead and its ticker', () => {
    const block = functionBody(inlineApp, 'onCaptureStarting');
    expect(block).toContain('dawPlayheadState.start(');
    expect(block).toContain('startPlayheadTicker()');
  });

  it('stopLive freezes the playhead and stops its ticker', () => {
    expect(functionBody(inlineApp, 'stopLive')).toContain('onCaptureStopping()');
    const body = functionBody(inlineApp, 'onCaptureStopping');
    expect(body).toContain('dawPlayheadState.stop(');
    expect(body).toContain('stopPlayheadTicker()');
  });

  it('renderDawPlayhead guards on shell presence, patches text only on change, and never assigns innerHTML', () => {
    const body = functionBody(inlineApp, 'renderDawPlayhead');
    expect(body).toContain(".daw-shell'");
    expect(body).toMatch(/textContent\s*!==/);
    expect(body).not.toContain('innerHTML');
  });

  it('startPlayheadTicker uses PLAYHEAD_TICK_MS; stopPlayheadTicker clears the interval', () => {
    expect(functionBody(inlineApp, 'startPlayheadTicker')).toContain('PLAYHEAD_TICK_MS');
    expect(functionBody(inlineApp, 'stopPlayheadTicker')).toContain('clearInterval');
  });

  it('defines named constants for the tick cadence and pixel scale (no magic numbers)', () => {
    expect(inlineApp).toMatch(/const PLAYHEAD_TICK_MS = \d+/);
    expect(inlineApp).toMatch(/const PLAYHEAD_PX_PER_SECOND = \d+/);
  });

  it('app.css styles the playhead line and the transport time readout', () => {
    expect(css).toContain('.daw-playhead');
    expect(css).toContain('.daw-transport-time');
  });

  it('App.tsx boots daw-playhead-state.js before the inline app script', () => {
    expect(appTsx).toContain('daw-playhead-state.js?raw');
    const playheadIdx = appTsx.indexOf('dawPlayheadStateSrc,');
    const inlineIdx = appTsx.indexOf('inlineAppSrc,');
    expect(playheadIdx).toBeGreaterThan(-1);
    expect(inlineIdx).toBeGreaterThan(-1);
    expect(playheadIdx).toBeLessThan(inlineIdx);
  });
});

describe('DAW mix waveform (#520)', () => {
  it('the shell markup includes the canvas and capture-mode attribute, no longer the placeholder text', () => {
    expect(workspaceViewTs).toContain('daw-mix-waveform');
    expect(workspaceViewTs).toContain('data-capture-mode');
    expect(workspaceViewTs).not.toContain('Mix waveform coming soon');
  });

  it('the 6j bridge re-paints the waveform after a shell render and on the meter tick path', () => {
    expect(inlineApp).toContain('renderWaveform: renderDawWaveform');
    expect(liveCapturePanelTsx).toContain('renderWaveform');
  });

  it('onLiveEvent handles peaks frames before the meter/window-tick path and returns', () => {
    // TD-001 slice 6g (#710): the meter path marker is now the store-owned
    // coaching advance, not the deleted updateLiveStatsRow call.
    const peaksIdx = inlineApp.indexOf("data.type === 'peaks'");
    const meterIdx = inlineApp.indexOf('lcStore.getState().advanceLapCoaching()');
    expect(peaksIdx).toBeGreaterThan(-1);
    expect(meterIdx).toBeGreaterThan(-1);
    expect(peaksIdx).toBeLessThan(meterIdx);
    const peaksBlock = enclosingBlock(inlineApp, "decodeLanes(data)");
    expect(peaksBlock).toContain('return;');
  });

  it('onLiveEvent schedules the waveform repaint rather than painting synchronously', () => {
    const peaksBlock = enclosingBlock(inlineApp, 'decodeLanes(data)');
    expect(peaksBlock).toContain('scheduleDawWaveformRender(');
    expect(peaksBlock).not.toContain('renderDawWaveform()');
  });

  it('scheduleDawWaveformRender coalesces repaints to one per animation frame', () => {
    const body = functionBody(inlineApp, 'scheduleDawWaveformRender');
    expect(body).toContain('waveformRenderScheduled');
    expect(body).toContain('requestAnimationFrame(');
    expect(body).toContain('renderDawWaveform()');
  });

  it('the Start handler resets waveform state and its bucket rate', () => {
    const block = functionBody(inlineApp, 'onCaptureStarting');
    expect(block).toContain('dawWaveformState.create(');
    expect(block).toContain('bucketsPerSecond(');
  });

  it('renderDawWaveform guards on shell/canvas presence and never assigns innerHTML', () => {
    const body = functionBody(inlineApp, 'renderDawWaveform');
    expect(body).toContain(".daw-shell'");
    expect(body).toContain('daw-mix-waveform');
    expect(body).not.toContain('innerHTML');
  });

  it('drawWaveformLane budgets columns to the canvas\'s own width, not the wider shell width (avoids off-canvas clipping)', () => {
    const body = functionBody(inlineApp, 'drawWaveformLane');
    expect(body).toContain('columnPeaks(pairs, waveformBucketsPerSec, PLAYHEAD_PX_PER_SECOND, canvas.width)');
  });

  it('renderDawWaveform draws the mix canvas from waveformState.pairs via the shared helper', () => {
    const body = functionBody(inlineApp, 'renderDawWaveform');
    expect(body).toContain('drawWaveformLane(canvas, waveformState.pairs, strokeStyle)');
  });

  it('renderDawWaveform derives capture mode directly from live state, not a DOM re-query', () => {
    const body = functionBody(inlineApp, 'renderDawWaveform');
    expect(body).toContain('dawWaveformState.captureModeToken(liveRunning, liveMode)');
    expect(body).not.toContain("querySelector('.daw-mix-lane')");
  });

  it('app.css styles the mix waveform canvas and capture-mode markers', () => {
    expect(css).toContain('.daw-mix-waveform');
    expect(css).toContain('data-capture-mode');
  });

  it('App.tsx boots daw-waveform-state.js before the inline app script', () => {
    expect(appTsx).toContain('daw-waveform-state.js?raw');
    const waveformIdx = appTsx.indexOf('dawWaveformStateSrc,');
    const inlineIdx = appTsx.indexOf('inlineAppSrc,');
    expect(waveformIdx).toBeGreaterThan(-1);
    expect(inlineIdx).toBeGreaterThan(-1);
    expect(waveformIdx).toBeLessThan(inlineIdx);
  });
});

describe('Per-input waveform lanes (#521)', () => {
  it('dawShellHTML lane markup renders a real waveform canvas, not the placeholder text', () => {
    expect(workspaceViewTs).toContain('daw-channel-waveform');
    expect(workspaceViewTs).not.toContain('Waveform coming soon');
  });

  it('dawShellHTML still renders each lane\'s name from the resolved lane names (channel identity preserved)', () => {
    expect(workspaceViewTs).toContain('daw-lane-name">${laneNames[idx]}</span>');
    expect(workspaceViewTs).toContain('data-ch="${idx}"');
  });

  it('onLiveEvent decodes all lanes and appends per-strip lanes into waveformLaneStates', () => {
    const peaksBlock = enclosingBlock(inlineApp, 'decodeLanes(data)');
    expect(peaksBlock).toContain('decodeLanes(');
    expect(peaksBlock).toContain('waveformLaneStates[id]');
  });

  it('the Start handler resets waveformLaneStates alongside waveformState', () => {
    const block = functionBody(inlineApp, 'onCaptureStarting');
    expect(block).toContain('waveformLaneStates = {}');
  });

  it('renderDawWaveform iterates channel lanes and looks up state by strip + data-ch', () => {
    const body = functionBody(inlineApp, 'renderDawWaveform');
    expect(body).toContain('daw-channel-lane');
    expect(body).toContain("'strip' + ");
  });

  it('app.css styles the per-channel waveform canvas and lane body height', () => {
    expect(css).toContain('.daw-channel-waveform');
    expect(css).toContain('.daw-channel-lane .daw-lane-body');
  });
});
