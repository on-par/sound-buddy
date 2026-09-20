// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const appCss = fs.readFileSync(fileURLToPath(new URL('./styles/app.css', import.meta.url)), 'utf8');
const panelSrc = fs.readFileSync(fileURLToPath(new URL('./AnalyzeLiveEqPanel.tsx', import.meta.url)), 'utf8');

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
});
