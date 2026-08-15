// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Experimental live adjustments area (#522) + per-input candidates (#525) +
// coaching stability (#612/#613) + outcome evaluation (#614): since slice 6g
// (#710) the panel renders from liveCaptureStore state (live-board.ts's
// liveAdjustmentsPanelHTML → LiveCapturePanel), with the coaching state and
// focused input store-owned. inline-app.js is coverage-excluded glue (see
// vitest.config.ts); these assertions encode the acceptance criteria the same
// way the pre-6g gate did, pointing at the new module/component/store.

const inlineApp = fs.readFileSync(fileURLToPath(new URL('./inline-app.js', import.meta.url)), 'utf8');
const liveBoard = fs.readFileSync(fileURLToPath(new URL('./live-board.ts', import.meta.url)), 'utf8');
const capturePanel = fs.readFileSync(fileURLToPath(new URL('./LiveCapturePanel.tsx', import.meta.url)), 'utf8');
const liveCaptureStore = fs.readFileSync(fileURLToPath(new URL('./stores/liveCaptureStore.ts', import.meta.url)), 'utf8');
const settingsPanelTsx = fs.readFileSync(fileURLToPath(new URL('./SettingsPanel.tsx', import.meta.url)), 'utf8');
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

describe('Live adjustments panel rendering (slice 6g, #710)', () => {
  it('live-board.ts exposes the adjustments panel HTML from panelHTML with the store state', () => {
    expect(liveBoard).toMatch(/export function liveAdjustmentsPanelHTML\(/);
    const body = functionBody(liveBoard, 'liveAdjustmentsPanelHTML');
    expect(body).toContain('getLiveAdjustmentsState().panelHTML(');
    expect(body).toContain('liveWindows');
    expect(body).toContain('lapFocusView(');
    expect(body).toContain('lapCoaching');
  });

  it('LiveCapturePanel renders the panel through dangerouslySetInnerHTML after the board', () => {
    expect(capturePanel).toContain('liveAdjustmentsPanelHTML(');
    expect(capturePanel).toContain('dangerouslySetInnerHTML');
    expect(capturePanel).toContain('liveBoardState()');
  });

  it('liveCaptureStore owns lapCoaching + focusedInputIndex with the five actions', () => {
    expect(liveCaptureStore).toContain('focusedInputIndex: number | null;');
    expect(liveCaptureStore).toContain('lapCoaching: unknown;');
    expect(liveCaptureStore).toContain('advanceLapCoaching(candidates, now, context)');
    expect(liveCaptureStore).toContain('applyLapAction(action, now, context)');
    expect(liveCaptureStore).toContain('setFocusedInputIndex(');
    expect(liveCaptureStore).toContain('resetLapCoaching()');
  });

  it('inline-app.js no longer renders the panel imperatively; coaching routes through the store', () => {
    expect(inlineApp).not.toContain('syncLiveAdjustmentsPanel');
    expect(inlineApp).not.toContain('function lapFocusView');
    expect(inlineApp).toContain('lcStore.getState().advanceLapCoaching(candidates, Date.now(), context)');
    expect(inlineApp).toContain('window.liveCoaching = { reset: () => lcStore.getState().resetLapCoaching() }');
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

  it('app.css styles the live-adjustments panel + candidates + coaching card', () => {
    expect(css).toContain('.live-adjustments-panel');
    expect(css).toContain('.lap-candidates');
    expect(css).toContain('.lap-cand-title');
    expect(css).toContain('.lap-card');
    expect(css).toContain('.lap-card-title');
    expect(css).toContain('.lap-card-meta');
    expect(css).toContain('.lap-card-advisory');
  });
});

describe('Per-input instrument-aware adjustment candidates (#525)', () => {
  it('live-board.ts resolves the focus view + observation context from store state', () => {
    expect(liveBoard).toMatch(/export function lapFocusView\(/);
    expect(liveBoard).toMatch(/export function lapObservationContext\(/);
    const focus = functionBody(liveBoard, 'lapFocusView');
    expect(focus).toContain('profileById(');
    expect(focus).toContain('effectiveProfileId(');
    const obs = functionBody(liveBoard, 'lapObservationContext');
    expect(obs).toContain('getLiveAdjustmentsState().observationContext(');
    expect(obs).toContain('measurementSourceOptionLabel(');
  });

  it('LiveCapturePanel routes .lap-focus-select changes to setFocusedInputIndex', () => {
    expect(capturePanel).toContain('lap-focus-select');
    expect(capturePanel).toContain('setFocusedInputIndex(');
  });

  it('app.css styles the focused-input selector and candidate list', () => {
    expect(css).toContain('.lap-focus-select');
    expect(css).toContain('.lap-input-candidates');
  });
});

describe('Coaching disposition wiring (#613/#614)', () => {
  it('LiveCapturePanel routes [data-lap-action] clicks to applyLapAction', () => {
    expect(capturePanel).toContain('[data-lap-action]');
    expect(capturePanel).toContain('applyLapAction(');
  });

  it('inline-app.js window ticks call the store advanceCoaching action once per window', () => {
    const block = enclosingBlock(inlineApp, 'sessionWindows.push');
    expect(block).toContain('lcStore.getState().advanceLapCoaching(candidates, Date.now(), context)');
    expect(block).toContain('allCoachingCandidates(');
    expect(block).toContain('observationContext(');
  });

  it('app.css styles the disposition actions, cue, observing line, and snoozed card', () => {
    expect(css).toContain('.lap-card-actions');
    expect(css).toContain('.lap-action');
    expect(css).toContain('.lap-card-cue');
    expect(css).toContain('.lap-card-observing');
    expect(css).toContain('.lap-card-snoozed');
    expect(css).toContain('.lap-card-outcome');
    expect(css).toContain('.lap-outcome-detail');
    expect(css).toContain('.lap-outcome-metric');
  });
});
