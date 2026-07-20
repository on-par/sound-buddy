// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Single-column workspace gate (#542, epic e17): renders the Source panel
// full-width and folds the spectrum panel + AI rail away for Recent / Build
// Guide / Ring-Out when report-first-ux is on, mirroring
// ai-dock-gate.test.ts and report-first-ux-gate.test.ts file-for-file.
// inline-app.js is coverage-excluded glue (see vitest.config.ts), so its
// wiring is verified here the same way those gate tests encode their
// acceptance criteria.

const inlineApp = fs.readFileSync(fileURLToPath(new URL('./inline-app.js', import.meta.url)), 'utf8');
const appTsx = fs.readFileSync(fileURLToPath(new URL('./App.tsx', import.meta.url)), 'utf8');
const rootMarkup = fs.readFileSync(fileURLToPath(new URL('./root-markup.html', import.meta.url)), 'utf8');
const appCss = fs.readFileSync(fileURLToPath(new URL('./styles/app.css', import.meta.url)), 'utf8');
const singleColumnState = fs.readFileSync(fileURLToPath(new URL('../single-column-state.js', import.meta.url)), 'utf8');

describe('Single-column workspace gate (#542)', () => {
  it('App.tsx imports and boots single-column-state.js before the inline app script', () => {
    expect(appTsx).toContain("import singleColumnStateSrc from '../single-column-state.js?raw';");
    const singleColumnIdx = appTsx.indexOf('singleColumnStateSrc,');
    const inlineIdx = appTsx.indexOf('inlineAppSrc,');
    expect(singleColumnIdx).toBeGreaterThan(-1);
    expect(inlineIdx).toBeGreaterThan(-1);
    expect(singleColumnIdx).toBeLessThan(inlineIdx);
  });

  it('inline-app.js derives the single-column class from the predicate, never hardwired', () => {
    expect(inlineApp).toContain('window.singleColumnState.isSingleColumn(');
    expect(inlineApp).toContain('window.reportFirstUxState.isEnabled(');
    expect(inlineApp).toContain("document.body.classList.toggle('single-column'");
  });

  it('inline-app.js re-syncs on mode-tab clicks and on settings changes', () => {
    expect(inlineApp).toContain('syncSingleColumn()');
    expect(inlineApp).toContain('setStore.subscribe(() => syncSingleColumn());');
  });

  it('inline-app.js re-syncs once at boot for a flag-already-on first paint', () => {
    const bootCallIdx = inlineApp.lastIndexOf('syncSingleColumn();');
    const subscribeIdx = inlineApp.indexOf('setStore.subscribe(() => syncSingleColumn());');
    expect(bootCallIdx).toBeGreaterThan(-1);
    expect(bootCallIdx).not.toBe(subscribeIdx);
  });

  it('root-markup.html has no single-column markup (flag-off shell is byte-identical)', () => {
    expect(rootMarkup).not.toContain('single-column');
  });

  it('app.css collapses both side panels and frees the source panel', () => {
    expect(appCss).toContain('body.single-column #spectrum-panel { display:none; }');
    expect(appCss).toContain('body.single-column #ai-panel { display:none; }');
    expect(appCss).toContain('body.single-column #source-panel');
  });

  it('app.css hides the single-column AI panel rule after the docked-AI cascade so it always wins', () => {
    const dockedAiIdx = appCss.indexOf('body.report-first-ux #rc-ai-dock #ai-panel');
    const singleColumnAiIdx = appCss.indexOf('body.single-column #ai-panel');
    expect(dockedAiIdx).toBeGreaterThan(-1);
    expect(singleColumnAiIdx).toBeGreaterThan(-1);
    expect(singleColumnAiIdx).toBeGreaterThan(dockedAiIdx);
  });

  it('single-column-state.js carries the proprietary header', () => {
    expect(singleColumnState).toContain('Copyright (c) 2026 Patrick Robinson (on-par)');
  });
});
