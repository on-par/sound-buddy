// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import LiveSessionOffers, { liveCueShown } from './LiveSessionOffers';
import { useLiveCaptureStore } from './stores/liveCaptureStore';

// LiveSessionOffers (TD-001 slice 6i, #712) — the #live-rc-cue cue + the three
// post-stop offer rows (#rec-offer/#rc-offer/#rc-not-enough), rendered from
// liveCaptureStore's sessionOffers/liveCueVisible. The button click handlers
// (revealPath / switchMode navigation) are c8-ignored — no jsdom in this
// harness — and are exercised by tests/e2e/live-capture.spec.ts and
// live-capture-report-card.spec.ts. #1597: offer rows render inside a single
// #session-offers strip and the cue is idle-only (hidden while capturing).
describe('LiveSessionOffers (TD-001 slice 6i, #712)', () => {
  afterEach(() => {
    useLiveCaptureStore.setState({
      sessionOffers: { sessionDir: null, reportCard: false, notEnoughData: false },
      liveCueVisible: true,
      isCapturing: false,
    });
  });

  it('shows the live-report-card cue idle-visible with every offer row hidden', () => {
    useLiveCaptureStore.setState({ sessionOffers: { sessionDir: null, reportCard: false, notEnoughData: false }, liveCueVisible: true, isCapturing: false });
    const html = renderToString(createElement(LiveSessionOffers));
    expect(html).toContain('id="live-rc-cue"');
    expect(html).toContain('Listening builds a live Report Card as it runs.');
    expect(html).toMatch(/id="live-rc-cue"[^>]*style=""|id="live-rc-cue"/);
    expect(html).toMatch(/id="rec-offer"[^>]*style="display:none"/);
    expect(html).toMatch(/id="rc-offer"[^>]*style="display:none"/);
    expect(html).toMatch(/id="rc-not-enough"[^>]*style="display:none"/);
    expect(html).toMatch(/id="session-offers"[^>]*style="display:none"/);
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

  it('hides the cue while capturing even when liveCueVisible is true (#776 monitor auto-resume, #1597)', () => {
    useLiveCaptureStore.setState({ liveCueVisible: true, isCapturing: true, sessionOffers: { sessionDir: null, reportCard: false, notEnoughData: false } });
    const html = renderToString(createElement(LiveSessionOffers));
    expect(html).toMatch(/id="live-rc-cue"[^>]*style="display:none"/);
  });

  it('renders both offer rows inside a single visible #session-offers strip and hides the idle cue (#1597)', () => {
    useLiveCaptureStore.setState({
      liveCueVisible: true,
      isCapturing: false,
      sessionOffers: { sessionDir: '/x/sound-buddy-20260927-093334-588', reportCard: true, notEnoughData: false },
    });
    const html = renderToString(createElement(LiveSessionOffers));
    expect(html).toMatch(/id="live-rc-cue"[^>]*style="display:none"/);
    expect(html).toMatch(/id="session-offers"[^>]*style="display:flex"/);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Session ended"');
    expect(html).toMatch(/id="rec-offer"[^>]*style="display:flex"/);
    expect(html).toMatch(/id="rc-offer"[^>]*style="display:flex"/);
    expect(html).toMatch(/id="session-offers"[\s\S]*id="rec-offer"[\s\S]*id="rc-offer"/);
  });

  describe('liveCueShown (#1597)', () => {
    const noOffers = { sessionDir: null, reportCard: false, notEnoughData: false };

    it('returns true when liveCueVisible, not capturing, no offers', () => {
      expect(liveCueShown(true, false, noOffers)).toBe(true);
    });

    it('returns false when liveCueVisible is false', () => {
      expect(liveCueShown(false, false, noOffers)).toBe(false);
    });

    it('returns false when isCapturing is true (post-stop monitor auto-resume)', () => {
      expect(liveCueShown(true, true, noOffers)).toBe(false);
    });

    it('returns false when sessionDir is set', () => {
      expect(liveCueShown(true, false, { ...noOffers, sessionDir: '/x/y' })).toBe(false);
    });

    it('returns false when reportCard is true', () => {
      expect(liveCueShown(true, false, { ...noOffers, reportCard: true })).toBe(false);
    });

    it('returns false when notEnoughData is true', () => {
      expect(liveCueShown(true, false, { ...noOffers, notEnoughData: true })).toBe(false);
    });
  });

  it('app.css defines the #1597 .session-offers strip layout', () => {
    const css = readFileSync(new URL('./styles/app.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.session-offers\s*\{[^}]*display:flex/);
    expect(css).toMatch(/\.session-offers \.rec-offer\s*\{[^}]*margin-top:0/);
  });
});
