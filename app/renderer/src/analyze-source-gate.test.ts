// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Unified "Analyze" source picker gate (#543, epic e17): offers exactly
// three choices (file / live / soundcheck) at the moment a new analysis
// starts, routing each to the flow the corresponding existing tab already
// drives, unchanged. Since TD-001 slice 6h (#711) the picker is React-owned
// (AnalyzeSourcePicker.tsx + analyzeSourceStore.ts, replacing inline-app.js's
// static overlay + window.analyzeSourcePicker open/close bridge) — the
// picker's markup/dispatch acceptance criteria are encoded here the same way
// single-column-gate.test.ts and ai-dock-gate.test.ts encode theirs. The
// routing logic itself (analyzeSourceState.targetModeFor) stays a classic
// script, unit-tested in analyze-source-state.js's own suite.

const inlineApp = fs.readFileSync(fileURLToPath(new URL('./inline-app.js', import.meta.url)), 'utf8');
const appTsx = fs.readFileSync(fileURLToPath(new URL('./App.tsx', import.meta.url)), 'utf8');
const pickerTsx = fs.readFileSync(fileURLToPath(new URL('./AnalyzeSourcePicker.tsx', import.meta.url)), 'utf8');
const pickerStoreTs = fs.readFileSync(fileURLToPath(new URL('./stores/analyzeSourceStore.ts', import.meta.url)), 'utf8');
const rootMarkup = fs.readFileSync(fileURLToPath(new URL('./root-markup.html', import.meta.url)), 'utf8');
const appCss = fs.readFileSync(fileURLToPath(new URL('./styles/app.css', import.meta.url)), 'utf8');
const analyzeSourceState = fs.readFileSync(fileURLToPath(new URL('../analyze-source-state.js', import.meta.url)), 'utf8');
// The reportcard-load-btn gating lives in ReportCardToolbar.tsx's onClick
// (TD-001 slice 6e, #703) — scan it for that piece.
const reportCardToolbarTsx = fs.readFileSync(fileURLToPath(new URL('./ReportCardToolbar.tsx', import.meta.url)), 'utf8');

describe('Unified Analyze source picker gate (#543)', () => {
  it('App.tsx imports and boots analyze-source-state.js before the inline app script', () => {
    expect(appTsx).toContain("import analyzeSourceStateSrc from '../analyze-source-state.js?raw';");
    const analyzeSourceIdx = appTsx.indexOf('analyzeSourceStateSrc,');
    const inlineIdx = appTsx.indexOf('inlineAppSrc,');
    expect(analyzeSourceIdx).toBeGreaterThan(-1);
    expect(inlineIdx).toBeGreaterThan(-1);
    expect(analyzeSourceIdx).toBeLessThan(inlineIdx);
  });

  it('App.tsx mounts AnalyzeSourcePicker as a direct child (like LicenseChrome), gated on booted', () => {
    expect(appTsx).toContain("import AnalyzeSourcePicker from './AnalyzeSourcePicker';");
    expect(appTsx).toContain('booted && <AnalyzeSourcePicker />');
  });

  it('AnalyzeSourcePicker has exactly three data-analyze-source choices, one per source', () => {
    // The SOURCES table drives the rendered choices — it carries exactly the
    // three ids, mapped through one data-analyze-source binding. The rendered
    // three-button output is pinned by AnalyzeSourcePicker.test.tsx.
    expect(pickerTsx).toContain('data-analyze-source={s.id}');
    expect(pickerTsx).toContain("{ id: 'file', icon: 'file-audio'");
    expect(pickerTsx).toContain("{ id: 'live', icon: 'radio'");
    expect(pickerTsx).toContain("{ id: 'soundcheck', icon: 'sliders'");
    const ids = ['file', 'live', 'soundcheck'];
    const sourceLines = (pickerTsx.match(/\{ id: '[a-z]+', icon: '[a-z-]+'/g) || []);
    expect(sourceLines).toHaveLength(3);
    expect(ids.every((id) => pickerTsx.includes(`id: '${id}'`))).toBe(true);
  });

  it('root-markup no longer carries the static overlay — the picker renders nothing until the store opens it (no flash)', () => {
    expect(rootMarkup).not.toContain('id="analyze-source-picker"');
    expect(pickerStoreTs).toContain('isOpen: false');
    expect(pickerTsx).toContain('if (!isOpen) return null;');
  });

  it('the picker markup does not duplicate the Pro gate or tab lock', () => {
    expect(pickerTsx).not.toContain('pro-gate');
    expect(pickerTsx).not.toContain('tab-lock');
  });

  it('ReportCardToolbar.tsx gates the picker through reportFirstUxState.isEnabled, never reading settings directly', () => {
    expect(reportCardToolbarTsx).toContain('getAnalyzeSourceState().isPickerEnabled(');
    expect(reportCardToolbarTsx).toContain('getReportFirstUxState().isEnabled(settings)');
    expect(reportCardToolbarTsx).not.toContain('settings.reportFirstUxEnabled');
  });

  it('AnalyzeSourcePicker routes chosen sources through analyzeSourceState.targetModeFor', () => {
    expect(pickerTsx).toContain('window as unknown as { analyzeSourceState: AnalyzeSourceStateApi }');
    expect(pickerTsx).toContain('targetModeFor(id)');
  });

  it('AnalyzeSourcePicker surfaces an error instead of silently no-opping on an unrecognized source id', () => {
    // targetModeFor returns undefined for an unknown id specifically so a typo
    // "fails loudly instead of silently no-op'ing" (analyze-source-state.js) —
    // the picker's choice dispatch must honor that contract, not just close.
    expect(pickerTsx).toMatch(/mode === undefined[\s\S]{0,160}console\.error/);
  });

  it('inline-app.js no longer defines chooseAndAnalyzeFile — AnalyzeSourcePicker.tsx imports it directly (TD-001 slice 6k, #714)', () => {
    expect(inlineApp).not.toContain('function chooseAndAnalyzeFile()');
    expect(inlineApp).not.toContain('window.chooseAndAnalyzeFile = chooseAndAnalyzeFile');
    expect(pickerTsx).toContain("import { chooseAndAnalyzeFile } from './report-card-chrome';");
  });

  it('the file source routes through the imported chooseAndAnalyzeFile', () => {
    expect(pickerTsx).toContain('void chooseAndAnalyzeFile()');
  });

  it('AnalyzeSourcePicker wires cancel + Escape to the store close action', () => {
    expect(pickerTsx).toContain('id="source-picker-cancel"');
    expect(pickerTsx).toContain("if (e.key === 'Escape') useAnalyzeSourceStore.getState().close()");
    expect(pickerTsx).toContain('onClick={() => useAnalyzeSourceStore.getState().close()}');
  });

  it('ModeTabs opens the picker through the store, not a window bridge', () => {
    const modeTabsTsx = fs.readFileSync(fileURLToPath(new URL('./ModeTabs.tsx', import.meta.url)), 'utf8');
    expect(modeTabsTsx).toContain('useAnalyzeSourceStore.getState().open()');
    expect(modeTabsTsx).not.toContain('getAnalyzeSourcePicker()');
  });

  it('app.css contains the belt-and-braces flag-off rule', () => {
    expect(appCss).toContain('body:not(.report-first-ux) #analyze-source-picker { display:none !important; }');
  });

  it('analyze-source-state.js carries the proprietary header', () => {
    expect(analyzeSourceState).toContain('Copyright (c) 2026 Patrick Robinson (on-par)');
  });
});
