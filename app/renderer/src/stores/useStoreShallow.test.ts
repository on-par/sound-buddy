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
});
