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

  it('renders a muted empty-state row when channelConfig is empty', () => {
    const body = functionBody(inlineApp, 'renderDawShell');
    expect(body).toContain('Add tracks from the Source panel');
  });

  it('patches in place instead of rebuilding every tick', () => {
    const body = functionBody(inlineApp, 'renderDawShell');
    expect(body).toContain('.daw-shell');
    expect(body).toContain('.daw-channel-lane');
    expect(body).toContain('channelConfig.length');
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
    const subscriberBlock = inlineApp.slice(
      inlineApp.indexOf("classList.toggle('daw-workspace'"),
      inlineApp.indexOf("classList.toggle('daw-workspace'") + 600
    );
    expect(subscriberBlock).toContain("syncSpectrumForMode('live')");
  });
});

describe('DAW shell styles (#517)', () => {
  it('app.css styles the shell and its lanes', () => {
    expect(css).toContain('.daw-shell');
    expect(css).toContain('.daw-lane');
  });
});
