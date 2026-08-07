// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Single-column workspace gate (#542, epic e17): renders the Source panel
// full-width and folds the spectrum panel away for Recent / Build Guide /
// Ring-Out when report-first-ux is on, mirroring report-first-ux-gate.test.ts
// file-for-file. inline-app.js is coverage-excluded glue (see
// vitest.config.ts), so its wiring is verified here the same way that gate
// test encodes its acceptance criteria. The predicate + DOM apply moved from
// inline-app.js's syncSingleColumn into mode-switch.ts#applySingleColumnSync
// (TD-001 slice 6e, #703), called from switchMode() (mode-tab clicks) and
// still bridged onto window.modeSwitch for inline-app.js's own remaining
// settings-change/boot call sites.

const inlineApp = fs.readFileSync(fileURLToPath(new URL('./inline-app.js', import.meta.url)), 'utf8');
const modeSwitchSrc = fs.readFileSync(fileURLToPath(new URL('./mode-switch.ts', import.meta.url)), 'utf8');
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

  it('mode-switch.ts derives the single-column class from the predicate, never hardwired', () => {
    expect(modeSwitchSrc).toContain('getSingleColumnState().isSingleColumn(');
    expect(modeSwitchSrc).toContain('getReportFirstUxState().isEnabled(');
    expect(modeSwitchSrc).toContain("document.body.classList.toggle('single-column'");
  });

  it('mode-tab clicks (switchMode) and inline-app.js settings changes both re-sync', () => {
    expect(modeSwitchSrc).toContain('applySingleColumnSync();');
    expect(inlineApp).toContain('setStore.subscribe(() => window.modeSwitch.applySingleColumnSync());');
  });

  it('inline-app.js re-syncs once at boot for a flag-already-on first paint', () => {
    const bootCallIdx = inlineApp.lastIndexOf('window.modeSwitch.applySingleColumnSync();');
    const subscribeIdx = inlineApp.indexOf('setStore.subscribe(() => window.modeSwitch.applySingleColumnSync());');
    expect(bootCallIdx).toBeGreaterThan(-1);
    expect(bootCallIdx).not.toBe(subscribeIdx);
  });

  it('root-markup.html has no single-column markup (flag-off shell is byte-identical)', () => {
    expect(rootMarkup).not.toContain('single-column');
  });

  it('app.css collapses the spectrum panel and frees the source panel', () => {
    expect(appCss).toContain('body.single-column #spectrum-panel { display:none; }');
    expect(appCss).toContain('body.single-column #source-panel');
  });

  it('single-column-state.js carries the proprietary header', () => {
    expect(singleColumnState).toContain('Copyright (c) 2026 Patrick Robinson (on-par)');
  });
});
