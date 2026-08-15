// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Guided first-use setup for the Live tab (#294): the zero-state teaches the
// sequence choose a device -> add a track -> start monitoring or recording,
// and advanced power-user controls stay hidden until at least one track
// exists. Since slice 6g (#710) the hero/banner render from live-board.ts
// (heroHTML/bannerHTML) via LiveCapturePanel; inline-app.js is coverage-
// excluded glue verified by e2e (#303), so these assertions encode the
// acceptance criteria the same way root-markup.test.ts (#293) does.

const inlineApp = fs.readFileSync(fileURLToPath(new URL('./inline-app.js', import.meta.url)), 'utf8');
const liveBoard = fs.readFileSync(fileURLToPath(new URL('./live-board.ts', import.meta.url)), 'utf8');
const capturePanel = fs.readFileSync(fileURLToPath(new URL('./LiveCapturePanel.tsx', import.meta.url)), 'utf8');

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

describe('Live tab guided first-use setup (#294, React-rendered since #710)', () => {
  it('replaces the bare technical-canvas empty state', () => {
    expect(inlineApp).not.toContain('Add your first track to get started');
  });

  it('live-board.ts exposes the instructional hero + first-use banner builders', () => {
    expect(liveBoard).toMatch(/export function heroHTML\(/);
    expect(liveBoard).toMatch(/export function bannerHTML\(/);
    const hero = functionBody(liveBoard, 'heroHTML');
    expect(hero).toContain('live-setup-hero');
    expect(hero).toContain('Set up your live check');
    expect(hero).toContain('Add your first track');
  });

  it('gates advanced controls (new group / collapse / expand / arm-all) behind showAdvancedControls', () => {
    expect(liveBoard).toMatch(/showAdvancedControls\(/);
  });

  it('renders an instructional hero when the workspace is empty, and a banner otherwise', () => {
    // heroHTML renders at zero tracks; bannerHTML renders above the seeded
    // board while the guide is not complete AND the board is idle.
    const banner = functionBody(liveBoard, 'bannerHTML');
    expect(banner).toContain('live-setup-banner');
    expect(banner).toContain('shouldShowGuide(');
    expect(banner).toContain('isCapturing');
  });

  it('marks setup complete both on dismiss and on first successful capture start', () => {
    // Dismiss → LiveCapturePanel's delegated handler; capture start →
    // inline-app.js's onCaptureStarted success path (both still present).
    expect(capturePanel).toContain('markSetupGuideComplete(');
    expect(capturePanel).toContain('live-setup-skip');
    expect(inlineApp).toContain('markSetupComplete(');
  });

  it('dismiss handler removes the rendered banner and re-renders from localStorage', () => {
    const skipHandler = capturePanel.slice(capturePanel.indexOf('live-setup-skip'));
    expect(skipHandler).toContain('markSetupGuideComplete(window.localStorage)');
    expect(skipHandler).toContain('setGuideDismissed(true)');
  });

  it('the zero-track CTA carries the same disabled rule as the toolbar Add track (#294/#188)', () => {
    const hero = functionBody(liveBoard, 'heroHTML');
    expect(hero).toContain('addTrackDisabled(state)');
    expect(hero).toContain('id="live-ws-add"');
  });
});
