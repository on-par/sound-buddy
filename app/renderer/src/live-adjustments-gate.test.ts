// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Experimental live adjustments area (#522): a static placeholder panel gated
// behind liveAdjustmentsEnabled, mirroring the #516 dawWorkspaceEnabled
// pattern file-for-file. inline-app.js is coverage-excluded glue (see
// vitest.config.ts), verified here the same way daw-workspace-shell.test.ts
// (#517) encodes its acceptance criteria.

const inlineApp = fs.readFileSync(fileURLToPath(new URL('./inline-app.js', import.meta.url)), 'utf8');
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

describe('Live adjustments gate wiring (#522)', () => {
  it('renderDawShell calls syncLiveAdjustmentsPanel', () => {
    const body = functionBody(inlineApp, 'renderDawShell');
    expect(body).toContain('syncLiveAdjustmentsPanel(');
    expect(body.split('syncLiveAdjustmentsPanel(').length).toBeGreaterThanOrEqual(3);
  });

  it('renderLiveMeters calls syncLiveAdjustmentsPanel on both the patch and rebuild paths', () => {
    const body = functionBody(inlineApp, 'renderLiveMeters');
    expect(body).toContain('syncLiveAdjustmentsPanel(');
    expect(body.split('syncLiveAdjustmentsPanel(').length).toBeGreaterThanOrEqual(3);
  });

  it('renderLiveWorkspace calls syncLiveAdjustmentsPanel', () => {
    const body = functionBody(inlineApp, 'renderLiveWorkspace');
    expect(body).toContain('syncLiveAdjustmentsPanel(');
  });

  it('syncLiveAdjustmentsPanel reads panelHTML and manages the panel element', () => {
    const body = functionBody(inlineApp, 'syncLiveAdjustmentsPanel');
    expect(body).toContain('liveAdjustmentsState.panelHTML(');
    expect(body).toContain('.live-adjustments-panel');
  });

  it('syncLiveAdjustmentsPanel passes live window data through and replaces stale panels', () => {
    const body = functionBody(inlineApp, 'syncLiveAdjustmentsPanel');
    expect(body).toContain('liveWindows');
    expect(body).toContain('measurementSource');
    expect(body).toContain('outerHTML');
  });

  it('window ticks refresh the adjustments panel', () => {
    const block = enclosingBlock(inlineApp, 'liveWindows.push');
    expect(block).toContain('syncLiveAdjustmentsPanel(');
  });

  it('starting a capture resets the adjustments panel to the waiting state', () => {
    const block = enclosingBlock(inlineApp, 'liveRunning = true');
    expect(block).toContain('syncLiveAdjustmentsPanel(');
  });

  it('the settingsStore subscriber re-syncs the Live pane on an actual flip', () => {
    const block = enclosingBlock(inlineApp, 'liveAdjustmentsWasEnabled = nowEnabled');
    expect(block).toContain('liveAdjustmentsState.isEnabled(');
    expect(block).toContain("syncSpectrumForMode('live')");
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
  it('syncLiveAdjustmentsPanel builds and passes the focus view', () => {
    const body = functionBody(inlineApp, 'syncLiveAdjustmentsPanel');
    expect(body).toContain('lapFocusView(');
  });

  it('lapFocusView resolves each input strip\'s effective instrument profile', () => {
    const body = functionBody(inlineApp, 'lapFocusView');
    expect(body).toContain('instrumentProfiles.profileById(');
    expect(body).toContain('effectiveProfileId(');
  });

  it('the .lap-focus-select change listener updates focusedInputIndex and re-syncs the panel', () => {
    const block = enclosingBlock(inlineApp, "closest('.lap-focus-select')");
    expect(block).toContain('focusedInputIndex');
    expect(block).toContain('syncLiveAdjustmentsPanel(');
  });

  it('removing a track shifts/clears the focused input index', () => {
    const block = enclosingBlock(inlineApp, 'measurementSourceAfterRemove(focusedInputIndex');
    expect(block).toBeTruthy();
  });

  it('resetChannelConfig clears the focused input on a device switch', () => {
    const body = functionBody(inlineApp, 'resetChannelConfig');
    expect(body).toContain('focusedInputIndex = null');
  });

  it('app.css styles the focused-input selector and candidate list', () => {
    expect(css).toContain('.lap-focus-select');
    expect(css).toContain('.lap-input-candidates');
  });
});
