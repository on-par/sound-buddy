// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const appCss = fs.readFileSync(fileURLToPath(new URL('./styles/app.css', import.meta.url)), 'utf8');
const panelSrc = fs.readFileSync(fileURLToPath(new URL('./AnalyzeLiveEqPanel.tsx', import.meta.url)), 'utf8');
const appSrc = fs.readFileSync(fileURLToPath(new URL('./App.tsx', import.meta.url)), 'utf8');
const modeSwitchSrc = fs.readFileSync(fileURLToPath(new URL('./mode-switch.ts', import.meta.url)), 'utf8');
const analyzeEntryStoreSrc = fs.readFileSync(fileURLToPath(new URL('./stores/analyzeEntryStore.ts', import.meta.url)), 'utf8');
const liveEqPaneSrc = fs.readFileSync(fileURLToPath(new URL('./LiveEqPane.tsx', import.meta.url)), 'utf8');

describe('#1496 analyze layout: the live EQ owns the primary stage', () => {
  it('folds the source panel and the report-card column away while listening', () => {
    expect(appCss).toContain('body.analyze-listening #source-panel { display:none !important; }');
    expect(appCss).toContain('body.analyze-listening #reportcard-view { display:none !important; }');
  });

  it('force-shows #spectrum-panel so Simple-mode single-column cannot hide the island', () => {
    expect(appCss).toContain('body.analyze-listening #spectrum-panel { display:flex !important; }');
    expect(appCss).toContain('body.single-column #spectrum-panel { display:none; }');
    const analyzeListeningIdx = appCss.indexOf('body.analyze-listening #spectrum-panel { display:flex !important; }');
    const singleColumnIdx = appCss.indexOf('body.single-column #spectrum-panel { display:none; }');
    expect(analyzeListeningIdx).toBeGreaterThan(-1);
    expect(singleColumnIdx).toBeGreaterThan(-1);
    expect(analyzeListeningIdx).toBeLessThan(singleColumnIdx);
  });

  it('gives the EQ card the freed stage (flex:1) with a subordinate actions row', () => {
    expect(appCss).toContain('.analyze-live-eq .eq-pane-primary { flex:1; min-height:0;');
    expect(appCss).toContain('.analyze-live-eq-actions { display:flex; gap:8px; align-self:flex-start; flex-shrink:0; }');
  });

  it('never forces a height or preserveAspectRatio on the room curve', () => {
    const startIdx = appCss.indexOf('.analyze-live-eq .eq-pane-primary { flex:1; min-height:0;');
    const endIdx = appCss.indexOf('.analyze-live-eq-actions { display:flex; gap:8px; align-self:flex-start; flex-shrink:0; }');
    expect(startIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(startIdx);
    const slice = appCss.slice(startIdx, endIdx);
    expect(slice).not.toContain('preserveAspectRatio');
    expect(slice).not.toContain('.veq-chart svg');
  });

  it('scopes every new stage rule to body.analyze-listening', () => {
    expect(appCss).not.toContain('\n    #reportcard-view { display:none !important');
    expect(appCss).not.toContain('\n    #source-panel { display:none !important');
  });

  it("leaves Session's docked #live-eq-pane untouched", () => {
    expect(appCss).not.toContain('body.analyze-listening #live-eq-pane');
    expect(panelSrc).not.toContain('live-eq-pane');
  });

  // #1487: the results rail folds onto the #1496 stage as a second column —
  // the room EQ stays flex:1 inside .analyze-stage, the rail is a fixed
  // width so it never competes with the EQ for the dominant column.
  it('lays the results rail out as a fixed-width second column beside the (still flex:1) room EQ', () => {
    expect(appCss).toContain('.analyze-stage { display:flex; flex-direction:row; gap:16px; flex:1; min-height:0; }');
    expect(appCss).toContain('.analyze-results-rail { width:320px; flex-shrink:0;');
    expect(appCss).not.toContain('.analyze-results-rail { flex:1');
  });
});

// #1606: static source guards pinning ADR-0141 — Session's docked LiveEqPane
// (#live-eq-pane, shown only while appMode === 'live') and Analyze's live-EQ
// island (#analyze-live-island, shown only when analyzeLiveEqView(...) is not
// hidden) must never share or move a DOM node. A future change that portals
// one surface into the other's node, moves a node between them, or has one
// surface reach into the other's markup would break the mutual-exclusion
// invariant these guards protect without any of the other tests in this file
// noticing.
describe('#1606 ADR-0141: Session pane and Analyze island never share or move a node', () => {
  it('App.tsx portals each surface into its own node only, exactly once', () => {
    expect(appSrc).toContain("createPortal(<LiveEqPane />, document.getElementById('live-eq-pane-body')!)");
    expect(appSrc).toContain("createPortal(<AnalyzeLiveEqPanel />, document.getElementById('analyze-live-island')!)");
    expect((appSrc.match(/<LiveEqPane \/>/g) ?? []).length).toBe(1);
    expect((appSrc.match(/<AnalyzeLiveEqPanel \/>/g) ?? []).length).toBe(1);
  });

  const DOM_MOVING_CALL = /\.(appendChild|insertBefore|replaceChildren|replaceWith|append|prepend)\(/;

  it.each([
    ['mode-switch.ts', modeSwitchSrc],
    ['stores/analyzeEntryStore.ts', analyzeEntryStoreSrc],
    ['LiveEqPane.tsx', liveEqPaneSrc],
    ['AnalyzeLiveEqPanel.tsx', panelSrc],
  ])('%s never moves a DOM node', (_name, src) => {
    expect(src).not.toMatch(DOM_MOVING_CALL);
  });

  it('mode-switch.ts never looks up either surface node directly', () => {
    expect(modeSwitchSrc).not.toContain("getElementById('live-eq-pane");
    expect(modeSwitchSrc).not.toContain("getElementById('analyze-live-island')");
  });

  it('analyzeEntryStore.ts never looks up either surface node directly', () => {
    expect(analyzeEntryStoreSrc).not.toContain("getElementById('live-eq-pane");
    expect(analyzeEntryStoreSrc).not.toContain("getElementById('analyze-live-island')");
  });

  it('LiveEqPane.tsx never references the Analyze island', () => {
    expect(liveEqPaneSrc).not.toContain('analyze-live-island');
    expect(liveEqPaneSrc).not.toContain('AnalyzeLiveEqPanel');
  });

  it('AnalyzeLiveEqPanel.tsx does not import LiveEqPane', () => {
    expect(panelSrc).not.toMatch(/from '\.\/LiveEqPane'/);
  });
});
