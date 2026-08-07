// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// renderToString assertions per LiveControls.test.ts's pattern — no jsdom in
// this harness, so the mounted useEffect controller wiring (real rAF +
// #sc-elapsed/#spectrum-imperative DOM writes) is untestable here and is
// /* c8 ignore */-covered by tests/e2e/virtual-soundcheck.spec.ts instead;
// createSoundcheckTransportController's own coalescing logic is unit-tested
// against fake deps in soundcheck-transport-controller.test.ts.

import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import SoundcheckPanel from './SoundcheckPanel';
import { useSoundcheckStore } from './stores/soundcheckStore';
import type { SessionManifest } from './soundcheck-panel';

afterEach(() => {
  useSoundcheckStore.setState({
    manifest: null, sessionDir: null, routes: [], devices: [], devicesLoaded: false,
    selectedDevice: '', deviceChannels: 0, master: false, playing: false,
    elapsedText: null, mixdownNotice: null, statusMessage: null,
    lastElapsedTick: null, lastMeterTick: null,
  });
});

function renderMarkup(): string {
  return renderToString(createElement(SoundcheckPanel));
}

describe('SoundcheckPanel', () => {
  it('always renders the choose-session button', () => {
    expect(renderMarkup()).toContain('id="sc-choose-btn"');
  });

  it('hides the session name until a session is chosen', () => {
    expect(renderMarkup()).not.toContain('id="sc-session-name"');
  });

  it('shows the session folder basename once chosen', () => {
    useSoundcheckStore.setState({ sessionDir: '/Users/pat/Sessions/Sunday AM' });
    expect(renderMarkup()).toContain('Sunday AM');
  });

  it('renders the default-output option plus real devices', () => {
    useSoundcheckStore.setState({ devices: [{ index: 0, name: 'Focusrite', channels: 4 }] });
    const html = renderMarkup();
    expect(html).toContain('Default output');
    expect(html).toContain('Focusrite (4ch)');
  });

  it('shows the empty-state message with no session loaded', () => {
    expect(renderMarkup()).toContain('Choose a session folder to load its tracks.');
  });

  it('renders one row per track with mono/stereo badges and route options', () => {
    const manifest: SessionManifest = { tracks: [{ kind: 'mono', label: 'Vocal' }, { kind: 'stereo' }] };
    useSoundcheckStore.setState({ manifest, routes: [[0], [1, 2]], deviceChannels: 4 });
    const html = renderMarkup();
    expect(html).toContain('Vocal');
    expect(html).toContain('Stereo');
    expect(html).toContain('Mono');
    expect(html).not.toContain('Choose a session folder to load its tracks.');
  });

  it('disables track route selects while playing', () => {
    const manifest: SessionManifest = { tracks: [{ kind: 'mono' }] };
    useSoundcheckStore.setState({ manifest, routes: [[0]], playing: true });
    expect(renderMarkup()).toContain('data-kind="mono" disabled=""');
  });

  it('enables track route selects when not playing', () => {
    const manifest: SessionManifest = { tracks: [{ kind: 'mono' }] };
    useSoundcheckStore.setState({ manifest, routes: [[0]], playing: false });
    expect(renderMarkup()).toContain('<select class="sc-route" data-idx="0" data-kind="mono">');
  });

  it('shows the mixdown notice only when non-null', () => {
    expect(renderMarkup()).not.toContain('id="sc-mixdown-notice"');
    useSoundcheckStore.setState({ mixdownNotice: 'Playing a stereo master mixdown.' });
    expect(renderMarkup()).toContain('Playing a stereo master mixdown.');
  });

  it('disables Play until a manifest is loaded and devices are ready', () => {
    expect(renderMarkup()).toContain('id="sc-play-btn" disabled=""');
  });

  it('enables Play once a manifest is loaded, devices are ready, and nothing is playing', () => {
    const manifest: SessionManifest = { tracks: [{ kind: 'mono' }] };
    useSoundcheckStore.setState({ manifest, devicesLoaded: true });
    expect(renderMarkup()).not.toContain('id="sc-play-btn" disabled=""');
  });

  it('toggles Play/Stop visibility with the playing flag', () => {
    let html = renderMarkup();
    expect(html).toContain('id="sc-play-btn" disabled="" style="display:inline-flex"');
    expect(html).toContain('id="sc-stop-btn" style="display:none"');

    useSoundcheckStore.setState({ playing: true });
    html = renderMarkup();
    expect(html).toContain('id="sc-play-btn" disabled="" style="display:none"');
    expect(html).toContain('id="sc-stop-btn" style="display:inline-flex"');
  });

  it('shows the elapsed readout only when non-null', () => {
    expect(renderMarkup()).not.toContain('id="sc-elapsed"');
    useSoundcheckStore.setState({ elapsedText: '0:12 / 1:00' });
    expect(renderMarkup()).toContain('0:12 / 1:00');
  });

  it('shows the status line only when non-null', () => {
    expect(renderMarkup()).not.toContain('id="sc-status"');
    useSoundcheckStore.setState({ statusMessage: 'Could not start playback.' });
    const html = renderMarkup();
    expect(html).toContain('role="alert"');
    expect(html).toContain('Could not start playback.');
  });
});
