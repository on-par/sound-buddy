// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import ModeTabs from './ModeTabs';
import { resolveModeSwitch } from './mode-switch';

// Final nav consolidation (#547, epic e17): the closing slice of e17 — with
// report-first-ux on, #mode-tabs collapses to exactly two destinations,
// Analyze (the #543 unified source picker) and History (the #542 full-width
// Recent list). #544 already hid Directory/Live/Soundcheck and #546 hid
// Build Guide/Ring Out; this slice hides the two remaining legacy tabs
// (Recent, Report Card) and adds the two new flag-only entries that replace
// them. inline-app.js is coverage-excluded glue (see vitest.config.ts), so
// its wiring is verified here the same way the sibling gate tests encode
// their acceptance criteria. The tab buttons + the analyze/history special
// casing moved from static root-markup.html / inline-app.js's click listener
// into ModeTabs.tsx / mode-switch.ts#resolveModeSwitch (TD-001 slice 6e,
// #703) — render/import those instead of scanning the old sources for them.

const appCss = fs.readFileSync(fileURLToPath(new URL('./styles/app.css', import.meta.url)), 'utf8');
const modeTabsMarkup = renderToString(createElement(ModeTabs));

describe('Final nav consolidation gate (#547)', () => {
  it('ModeTabs.tsx renders the two flag-only entries', () => {
    expect(modeTabsMarkup).toContain('id="nav-analyze" data-mode="analyze"');
    expect(modeTabsMarkup).toMatch(/id="nav-analyze"[\s\S]*?Analyze<\/button>/);
    expect(modeTabsMarkup).toContain('id="nav-history" data-mode="history"');
    expect(modeTabsMarkup).toMatch(/id="nav-history"[\s\S]*?History<\/button>/);
  });

  it('app.css hides the new entries by default and shows them only flag-on', () => {
    expect(appCss).toContain('#nav-analyze, #nav-history { display:none; }');
    expect(appCss).toContain('body.report-first-ux #nav-analyze, body.report-first-ux #nav-history { display:inline-flex; }');
    const hideIdx = appCss.indexOf('#nav-analyze, #nav-history { display:none; }');
    const showIdx = appCss.indexOf('body.report-first-ux #nav-analyze, body.report-first-ux #nav-history { display:inline-flex; }');
    expect(showIdx).toBeGreaterThan(hideIdx);
  });

  it('app.css hides Recent and Report Card flag-on', () => {
    expect(appCss).toContain('body.report-first-ux .mode-tab[data-mode="recent"]');
    expect(appCss).toContain('body.report-first-ux .mode-tab[data-mode="reportcard"]');
    const ruleStart = appCss.indexOf('body.report-first-ux .mode-tab[data-mode="recent"]');
    const ruleEnd = appCss.indexOf('}', ruleStart);
    expect(appCss.slice(ruleStart, ruleEnd + 1)).toMatch(/display:\s*none;\s*\}$/);
  });

  it('exactly two entries survive flag-on: every legacy tab is hidden', () => {
    const legacyModes = ['dir', 'live', 'soundcheck', 'recent', 'guide', 'ringout', 'reportcard'];
    for (const mode of legacyModes) {
      expect(appCss).toContain(`body.report-first-ux .mode-tab[data-mode="${mode}"]`);
    }
  });

  it('flag-off shell is unchanged: all seven legacy buttons remain, reportcard still default-active', () => {
    const legacyModes = ['dir', 'live', 'soundcheck', 'recent', 'guide', 'ringout', 'reportcard'];
    for (const mode of legacyModes) {
      expect(modeTabsMarkup).toContain(`data-mode="${mode}"`);
    }
    expect(modeTabsMarkup).toContain('class="mode-tab active" data-mode="reportcard"');
  });

  it('every display:none on a mode-tab data-mode selector stays scoped to body.report-first-ux', () => {
    const lines = appCss.split('\n');
    for (const line of lines) {
      if (/\.mode-tab\[data-mode=/.test(line) && /display:\s*none/.test(line)) {
        expect(line).toContain('body.report-first-ux');
      }
    }
  });

  it('Analyze reaches the #543 source picker', () => {
    expect(resolveModeSwitch('analyze', 'reportcard')).toEqual({ type: 'openPicker' });
  });

  it('History reaches the Recent list', () => {
    expect(resolveModeSwitch('history', 'reportcard')).toEqual({ type: 'redirect', mode: 'recent' });
  });

  it('special cases for analyze/history precede the generic mode switch', () => {
    // Both are resolved unconditionally before the same-mode/switch checks —
    // requesting them while already "on" that mode (impossible for analyze/
    // history, which are never liveCaptureStore.appMode itself, but exercised
    // here as the strongest form of "precedes") never falls through to noop.
    expect(resolveModeSwitch('analyze', 'analyze')).toEqual({ type: 'openPicker' });
    expect(resolveModeSwitch('history', 'history')).toEqual({ type: 'redirect', mode: 'recent' });
  });
});
