// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// DAW-style live workspace shell (#517): when the experimental toggle (#516)
// is on, the Live tab's center pane renders a timeline-oriented shell instead
// of the existing meter workspace. inline-app.js is coverage-excluded glue
// (see vitest.config.ts), verified here the same way live-setup-workspace.test.ts
// (#294) and root-markup.test.ts (#293) encode their acceptance criteria.

const inlineApp = fs.readFileSync(fileURLToPath(new URL('./inline-app.js', import.meta.url)), 'utf8');
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
  it('renderLiveWorkspace early-outs to the DAW shell when showShell is true', () => {
    const body = functionBody(inlineApp, 'renderLiveWorkspace');
    expect(body).toContain('dawWorkspaceState.showShell(');
    expect(body).toContain('renderDawShell()');
  });

  it('renderLiveMeters early-outs to the DAW shell when showShell is true', () => {
    const body = functionBody(inlineApp, 'renderLiveMeters');
    expect(body).toContain('dawWorkspaceState.showShell(');
    expect(body).toContain('renderDawShell()');
  });

  it('renderLiveMeters keeps resolving live channel names even while the DAW shell is showing', () => {
    // lastLiveChannels (the #39 device-name fallback stripLabel reads for DAW
    // shell lane names) must be assigned before the showShell early-return,
    // or every lane name is stuck unresolved for the whole capture.
    const body = functionBody(inlineApp, 'renderLiveMeters');
    const assignIdx = body.indexOf('lastLiveChannels = win.channels');
    const gateIdx = body.indexOf('dawWorkspaceState.showShell(');
    expect(assignIdx).toBeGreaterThan(-1);
    expect(assignIdx).toBeLessThan(gateIdx);
  });
});

describe('DAW workspace timeline shell markup (#517)', () => {
  it('defines renderDawShell', () => {
    expect(inlineApp).toMatch(/function renderDawShell\(/);
  });

  it('renders the transport/header, ruler, and mix lane', () => {
    const body = functionBody(inlineApp, 'renderDawShell');
    expect(body).toContain('daw-shell');
    expect(body).toContain('daw-transport');
    expect(body).toContain('daw-ruler');
    expect(body).toContain('daw-mix-lane');
    expect(body).toContain('daw-channel-lane');
    expect(body).toContain('transportLabel(');
  });

  it('maps channel lanes from channelConfig using stripLabel', () => {
    const body = functionBody(inlineApp, 'renderDawShell');
    expect(body).toContain('channelConfig.map(');
    expect(body).toContain('stripLabel(');
  });

  it('escapes the lane name before it reaches innerHTML (stripLabel can return a user-entered or device-reported string)', () => {
    const body = functionBody(inlineApp, 'renderDawShell');
    expect(body).toMatch(/escapeHtml\(stripLabel\(/);
  });

  it('rebuilds when lane content changes even if the channel count does not (e.g. a same-size rig swap)', () => {
    // The patch-in-place shortcut must key off more than channelConfig.length,
    // or swapping to a different rig with the same track count leaves every
    // lane showing the previous rig's names until something else forces a
    // full rebuild.
    const body = functionBody(inlineApp, 'renderDawShell');
    expect(body).toContain('laneSignature');
    expect(body).toContain('dataset.laneSignature');
  });

  it('patches the transport chip in place rather than replacing it every tick', () => {
    const body = functionBody(inlineApp, 'renderDawShell');
    expect(body).not.toContain('chip.outerHTML');
    expect(body).toMatch(/chip\.textContent\s*!==/);
  });

  it('renders a muted empty-state row when channelConfig is empty', () => {
    const body = functionBody(inlineApp, 'renderDawShell');
    expect(body).toContain('Add tracks from the Source panel');
  });

  it('patches in place instead of rebuilding every tick', () => {
    const body = functionBody(inlineApp, 'renderDawShell');
    expect(body).toContain(".querySelector('.daw-shell')");
    expect(body).toContain('laneSignature');
  });

  it('points users at the Source panel for capture controls', () => {
    const body = functionBody(inlineApp, 'renderDawShell');
    expect(body).toContain('Source panel');
  });
});

describe('DAW shell preserves existing capture controls (#517)', () => {
  it('root-markup.html still has the Source-panel capture controls', () => {
    expect(markup).toContain('id="live-mode"');
    expect(markup).toContain('id="live-start-btn"');
    expect(markup).toContain('id="live-stop-btn"');
  });

  it('renderDawShell does not duplicate the capture controls', () => {
    const body = functionBody(inlineApp, 'renderDawShell');
    expect(body).not.toContain('id="live-mode"');
    expect(body).not.toContain('id="live-start-btn"');
    expect(body).not.toContain('id="live-stop-btn"');
  });
});

describe('DAW shell re-renders on toggle flip (#517)', () => {
  it('the settingsStore subscriber re-syncs the Live pane on an actual flip', () => {
    const subscriberBlock = enclosingBlock(inlineApp, "classList.toggle('daw-workspace'");
    expect(subscriberBlock).toContain("syncSpectrumForMode('live')");
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
  it('renderDawShell markup includes the transport time readout and playhead line', () => {
    const body = functionBody(inlineApp, 'renderDawShell');
    expect(body).toContain('daw-transport-time');
    expect(body).toContain('daw-playhead');
  });

  it('renderDawShell calls renderDawPlayhead on both the patch and rebuild paths', () => {
    const body = functionBody(inlineApp, 'renderDawShell');
    const matches = body.match(/renderDawPlayhead\(/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('renderDawShell seeds the transport time from state so a mid-capture rebuild never flashes 0:00', () => {
    const body = functionBody(inlineApp, 'renderDawShell');
    expect(body).toMatch(/formatElapsed\(/);
  });

  it('the Start handler starts the playhead and its ticker', () => {
    const block = enclosingBlock(inlineApp, 'liveRunning = true;');
    expect(block).toContain('dawPlayheadState.start(');
    expect(block).toContain('startPlayheadTicker()');
  });

  it('stopLive freezes the playhead and stops its ticker', () => {
    const body = functionBody(inlineApp, 'stopLive');
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
