// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The #feedback-dialog Send Feedback form (#144, in-app submission #472,
// TD-001 slice 6f, #704) — portaled by App.tsx onto #feedback-dialog-island.
// Markup is copied verbatim from the old static index.html (every id
// preserved) so app/tests/e2e/utility-dialogs.spec.ts's selectors work.

import { useEffect, type JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useFeedbackDialogStore } from './stores/feedbackDialogStore';

interface FeedbackCategoryOption { id: string; label: string }
interface FeedbackFormApi { CATEGORIES: FeedbackCategoryOption[] }
// feedback-form-state.js stays a classic script — read via a typed window
// cast, matching RingoutPanel.tsx's getFeedbackRingout() pattern.
function getFeedbackForm(): FeedbackFormApi {
  return (window as unknown as { feedbackForm: FeedbackFormApi }).feedbackForm;
}

export default function FeedbackDialog(): JSX.Element {
  const {
    dialogOpen, category, message, contactEmail, attachDiagnostics, diagHint, status, sending, emailInsteadVisible,
  } = useStoreShallow(useFeedbackDialogStore, (s) => ({
    dialogOpen: s.dialogOpen,
    category: s.category,
    message: s.message,
    contactEmail: s.contactEmail,
    attachDiagnostics: s.attachDiagnostics,
    diagHint: s.diagHint,
    status: s.status,
    sending: s.sending,
    emailInsteadVisible: s.emailInsteadVisible,
  }));

  /* c8 ignore start -- document-level Escape close, no jsdom in this harness;
     covered by app/tests/e2e/utility-dialogs.spec.ts. */
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && useFeedbackDialogStore.getState().dialogOpen) {
        useFeedbackDialogStore.getState().close();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
  /* c8 ignore stop */

  return (
    <div
      id="feedback-dialog"
      className="rig-dialog"
      style={{ display: dialogOpen ? 'flex' : 'none' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="feedback-dialog-title"
      /* c8 ignore next -- click dispatch, no jsdom */
      onClick={(e) => { if (e.target === e.currentTarget) useFeedbackDialogStore.getState().close(); }}
    >
      <div className="rig-dialog-card">
        <div className="rig-dialog-title" id="feedback-dialog-title">Send Feedback</div>
        <div className="ai-dialog-sub">Sends your message to the Sound Buddy team along with your app version and macOS version. Never audio, recordings, license keys, file paths, or anything else from your machine.</div>
        <label className="ai-field">
          <span className="ai-field-label">Category</span>
          <select
            id="feedback-category"
            className="rig-dialog-input"
            value={category}
            onChange={(e) => useFeedbackDialogStore.getState().setCategory(e.target.value)}
          >
            {getFeedbackForm().CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </label>
        <label className="ai-field">
          <span className="ai-field-label">Message</span>
          <textarea
            id="feedback-message"
            className="rig-dialog-input"
            rows={4}
            maxLength={4000}
            placeholder="What happened, or what would help?"
            value={message}
            onChange={(e) => useFeedbackDialogStore.getState().setMessage(e.target.value)}
          />
        </label>
        <label className="ai-field">
          <span className="ai-field-label">Email for a reply (optional)</span>
          <input
            type="email"
            id="feedback-email"
            className="rig-dialog-input"
            placeholder="you@example.com"
            autoComplete="off"
            value={contactEmail}
            onChange={(e) => useFeedbackDialogStore.getState().setContactEmail(e.target.value)}
          />
        </label>
        <label className="ai-enable-row">
          <input
            type="checkbox"
            id="feedback-attach-diagnostics"
            checked={attachDiagnostics}
            /* c8 ignore next -- click dispatch, no jsdom */
            onChange={(e) => { void useFeedbackDialogStore.getState().toggleAttachDiagnostics(e.target.checked); }}
          />
          Reveal my diagnostic log (never uploaded)
        </label>
        <p className="ai-dialog-note" id="feedback-diag-hint" style={{ display: diagHint ? '' : 'none' }}>{diagHint}</p>
        <span className="ai-status" id="feedback-status" role="status">{status}</span>
        <div className="rig-dialog-actions">
          <button
            type="button"
            id="feedback-dialog-email-instead"
            className="btn btn-secondary sm"
            style={{ display: emailInsteadVisible ? '' : 'none' }}
            /* c8 ignore next -- click dispatch, no jsdom */
            onClick={() => useFeedbackDialogStore.getState().emailInstead()}
          >
            Email instead
          </button>
          <button
            type="button"
            id="feedback-dialog-cancel"
            className="btn btn-secondary sm"
            /* c8 ignore next -- click dispatch, no jsdom */
            onClick={() => useFeedbackDialogStore.getState().close()}
          >
            Cancel
          </button>
          <button
            type="button"
            id="feedback-dialog-send"
            className="btn btn-primary sm"
            disabled={sending}
            /* c8 ignore next -- click dispatch, no jsdom */
            onClick={() => { void useFeedbackDialogStore.getState().send(); }}
          >
            Send Feedback
          </button>
        </div>
      </div>
    </div>
  );
}
