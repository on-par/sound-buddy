// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Guided first-use setup for the Live tab (#294): the zero-state teaches the
// sequence choose a device -> add a track -> start monitoring or recording,
// and advanced power-user controls stay hidden until at least one track
// exists. inline-app.js is coverage-excluded glue verified by e2e (#303), so
// these assertions encode the acceptance criteria the same way
// root-markup.test.ts (#293) does for the Directory tab.

const inlineApp = fs.readFileSync(fileURLToPath(new URL('./inline-app.js', import.meta.url)), 'utf8');

describe('Live tab guided first-use setup (#294)', () => {
  it('replaces the bare technical-canvas empty state', () => {
    expect(inlineApp).not.toContain('Add your first track to get started');
  });

  it('renders an instructional hero when the workspace is empty', () => {
    expect(inlineApp).toContain('live-setup-hero');
    expect(inlineApp).toContain('Set up your live check');
  });

  it('gates advanced controls (new group / collapse / expand / arm-all) behind showAdvancedControls', () => {
    expect(inlineApp).toMatch(/showAdvancedControls\(/);
  });

  it('marks setup complete both on dismiss and on first successful capture start', () => {
    const occurrences = inlineApp.split('markSetupComplete').length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it('offers a dismiss control on the first-use banner', () => {
    expect(inlineApp).toContain('id="live-setup-skip"');
  });
});
