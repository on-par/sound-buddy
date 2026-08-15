// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// DAW-style live workspace shell (#517): when the experimental toggle (#516)
// is on, the Live tab's center pane renders a timeline-oriented shell instead
// of the existing meter workspace. Since slice 6g (#710) the SHELL MARKUP
// renders from live-board.ts's dawShellHTML via LiveCapturePanel (the old
// inline renderDawShell is gone); the playhead/waveform CANVAS rendering (6j)
// stays in inline-app.js and is gated below as before.

const inlineApp = fs.readFileSync(fileURLToPath(new URL('./inline-app.js', import.meta.url)), 'utf8');
const liveBoard = fs.readFileSync(fileURLToPath(new URL('./live-board.ts', import.meta.url)), 'utf8');
const capturePanel = fs.readFileSync(fileURLToPath(new URL('./LiveCapturePanel.tsx', import.meta.url)), 'utf8');
const markup = fs.readFileSync(fileURLToPath(new URL('./root-markup.html', import.meta.url)), 'utf8');
const css = fs.readFileSync(fileURLToPath(new URL('./styles/app.css', import.meta.url)), 'utf8');
const appTsx = fs.readFileSync(fileURLToPath(new URL('./App.tsx', import.meta.url)), 'utf8');

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
// callback body.
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

