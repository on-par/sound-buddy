// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFeedbackDialogStore, useFeedbackDialogStore } from './feedbackDialogStore';
import { createMockSoundBuddy } from '../mock-sound-buddy';

const CATEGORIES = [
  { id: 'bug', label: 'Bug' },
  { id: 'idea', label: 'Idea' },
];

function feedbackFormMock(overrides: Partial<{
  validate: (input: unknown) => { ok: boolean; error?: string };
  resultStatus: (result: unknown) => { text: string; retryable: boolean };
}> = {}) {
  return {
    CATEGORIES,
    validate: overrides.validate ?? (() => ({ ok: true })),
    buildSubmission: (input: {
      message: string;
      category: string;
      contactEmail: string;
      attachDiagnostics: boolean;
    }) => ({
      message: input.message,
      category: input.category,
      ...(input.contactEmail ? { contactEmail: input.contactEmail } : {}),
      ...(input.attachDiagnostics === true ? { attachDiagnostics: true } : {}),
    }),
    resultStatus: overrides.resultStatus ?? ((result: { ok: boolean; error?: string; retryable?: boolean }) => (
      result.ok
        ? { text: 'Thanks — your feedback was sent.', retryable: false }
        : { text: result.retryable ? `${result.error} Try again.` : result.error, retryable: !!result.retryable }
    )),
  };
}

let mock: ReturnType<typeof createMockSoundBuddy>;

beforeEach(() => {
  mock = createMockSoundBuddy();
  (globalThis as { window?: unknown }).window = { feedbackForm: feedbackFormMock() };
  vi.useFakeTimers();
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  vi.useRealTimers();
});

