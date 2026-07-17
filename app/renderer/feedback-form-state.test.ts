import { describe, it, expect } from 'vitest';

// feedback-form-state is a plain classic script (window.feedbackForm in the
// browser, module.exports under Node) so the pure validation/submission/
// status logic is exercised without a DOM, mirroring feedback-ringout-state.test.ts.

interface Category {
  id: string;
  label: string;
}

interface ValidateInput {
  message?: unknown;
  contactEmail?: unknown;
}

interface ValidateResult {
  ok: boolean;
  error?: string;
}

interface SubmissionInput {
  message?: unknown;
  category?: unknown;
  contactEmail?: unknown;
}

interface Submission {
  message: string;
  category: string;
  contactEmail?: string;
}

interface SubmitResult {
  ok: boolean;
  retryable?: boolean;
  error?: string;
}

interface ResultStatus {
  text: string;
  retryable: boolean;
}

const { CATEGORIES, validate, buildSubmission, resultStatus } = require('./feedback-form-state.js') as {
  CATEGORIES: Category[];
  validate: (input: ValidateInput) => ValidateResult;
  buildSubmission: (input: SubmissionInput) => Submission;
  resultStatus: (result: SubmitResult) => ResultStatus;
};

describe('CATEGORIES', () => {
  it('lists exactly bug, idea, question, other with labels', () => {
    expect(CATEGORIES).toEqual([
      { id: 'bug', label: 'Bug' },
      { id: 'idea', label: 'Idea' },
      { id: 'question', label: 'Question' },
      { id: 'other', label: 'Other' },
    ]);
  });
});

describe('validate', () => {
  it('accepts a well-formed message with no contact email', () => {
    expect(validate({ message: 'the meter froze during a live session' })).toEqual({ ok: true });
  });

  it('accepts a well-formed message with a valid contact email', () => {
    expect(validate({ message: 'a bug report', contactEmail: 'pat@example.com' })).toEqual({
      ok: true,
    });
  });

  it('rejects an empty message', () => {
    const result = validate({ message: '' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/enter a short message/i);
  });

  it('rejects a whitespace-only message', () => {
    const result = validate({ message: '   \n\t  ' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/enter a short message/i);
  });

  it('rejects a missing message', () => {
    const result = validate({});
    expect(result.ok).toBe(false);
  });

  it('rejects a message over 4000 characters', () => {
    const result = validate({ message: 'x'.repeat(4001) });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/too long/i);
  });

  it('accepts a message of exactly 4000 characters', () => {
    expect(validate({ message: 'x'.repeat(4000) })).toEqual({ ok: true });
  });

  it('rejects a non-empty contact email that is not email-shaped', () => {
    const result = validate({ message: 'hi', contactEmail: 'not-an-email' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/valid email/i);
  });

  it('rejects a contact email over 254 chars, matching the worker\'s bound', () => {
    const overlong = 'a'.repeat(250) + '@x.com'; // > 254 chars
    const result = validate({ message: 'hi', contactEmail: overlong });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/valid email/i);
  });

  it('accepts an empty-string contact email (treated as omitted)', () => {
    expect(validate({ message: 'hi', contactEmail: '' })).toEqual({ ok: true });
  });
});

describe('buildSubmission', () => {
  it('trims the message and keeps a known category', () => {
    expect(buildSubmission({ message: '  it crashed  ', category: 'bug' })).toEqual({
      message: 'it crashed',
      category: 'bug',
    });
  });

  it('omits contactEmail when absent', () => {
    const submission = buildSubmission({ message: 'hi', category: 'idea' });
    expect(submission).not.toHaveProperty('contactEmail');
  });

  it('omits contactEmail when empty/whitespace', () => {
    const submission = buildSubmission({ message: 'hi', category: 'idea', contactEmail: '   ' });
    expect(submission).not.toHaveProperty('contactEmail');
  });

  it('trims and includes a provided contactEmail', () => {
    const submission = buildSubmission({
      message: 'hi',
      category: 'idea',
      contactEmail: '  pat@example.com  ',
    });
    expect(submission.contactEmail).toBe('pat@example.com');
  });

  it('coerces an unknown category to "other"', () => {
    expect(buildSubmission({ message: 'hi', category: 'rant' })).toEqual({
      message: 'hi',
      category: 'other',
    });
  });

  it('coerces a missing category to "other"', () => {
    expect(buildSubmission({ message: 'hi' })).toEqual({ message: 'hi', category: 'other' });
  });
});

describe('resultStatus', () => {
  it('returns success copy for an ok result', () => {
    expect(resultStatus({ ok: true })).toEqual({
      text: 'Thanks — your feedback was sent.',
      retryable: false,
    });
  });

  it('appends "Try again." for a retryable failure', () => {
    expect(
      resultStatus({ ok: false, retryable: true, error: 'The feedback service is busy.' })
    ).toEqual({
      text: 'The feedback service is busy. Try again.',
      retryable: true,
    });
  });

  it('passes through the main-process error unchanged for a non-retryable failure', () => {
    expect(
      resultStatus({
        ok: false,
        retryable: false,
        error: 'Could not submit feedback — email support@soundbuddy.online instead.',
      })
    ).toEqual({
      text: 'Could not submit feedback — email support@soundbuddy.online instead.',
      retryable: false,
    });
  });
});
