// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createOnboardingStore, useOnboardingStore } from './onboardingStore';
import { useAnalysisStore } from './analysisStore';
import { useLiveCaptureStore } from './liveCaptureStore';
import { createMockSoundBuddy } from '../mock-sound-buddy';

function makeClassList() {
  const classes = new Set<string>();
  return {
    add: (c: string) => { classes.add(c); },
    remove: (c: string) => { classes.delete(c); },
    toggle: (c: string, force?: boolean) => {
      const on = force === undefined ? !classes.has(c) : force;
      if (on) classes.add(c); else classes.delete(c);
      return on;
    },
    contains: (c: string) => classes.has(c),
  };
}
function makeFakeElement() {
  return { style: {} as Record<string, string>, textContent: '', classList: makeClassList() };
}

let elements: Record<string, ReturnType<typeof makeFakeElement>>;
let shouldShowOnboarding: ReturnType<typeof vi.fn>;
let markOnboardingSeen: ReturnType<typeof vi.fn>;
let mock: ReturnType<typeof createMockSoundBuddy>;

beforeEach(() => {
  elements = {
    'spectrum-title': makeFakeElement(),
    'live-eq-pane': makeFakeElement(),
    'reportcard-view': makeFakeElement(),
  };
  shouldShowOnboarding = vi.fn(() => true);
  markOnboardingSeen = vi.fn();
  mock = createMockSoundBuddy();
  (globalThis as { document?: unknown }).document = {
    getElementById: (id: string) => elements[id] ?? null,
    querySelectorAll: () => [],
    body: { classList: makeClassList() },
  };
  (globalThis as { window?: unknown }).window = {
    soundBuddy: mock.api,
    localStorage: {},
    onboardingState: { shouldShowOnboarding, markOnboardingSeen },
    singleColumnState: { isSingleColumn: () => false },
    reportFirstUxState: { isEnabled: () => false },
  };
});

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
  delete (globalThis as { window?: unknown }).window;
  vi.restoreAllMocks();
  useAnalysisStore.setState({
    currentAnalysis: null, selectedFilePath: null, status: 'idle', historySummary: null,
  });
  useLiveCaptureStore.setState({ appMode: 'reportcard' });
});

