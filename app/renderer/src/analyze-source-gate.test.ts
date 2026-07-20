// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Unified "Analyze" source picker gate (#543, epic e17): offers exactly
// three choices (file / live / soundcheck) at the moment a new analysis
// starts, routing each to the flow the corresponding existing tab already
// drives, unchanged. inline-app.js is coverage-excluded glue (see
// vitest.config.ts), so its wiring is verified here the same way
// single-column-gate.test.ts and ai-dock-gate.test.ts encode their
// acceptance criteria.

const inlineApp = fs.readFileSync(fileURLToPath(new URL('./inline-app.js', import.meta.url)), 'utf8');
const appTsx = fs.readFileSync(fileURLToPath(new URL('./App.tsx', import.meta.url)), 'utf8');
const rootMarkup = fs.readFileSync(fileURLToPath(new URL('./root-markup.html', import.meta.url)), 'utf8');
const appCss = fs.readFileSync(fileURLToPath(new URL('./styles/app.css', import.meta.url)), 'utf8');
const analyzeSourceState = fs.readFileSync(fileURLToPath(new URL('../analyze-source-state.js', import.meta.url)), 'utf8');

describe('Unified Analyze source picker gate (#543)', () => {
  it('App.tsx imports and boots analyze-source-state.js before the inline app script', () => {
    expect(appTsx).toContain("import analyzeSourceStateSrc from '../analyze-source-state.js?raw';");
    const analyzeSourceIdx = appTsx.indexOf('analyzeSourceStateSrc,');
    const inlineIdx = appTsx.indexOf('inlineAppSrc,');
    expect(analyzeSourceIdx).toBeGreaterThan(-1);
    expect(inlineIdx).toBeGreaterThan(-1);
    expect(analyzeSourceIdx).toBeLessThan(inlineIdx);
  });

  it('root-markup.html has exactly three data-analyze-source choices, one per source', () => {
    const matches = rootMarkup.match(/data-analyze-source=/g) || [];
    expect(matches.length).toBe(3);
    expect(rootMarkup).toContain('data-analyze-source="file"');
    expect(rootMarkup).toContain('data-analyze-source="live"');
    expect(rootMarkup).toContain('data-analyze-source="soundcheck"');
  });

  it('root-markup.html hides the picker so flag-off never paints it (no flash)', () => {
    expect(rootMarkup).toMatch(/id="analyze-source-picker"[^>]*\bhidden\b/);
  });

  it('the picker markup does not duplicate the Pro gate or tab lock', () => {
    const pickerMatch = rootMarkup.match(/<div class="source-picker"[\s\S]*?<\/div>\s*<\/div>/);
    expect(pickerMatch).not.toBeNull();
    const picker = pickerMatch![0];
    expect(picker).not.toContain('pro-gate');
    expect(picker).not.toContain('tab-lock');
  });

  it('inline-app.js gates the picker through reportFirstUxState.isEnabled, never reading settings directly', () => {
    expect(inlineApp).toContain('window.analyzeSourceState.isPickerEnabled(');
    expect(inlineApp).toContain('window.reportFirstUxState.isEnabled(setStore.getState().settings)');
    expect(inlineApp).not.toContain('settings.reportFirstUxEnabled');
  });

  it('inline-app.js routes chosen sources through analyzeSourceState.targetModeFor', () => {
    expect(inlineApp).toContain('window.analyzeSourceState.targetModeFor(');
  });

  it('inline-app.js still falls back to chooseAndAnalyzeFile when the flag is off (additive guarantee)', () => {
    expect(inlineApp).toContain('function chooseAndAnalyzeFile()');
    expect(inlineApp).toContain('chooseAndAnalyzeFile();');
  });

  it('inline-app.js opens/closes the picker and wires cancel + Escape', () => {
    expect(inlineApp).toContain('function openAnalyzeSourcePicker()');
    expect(inlineApp).toContain('function closeAnalyzeSourcePicker()');
    expect(inlineApp).toContain("getElementById('source-picker-cancel')");
    expect(inlineApp).toMatch(/key === 'Escape'[\s\S]{0,120}closeAnalyzeSourcePicker\(\)/);
  });

  it('app.css contains the belt-and-braces flag-off rule', () => {
    expect(appCss).toContain('body:not(.report-first-ux) #analyze-source-picker { display:none !important; }');
  });

  it('analyze-source-state.js carries the proprietary header', () => {
    expect(analyzeSourceState).toContain('Copyright (c) 2026 Patrick Robinson (on-par)');
  });
});
