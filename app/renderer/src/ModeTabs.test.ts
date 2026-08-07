// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import ModeTabs from './ModeTabs';
import { useLiveCaptureStore } from './stores/liveCaptureStore';

afterEach(() => {
  useLiveCaptureStore.setState({ appMode: 'reportcard' });
});

function renderMarkup(): string {
  return renderToString(createElement(ModeTabs));
}

describe('ModeTabs', () => {
  it('renders all 9 tabs with their ids/data-mode', () => {
    const html = renderMarkup();
    expect(html).toContain('id="nav-analyze" data-mode="analyze"');
    expect(html).toContain('id="nav-history" data-mode="history"');
    expect(html).toContain('data-mode="dir"');
    expect(html).toContain('data-mode="live"');
    expect(html).toContain('data-mode="soundcheck"');
    expect(html).toContain('data-mode="recent"');
    expect(html).toContain('data-mode="guide"');
    expect(html).toContain('data-mode="ringout"');
    expect(html).toContain('data-mode="reportcard"');
  });

  it('marks the report card tab active by default', () => {
    const html = renderMarkup();
    expect(html).toContain('class="mode-tab active" data-mode="reportcard"');
  });

  it('marks whichever tab matches appMode as active instead', () => {
    useLiveCaptureStore.setState({ appMode: 'live' });
    const html = renderMarkup();
    expect(html).toContain('class="mode-tab active" data-mode="live"');
    expect(html).not.toContain('class="mode-tab active" data-mode="reportcard"');
  });

  it('renders the tab-lock decoration on Live and Soundcheck only', () => {
    const html = renderMarkup();
    const liveButton = html.slice(html.indexOf('data-mode="live"'), html.indexOf('data-mode="soundcheck"'));
    const dirButton = html.slice(html.indexOf('data-mode="dir"'), html.indexOf('data-mode="live"'));
    expect(liveButton).toContain('class="tab-lock"');
    expect(dirButton).not.toContain('tab-lock');
  });

  it('does not mark History active by default (only set via a redirect click)', () => {
    const html = renderMarkup();
    expect(html).toContain('id="nav-history" data-mode="history"');
    expect(html).not.toContain('class="mode-tab active" id="nav-history"');
  });
});
