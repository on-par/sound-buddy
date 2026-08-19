// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import FeedbackDialog from './FeedbackDialog';
import { useFeedbackDialogStore } from './stores/feedbackDialogStore';

function renderMarkup(): string {
  return renderToString(createElement(FeedbackDialog));
}

const CLOSED_STATE = {
  dialogOpen: false,
  category: 'bug',
  message: '',
  contactEmail: '',
  attachDiagnostics: false,
  diagHint: null as string | null,
  status: '',
  sending: false,
  emailInsteadVisible: false,
};

beforeEach(() => {
  (globalThis as { window?: unknown }).window = {
    feedbackForm: { CATEGORIES: [{ id: 'bug', label: 'Bug' }, { id: 'idea', label: 'Idea' }] },
  };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  useFeedbackDialogStore.setState(CLOSED_STATE);
});

describe('FeedbackDialog', () => {
  it('is hidden (display:none) when the dialog is closed', () => {
    useFeedbackDialogStore.setState({ ...CLOSED_STATE, dialogOpen: false });

    const html = renderMarkup();

    expect(html).toContain('id="feedback-dialog"');
    expect(html).toContain('display:none');
  });

  it('is visible when open', () => {
    useFeedbackDialogStore.setState({ ...CLOSED_STATE, dialogOpen: true });

    const html = renderMarkup();

    expect(html).toContain('display:flex');
  });

  it('renders one option per window.feedbackForm.CATEGORIES entry', () => {
    const html = renderMarkup();

    expect(html).toContain('>Bug</option>');
    expect(html).toContain('<option value="idea">Idea</option>');
  });

  it('reflects the message/contactEmail/category field values', () => {
    useFeedbackDialogStore.setState({ ...CLOSED_STATE, message: 'it broke', contactEmail: 'me@x.com', category: 'idea' });

    const html = renderMarkup();

    expect(html).toContain('it broke');
    expect(html).toContain('value="me@x.com"');
  });

  it('shows the diagnostic hint text only when set', () => {
    useFeedbackDialogStore.setState({ ...CLOSED_STATE, diagHint: 'No diagnostic log exists yet — try again after using the app.' });

    const html = renderMarkup();

    expect(html).toMatch(/id="feedback-diag-hint"[^>]*>No diagnostic log exists yet/);
  });

  it('hides the diagnostic hint when unset', () => {
    const html = renderMarkup();

    expect(html).toMatch(/id="feedback-diag-hint"[^>]*style="display:none"/);
  });

  it('reflects the status text', () => {
    useFeedbackDialogStore.setState({ ...CLOSED_STATE, status: 'Sending…' });

    const html = renderMarkup();

    expect(html).toContain('Sending…');
  });

  it('disables Send while sending', () => {
    useFeedbackDialogStore.setState({ ...CLOSED_STATE, sending: true });

    const html = renderMarkup();

    expect(html).toMatch(/id="feedback-dialog-send"[^>]*disabled=""/);
  });

  it('shows Email instead only when emailInsteadVisible', () => {
    useFeedbackDialogStore.setState({ ...CLOSED_STATE, emailInsteadVisible: true });

    const html = renderMarkup();

    expect(html).not.toMatch(/id="feedback-dialog-email-instead"[^>]*style="display:none"/);
  });

  it('hides Email instead by default', () => {
    const html = renderMarkup();

    expect(html).toMatch(/id="feedback-dialog-email-instead"[^>]*style="display:none"/);
  });

  it('labels the diagnostics checkbox as including the log, not revealing it', () => {
    const html = renderMarkup();

    expect(html).toContain('Include my diagnostic log');
    expect(html).not.toContain('never uploaded');
  });

  it('discloses what is never sent without claiming nothing leaves the machine', () => {
    const html = renderMarkup();

    expect(html).toContain('Never audio or recordings');
    expect(html).toContain('Email addresses and license keys are stripped');
    expect(html).not.toContain('anything else from your machine');
  });
});