describe('createOnboardingStore', () => {
  it('starts closed, in the actions phase, with no copy override', () => {
    const store = createOnboardingStore(() => mock.api);
    expect(store.getState().dialogOpen).toBe(false);
    expect(store.getState().phase).toBe('actions');
    expect(store.getState().copyOverride).toBeNull();
    expect(store.getState().runButtonLabel).toBe('Run your first analysis');
  });

  describe('init', () => {
    it('does nothing when window.onboardingState is undefined', async () => {
      (globalThis as { window: { onboardingState?: unknown } }).window.onboardingState = undefined;
      const store = createOnboardingStore(() => mock.api);

      await store.getState().init();

      expect(store.getState().dialogOpen).toBe(false);
    });

    it('stays hidden when the dev/e2e escape hatch reports onboarding disabled', async () => {
      mock.api.isOnboardingDisabled = vi.fn().mockResolvedValue(true);
      const store = createOnboardingStore(() => mock.api);

      await store.getState().init();

      expect(store.getState().dialogOpen).toBe(false);
    });

    it('shows anyway when isOnboardingDisabled rejects (no bridge)', async () => {
      mock.api.isOnboardingDisabled = vi.fn().mockRejectedValue(new Error('no bridge'));
      const store = createOnboardingStore(() => mock.api);

      await store.getState().init();

      expect(store.getState().dialogOpen).toBe(true);
    });

    it('stays hidden when shouldShowOnboarding says no (already seen)', async () => {
      shouldShowOnboarding.mockReturnValue(false);
      const store = createOnboardingStore(() => mock.api);

      await store.getState().init();

      expect(store.getState().dialogOpen).toBe(false);
    });

    it('shows the dialog on a genuine first launch', async () => {
      const store = createOnboardingStore(() => mock.api);

      await store.getState().init();

      expect(store.getState().dialogOpen).toBe(true);
    });
  });

  describe('runFirstAnalysis', () => {
    it('happy path: analyzes the bundled demo and closes on success', async () => {
      mock.api.getDemoAudio = vi.fn().mockResolvedValue('/demo/demo.wav');
      mock.api.analyzeFile = vi.fn().mockResolvedValue({ success: true, data: { sox: {}, spectrum: {} } });
      const store = createOnboardingStore(() => mock.api);
      store.setState({ dialogOpen: true });

      await store.getState().runFirstAnalysis();

      expect(useAnalysisStore.getState().selectedFilePath).toBe('/demo/demo.wav');
      expect(useAnalysisStore.getState().currentAnalysis).toEqual({ sox: {}, spectrum: {} });
      expect(store.getState().dialogOpen).toBe(false);
      expect(markOnboardingSeen).toHaveBeenCalled();
      expect(useLiveCaptureStore.getState().appMode).toBe('reportcard');
    });

    it('no-demo fallback: closes, switches tabs, and analyzes a user-picked file', async () => {
      mock.api.getDemoAudio = vi.fn().mockResolvedValue(null);
      mock.api.openFileDialog = vi.fn().mockResolvedValue('/picked/file.wav');
      mock.api.analyzeFile = vi.fn().mockResolvedValue({ success: true, data: { sox: {}, spectrum: {} } });
      const store = createOnboardingStore(() => mock.api);
      store.setState({ dialogOpen: true });

      await store.getState().runFirstAnalysis();

      expect(store.getState().dialogOpen).toBe(false);
      expect(markOnboardingSeen).toHaveBeenCalled();
      await vi.waitFor(() => expect(useAnalysisStore.getState().selectedFilePath).toBe('/picked/file.wav'));
    });

    it('no-demo fallback: a cancelled file picker leaves no file selected', async () => {
      mock.api.getDemoAudio = vi.fn().mockResolvedValue(null);
      mock.api.openFileDialog = vi.fn().mockResolvedValue(null);
      const store = createOnboardingStore(() => mock.api);

      await store.getState().runFirstAnalysis();

      expect(useAnalysisStore.getState().selectedFilePath).toBeNull();
    });

    it('no-demo fallback: a thrown file picker is swallowed', async () => {
      mock.api.getDemoAudio = vi.fn().mockResolvedValue(null);
      mock.api.openFileDialog = vi.fn().mockRejectedValue(new Error('cancelled'));
      const store = createOnboardingStore(() => mock.api);

      await expect(store.getState().runFirstAnalysis()).resolves.toBeUndefined();
    });

    it('getDemoAudio throwing is treated the same as no demo', async () => {
      mock.api.getDemoAudio = vi.fn().mockRejectedValue(new Error('boom'));
      mock.api.openFileDialog = vi.fn().mockResolvedValue(null);
      const store = createOnboardingStore(() => mock.api);

      await store.getState().runFirstAnalysis();

      expect(store.getState().dialogOpen).toBe(false);
    });

    it('analysis-failure path: relabels the CTA and stays open for a retry', async () => {
      mock.api.getDemoAudio = vi.fn().mockResolvedValue('/demo/demo.wav');
      mock.api.analyzeFile = vi.fn().mockResolvedValue({ success: false, error: 'sox failed' });
      const store = createOnboardingStore(() => mock.api);
      store.setState({ dialogOpen: true });

      await store.getState().runFirstAnalysis();

      expect(store.getState().dialogOpen).toBe(true);
      expect(store.getState().phase).toBe('actions');
      expect(store.getState().runButtonLabel).toBe('Try again');
      expect(store.getState().copyOverride).toContain('couldn’t finish');
      expect(markOnboardingSeen).not.toHaveBeenCalled();
    });

    it('sets phase to progress immediately', () => {
      mock.api.getDemoAudio = vi.fn(() => new Promise<string | null>(() => {})); // never resolves
      const store = createOnboardingStore(() => mock.api);

      void store.getState().runFirstAnalysis();

      expect(store.getState().phase).toBe('progress');
    });
  });

  describe('close', () => {
    it('marks onboarding seen and hides the dialog', () => {
      const store = createOnboardingStore(() => mock.api);
      store.setState({ dialogOpen: true });

      store.getState().close();

      expect(store.getState().dialogOpen).toBe(false);
      expect(markOnboardingSeen).toHaveBeenCalledWith(window.localStorage);
    });
  });

  it('binds the default hook to the window preload bridge', async () => {
    await useOnboardingStore.getState().init();
    expect(useOnboardingStore.getState().dialogOpen).toBe(true);
    useOnboardingStore.setState({ dialogOpen: false, phase: 'actions', copyOverride: null, runButtonLabel: 'Run your first analysis' });
  });
});
