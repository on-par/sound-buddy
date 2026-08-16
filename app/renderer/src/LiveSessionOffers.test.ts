// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import LiveSessionOffers from './LiveSessionOffers';
import { useLiveCaptureStore } from './stores/liveCaptureStore';

// LiveSessionOffers (TD-001 slice 6i, #712) — the #live-rc-cue cue + the three
// post-stop offer rows (#rec-offer/#rc-offer/#rc-not-enough), rendered from
// liveCaptureStore's sessionOffers/liveCueVisible. The button click handlers
// (revealPath / switchMode navigation) are c8-ignored — no jsdom in this
// harness — and are exercised by tests/e2e/live-capture.spec.ts and
// live-capture-report-card.spec.ts.
describe('LiveSessionOffers (TD-001 slice 6i, #712)', () => {
  afterEach(() => {
    useLiveCaptureStore.setState({
      sessionOffers: { sessionDir: null, reportCard: false, notEnoughData: false },
      liveCueVisible: true,
    });
  });

  it('shows the live-report-card cue idle-visible with every offer row hidden', () => {
    useLiveCaptureStore.setState({ sessionOffers: { sessionDir: null, reportCard: false, notEnoughData: false }, liveCueVisible: true });
    const html = renderToString(createElement(LiveSessionOffers));
    expect(html).toContain('id="live-rc-cue"');
    expect(html).toContain('Listening builds a live Report Card as it runs.');
    expect(html).toMatch(/id="live-rc-cue"[^>]*style=""|id="live-rc-cue"/);
    expect(html).toMatch(/id="rec-offer"[^>]*style="display:none"/);
    expect(html).toMatch(/id="rc-offer"[^>]*style="display:none"/);
    expect(html).toMatch(/id="rc-not-enough"[^>]*style="display:none"/);
  });

  it('hides the cue when liveCueVisible is false', () => {
    useLiveCaptureStore.setState({ liveCueVisible: false });
    const html = renderToString(createElement(LiveSessionOffers));
    expect(html).toMatch(/id="live-rc-cue"[^>]*style="display:none"/);
  });

  it('renders the session-saved offer with the folder name as a text node', () => {
    useLiveCaptureStore.setState({ sessionOffers: { sessionDir: '/Users/music/Sunday Service 2026-08-15', reportCard: false, notEnoughData: false } });
    const html = renderToString(createElement(LiveSessionOffers));
    expect(html).toMatch(/id="rec-offer"[^>]*style="display:flex"/);
    expect(html).toContain('id="rec-offer-text"');
    expect(html).toContain('Session saved <b>Sunday Service 2026-08-15</b>.');
    expect(html).toContain('id="rec-offer-btn"');
    expect(html).toContain('Open folder');
    // #865: the folder icon must render as a real <svg> element, not as
    // escaped SVG markup text (iconSvg returns a raw string).
    expect(html).toMatch(/id="rec-offer-btn"[^>]*>(?:(?!<\/button>)[\s\S])*?<svg width="16"/);
    expect(html).not.toMatch(/&lt;svg/);
  });

  it('renders the report-card and not-enough-data rows from their flags', () => {
    useLiveCaptureStore.setState({ sessionOffers: { sessionDir: null, reportCard: true, notEnoughData: true } });
    const html = renderToString(createElement(LiveSessionOffers));
    expect(html).toMatch(/id="rc-offer"[^>]*style="display:flex"/);
    expect(html).toContain('Report card ready.');
    expect(html).toContain('id="rc-offer-btn"');
    expect(html).toContain('View report card');
    // #865: the clipboard-check icon must render as a real <svg> element, not
    // as escaped SVG markup text.
    expect(html).toMatch(/id="rc-offer-btn"[^>]*>(?:(?!<\/button>)[\s\S])*?<svg width="16"/);
    expect(html).not.toMatch(/&lt;svg/);
    expect(html).toMatch(/id="rc-not-enough"[^>]*style="display:flex"/);
    expect(html).toContain('Not enough data — monitor at least a few seconds of audio to generate a report card.');
  });
});
