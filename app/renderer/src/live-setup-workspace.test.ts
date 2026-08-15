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
const inlineApp = fs.readFileSync(fileURLToPath(new URL('./inline-app.js', import.meta.url)), 'utf8');
// TD-001 slice 6i (#712): the capture-start success path (onCaptureStarted →
// markSetupComplete + banner removal) moved here from inline-app.js.
const lifecycleTs = fs.readFileSync(fileURLToPath(new URL('./capture-lifecycle.ts', import.meta.url)), 'utf8');

describe('Live tab guided first-use setup (#294)', () => {
  it('the board island renders an instructional hero when the workspace is empty', () => {
    // LiveCapturePanel.test.ts asserts the rendered hero; this pins the homes
    // so the wiring can't silently move back into inline-app.js.
    expect(liveCapturePanelTsx).toContain('live-setup-hero');
    expect(liveCapturePanelTsx).toContain('Set up your live check');
    expect(inlineApp).not.toContain('live-setup-hero');
  });

  it('gates advanced controls (new group / collapse / expand / arm-all) behind showAdvancedControls', () => {
    // live-workspace-view.test.ts asserts the toolbar drops the cluster at
    // zero tracks; this pins the call site.
    expect(liveCapturePanelTsx).toContain('liveWorkspaceToolbarHTML');
  });

  it('marks setup complete both on dismiss and on first successful capture start', () => {
    const occurrences =
      (liveCapturePanelTsx.split('markSetupComplete').length - 1)
      + (lifecycleTs.split('markSetupComplete').length - 1);
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it('offers a dismiss control on the first-use banner', () => {
    expect(liveCapturePanelTsx).toContain('id="live-setup-skip"');
  });

  it('dismiss handler removes the rendered banner directly, not only via a re-render', () => {
    // renderChannelConfig() early-outs while a capture is running (liveRunning),
    // so a Dismiss click during Start Capture would leave the banner stuck on
    // screen until the running board's next tick unless the handler also
    // removes the DOM node itself — the same fix the capture-start success
    // path below needs for the same reason.
    const skipHandler = liveCapturePanelTsx.slice(liveCapturePanelTsx.indexOf("closest('#live-setup-skip')"));
    expect(skipHandler).toContain('.live-setup-banner');
    expect(skipHandler).toContain('.remove()');
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
