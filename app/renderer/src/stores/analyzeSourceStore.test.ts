// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { useAnalyzeSourceStore } from './analyzeSourceStore';

afterEach(() => {
  useAnalyzeSourceStore.setState({ isOpen: false });
});

describe('useAnalyzeSourceStore (TD-001 slice 6h, #711)', () => {
  it('starts closed', () => {
    expect(useAnalyzeSourceStore.getState().isOpen).toBe(false);
  });

  it('open sets isOpen true', () => {
    useAnalyzeSourceStore.getState().open();
    expect(useAnalyzeSourceStore.getState().isOpen).toBe(true);
  });

  it('close sets isOpen false', () => {
    useAnalyzeSourceStore.getState().open();
    useAnalyzeSourceStore.getState().close();
    expect(useAnalyzeSourceStore.getState().isOpen).toBe(false);
  });
});
