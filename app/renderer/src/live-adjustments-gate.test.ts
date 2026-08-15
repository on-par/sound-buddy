// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Experimental live adjustments area (#522): a placeholder panel gated behind
// liveAdjustmentsEnabled, mirroring the #516 dawWorkspaceEnabled pattern.
// The panel's rendering moved out of inline-app.js (syncLiveAdjustmentsPanel)
// into the pure live-workspace-view.ts liveAdjustmentsPanelHTML builder + the
// React LiveCapturePanel island, and the focused-input/coaching state moved
// into liveCaptureStore (TD-001 slice 6g, #710) — the rendering/coaching
// acceptance criteria are enforced by live-workspace-view.test.ts,
// liveCaptureStore.test.ts, and LiveCapturePanel.test.ts. This gate keeps the
// app.css/SettingsPanel/App.tsx assertions and pins the 6g acceptance rule:
// no inline-app.js listener owns the lap- surfaces anymore.

const inlineApp = fs.readFileSync(fileURLToPath(new URL('./inline-app.js', import.meta.url)), 'utf8');
const liveCaptureStoreTs = fs.readFileSync(fileURLToPath(new URL('./stores/liveCaptureStore.ts', import.meta.url)), 'utf8');
const liveCapturePanelTsx = fs.readFileSync(fileURLToPath(new URL('./LiveCapturePanel.tsx', import.meta.url)), 'utf8');
const workspaceViewTs = fs.readFileSync(fileURLToPath(new URL('./live-workspace-view.ts', import.meta.url)), 'utf8');
const settingsPanelTsx = fs.readFileSync(fileURLToPath(new URL('./SettingsPanel.tsx', import.meta.url)), 'utf8');
const css = fs.readFileSync(fileURLToPath(new URL('./styles/app.css', import.meta.url)), 'utf8');
const appTsx = fs.readFileSync(fileURLToPath(new URL('./App.tsx', import.meta.url)), 'utf8');
// TD-001 slice 6i (#712): the capture lifecycle (whose onCaptureStarting calls
// resetLapCoaching and whose onWindowTick advances coaching) moved here.
const lifecycleTs = fs.readFileSync(fileURLToPath(new URL('./capture-lifecycle.ts', import.meta.url)), 'utf8');

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

// Extracts an object-literal method body (store actions / bridge members are
// `name() { … }`, not `function name(` declarations). The signature is matched
// with a trailing ` {` so an interface member (`name(): void;`) never matches.
function methodBody(src: string, signature: string): string {
  const brace = src.indexOf(`${signature} {`);
  if (brace === -1) throw new Error(`method ${signature} not found`);
  let depth = 0;
  for (let i = brace; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(brace, i + 1);
    }
  }
  throw new Error(`unbalanced braces around ${signature}`);
}

