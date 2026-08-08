// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGradeOwnGuideStore, useGradeOwnGuideStore } from './gradeOwnGuideStore';
import { useAnalysisStore } from './analysisStore';
import { createMockSoundBuddy } from '../mock-sound-buddy';

let mock: ReturnType<typeof createMockSoundBuddy>;
let ctaAction: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mock = createMockSoundBuddy();
  ctaAction = vi.fn();
  (globalThis as { window?: unknown }).window = { gradeOwnState: { ctaAction }, soundBuddy: mock.api };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  useAnalysisStore.setState({
    currentAnalysis: null, selectedFilePath: null, status: 'idle', historySummary: null,
  });
});

describe('createGradeOwnGuideStore', () => {
  it('starts closed', () => {
    const store = createGradeOwnGuideStore(() => mock.api);
    expect(store.getState().dialogOpen).toBe(false);
  });

  it('open shows the dialog', () => {
    const store = createGradeOwnGuideStore(() => mock.api);
    store.getState().open();
    expect(store.getState().dialogOpen).toBe(true);
  });

  it('close hides the dialog', () => {
    const store = createGradeOwnGuideStore(() => mock.api);
    store.getState().open();
    store.getState().close();
    expect(store.getState().dialogOpen).toBe(false);
  });

  describe('chooseFile', () => {
    it('a cancelled file picker (falsy fp) leaves the dialog open with no analysis', async () => {
      mock.api.openFileDialog = vi.fn().mockResolvedValue(null);
      const store = createGradeOwnGuideStore(() => mock.api);
      store.getState().open();

      await store.getState().chooseFile();

      expect(store.getState().dialogOpen).toBe(true);
      expect(useAnalysisStore.getState().selectedFilePath).toBeNull();
    });

    it('a thrown file picker is swallowed', async () => {
      mock.api.openFileDialog = vi.fn().mockRejectedValue(new Error('cancelled'));
      const store = createGradeOwnGuideStore(() => mock.api);

      await expect(store.getState().chooseFile()).resolves.toBeUndefined();
      expect(useAnalysisStore.getState().selectedFilePath).toBeNull();
    });

    it('happy path: closes the dialog, selects the file, and starts analysis', async () => {
      mock.api.openFileDialog = vi.fn().mockResolvedValue('/picked/service.wav');
      mock.api.analyzeFile = vi.fn().mockResolvedValue({ success: true, data: { sox: {}, spectrum: {} } });
      const store = createGradeOwnGuideStore(() => mock.api);
      store.getState().open();

      await store.getState().chooseFile();

      expect(store.getState().dialogOpen).toBe(false);
      expect(useAnalysisStore.getState().selectedFilePath).toBe('/picked/service.wav');
      expect(useAnalysisStore.getState().currentAnalysis).toEqual({ sox: {}, spectrum: {} });
    });
  });

  describe('handlePathAction', () => {
    it('"choose-file" delegates to chooseFile', async () => {
      ctaAction.mockReturnValue('choose-file');
      mock.api.openFileDialog = vi.fn().mockResolvedValue(null);
      const store = createGradeOwnGuideStore(() => mock.api);

      store.getState().handlePathAction('livestream');

      expect(ctaAction).toHaveBeenCalledWith('livestream');
      await vi.waitFor(() => expect(mock.api.openFileDialog).toHaveBeenCalled());
    });

    it('"open-guide" opens the capture guide and closes the dialog', () => {
      ctaAction.mockReturnValue('open-guide');
      const openCaptureGuide = vi.fn().mockResolvedValue(undefined);
      mock.api.openCaptureGuide = openCaptureGuide;
      const store = createGradeOwnGuideStore(() => mock.api);
      store.getState().open();

      store.getState().handlePathAction('usb');

      expect(openCaptureGuide).toHaveBeenCalled();
      expect(store.getState().dialogOpen).toBe(false);
    });

    it('a thrown openCaptureGuide call is swallowed but still closes the dialog', () => {
      ctaAction.mockReturnValue('open-guide');
      mock.api.openCaptureGuide = vi.fn(() => { throw new Error('preload missing'); });
      const store = createGradeOwnGuideStore(() => mock.api);
      store.getState().open();

      expect(() => store.getState().handlePathAction('usb')).not.toThrow();
      expect(store.getState().dialogOpen).toBe(false);
    });

    it('an unrecognized action is a no-op', () => {
      ctaAction.mockReturnValue(null);
      const store = createGradeOwnGuideStore(() => mock.api);
      store.getState().open();

      store.getState().handlePathAction('nonsense');

      expect(store.getState().dialogOpen).toBe(true);
    });
  });

  it('binds the default hook to the window preload bridge', () => {
    (globalThis as unknown as { window: { soundBuddy?: unknown; gradeOwnState: unknown } }).window.soundBuddy = mock.api;
    useGradeOwnGuideStore.getState().open();
    expect(useGradeOwnGuideStore.getState().dialogOpen).toBe(true);
    useGradeOwnGuideStore.getState().close();
  });
});
