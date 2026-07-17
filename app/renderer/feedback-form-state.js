// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure logic for the in-app feedback dialog (#472): validates the user's
// message/contact email, builds the allowlisted FeedbackSubmission the main
// process expects, and turns a SubmitFeedbackResult into UI status copy.
// Nothing here touches the DOM, IPC, or window — mirrors
// feedback-ringout-state.js's shape (UMD, injected-nothing pure module).
(function (root) {
  'use strict';

  var MAX_MESSAGE_LENGTH = 4000;
  var MAX_CONTACT_EMAIL_LENGTH = 254; // matches the worker's ingest.ts bound
  var EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

  var CATEGORIES = [
    { id: 'bug', label: 'Bug' },
    { id: 'idea', label: 'Idea' },
    { id: 'question', label: 'Question' },
    { id: 'other', label: 'Other' },
  ];

  function categoryIds() {
    return CATEGORIES.map(function (c) { return c.id; });
  }

  function validate(input) {
    var message = (input && input.message) || '';
    if (typeof message !== 'string' || !message.trim()) {
      return { ok: false, error: 'Enter a short message describing what happened or what would help.' };
    }
    if (message.trim().length > MAX_MESSAGE_LENGTH) {
      return {
        ok: false,
        error: 'Your message is too long — please shorten it to ' + MAX_MESSAGE_LENGTH + ' characters or fewer.',
      };
    }
    var contactEmail = input && input.contactEmail;
    var trimmedEmail = contactEmail ? String(contactEmail).trim() : '';
    if (
      trimmedEmail &&
      (trimmedEmail.length > MAX_CONTACT_EMAIL_LENGTH || !EMAIL_PATTERN.test(trimmedEmail))
    ) {
      return { ok: false, error: 'Enter a valid email address, or leave it blank.' };
    }
    return { ok: true };
  }

  // Trimmed FeedbackSubmission the main process expects; empty contact email
  // is omitted and an unrecognized/missing category is coerced to 'other'
  // rather than rejected, since the main process re-validates anyway.
  function buildSubmission(input) {
    var message = String((input && input.message) || '').trim();
    var category = input && input.category;
    if (categoryIds().indexOf(category) === -1) category = 'other';
    var contactEmail = (input && input.contactEmail) ? String(input.contactEmail).trim() : '';
    var submission = { message: message, category: category };
    if (contactEmail) submission.contactEmail = contactEmail;
    return submission;
  }

  // SubmitFeedbackResult -> UI status copy. A retryable failure appends
  // "Try again." to the main-process error; a non-retryable failure passes
  // that error straight through (it already names the support email).
  function resultStatus(result) {
    if (result && result.ok) {
      return { text: 'Thanks — your feedback was sent.', retryable: false };
    }
    var error = (result && result.error) || 'Could not submit feedback.';
    var retryable = !!(result && result.retryable);
    return { text: retryable ? error + ' Try again.' : error, retryable: retryable };
  }

  var api = {
    CATEGORIES: CATEGORIES,
    validate: validate,
    buildSubmission: buildSubmission,
    resultStatus: resultStatus,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.feedbackForm = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
