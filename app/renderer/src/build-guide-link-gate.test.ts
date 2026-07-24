// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Contextual "Review in Build Guide" link gate (#545, epic e17): inline-app.js
// is coverage-excluded glue (see vitest.config.ts), so its wiring is verified
// here the same way single-column-gate.test.ts / report-first-ux-gate.test.ts
// encode their acceptance criteria.

const inlineApp = fs.readFileSync(fileURLToPath(new URL('./inline-app.js', import.meta.url)), 'utf8');

describe('Build Guide link gate (#545)', () => {
  it('inline-app.js defines openBuildGuide, navigating via the guide mode-tab', () => {
    const fnStart = inlineApp.indexOf('function openBuildGuide()');
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = inlineApp.slice(fnStart, fnStart + 200);
    expect(fnBody).toContain('.mode-tab[data-mode="guide"]');
  });

  it('window.inlineDialogs exposes openBuildGuide to the React bridge', () => {
    const bridgeLine = inlineApp
      .split('\n')
      .find((line) => line.includes('window.inlineDialogs = {'));
    expect(bridgeLine).toBeDefined();
    expect(bridgeLine).toContain('openBuildGuide');
  });
});
