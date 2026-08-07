// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import RingoutPanel from './RingoutPanel';
import { useRingoutStore } from './stores/ringoutStore';

const feedbackRingout = require('../feedback-ringout-state.js');

function renderMarkup(): string {
  return renderToString(createElement(RingoutPanel));
}

beforeEach(() => {
  (globalThis as { window?: unknown }).window = { feedbackRingout };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  useRingoutStore.setState({ stepIndex: 0, cut: null, status: '', profiles: [], capturing: false });
});

describe('RingoutPanel', () => {
  it('renders the first step with Back disabled', () => {
    const html = renderMarkup();
    expect(html).toContain('id="ringout-step"');
    expect(html).toMatch(/id="ringout-prev"[^>]*disabled=""/);
    expect(html).not.toMatch(/id="ringout-next"[^>]*disabled=""/);
  });

  it('disables Next on the last step', () => {
    useRingoutStore.setState({ stepIndex: feedbackRingout.stepCount() - 1 });
    const html = renderMarkup();
    expect(html).toMatch(/id="ringout-next"[^>]*disabled=""/);
    expect(html).not.toMatch(/id="ringout-prev"[^>]*disabled=""/);
  });

  it('shows the current status text', () => {
    useRingoutStore.setState({ status: 'Listening for the ring…' });
    const html = renderMarkup();
    expect(html).toContain('Listening for the ring…');
  });

  it('disables the capture button while capturing', () => {
    useRingoutStore.setState({ capturing: true });
    const html = renderMarkup();
    expect(html).toMatch(/id="ringout-capture"[^>]*disabled=""/);
  });

  it('shows the empty suggestion placeholder with no cut yet', () => {
    const html = renderMarkup();
    expect(html).toContain('ro-suggestion-empty');
  });

  it('shows the formatted suggestion once a cut exists', () => {
    useRingoutStore.setState({ cut: { freq: 3150, gainDb: -6, q: 6 } });
    const html = renderMarkup();
    expect(html).toContain(feedbackRingout.formatCut({ freq: 3150, gainDb: -6, q: 6 }));
  });

  it('renders a row per saved profile', () => {
    useRingoutStore.setState({ profiles: [{ mic: 'SM58', cuts: [{ freq: 3150, gainDb: -6, q: 6 }] }] });
    const html = renderMarkup();
    expect(html).toContain('SM58');
    expect(html).toContain('ro-profile-recall');
    expect(html).toContain('ro-profile-delete');
  });

  it('renders the manual-entry input and profile-name input', () => {
    const html = renderMarkup();
    expect(html).toContain('id="ringout-manual-input"');
    expect(html).toContain('id="ringout-profile-name"');
  });
});
