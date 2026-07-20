// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Report-first-ux epic gate (#538): a body-class branch point all subsequent
// e17 slices mount against, mirroring the #516 dawWorkspaceEnabled pattern
// file-for-file. inline-app.js is coverage-excluded glue (see
// vitest.config.ts), so its wiring is verified here the same way
// live-adjustments-gate.test.ts (#522) encodes its acceptance criteria.

const inlineApp = fs.readFileSync(fileURLToPath(new URL('./inline-app.js', import.meta.url)), 'utf8');
const appTsx = fs.readFileSync(fileURLToPath(new URL('./App.tsx', import.meta.url)), 'utf8');
const rootMarkup = fs.readFileSync(fileURLToPath(new URL('./root-markup.html', import.meta.url)), 'utf8');
const reportFirstUxState = fs.readFileSync(
  fileURLToPath(new URL('../report-first-ux-state.js', import.meta.url)),
  'utf8'
);

describe('Report-first-ux gate wiring (#538)', () => {
  it('App.tsx imports and boots report-first-ux-state.js before the inline app script', () => {
    expect(appTsx).toContain("import reportFirstUxStateSrc from '../report-first-ux-state.js?raw';");
    const reportFirstUxIdx = appTsx.indexOf('reportFirstUxStateSrc,');
    const inlineIdx = appTsx.indexOf('inlineAppSrc,');
    expect(reportFirstUxIdx).toBeGreaterThan(-1);
    expect(inlineIdx).toBeGreaterThan(-1);
    expect(reportFirstUxIdx).toBeLessThan(inlineIdx);
  });

  it('inline-app.js drives the report-first-ux body class from the predicate, never hardwired', () => {
    expect(inlineApp).toContain(
      "setStore.subscribe((s) => document.body.classList.toggle('report-first-ux', window.reportFirstUxState.isEnabled("
    );
  });

  it('root-markup.html has no report-first-ux occurrences (flag off leaves markup untouched)', () => {
    expect(rootMarkup).not.toContain('report-first-ux');
  });

  it('report-first-ux-state.js carries the proprietary header', () => {
    expect(reportFirstUxState).toContain('Copyright (c) 2026 Patrick Robinson (on-par)');
  });
});

// e17-06 (#545): the classic-side open action for the Report Card's "Review
// in Build Guide" forward link — the inverse of #build-guide-review. Same
// gate-by-text-assertion approach since inline-app.js is coverage-excluded.
describe('Build Guide forward-link wiring (#545)', () => {
  it('defines openBuildGuide and clicks the guide mode tab', () => {
    expect(inlineApp).toContain('function openBuildGuide');
    expect(inlineApp).toContain('.mode-tab[data-mode="guide"]');
  });

  it('exposes openBuildGuide on window.inlineDialogs', () => {
    expect(inlineApp).toMatch(/window\.inlineDialogs\s*=\s*\{[^}]*openBuildGuide[^}]*\}/);
  });
});
