// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Contextual "Review in Build Guide" link gate (#545, epic e17): the surface
// is ReportCardIsland.tsx-owned now (TD-001 slice 6k, #714) — openBuildGuide
// was ported from inline-app.js's coverage-excluded glue into an inline
// onOpenBuildGuide handler calling mode-switch.ts#switchMode directly,
// replacing the simulated .mode-tab click and the window.inlineDialogs
// bridge.

const inlineApp = fs.readFileSync(fileURLToPath(new URL('./inline-app.js', import.meta.url)), 'utf8');
const reportCardIslandTsx = fs.readFileSync(fileURLToPath(new URL('./ReportCardIsland.tsx', import.meta.url)), 'utf8');

describe('Build Guide link gate (#545)', () => {
  it('ReportCardIsland.tsx navigates to the Build Guide via switchMode', () => {
    expect(reportCardIslandTsx).toContain("onOpenBuildGuide={() => switchMode('guide')}");
  });

  it('inline-app.js no longer defines openBuildGuide or the window.inlineDialogs bridge', () => {
    expect(inlineApp).not.toContain('function openBuildGuide()');
    expect(inlineApp).not.toContain('window.inlineDialogs');
  });
});
