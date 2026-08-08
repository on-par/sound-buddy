// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The #feedback-dialog Send Feedback form (#144, in-app submission #472,
// TD-001 slice 6f, #704) — ports inline-app.js's openFeedbackDialog/
// closeFeedbackDialog/onFeedbackAttachToggle/feedbackEmailInstead/
// sendFeedback into a real store. feedback-form-state.js stays a classic
// script, read via a typed window cast — matching ringoutStore.ts's
// getFeedbackRingout() pattern.

import { create } from 'zustand';
import { getSoundBuddy } from '../useElectron';
import type { FeedbackApi, FeedbackSubmission, SubmitFeedbackResult } from '../../../electron/ipc/api';

interface FeedbackValidation { ok: boolean; error?: string }
interface FeedbackStatusView { text: string; retryable: boolean }
interface FeedbackCategoryOption { id: string; label: string }
interface FeedbackFormRaw { message: string; category: string; contactEmail: string }
interface FeedbackFormApi {
  CATEGORIES: FeedbackCategoryOption[];
  validate(input: FeedbackFormRaw): FeedbackValidation;
  buildSubmission(input: FeedbackFormRaw): FeedbackSubmission;
  resultStatus(result: SubmitFeedbackResult): FeedbackStatusView;
}
function getFeedbackForm(): FeedbackFormApi {
  return (window as unknown as { feedbackForm: FeedbackFormApi }).feedbackForm;
}

const FEEDBACK_DIAG_REVEALED_TEXT = 'Your log file is now selected in Finder. It is never uploaded — attach it to an email to support@soundbuddy.online if you’d like us to see it.';
const FEEDBACK_DIAG_MISSING_TEXT = 'No diagnostic log exists yet — try again after using the app.';
const FEEDBACK_DIAG_ERROR_TEXT = 'Could not reveal your log file — try unchecking and checking the box again.';
const FEEDBACK_SUCCESS_CLOSE_DELAY_MS = 1200;

export interface FeedbackDialogState {
  dialogOpen: boolean;
  category: string;
  message: string;
  contactEmail: string;
  attachDiagnostics: boolean;
  diagHint: string | null;
  status: string;
  sending: boolean;
  emailInsteadVisible: boolean;
  open(): void;
  close(): void;
  setCategory(v: string): void;
  setMessage(v: string): void;
  setContactEmail(v: string): void;
  toggleAttachDiagnostics(checked: boolean): Promise<void>;
  emailInstead(): void;
  send(): Promise<void>;
  bindIpcEvents(): void;
}

export function createFeedbackDialogStore(getApi: () => FeedbackApi) {
  return create<FeedbackDialogState>()((set, get) => ({
    dialogOpen: false,
    category: 'bug',
    message: '',
    contactEmail: '',
    attachDiagnostics: false,
    diagHint: null,
    status: '',
    sending: false,
    emailInsteadVisible: false,

    open() {
      set({
        dialogOpen: true,
        category: 'bug',
        message: '',
        contactEmail: '',
        attachDiagnostics: false,
        diagHint: null,
        status: '',
        sending: false,
        emailInsteadVisible: false,
      });
    },

    close() {
      set({ dialogOpen: false });
    },

    setCategory(v) { set({ category: v }); },
    setMessage(v) { set({ message: v }); },
    setContactEmail(v) { set({ contactEmail: v }); },

    async toggleAttachDiagnostics(checked) {
      set({ attachDiagnostics: checked });
      if (!checked) {
        set({ diagHint: null });
        return;
      }
      let r;
      try { r = await getApi().revealDiagnostics(); }
      catch { r = null; }
      // The checkbox may have been unchecked again while the reveal was in flight.
      if (!get().attachDiagnostics) return;
      if (r && r.revealed) set({ diagHint: FEEDBACK_DIAG_REVEALED_TEXT });
      else if (r && r.missing) set({ diagHint: FEEDBACK_DIAG_MISSING_TEXT });
      else set({ diagHint: FEEDBACK_DIAG_ERROR_TEXT });
    },

    emailInstead() {
      void getApi().openFeedback();
      get().close();
    },

    async send() {
      const { message, category, contactEmail } = get();
      const raw = { message, category, contactEmail };
      const fb = getFeedbackForm();

      const validation = fb.validate(raw);
      if (!validation.ok) {
        set({ status: validation.error ?? '' });
        return;
      }

      set({ sending: true, emailInsteadVisible: false, status: 'Sending…' });

      let result: SubmitFeedbackResult;
      try {
        result = await getApi().submitFeedback(fb.buildSubmission(raw));
      } catch {
        result = {
          ok: false,
          retryable: true,
          error: 'Could not reach the feedback service — check your internet connection and try again.',
        };
      }

      if (result.ok) {
        set({ status: fb.resultStatus(result).text });
        setTimeout(() => get().close(), FEEDBACK_SUCCESS_CLOSE_DELAY_MS);
        return;
      }

      const statusView = fb.resultStatus(result);
      set({ status: statusView.text, sending: false, emailInsteadVisible: !statusView.retryable });
    },

    bindIpcEvents() {
      getApi().onOpenFeedbackDialog(() => get().open());
    },
  }));
}

export const useFeedbackDialogStore = createFeedbackDialogStore(getSoundBuddy);
