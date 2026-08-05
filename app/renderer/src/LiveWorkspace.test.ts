// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import LiveWorkspace from './LiveWorkspace';

// LiveWorkspace always renders null — it hands #live-island back to the
// bridged imperative renderer (window.liveWorkspaceRuntime, inline-app.js),
// the same handoff SpectrumPanel uses for panelState 'meters' (see the
// header comment). Its actual behavior — WHEN the bridged renderer re-runs —
// lives in effects that don't run under renderToString (no jsdom in this
// harness); that reactivity is exercised by tests/e2e/live-capture.spec.ts.
// This test just pins the render-null contract so a future edit can't
// accidentally make it try to own #live-island's markup directly (see the
// file header for why that doesn't fit the DOM-query-based patch-vs-rebuild
// logic renderLiveMeters()/renderLiveWorkspace() use).
describe('LiveWorkspace', () => {
  it('always renders null, handing #live-island to the bridged imperative renderer', () => {
    expect(renderToString(createElement(LiveWorkspace))).toBe('');
  });
});
