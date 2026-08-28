// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const appCss = fs.readFileSync(fileURLToPath(new URL('./styles/app.css', import.meta.url)), 'utf8');
const rootMarkup = fs.readFileSync(fileURLToPath(new URL('./root-markup.html', import.meta.url)), 'utf8');

// Free-tier chrome — deliberately NOT behind the Pro gate. Adding an id
// here is a conscious product decision (see the #1245 ADR); a new Pro
// surface belongs in app.css's body.not-pro block instead.
const FREE_TIER_ISLANDS = new Set([
  'ideal-profile-island', 'license-badge-island', 'license-banner-island',
  'measurement-badge-island', 'onboarding-island', 'rc-upgrade-island',
  'spectrum-island', 'trial-banner-island', 'update-surface-island',
  'whats-new-banner-island', 'window-badge-island',
]);

describe('Pro gate covers the Session surfaces outside #tab-live (#1245)', () => {
  it('hides #live-island and #live-eq-pane for a free-tier body', () => {
    expect(appCss).toContain('body.not-pro #live-island,');
    expect(appCss).toContain('body.not-pro #live-eq-pane { display:none !important; }');
  });

  it('scopes the live-active force-show so it can never override the gate', () => {
    expect(appCss).toContain('body.live-active:not(.not-pro) #live-island { display:flex !important; }');
    expect(appCss).not.toContain('body.live-active #live-island { display:flex !important; }');
  });

  it('keeps the .pro-gate card visible while the workspace is hidden', () => {
    expect(appCss).toContain('body.not-pro #tab-live .pro-gate');
    const lines = appCss.split('\n');
    for (const line of lines) {
      if (/display:\s*none/.test(line)) {
        expect(line).not.toContain('#tab-live .pro-gate');
      }
    }

    const tabLiveStart = rootMarkup.indexOf('<div class="tab-content" id="tab-live">');
    const tabLiveEnd = rootMarkup.indexOf('<div id="spectrum-header">', tabLiveStart);
    expect(tabLiveStart).toBeGreaterThan(-1);
    expect(tabLiveEnd).toBeGreaterThan(tabLiveStart);
    const tabLiveMarkup = rootMarkup.slice(tabLiveStart, tabLiveEnd);
    expect(tabLiveMarkup.match(/<div class="pro-gate">/g)).toHaveLength(1);
  });
});

describe('Gate drift guards (#1245)', () => {
  it('every island mount point outside #tab-live is Pro-gated or explicitly free-tier', () => {
    const tabLiveStart = rootMarkup.indexOf('<div class="tab-content" id="tab-live">');
    const tabLiveEnd = rootMarkup.indexOf('<div id="spectrum-header">', tabLiveStart);
    expect(tabLiveStart).toBeGreaterThan(-1);
    expect(tabLiveEnd).toBeGreaterThan(tabLiveStart);
    const tabLiveMarkup = rootMarkup.slice(tabLiveStart, tabLiveEnd);

    const matches = rootMarkup.match(/id="([a-z0-9-]+-island)"/g) ?? [];
    const allIds = new Set(matches.map((m) => m.slice(4, -1)));
    const idsOutsideTabLive = [...allIds].filter((id) => !tabLiveMarkup.includes(`id="${id}"`));

    expect(idsOutsideTabLive.length).toBeGreaterThan(0);
    for (const id of idsOutsideTabLive) {
      const gated = appCss.includes(`body.not-pro #${id}`);
      expect(FREE_TIER_ISLANDS.has(id) || gated, `#${id} is neither Pro-gated nor on the free-tier allowlist`).toBe(true);
    }
  });

  it('every body.live-active rule that SHOWS an element has a matching not-pro hide rule', () => {
    const lines = appCss.split('\n');
    let checked = 0;
    for (const line of lines) {
      const match = /body\.live-active[^,{]*#([a-z0-9-]+)/.exec(line);
      if (!match) continue;
      if (!/display:/.test(line) || /display:\s*none/.test(line)) continue;
      checked += 1;
      const id = match[1];
      expect(appCss.includes(`body.not-pro #${id}`), `body.live-active shows #${id} but no body.not-pro #${id} hide rule exists`).toBe(true);
    }
    expect(checked).toBeGreaterThan(0);
  });
});
