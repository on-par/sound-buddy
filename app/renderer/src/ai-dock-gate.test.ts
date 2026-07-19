// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Inline AI Engineer dock gate (#541, epic e17): docks aside#ai-panel into a
// collapsed <details> inside the Report Card layout when report-first-ux is
// on (and mode isn't live), mirroring report-first-ux-gate.test.ts
// file-for-file. inline-app.js is coverage-excluded glue (see
// vitest.config.ts), so its wiring is verified here the same way
// report-first-ux-gate.test.ts (#538) encodes its acceptance criteria.

const inlineApp = fs.readFileSync(fileURLToPath(new URL('./inline-app.js', import.meta.url)), 'utf8');
const appTsx = fs.readFileSync(fileURLToPath(new URL('./App.tsx', import.meta.url)), 'utf8');
const rootMarkup = fs.readFileSync(fileURLToPath(new URL('./root-markup.html', import.meta.url)), 'utf8');
const appCss = fs.readFileSync(fileURLToPath(new URL('./styles/app.css', import.meta.url)), 'utf8');
const aiDockState = fs.readFileSync(fileURLToPath(new URL('../ai-dock-state.js', import.meta.url)), 'utf8');

describe('AI Engineer inline dock gate (#541)', () => {
  it('App.tsx imports and boots ai-dock-state.js before the inline app script', () => {
    expect(appTsx).toContain("import aiDockStateSrc from '../ai-dock-state.js?raw';");
    const aiDockIdx = appTsx.indexOf('aiDockStateSrc,');
    const inlineIdx = appTsx.indexOf('inlineAppSrc,');
    expect(aiDockIdx).toBeGreaterThan(-1);
    expect(inlineIdx).toBeGreaterThan(-1);
    expect(aiDockIdx).toBeLessThan(inlineIdx);
  });

  it('inline-app.js derives dock placement from the predicate, never hardwired', () => {
    expect(inlineApp).toContain('window.aiDockState.placement(');
    expect(inlineApp).toContain('window.reportFirstUxState.isEnabled(');
  });

  it('inline-app.js re-syncs the dock on mode-tab clicks and on settings changes', () => {
    expect(inlineApp).toContain('syncAiDock()');
    expect(inlineApp).toContain('setStore.subscribe(() => syncAiDock());');
  });

  it('inline-app.js re-syncs the dock once at boot for a flag-already-on first paint', () => {
    const bootCallIdx = inlineApp.lastIndexOf('syncAiDock();');
    const subscribeIdx = inlineApp.indexOf('setStore.subscribe(() => syncAiDock());');
    expect(bootCallIdx).toBeGreaterThan(-1);
    expect(bootCallIdx).not.toBe(subscribeIdx);
  });

  it('root-markup.html has the collapsed-by-default dock inside #rc-layout, after #report-card', () => {
    expect(rootMarkup).toMatch(/<details id="rc-ai-dock"(?![^>]*\bopen\b)[^>]*>/);
    const reportCardIdx = rootMarkup.indexOf('id="report-card"');
    const dockIdx = rootMarkup.indexOf('id="rc-ai-dock"');
    const rcLayoutIdx = rootMarkup.indexOf('id="rc-layout"');
    expect(reportCardIdx).toBeGreaterThan(-1);
    expect(dockIdx).toBeGreaterThan(reportCardIdx);
    expect(rcLayoutIdx).toBeLessThan(dockIdx);
  });

  it('root-markup.html leaves aside#ai-panel in place inside #workspace, before the Report Card (flag-off unchanged)', () => {
    const aiPanelIdx = rootMarkup.indexOf('<aside id="ai-panel"');
    const reportCardCommentIdx = rootMarkup.indexOf('<!-- ══ Report Card ══ -->');
    expect(aiPanelIdx).toBeGreaterThan(-1);
    expect(reportCardCommentIdx).toBeGreaterThan(-1);
    expect(aiPanelIdx).toBeLessThan(reportCardCommentIdx);
  });

  it('app.css keeps the flag-off rail behavior untouched', () => {
    expect(appCss).toContain('body.rc-active #ai-panel { display:none; }');
  });

  it('app.css hides the dock by default and shows it docked under the flag', () => {
    expect(appCss).toContain('#rc-ai-dock { display:none; }');
    expect(appCss).toContain('body.report-first-ux #rc-ai-dock {');
    expect(appCss).toContain('body.report-first-ux #rc-ai-dock #ai-panel {');
  });

  it('app.css hides the dock when AI is disabled', () => {
    expect(appCss).toContain('body.ai-disabled #rc-ai-dock { display:none !important; }');
  });

  it('ai-dock-state.js carries the proprietary header', () => {
    expect(aiDockState).toContain('Copyright (c) 2026 Patrick Robinson (on-par)');
  });
});
