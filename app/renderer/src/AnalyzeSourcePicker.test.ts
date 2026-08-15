// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import AnalyzeSourcePicker from './AnalyzeSourcePicker';
import { useAnalyzeSourceStore } from './stores/analyzeSourceStore';

// The picker's click/cancel/Escape dispatch is c8-ignored (no jsdom in this
// harness); the routing logic itself (analyzeSourceState.targetModeFor) is
// unit-tested in analyze-source-state.js's own suite, and the open/close
// transitions in stores/analyzeSourceStore.test.ts.

afterEach(() => {
  useAnalyzeSourceStore.setState({ isOpen: false });
});

function renderMarkup(): string {
  return renderToString(createElement(AnalyzeSourcePicker));
}

describe('AnalyzeSourcePicker (TD-001 slice 6h, #711)', () => {
  it('renders nothing while closed (no flash)', () => {
    expect(renderMarkup()).toBe('');
  });

  it('renders the three data-analyze-source choices plus cancel when open', () => {
    useAnalyzeSourceStore.getState().open();
    const html = renderMarkup();
    expect(html).toContain('class="source-picker" id="analyze-source-picker"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('id="source-picker-title"');
    expect(html).toContain('data-analyze-source="file"');
    expect(html).toContain('data-analyze-source="live"');
    expect(html).toContain('data-analyze-source="soundcheck"');
    expect(html).toContain('id="source-picker-cancel"');
    expect(html).toContain('Analyze a file');
    expect(html).toContain('Start live listening');
    expect(html).toContain('Load a soundcheck session');
  });

  it('has exactly three data-analyze-source choices', () => {
    useAnalyzeSourceStore.getState().open();
    const matches = renderMarkup().match(/data-analyze-source=/g) || [];
    expect(matches).toHaveLength(3);
  });

  it('does not duplicate the Pro gate or tab lock', () => {
    useAnalyzeSourceStore.getState().open();
    const html = renderMarkup();
    expect(html).not.toContain('pro-gate');
    expect(html).not.toContain('tab-lock');
  });

  it('renders the cancel button last (the closing affordance)', () => {
    useAnalyzeSourceStore.getState().open();
    const html = renderMarkup();
    expect(html.indexOf('source-picker-cancel')).toBeGreaterThan(html.indexOf('data-analyze-source'));
  });
});