describe('Live adjustments gate wiring (#522)', () => {
  it('the board island renders the panel from liveAdjustmentsPanelHTML (render coverage in LiveCapturePanel.test.ts)', () => {
    expect(liveCapturePanelTsx).toContain('liveAdjustmentsPanelHTML(state)');
    expect(workspaceViewTs).toContain('export function liveAdjustmentsPanelHTML(');
  });

  it('liveAdjustmentsPanelHTML reads panelHTML and passes the live window data + measurement source through', () => {
    // live-workspace-view.test.ts asserts the exact panelHTML delegation.
    const body = functionBody(workspaceViewTs, 'liveAdjustmentsPanelHTML');
    expect(body).toContain('panelHTML(');
    expect(body).toContain('liveWindows');
    expect(body).toContain('measurementSource');
  });

  it('window ticks advance the coaching state machine through the lifecycle (not inline-app.js)', () => {
    const block = enclosingBlock(lifecycleTs, 'sessionWindows.push(data)');
    expect(block).toContain('sessionWindows.push(data)');
    expect(block).toContain('deps.getLc().advanceLapCoaching()');
    // inline-app.js just forwards the window tick to window.captureLifecycle.
    expect(inlineApp).toContain('window.captureLifecycle?.onWindowTick?.(data)');
    expect(inlineApp).not.toContain('lcStore.getState().advanceLapCoaching()');
  });

  it('starting a capture resets the coaching state through the store', () => {
    const block = enclosingBlock(lifecycleTs, 'lc.resetLapCoaching()');
    expect(block).toContain('lc.resetLapCoaching()');
  });

  it('the settingsStore subscriber re-syncs the Live pane on an actual flip', () => {
    const block = enclosingBlock(inlineApp, 'liveAdjustmentsWasEnabled = nowEnabled');
    expect(block).toContain('liveAdjustmentsState.isEnabled(');
    expect(block).toContain("window.modeSwitch.applySpectrumForMode('live')");
  });

  it('the Settings dialog has the toggle and note elements (#204)', () => {
    expect(settingsPanelTsx).toContain('id="live-adjustments-toggle"');
    expect(settingsPanelTsx).toContain('id="live-adjustments-note"');
  });

  it('App.tsx imports and boots live-adjustments-state.js before the inline app script', () => {
    expect(appTsx).toContain("import liveAdjustmentsStateSrc from '../live-adjustments-state.js?raw';");
    const liveAdjIdx = appTsx.indexOf('liveAdjustmentsStateSrc,');
    const inlineIdx = appTsx.indexOf('inlineAppSrc,');
    expect(liveAdjIdx).toBeGreaterThan(-1);
    expect(inlineIdx).toBeGreaterThan(-1);
    expect(liveAdjIdx).toBeLessThan(inlineIdx);
  });

  it('app.css styles the live-adjustments panel', () => {
    expect(css).toContain('.live-adjustments-panel');
  });

  it('app.css styles the mix-candidates list (#523)', () => {
    expect(css).toContain('.lap-candidates');
    expect(css).toContain('.lap-cand-title');
  });

  it('app.css styles the ranked coaching card (#611)', () => {
    expect(css).toContain('.lap-card');
    expect(css).toContain('.lap-card-title');
    expect(css).toContain('.lap-card-meta');
    expect(css).toContain('.lap-card-advisory');
  });
});

describe('Per-input instrument-aware adjustment candidates (#525)', () => {
  it('lapFocusView resolves each input strip\'s effective instrument profile in the pure view module', () => {
    // live-workspace-view.test.ts asserts the resolution; pin the home.
    expect(workspaceViewTs).toContain('export function lapFocusView(');
    expect(workspaceViewTs).toContain('effectiveProfileId(');
  });

  it('focusedInputIndex is store-owned; the React panel renders it and the delegated select writes it', () => {
    expect(liveCaptureStoreTs).toContain('setFocusedInputIndex(');
    expect(liveCapturePanelTsx).toContain('.lap-focus-select');
    expect(liveCapturePanelTsx).toContain('setFocusedInputIndex(');
  });

  it('removing a track shifts/clears the focused input index in the store', () => {
    const body = methodBody(liveCaptureStoreTs, 'removeStrip(idx)');
    expect(body).toContain('focusedInputIndex: measurementSourceAfterRemove(');
  });

  it('a device switch clears the focused input through the store (TD-001 slice 6h, #711)', () => {
    // The deleted resetChannelConfig()/window.liveCaptureRuntime.selectDevice
    // wrappers were absorbed into liveCaptureStore's selectDevice/loadDevices
    // (covered by liveCaptureStore.test.ts) — inline-app.js no longer re-asserts
    // the reset itself.
    expect(liveCaptureStoreTs).toContain('focusedInputIndex: null,');
    expect(inlineApp).not.toContain('lcStore.getState().setFocusedInputIndex(null)');
  });

  it('app.css styles the focused-input selector and candidate list', () => {
    expect(css).toContain('.lap-focus-select');
    expect(css).toContain('.lap-input-candidates');
  });
});

