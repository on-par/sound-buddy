// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Guided first-use setup for the Live tab (#294): the zero-state teaches the
// sequence choose a device -> add a track -> start monitoring or recording,
// and advanced power-user controls stay hidden until at least one track
// exists. The hero/banner/toolbar markup and the setup-step builders moved
// out of inline-app.js into the React LiveCapturePanel island + the pure
// live-workspace-view module (TD-001 slice 6g, #710) — the markup acceptance
// criteria are enforced by LiveCapturePanel.test.ts (renderToString) and
// live-workspace-view.test.ts. This gate pins the remaining wiring that is
// only enforceable as source text: the dismiss handler still removes the
// rendered banner directly, setup completion still fires from both the
// dismiss and the first successful capture start, and no inline-app.js
// listener owns the banner anymore.

const liveCapturePanelTsx = fs.readFileSync(fileURLToPath(new URL('./LiveCapturePanel.tsx', import.meta.url)), 'utf8');
const liveWorkspaceViewTs = fs.readFileSync(fileURLToPath(new URL('./live-workspace-view.ts', import.meta.url)), 'utf8');
const inlineApp = fs.readFileSync(fileURLToPath(new URL('./inline-app.js', import.meta.url)), 'utf8');
// TD-001 slice 6i (#712): the capture-start success path (onCaptureStarted →
// markSetupComplete + banner removal) moved here from inline-app.js.
const lifecycleTs = fs.readFileSync(fileURLToPath(new URL('./capture-lifecycle.ts', import.meta.url)), 'utf8');

describe('Live tab guided first-use setup (#294)', () => {
  it('the Live panel always composes the arrangement shell, including with an empty workspace', () => {
    expect(liveCapturePanelTsx).toContain('dawShellHTML(state');
    expect(liveCapturePanelTsx).not.toContain('live-setup-hero');
    expect(inlineApp).not.toContain('live-setup-hero');
  });

  it('keeps advanced controls (new group / collapse / expand / arm-all) behind showAdvancedControls', () => {
    // live-workspace-view.test.ts asserts the toolbar drops the cluster at
    // zero tracks; this pins the builder call site.
    expect(liveWorkspaceViewTs).toContain('liveWorkspaceToolbarHTML');
  });

  it('marks setup complete on the first successful capture start', () => {
    expect(lifecycleTs).toContain('markSetupComplete');
  });

  it('does not compose the retired first-use banner in the unconditional arrangement panel', () => {
    expect(liveCapturePanelTsx).not.toContain('id="live-setup-skip"');
  });

  it('does not retain the obsolete banner dismiss listener', () => {
    expect(liveCapturePanelTsx).not.toContain("closest('#live-setup-skip')");
  });

  it('the capture-start success path also removes the rendered banner directly', () => {
    // onCaptureStarted (capture-lifecycle.ts, TD-001 slice 6i) removes the
    // banner node when a capture actually starts, because the board render
    // path early-outs while liveRunning.
    const onStarted = lifecycleTs.slice(lifecycleTs.indexOf('markSetupComplete'));
    expect(onStarted).toContain('.live-setup-banner');
    expect(onStarted).toContain('.remove()');
  });

  it('no inline-app.js listener owns the banner surface anymore (6g acceptance)', () => {
    expect(inlineApp).not.toContain("closest('#live-setup-skip')");
  });
});
