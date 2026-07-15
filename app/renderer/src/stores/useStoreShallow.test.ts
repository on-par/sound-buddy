// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { useStoreShallow } from './useStoreShallow';
import { createAnalysisStore } from './analysisStore';
import { createMockSoundBuddy } from '../mock-sound-buddy';

describe('useStoreShallow', () => {
  it('applies an object selector with shallow comparison', () => {
    const mock = createMockSoundBuddy();
    const store = createAnalysisStore(() => mock.api);

    function Probe() {
      const { busy, err } = useStoreShallow(store, (s) => ({
        busy: s.isAnalyzing,
        err: s.analysisError,
      }));
      return createElement('div', null, `busy=${busy} err=${err}`);
    }

    const html = renderToString(createElement(Probe));

    expect(html).toContain('busy=false');
    expect(html).toContain('err=null');
  });

  it('applies a primitive selector', () => {
    const mock = createMockSoundBuddy();
    const store = createAnalysisStore(() => mock.api);

    function Probe() {
      const busy = useStoreShallow(store, (s) => s.isAnalyzing);
      return createElement('div', null, `busy=${busy}`);
    }

    const html = renderToString(createElement(Probe));

    expect(html).toContain('busy=false');
  });

  // Regression: zustand's own bound hook uses getInitialState() (frozen at
  // create() time) as its renderToString/SSR snapshot, so a setState() call
  // made right before render — the pattern every store-driven component test
  // in this app relies on — would silently render the pristine initial state
  // instead. useStoreShallow must read the live state on both branches.
  it('reflects a setState() call made before render (renderToString has no real hydration in this app)', () => {
    const mock = createMockSoundBuddy();
    const store = createAnalysisStore(() => mock.api);
    store.setState({ isAnalyzing: true });

    function Probe() {
      const busy = useStoreShallow(store, (s) => s.isAnalyzing);
      return createElement('div', null, `busy=${busy}`);
    }

    const html = renderToString(createElement(Probe));

    expect(html).toContain('busy=true');
  });
});