describe('createFeedbackDialogStore', () => {
  it('starts closed with defaults', () => {
    const store = createFeedbackDialogStore(() => mock.api);
    expect(store.getState().dialogOpen).toBe(false);
    expect(store.getState().category).toBe('bug');
  });

  describe('open', () => {
    it('resets every field and opens the dialog', () => {
      const store = createFeedbackDialogStore(() => mock.api);
      store.setState({
        category: 'idea', message: 'stale', contactEmail: 'x@y.com', attachDiagnostics: true,
        diagHint: 'stale hint', status: 'stale status', sending: true, emailInsteadVisible: true,
      });

      store.getState().open();

      expect(store.getState()).toMatchObject({
        dialogOpen: true, category: 'bug', message: '', contactEmail: '', attachDiagnostics: false,
        diagHint: null, status: '', sending: false, emailInsteadVisible: false,
      });
    });
  });

  it('close hides the dialog', () => {
    const store = createFeedbackDialogStore(() => mock.api);
    store.getState().open();

    store.getState().close();

    expect(store.getState().dialogOpen).toBe(false);
  });

  it('setCategory/setMessage/setContactEmail update their fields', () => {
    const store = createFeedbackDialogStore(() => mock.api);

    store.getState().setCategory('idea');
    store.getState().setMessage('it broke');
    store.getState().setContactEmail('me@x.com');

    expect(store.getState().category).toBe('idea');
    expect(store.getState().message).toBe('it broke');
    expect(store.getState().contactEmail).toBe('me@x.com');
  });

  describe('toggleAttachDiagnostics', () => {
    it('unchecking clears the hint without calling revealDiagnostics', async () => {
      const revealDiagnostics = vi.fn();
      mock.api.revealDiagnostics = revealDiagnostics;
      const store = createFeedbackDialogStore(() => mock.api);
      store.setState({ diagHint: 'old hint' });

      await store.getState().toggleAttachDiagnostics(false);

      expect(store.getState().attachDiagnostics).toBe(false);
      expect(store.getState().diagHint).toBeNull();
      expect(revealDiagnostics).not.toHaveBeenCalled();
    });

    it('checking and revealed sets the revealed hint', async () => {
      mock.api.revealDiagnostics = vi.fn().mockResolvedValue({ revealed: true });
      const store = createFeedbackDialogStore(() => mock.api);

      await store.getState().toggleAttachDiagnostics(true);

      expect(store.getState().diagHint).toContain('now selected in Finder');
    });

    it('checking and missing sets the missing hint', async () => {
      mock.api.revealDiagnostics = vi.fn().mockResolvedValue({ revealed: false, missing: true });
      const store = createFeedbackDialogStore(() => mock.api);

      await store.getState().toggleAttachDiagnostics(true);

      expect(store.getState().diagHint).toContain('No diagnostic log exists yet');
    });

    it('checking and an unexpected/failed reveal sets the error hint', async () => {
      mock.api.revealDiagnostics = vi.fn().mockRejectedValue(new Error('ipc down'));
      const store = createFeedbackDialogStore(() => mock.api);

      await store.getState().toggleAttachDiagnostics(true);

      expect(store.getState().diagHint).toContain('Could not reveal your log file');
    });

    it('guards the in-flight-uncheck race: unchecked again before reveal resolves leaves the hint alone', async () => {
      let resolveReveal: (v: { revealed: boolean }) => void;
      mock.api.revealDiagnostics = vi.fn(() => new Promise<{ revealed: boolean }>((resolve) => { resolveReveal = resolve; }));
      const store = createFeedbackDialogStore(() => mock.api);

      const pending = store.getState().toggleAttachDiagnostics(true);
      store.getState().toggleAttachDiagnostics(false);
      resolveReveal!({ revealed: true });
      await pending;

      expect(store.getState().diagHint).toBeNull();
    });
  });

  it('emailInstead opens the mailto fallback and closes the dialog', () => {
    const openFeedback = vi.fn().mockResolvedValue(undefined);
    mock.api.openFeedback = openFeedback;
    const store = createFeedbackDialogStore(() => mock.api);
    store.getState().open();

    store.getState().emailInstead();

    expect(openFeedback).toHaveBeenCalled();
    expect(store.getState().dialogOpen).toBe(false);
  });

  describe('send', () => {
    it('validation failure sets the status and never calls submitFeedback', async () => {
      (globalThis as unknown as { window: { feedbackForm: unknown } }).window.feedbackForm = feedbackFormMock({
        validate: () => ({ ok: false, error: 'Enter a short message describing what happened or what would help.' }),
      });
      const submitFeedback = vi.fn();
      mock.api.submitFeedback = submitFeedback;
      const store = createFeedbackDialogStore(() => mock.api);

      await store.getState().send();

      expect(store.getState().status).toBe('Enter a short message describing what happened or what would help.');
      expect(submitFeedback).not.toHaveBeenCalled();
    });

    it('submit success sets the status and schedules a close', async () => {
      mock.api.submitFeedback = vi.fn().mockResolvedValue({ ok: true });
      const store = createFeedbackDialogStore(() => mock.api);
      store.getState().open();
      store.getState().setMessage('it broke');

      await store.getState().send();

      expect(store.getState().status).toBe('Thanks — your feedback was sent.');
      expect(store.getState().dialogOpen).toBe(true);

      vi.advanceTimersByTime(1200);

      expect(store.getState().dialogOpen).toBe(false);
    });

    it('submit failure (retryable) re-enables the form without showing Email instead', async () => {
      mock.api.submitFeedback = vi.fn().mockResolvedValue({
        ok: false, retryable: true, error: 'Could not reach the feedback service.',
      });
      const store = createFeedbackDialogStore(() => mock.api);
      store.getState().setMessage('it broke');

      await store.getState().send();

      expect(store.getState().sending).toBe(false);
      expect(store.getState().status).toContain('Try again.');
      expect(store.getState().emailInsteadVisible).toBe(false);
    });

    it('submit failure (non-retryable) shows Email instead', async () => {
      mock.api.submitFeedback = vi.fn().mockResolvedValue({
        ok: false, retryable: false, error: 'That category is not accepted.',
      });
      const store = createFeedbackDialogStore(() => mock.api);
      store.getState().setMessage('it broke');

      await store.getState().send();

      expect(store.getState().sending).toBe(false);
      expect(store.getState().emailInsteadVisible).toBe(true);
      expect(store.getState().status).toBe('That category is not accepted.');
    });

    it('forwards attachDiagnostics: true to submitFeedback when the checkbox is checked', async () => {
      const submitFeedback = vi.fn().mockResolvedValue({ ok: true });
      mock.api.submitFeedback = submitFeedback;
      const store = createFeedbackDialogStore(() => mock.api);
      store.getState().setMessage('it broke');
      store.setState({ attachDiagnostics: true });

      await store.getState().send();

      expect(submitFeedback).toHaveBeenCalledWith(
        expect.objectContaining({ attachDiagnostics: true })
      );
    });

    it('omits attachDiagnostics from the submitted object when the checkbox is unchecked', async () => {
      const submitFeedback = vi.fn().mockResolvedValue({ ok: true });
      mock.api.submitFeedback = submitFeedback;
      const store = createFeedbackDialogStore(() => mock.api);
      store.getState().setMessage('it broke');
      store.setState({ attachDiagnostics: false });

      await store.getState().send();

      const submitted = submitFeedback.mock.calls[0][0];
      expect(submitted).not.toHaveProperty('attachDiagnostics');
    });

    it('a thrown submitFeedback falls back to a retryable connection-error status', async () => {
      mock.api.submitFeedback = vi.fn().mockRejectedValue(new Error('network down'));
      const store = createFeedbackDialogStore(() => mock.api);
      store.getState().setMessage('it broke');

      await store.getState().send();

      expect(store.getState().status).toContain('Could not reach the feedback service');
      expect(store.getState().emailInsteadVisible).toBe(false);
      expect(store.getState().sending).toBe(false);
    });
  });

  it('bindIpcEvents registers a callback that opens the dialog', () => {
    const store = createFeedbackDialogStore(() => mock.api);

    store.getState().bindIpcEvents();
    mock.emit('onOpenFeedbackDialog');

    expect(store.getState().dialogOpen).toBe(true);
  });

  it('binds the default hook to the window preload bridge', () => {
    (globalThis as unknown as { window: { soundBuddy?: unknown; feedbackForm: unknown } }).window.soundBuddy = mock.api;
    useFeedbackDialogStore.getState().open();
    expect(useFeedbackDialogStore.getState().dialogOpen).toBe(true);
    useFeedbackDialogStore.getState().close();
  });
});
