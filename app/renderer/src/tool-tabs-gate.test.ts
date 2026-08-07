// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import ModeTabs from './ModeTabs';

// Unified source entry point (#546, epic e17): with report-first-ux on, the
// Build Guide / Ring Out buttons in #mode-tabs are hidden — they're
// redundant now that e17-06 (#545) ships contextual links to both tools
// from the Report Card. The buttons stay in the DOM (the contextual links
// route by simulated .click(), and the flag-off shell must be unchanged),
// so this is a CSS visibility gate, not a markup deletion, mirroring
// source-tabs-gate.test.ts (#544) file-for-file. inline-app.js is
// coverage-excluded glue (see vitest.config.ts), so its wiring is verified
// here the same way the sibling gate test encodes its acceptance criteria.
// The tab buttons themselves moved from static root-markup.html into
// ModeTabs.tsx (TD-001 slice 6e, #703) — render it the same way
// ModeTabs.test.ts does rather than scanning root-markup.html for them.

const inlineApp = fs.readFileSync(fileURLToPath(new URL('./inline-app.js', import.meta.url)), 'utf8');
const appCss = fs.readFileSync(fileURLToPath(new URL('./styles/app.css', import.meta.url)), 'utf8');
const modeTabsMarkup = renderToString(createElement(ModeTabs));

describe('Tool tabs gate (#546)', () => {
  it('app.css hides the Build Guide and Ring Out tabs under report-first-ux', () => {
    expect(appCss).toContain('body.report-first-ux .mode-tab[data-mode="guide"]');
    expect(appCss).toContain('body.report-first-ux .mode-tab[data-mode="ringout"]');
    const ruleStart = appCss.indexOf('body.report-first-ux .mode-tab[data-mode="guide"]');
    const ruleEnd = appCss.indexOf('}', ruleStart);
    expect(appCss.slice(ruleStart, ruleEnd + 1)).toMatch(/display:\s*none;\s*\}$/);
  });

  it('ModeTabs.tsx keeps both tab buttons for the flag-off shell', () => {
    expect(modeTabsMarkup).toContain('data-mode="guide"');
    expect(modeTabsMarkup).toContain('data-mode="ringout"');
  });

  it('every display:none on a mode-tab selector is scoped to body.report-first-ux', () => {
    const lines = appCss.split('\n');
    for (const line of lines) {
      if (/\.mode-tab\[data-mode=/.test(line) && /display:\s*none/.test(line)) {
        expect(line).toContain('body.report-first-ux');
      }
    }
  });

  it('the hide rule comes after the base .mode-tab rules so it wins the cascade', () => {
    const hideIdx = appCss.indexOf('body.report-first-ux .mode-tab[data-mode="guide"]');
    const baseIdx = appCss.indexOf('.mode-tab .tab-soon');
    expect(hideIdx).toBeGreaterThan(-1);
    expect(baseIdx).toBeGreaterThan(-1);
    expect(hideIdx).toBeGreaterThan(baseIdx);
  });

  it('both tools stay reachable via the e17-06 contextual links', () => {
    expect(modeTabsMarkup).toContain('data-mode="guide"');
    expect(modeTabsMarkup).toContain('data-mode="ringout"');

    const buildGuideIdx = inlineApp.indexOf('function openBuildGuide()');
    expect(buildGuideIdx).toBeGreaterThan(-1);
    const buildGuideBody = inlineApp.slice(buildGuideIdx, inlineApp.indexOf('\n}', buildGuideIdx));
    expect(buildGuideBody).toContain('.mode-tab[data-mode="guide"]');

    const ringoutIdx = inlineApp.indexOf('function openFeedbackRingout()');
    expect(ringoutIdx).toBeGreaterThan(-1);
    expect(inlineApp.slice(ringoutIdx, ringoutIdx + 400)).toContain('.mode-tab[data-mode="ringout"]');

    const dialogsLine = inlineApp.slice(inlineApp.indexOf('window.inlineDialogs = {'));
    const dialogsLineEnd = dialogsLine.indexOf('\n');
    const dialogsDecl = dialogsLine.slice(0, dialogsLineEnd);
    expect(dialogsDecl).toContain('openBuildGuide');
    expect(dialogsDecl).toContain('openFeedbackRingout');
  });
});