describe('DAW shell markup renders from live-board.ts (slice 6g, #710)', () => {
  it('dawShellHTML renders the transport/header, ruler, mix lane, and per-input lanes', () => {
    const body = functionBody(liveBoard, 'dawShellHTML');
    expect(body).toContain('daw-shell');
    expect(body).toContain('daw-transport');
    expect(body).toContain('daw-ruler');
    expect(body).toContain('daw-mix-lane');
    expect(body).toContain('daw-channel-lane');
    expect(body).toContain('transportLabel(');
  });

  it('maps channel lanes from channelConfig using the resolved strip label', () => {
    const body = functionBody(liveBoard, 'dawShellHTML');
    expect(body).toContain('channelConfig.map(');
    expect(body).toContain('resolveStripLabel(');
  });

  it('escapes the lane name before it reaches innerHTML (stripLabel can return a user-entered or device-reported string)', () => {
    const body = functionBody(liveBoard, 'dawShellHTML');
    expect(body).toMatch(/escapeHtml\(getRigReconcile\(\)\.resolveStripLabel\(/);
  });

  it('renders a muted empty-state row when channelConfig is empty', () => {
    const body = functionBody(liveBoard, 'dawShellHTML');
    expect(body).toContain('Add tracks to see channel lanes');
  });

  it('points users at the top-bar Record button for capture controls (#757)', () => {
    const body = functionBody(liveBoard, 'dawShellHTML');
    expect(body).toContain('Start and stop recording from the top-bar Record button');
  });

  it('LiveCapturePanel renders the DAW branch through dangerouslySetInnerHTML and repaints via the bridge', () => {
    expect(capturePanel).toContain('dawShellShowing(');
    expect(capturePanel).toContain('dawShellHTML(');
    expect(capturePanel).toContain('liveDawShellRepaint?.()');
  });

  it('inline-app.js exposes the liveDawShellRepaint bridge (6j playhead + waveform)', () => {
    expect(inlineApp).toContain('window.liveDawShellRepaint = () => { renderDawPlayhead(); renderDawWaveform(); }');
  });

  it('inline-app.js no longer defines the imperative shell renderer', () => {
    expect(inlineApp).not.toContain('function renderDawShell');
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

  it('the workspace arm cluster renders always (not record-mode gated) — armHTML drops the render gate', () => {
    const body = functionBody(liveBoard, 'workspaceToolbarHTML');
    expect(body).toContain('live-ws-arm-count');
    expect(body).not.toContain("advanced && liveMode === 'record'");
  });

  it('arm controls stay usable while monitoring and freeze only while recording (#757)', () => {
    const toolbar = functionBody(liveBoard, 'workspaceToolbarHTML');
    expect(toolbar).toContain("state.isCapturing && state.liveMode === 'record'");
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

describe('DAW playhead (#518, stays inline 6j)', () => {
  it('dawShellHTML markup includes the transport time readout and playhead line', () => {
    const body = functionBody(liveBoard, 'dawShellHTML');
    expect(body).toContain('daw-transport-time');
    expect(body).toContain('daw-playhead');
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

  it('the Start handler starts the playhead and its ticker; stop freezes it', () => {
    expect(functionBody(inlineApp, 'onCaptureStarting')).toContain('dawPlayheadState.start(');
    expect(functionBody(inlineApp, 'onCaptureStarting')).toContain('startPlayheadTicker()');
    expect(functionBody(inlineApp, 'onCaptureStopping')).toContain('dawPlayheadState.stop(');
    expect(functionBody(inlineApp, 'onCaptureStopping')).toContain('stopPlayheadTicker()');
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

describe('DAW mix waveform (#520/#521, stays inline 6j)', () => {
  it('dawShellHTML markup includes the canvases and capture-mode attribute', () => {
    const body = functionBody(liveBoard, 'dawShellHTML');
    expect(body).toContain('daw-mix-waveform');
    expect(body).toContain('daw-channel-waveform');
    expect(body).toContain('data-capture-mode');
    expect(body).not.toContain('Mix waveform coming soon');
    expect(body).not.toContain('Waveform coming soon');
  });

  it('onLiveEvent handles peaks frames before the meter/window-tick path and schedules the repaint', () => {
    const peaksIdx = inlineApp.indexOf("data.type === 'peaks'");
    expect(peaksIdx).toBeGreaterThan(-1);
    const peaksBlock = enclosingBlock(inlineApp, 'decodeLanes(data)');
    expect(peaksBlock).toContain('scheduleDawWaveformRender(');
    expect(peaksBlock).not.toContain('renderDawWaveform()');
    expect(peaksBlock).toContain('return;');
  });

  it('scheduleDawWaveformRender coalesces repaints to one per animation frame', () => {
    const body = functionBody(inlineApp, 'scheduleDawWaveformRender');
    expect(body).toContain('waveformRenderScheduled');
    expect(body).toContain('requestAnimationFrame(');
    expect(body).toContain('renderDawWaveform()');
  });

  it('the Start handler resets waveform state and its bucket rate; onLiveEvent decodes lanes into lane states', () => {
    const start = functionBody(inlineApp, 'onCaptureStarting');
    expect(start).toContain('dawWaveformState.create(');
    expect(start).toContain('bucketsPerSecond(');
    expect(start).toContain('waveformLaneStates = {}');
    const peaksBlock = enclosingBlock(inlineApp, 'decodeLanes(data)');
    expect(peaksBlock).toContain('waveformLaneStates[id]');
  });

  it('renderDawWaveform guards on shell/canvas presence, never assigns innerHTML, and draws the mix canvas from waveformState.pairs', () => {
    const body = functionBody(inlineApp, 'renderDawWaveform');
    expect(body).toContain(".daw-shell'");
    expect(body).toContain('daw-mix-waveform');
    expect(body).not.toContain('innerHTML');
    expect(body).toContain('drawWaveformLane(canvas, waveformState.pairs, strokeStyle)');
  });

  it('drawWaveformLane budgets columns to the canvas\'s own width', () => {
    const body = functionBody(inlineApp, 'drawWaveformLane');
    expect(body).toContain('columnPeaks(pairs, waveformBucketsPerSec, PLAYHEAD_PX_PER_SECOND, canvas.width)');
  });

  it('renderDawWaveform derives capture mode directly from live state, not a DOM re-query', () => {
    const body = functionBody(inlineApp, 'renderDawWaveform');
    expect(body).toContain('dawWaveformState.captureModeToken(liveRunning, liveMode)');
    expect(body).not.toContain("querySelector('.daw-mix-lane')");
  });

  it('app.css styles the mix/per-channel waveform canvases', () => {
    expect(css).toContain('.daw-mix-waveform');
    expect(css).toContain('.daw-channel-waveform');
    expect(css).toContain('.daw-channel-lane .daw-lane-body');
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
