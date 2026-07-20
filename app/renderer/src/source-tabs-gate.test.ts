// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Unified source entry point (#544, epic e17): with report-first-ux on, the
// Directory / Live / Soundcheck buttons in #mode-tabs are hidden — the #543
// picker is the single entry point for "where's the audio from?". The
// buttons stay in the DOM (the picker routes by simulated .click(), and the
// flag-off shell must be unchanged), so this is a CSS visibility gate, not a
// markup deletion, mirroring single-column-gate.test.ts file-for-file.
// inline-app.js is coverage-excluded glue (see vitest.config.ts), so its
// wiring is verified here the same way the other gate tests encode their
// acceptance criteria.

const inlineApp = fs.readFileSync(fileURLToPath(new URL('./inline-app.js', import.meta.url)), 'utf8');
const rootMarkup = fs.readFileSync(fileURLToPath(new URL('./root-markup.html', import.meta.url)), 'utf8');
const appCss = fs.readFileSync(fileURLToPath(new URL('./styles/app.css', import.meta.url)), 'utf8');
const analyzeSourceState = fs.readFileSync(fileURLToPath(new URL('../analyze-source-state.js', import.meta.url)), 'utf8');
const indexHtml = fs.readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
const upgradeMomentum = fs.readFileSync(fileURLToPath(new URL('../upgrade-momentum.js', import.meta.url)), 'utf8');

// Strips HTML `<!-- ... -->` and JS `//` line comments so copy assertions
// only see real, user-visible strings.
// Not a security sanitizer: this never renders to a browser or feeds an
// HTML sink — it only trims comment markers out of trusted local repo
// source files before a test string-equality assertion. An incomplete
// strip on adversarial nested-comment input would at worst leave stray
// `<!--`/`-->` text in the value diffed against, not an injection.
function stripComments(source: string): string {
  return source
    // codeql[js/incomplete-multi-character-sanitization]
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('Source tabs gate (#544)', () => {
  it('app.css hides the old source tabs under report-first-ux', () => {
    expect(appCss).toContain('body.report-first-ux .mode-tab[data-mode="dir"]');
    expect(appCss).toContain('body.report-first-ux .mode-tab[data-mode="live"]');
    expect(appCss).toContain('body.report-first-ux .mode-tab[data-mode="soundcheck"]');
    const ruleStart = appCss.indexOf('body.report-first-ux .mode-tab[data-mode="dir"]');
    const ruleEnd = appCss.indexOf('}', ruleStart);
    expect(appCss.slice(ruleStart, ruleEnd + 1)).toMatch(/display:\s*none;\s*\}$/);
  });

  it('root-markup.html keeps all three tab buttons for the flag-off shell', () => {
    expect(rootMarkup).toContain('data-mode="dir"');
    expect(rootMarkup).toContain('data-mode="live"');
    expect(rootMarkup).toContain('data-mode="soundcheck"');
  });

  it('every display:none on a source-tab selector is scoped to body.report-first-ux', () => {
    const lines = appCss.split('\n');
    for (const line of lines) {
      if (/\.mode-tab\[data-mode=/.test(line) && /display:\s*none/.test(line)) {
        expect(line).toContain('body.report-first-ux');
      }
    }
  });

  it('the hide rule comes after the base .mode-tab rules so it wins the cascade', () => {
    const hideIdx = appCss.indexOf('body.report-first-ux .mode-tab[data-mode="dir"]');
    const baseIdx = appCss.indexOf('.mode-tab .tab-soon');
    expect(hideIdx).toBeGreaterThan(-1);
    expect(baseIdx).toBeGreaterThan(-1);
    expect(hideIdx).toBeGreaterThan(baseIdx);
  });

  it('the three flows stay reachable: routing tabs are in the DOM and the picker still simulates a click', () => {
    expect(rootMarkup).toContain('<button class="mode-tab" data-mode="dir"');
    expect(rootMarkup).toContain('<button class="mode-tab" data-mode="live"');
    expect(rootMarkup).toContain('<button class="mode-tab" data-mode="soundcheck"');
    expect(inlineApp).toContain('document.querySelector(`.mode-tab[data-mode="${mode}"]`).click();');
    expect(inlineApp).toContain('window.analyzeSourceState.targetModeFor(');
  });

  it('analyze-source-state.js still routes live and soundcheck through targetModeFor', () => {
    expect(analyzeSourceState).toContain("case 'live': return 'live';");
    expect(analyzeSourceState).toContain("case 'soundcheck': return 'soundcheck';");
  });

  it('no UI copy names a removed tab by name', () => {
    const strippedIndexHtml = stripComments(indexHtml);
    const strippedRootMarkup = stripComments(rootMarkup);
    const strippedUpgradeMomentum = stripComments(upgradeMomentum);
    for (const banned of ['Live tab', 'Directory tab', 'Soundcheck tab']) {
      expect(strippedIndexHtml).not.toContain(banned);
      expect(strippedRootMarkup).not.toContain(banned);
      expect(strippedUpgradeMomentum).not.toContain(banned);
    }
  });
});