describe('Coaching stability wiring (#612)', () => {
  it('the store owns lapCoaching and seeds fresh state via resetLapCoaching', () => {
    expect(liveCaptureStoreTs).toContain('lapCoaching:');
    expect(methodBody(liveCaptureStoreTs, 'resetLapCoaching()')).toContain('createCoachingState()');
  });

  it('liveAdjustmentsPanelHTML passes lapCoaching to panelHTML', () => {
    const body = functionBody(workspaceViewTs, 'liveAdjustmentsPanelHTML');
    expect(body).toContain('panelHTML(');
    expect(body).toContain('lapCoaching');
  });

  it('advanceLapCoaching is the once-per-window-tick advance with allCoachingCandidates and the observation context', () => {
    const body = methodBody(liveCaptureStoreTs, 'advanceLapCoaching()');
    expect(body).toContain('advanceCoaching(');
    expect(body).toContain('allCoachingCandidates(');
    expect(body).toContain('Date.now()');
    expect(body).toContain('lapObservationContext(');
  });

  it('createCoachingState is reachable from every reset path (boot seed, capture start, Clear, history load)', () => {
    // The reset path is one store function called from multiple places; count
    // the call sites across the still-inline boot seed and the 6i lifecycle
    // module (which replaced inline-app.js's onCaptureStarting) plus the store
    // action's own createCoachingState reach.
    const sites =
      lifecycleTs.split('resetLapCoaching').length - 1
      + inlineApp.split('resetLapCoaching').length - 1
      + liveCaptureStoreTs.split('createCoachingState()').length - 1;
    expect(sites).toBeGreaterThanOrEqual(3);
  });
});

describe('Coaching disposition wiring (#613)', () => {
  it('liveAdjustmentsPanelHTML passes Date.now() as the 7th argument to panelHTML', () => {
    const body = functionBody(workspaceViewTs, 'liveAdjustmentsPanelHTML');
    expect(body).toContain('panelHTML(');
    expect(body).toContain('Date.now()');
  });

  it('the React island routes data-lap-action clicks through the store\'s lapDispose, which reaches every reducer', () => {
    // liveCaptureStore.test.ts asserts each reducer; pin the homes.
    expect(liveCapturePanelTsx).toContain("closest('[data-lap-action]')");
    expect(liveCapturePanelTsx).toContain('lapDispose(');
    const reducerBody = functionBody(liveCaptureStoreTs, 'lapDisposeReducer');
    expect(reducerBody).toContain('acknowledgeCoaching(');
    expect(reducerBody).toContain('markTriedCoaching(');
    expect(reducerBody).toContain('snoozeCoaching(');
    expect(reducerBody).toContain('dismissCoaching(');
    expect(reducerBody).toContain('resumeCoaching(');
    expect(reducerBody).toContain('acknowledgeOutcome(');
  });

  it('no inline-app.js listener owns the lap- surfaces anymore (6g acceptance)', () => {
    expect(inlineApp).not.toContain("closest('[data-lap-action]')");
    expect(inlineApp).not.toContain("closest('.lap-focus-select')");
    expect(inlineApp).not.toMatch(/function syncLiveAdjustmentsPanel\(/);
    expect(inlineApp).not.toContain('window.liveCoaching');
  });

  it('app.css styles the disposition actions, cue, observing line, and snoozed card', () => {
    expect(css).toContain('.lap-card-actions');
    expect(css).toContain('.lap-action');
    expect(css).toContain('.lap-card-cue');
    expect(css).toContain('.lap-card-observing');
    expect(css).toContain('.lap-card-snoozed');
    expect(css).toContain('prefers-reduced-motion');
  });
});

describe('Outcome evaluation wiring (#614)', () => {
  it('advanceLapCoaching computes the observation context from store state and passes it to advanceCoaching', () => {
    const body = methodBody(liveCaptureStoreTs, 'advanceLapCoaching()');
    expect(body).toContain('lapObservationContext(');
    expect(body).toContain('advanceCoaching(');
  });

  it('lapDispose routes outcome-ack and passes the observation context to markTriedCoaching', () => {
    const body = functionBody(liveCaptureStoreTs, 'lapDisposeReducer');
    expect(body).toContain('acknowledgeOutcome(');
    expect(body).toContain('markTriedCoaching(lapCoaching, now, lapObservationContext(snapshot))');
  });

  it('lapObservationContext derives context in the pure view module from observationContext, liveWindows, lapFocusView, and measurementSourceOptionLabel', () => {
    // live-workspace-view.test.ts asserts the derivation; pin the home.
    const body = functionBody(workspaceViewTs, 'lapObservationContext');
    expect(body).toContain('observationContext(');
    expect(body).toContain('liveWindows');
    expect(body).toContain('lapFocusView(');
    expect(body).toContain('measurementSourceOptionLabel(');
  });

  it('app.css styles the outcome card', () => {
    expect(css).toContain('.lap-card-outcome');
    expect(css).toContain('.lap-outcome-detail');
    expect(css).toContain('.lap-outcome-metric');
  });
});
